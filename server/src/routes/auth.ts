import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { authenticate, type JwtUser } from '../auth.js';

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/login', async (req, reply) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    if (!username) return reply.code(400).send({ error: 'Συμπληρώστε όνομα χρήστη' });

    const row = db
      .prepare('SELECT id, username, password_hash, role, full_name, enabled FROM users WHERE username = ?')
      .get(username) as
      | { id: number; username: string; password_hash: string; role: 'manager' | 'cashier' | 'checker'; full_name?: string; enabled: number }
      | undefined;

    // Επιτρέπεται κενός κωδικός (π.χ. ο ταμίας 'user') — compare με το hash του κενού string.
    if (!row || !row.enabled || !bcrypt.compareSync(password ?? '', row.password_hash)) {
      return reply.code(401).send({ error: 'Λάθος στοιχεία σύνδεσης' });
    }

    const payload: JwtUser = { id: row.id, username: row.username, role: row.role, full_name: row.full_name };
    const token = app.jwt.sign(payload, { expiresIn: '12h' });
    return { token, user: payload };
  });

  app.get('/api/me', { preHandler: authenticate }, async (req) => {
    return { user: req.user };
  });

  // Αλλαγή κωδικού του ΣΥΝΔΕΔΕΜΕΝΟΥ χρήστη (επιβεβαίωση τρέχοντος κωδικού).
  app.post('/api/me/password', { preHandler: authenticate }, async (req, reply) => {
    const user = req.user as JwtUser;
    const { current, next } = (req.body ?? {}) as { current?: string; next?: string };
    if (!next || String(next).length < 4)
      return reply.code(400).send({ error: 'Ο νέος κωδικός πρέπει να έχει τουλάχιστον 4 χαρακτήρες' });
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'Δεν βρέθηκε χρήστης' });
    if (!bcrypt.compareSync(current ?? '', row.password_hash))
      return reply.code(401).send({ error: 'Λάθος τρέχων κωδικός' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(next), 10), user.id);
    return { ok: true };
  });
}
