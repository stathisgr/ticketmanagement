// Παράγει καθαρό JS στο dist/ με esbuild (transpile-only, χωρίς type-check — όπως το tsx στο runtime,
// αλλά ahead-of-time). Έτσι ο πελάτης τρέχει `node dist/server.js` ΧΩΡΙΣ tsx/esbuild/typescript.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true }); // καθάρισμα τυχόν παλιών αρχείων
mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/server.ts', 'src/seed.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external', // οι εξαρτήσεις (fastify κ.λπ.) μένουν στο node_modules
  logLevel: 'info',
});
copyFileSync('src/schema.sql', 'dist/schema.sql');
console.log('[build] server -> dist (esbuild) + schema.sql');
