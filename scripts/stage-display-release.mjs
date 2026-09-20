import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

function inside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

function filesAt(root, path = '') {
  return readdirSync(resolve(root, path), { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name.startsWith('.env')) {
      throw new Error('Stage a built static directory, not source files or credentials.');
    }
    const file = path ? `${path}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return filesAt(root, file);
    if (!entry.isFile()) throw new Error(`Build files must be regular files: ${file}`);
    return [file];
  });
}

/** GitHub Pages caches HTML independently from JS. Old hashed files must remain
 * available for cached entrypoints and their transitive imports after a release. */
export function stageDisplayRelease(buildDirectory, releaseDirectory) {
  const source = resolve(buildDirectory), destination = resolve(releaseDirectory);
  if (inside(source, destination) || inside(destination, source)) throw new Error('Build and release directories must be separate.');
  if (!existsSync(resolve(source, 'index.html')) || !existsSync(resolve(source, 'assets'))) {
    throw new Error('Build the display first; index.html and assets/ are required.');
  }
  const files = filesAt(source);
  // A fingerprinted URL is immutable. Reject a conflicting build before any
  // entrypoint is changed, instead of corrupting an existing cached release.
  for (const file of files.filter(file => file.startsWith('assets/'))) {
    const target = resolve(destination, file);
    if (existsSync(target) && (!statSync(target).isFile() || !readFileSync(target).equals(readFileSync(resolve(source, file))))) {
      throw new Error(`Existing asset has different content at the same URL: ${file}`);
    }
  }
  // Merge only; never delete the prior release's assets or the checkout's .git.
  // Copy assets before HTML so newly published entrypoints can already load.
  const order = file => file.startsWith('assets/') ? 0 : file.endsWith('.html') ? 2 : 1;
  for (const file of files.sort((a, b) => order(a) - order(b))) {
    const target = resolve(destination, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(resolve(source, file), target);
  }
  return { files: files.length, destination };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, destination, ...extra] = process.argv.slice(2);
  if (!source || !destination || extra.length) throw new Error('Usage: node scripts/stage-display-release.mjs BUILD_DIRECTORY PAGES_CHECKOUT');
  const result = stageDisplayRelease(source, destination);
  console.log(`Staged ${result.files} files at ${result.destination}; historical assets retained.`);
}
