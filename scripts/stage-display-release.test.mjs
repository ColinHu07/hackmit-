import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createStaticWebHandler } from '../bridge/static-web.mjs';
import { stageDisplayRelease } from './stage-display-release.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'kith-display-release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (directory, files) => {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(directory, name)), { recursive: true });
      writeFileSync(join(directory, name), content);
    }
  };
  return { root, write };
}

test('a cached prior entrypoint and its imported JS/CSS still load after staging a new release', async t => {
  const { root, write } = fixture(t);
  const first = join(root, 'first'), next = join(root, 'next'), release = join(root, 'pages');
  const oldHtml = '<script type="module" src="/assets/index-AAAAAAAA.js"></script><link rel="stylesheet" href="/assets/index-AAAAAAAA.css">';
  write(first, {
    'index.html': oldHtml,
    'assets/index-AAAAAAAA.js': 'import "./shared-AAAAAAAA.js"; export const version = 1;',
    'assets/shared-AAAAAAAA.js': 'export const shared = 1;',
    'assets/index-AAAAAAAA.css': 'body { color: green; }',
  });
  write(release, { '.git/HEAD': 'ref: refs/heads/codex/display', '.nojekyll': '' });
  stageDisplayRelease(first, release);
  const cachedHtml = readFileSync(join(release, 'index.html'), 'utf8');
  write(next, {
    'index.html': '<script type="module" src="/assets/index-BBBBBBBB.js"></script>',
    'assets/index-BBBBBBBB.js': 'export const version = 2;',
  });
  stageDisplayRelease(next, release);
  const server = createServer(createStaticWebHandler(release));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const oldReferences = [...cachedHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  for (const path of [...oldReferences, '/assets/shared-AAAAAAAA.js', '/assets/index-BBBBBBBB.js']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, `cached release dependency missing: ${path}`);
    assert.match(response.headers.get('content-type'), /javascript|css/);
  }
  assert.match(await (await fetch(origin)).text(), /index-BBBBBBBB/);
  assert.equal(readFileSync(join(release, '.git/HEAD'), 'utf8'), 'ref: refs/heads/codex/display');
  assert.equal(readFileSync(join(release, '.nojekyll'), 'utf8'), '');
});

test('a conflicting immutable asset aborts before replacing the current entrypoint', t => {
  const { root, write } = fixture(t);
  const build = join(root, 'build'), release = join(root, 'pages');
  write(release, { 'index.html': 'current', 'assets/index-AAAAAAAA.js': 'original bytes' });
  write(build, { 'index.html': 'replacement', 'assets/index-AAAAAAAA.js': 'different bytes' });
  assert.throws(() => stageDisplayRelease(build, release), /same URL/);
  assert.equal(readFileSync(join(release, 'index.html'), 'utf8'), 'current');
  assert.equal(readFileSync(join(release, 'assets/index-AAAAAAAA.js'), 'utf8'), 'original bytes');
});

test('invalid or overlapping build directories leave the existing release untouched', t => {
  const { root, write } = fixture(t);
  const release = join(root, 'pages'), missing = join(root, 'missing');
  write(release, { 'index.html': 'current', 'assets/index-AAAAAAAA.js': 'version 1' });
  assert.throws(() => stageDisplayRelease(missing, release), /Build the display first/);
  assert.throws(() => stageDisplayRelease(release, release), /must be separate/);
  assert.throws(() => stageDisplayRelease(release, join(release, 'nested')), /must be separate/);
  assert.equal(readFileSync(join(release, 'index.html'), 'utf8'), 'current');
});
