import type { FastifyInstance } from 'fastify';
import { mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { db, DATA_DIR } from '../db.js';
import { requireManager } from '../auth.js';
import { onlineConfigured, pullCloudBackup } from '../online/sync.js';

/** Εντοπίζει το εκτελέσιμο pg_dump: δέχεται είτε πλήρη διαδρομή αρχείου, είτε ΦΑΚΕΛΟ (bin) — οπότε
 *  προσθέτει μόνο του το pg_dump(.exe). Κενό → ψάχνει στο PATH. */
function resolvePgDump(p?: string): string {
  const isWin = process.platform === 'win32';
  const exe = isWin ? 'pg_dump.exe' : 'pg_dump';
  let t = (p ?? '').trim().replace(/^"(.*)"$/, '$1'); // αφαίρεσε τυχόν εισαγωγικά
  if (!t) return exe; // από το PATH
  try {
    if (existsSync(t) && statSync(t).isDirectory()) t = join(t, exe); // έδωσαν φάκελο → πρόσθεσε το εκτελέσιμο
    else if (isWin && !/\.exe$/i.test(t) && existsSync(t + '.exe')) t = t + '.exe';
  } catch { /* αγνόησε — θα φανεί στο σφάλμα εκτέλεσης */ }
  return t;
}

/** Πλήρες backup της cloud βάσης (schema + data + functions + policies) με pg_dump → plain SQL. */
function pgDumpFull(conn: string, pgDumpPath: string, outFile: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const bin = resolvePgDump(pgDumpPath);
    const args = ['--dbname', conn, '--no-owner', '--no-privileges', '-f', outFile];
    execFile(bin, args, { timeout: 180000, windowsHide: true }, (err, _out, stderr) => {
      if (err) {
        const enoent = (err as NodeJS.ErrnoException).code === 'ENOENT';
        reject(new Error(enoent
          ? `Δεν βρέθηκε το pg_dump στο «${bin}». Δώσε την ΠΛΗΡΗ διαδρομή του pg_dump.exe (ή τον φάκελο bin) στις ρυθμίσεις, ή εγκατέστησε PostgreSQL client tools.`
          : ('pg_dump: ' + String(stderr || err.message)).slice(0, 500)));
      } else resolve();
    });
  });
}

const BACKUP_DIR = join(DATA_DIR, '..', 'backups');

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export default async function backupRoutes(app: FastifyInstance) {
  // Δημιουργία συνεπούς αντιγράφου (VACUUM INTO) + επιστροφή για άμεση λήψη.
  app.post('/api/backup', { preHandler: requireManager }, async (_req, reply) => {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const st = stamp();
    const file = `ticket-${st}.db`;
    const full = join(BACKUP_DIR, file);
    try {
      // VACUUM INTO γράφει καθαρό, συνεπές single-file αντίγραφο ακόμη και με ενεργό WAL.
      db.exec(`VACUUM INTO '${full.replace(/'/g, "''")}'`);
    } catch (e) {
      return reply.code(500).send({ error: 'Αποτυχία backup: ' + (e as Error).message });
    }
    const size = statSync(full).size;
    const base64 = readFileSync(full).toString('base64');

    // Αν είναι ρυθμισμένο το Cloud → τράβα και αντίγραφο της cloud βάσης στον ίδιο φάκελο (JSON δεδομένων).
    let cloud: { file: string; size: number; counts: Record<string, number> } | { error: string } | null = null;
    if (onlineConfigured()) {
      try {
        const dump = await pullCloudBackup();
        const cfile = `cloud-${st}.json`;
        const cfull = join(BACKUP_DIR, cfile);
        writeFileSync(cfull, JSON.stringify(dump));
        cloud = { file: cfile, size: statSync(cfull).size, counts: dump.counts };
      } catch (e) {
        cloud = { error: (e as Error).message }; // η αποτυχία cloud ΔΕΝ ακυρώνει το τοπικό backup
      }
    }

    // ΠΛΗΡΕΣ cloud backup (schema+data+functions+policies) με pg_dump — αν έχει οριστεί connection string.
    let fullDump: { file: string; size: number } | { error: string } | null = null;
    const ocfg = db.prepare('SELECT pg_conn, pg_dump_path FROM online_config WHERE id = 1').get() as any;
    if (ocfg?.pg_conn) {
      const sfile = `cloud-full-${st}.sql`;
      const sfull = join(BACKUP_DIR, sfile);
      try {
        await pgDumpFull(String(ocfg.pg_conn), String(ocfg.pg_dump_path ?? ''), sfull);
        fullDump = { file: sfile, size: statSync(sfull).size };
      } catch (e) {
        try { unlinkSync(sfull); } catch { /* ignore */ }
        fullDump = { error: (e as Error).message };
      }
    }
    return { ok: true, file, path: full, size, base64, cloud, fullDump };
  });

  // Λίστα αντιγράφων στον φάκελο backups/
  app.get('/api/backups', { preHandler: requireManager }, async () => {
    mkdirSync(BACKUP_DIR, { recursive: true });
    return readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.db') || f.endsWith('.json') || f.endsWith('.sql'))
      .map((f) => { const s = statSync(join(BACKUP_DIR, f)); const kind = f.endsWith('.sql') ? 'cloud-full' : f.endsWith('.json') ? 'cloud' : 'local'; return { file: f, size: s.size, mtime: s.mtime.toISOString(), kind }; })
      .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  });

  // Λήψη συγκεκριμένου αντιγράφου (προστασία από path traversal με basename).
  app.get('/api/backups/:file', { preHandler: requireManager }, async (req, reply) => {
    const file = basename(String((req.params as any).file));
    const full = join(BACKUP_DIR, file);
    try {
      const buf = readFileSync(full);
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${file}"`);
      return reply.send(buf);
    } catch {
      return reply.code(404).send({ error: 'Δεν βρέθηκε' });
    }
  });

  // Διαγραφή συγκεκριμένου αντιγράφου (manager). Προστασία από path traversal με basename + έλεγχο κατάληξης .db.
  app.delete('/api/backups/:file', { preHandler: requireManager }, async (req, reply) => {
    const file = basename(String((req.params as any).file));
    if (!file.endsWith('.db') && !file.endsWith('.json') && !file.endsWith('.sql')) return reply.code(400).send({ error: 'Μη έγκυρο αρχείο' });
    try {
      unlinkSync(join(BACKUP_DIR, file));
      return { ok: true, file };
    } catch {
      return reply.code(404).send({ error: 'Δεν βρέθηκε' });
    }
  });
}
