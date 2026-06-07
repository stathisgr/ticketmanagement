import type { FastifyInstance } from 'fastify';
import { mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { db, DATA_DIR } from '../db.js';
import { requireManager } from '../auth.js';
import { onlineConfigured, pullCloudBackup } from '../online/sync.js';

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

    // Αν είναι ρυθμισμένο το Cloud → τράβα και αντίγραφο της cloud βάσης στον ίδιο φάκελο (JSON).
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
    return { ok: true, file, path: full, size, base64, cloud };
  });

  // Λίστα αντιγράφων στον φάκελο backups/
  app.get('/api/backups', { preHandler: requireManager }, async () => {
    mkdirSync(BACKUP_DIR, { recursive: true });
    return readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.db') || f.endsWith('.json'))
      .map((f) => { const s = statSync(join(BACKUP_DIR, f)); return { file: f, size: s.size, mtime: s.mtime.toISOString(), kind: f.endsWith('.json') ? 'cloud' : 'local' }; })
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
    if (!file.endsWith('.db') && !file.endsWith('.json')) return reply.code(400).send({ error: 'Μη έγκυρο αρχείο' });
    try {
      unlinkSync(join(BACKUP_DIR, file));
      return { ok: true, file };
    } catch {
      return reply.code(404).send({ error: 'Δεν βρέθηκε' });
    }
  });
}
