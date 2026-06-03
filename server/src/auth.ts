import type { FastifyReply, FastifyRequest } from 'fastify';

export interface JwtUser {
  id: number;
  username: string;
  role: 'manager' | 'cashier' | 'checker';
  full_name?: string;
}

/** Επαληθεύει JWT. Χρήση ως preHandler. */
export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    reply.code(401).send({ error: 'Μη εξουσιοδοτημένη πρόσβαση' });
  }
}

/** Απαιτεί ρόλο manager. */
export async function requireManager(req: FastifyRequest, reply: FastifyReply) {
  await authenticate(req, reply);
  const user = req.user as JwtUser | undefined;
  if (user && user.role !== 'manager') {
    reply.code(403).send({ error: 'Απαιτούνται δικαιώματα διαχειριστή' });
  }
}
