import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Sites accepts static output at the repository's dist/ directory. Keep the
// workspace build usable independently and stage exactly its generated files.
const source = fileURLToPath(new URL('../glasses-web/dist/', import.meta.url));
const destination = fileURLToPath(new URL('../dist/', import.meta.url));
if (!existsSync(`${source}/index.html`)) throw new Error('Build glasses-web before staging the display.');
rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });
