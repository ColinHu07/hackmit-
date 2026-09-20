import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Serve the phone and glasses games from the same trusted HTTPS game origin.
const source = fileURLToPath(new URL('../glasses-web/dist/', import.meta.url));
const destination = fileURLToPath(new URL('../companion-web/dist/glasses/', import.meta.url));
if (!existsSync(`${source}/index.html`)) throw new Error('Build the glasses game first.');
rmSync(destination, { force: true, recursive: true });
cpSync(source, destination, { recursive: true });
console.log('Glasses game ready at /glasses/index.html alongside the phone app.');
