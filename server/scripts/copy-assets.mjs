// Αντιγράφει μη-TS assets στο dist μετά το tsc (τρέχει από το build script, cwd = server/).
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
copyFileSync('src/schema.sql', 'dist/schema.sql');
console.log('[build] copied src/schema.sql -> dist/schema.sql');
