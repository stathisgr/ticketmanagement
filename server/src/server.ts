import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from './db.js';
import authRoutes from './routes/auth.js';
import ticketTypeRoutes from './routes/ticketTypes.js';
import customerRoutes from './routes/customers.js';
import salesRoutes from './routes/sales.js';
import tillRoutes from './routes/till.js';
import venueRoutes from './routes/venue.js';
import hallRoutes from './routes/halls.js';
import showRoutes from './routes/shows.js';
import reportRoutes from './routes/reports.js';
import printerRoutes from './routes/printers.js';
import backupRoutes from './routes/backup.js';
import checkinRoutes from './routes/checkin.js';
import onlineRoutes from './routes/online.js';
import { startAutoSync } from './online/scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET ?? 'change-me-in-production';

async function main() {
  migrate();

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: JWT_SECRET });

  await app.register(authRoutes);
  await app.register(ticketTypeRoutes);
  await app.register(customerRoutes);
  await app.register(salesRoutes);
  await app.register(tillRoutes);
  await app.register(venueRoutes);
  await app.register(hallRoutes);
  await app.register(showRoutes);
  await app.register(reportRoutes);
  await app.register(printerRoutes);
  await app.register(backupRoutes);
  await app.register(checkinRoutes);
  await app.register(onlineRoutes);

  app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));

  // Σερβίρισμα του built client (production)
  const clientDist = join(__dirname, '..', '..', 'client', 'dist');
  if (existsSync(clientDist)) {
    await app.register(fastifyStatic, { root: clientDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  } else {
    // Development: το UI τρέχει στον Vite (5173). Φιλικό μήνυμα στη ρίζα.
    app.get('/', async (_req, reply) => {
      reply.type('text/html').send(
        `<!doctype html><html lang="el"><meta charset="utf-8"><body style="font-family:system-ui;padding:2rem">
         <h2>🎟️ Ticket Manager — API</h2>
         <p>Αυτή είναι η θύρα του <b>API</b> (development). Το περιβάλλον χρήστη τρέχει στον Vite:</p>
         <p><a href="http://localhost:5173" style="font-size:1.2rem">➡️ http://localhost:5173</a></p>
         <p style="color:#888">Σε παραγωγή (<code>npm run build</code> → <code>npm start</code>) το UI σερβίρεται από εδώ.</p>
         </body></html>`
      );
    });
  }

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Ticket Manager API → http://localhost:${PORT}`);

  // Αυτόματος συγχρονισμός online (αν ρυθμιστεί auto_sync_minutes > 0) — χωρίς ανάγκη login.
  startAutoSync();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
