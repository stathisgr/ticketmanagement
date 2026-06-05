import type { FastifyInstance } from 'fastify';
import { mkdirSync, readdirSync, statSync, readFileSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { db, DATA_DIR } from '../db.js';
import { requireManager } from '../auth.js';

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
    const file = `ticket-${stamp()}.db`;
    const full = join(BACKUP_DIR, file);
    try {
      // VACUUM INTO γράφει καθαρό, συνεπές single-file αντίγραφο ακόμη και με ενεργό WAL.
      db.exec(`VACUUM INTO '${full.replace(/'/g, "''")}'`);
    } catch (e) {
      return reply.code(500).send({ error: 'Αποτυχία backup: ' + (e as Error).message });
    }
    const size = statSync(full).size;
    const base64 = readFileSync(full).toString('base64');
    return { ok: true, file, path: full, size, base64 };
  });

  // Λίστα αντιγράφων στον φάκελο backups/
  app.get('/api/backups', { preHandler: requireManager }, async () => {
    mkdirSync(BACKUP_DIR, { recursive: true });
    return readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.db'))
      .map((f) => { const s = statSync(join(BACKUP_DIR, f)); return { file: f, size: s.size, mtime: s.mtime.toISOString() }; })
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
    if (!file.endsWith('.db')) return reply.code(400).send({ error: 'Μη έγκυρο αρχείο' });
    try {
      unlinkSync(join(BACKUP_DIR, file));
      return { ok: true, file };
    } catch {
      return reply.code(404).send({ error: 'Δεν βρέθηκε' });
    }
  });
}
