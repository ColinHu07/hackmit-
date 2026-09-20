import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { serveoSshArgs } from './share-phone-web.mjs';

test('reserved tunnels only use the registered key and retain pinned host verification', () => {
  const args = serveoSshArgs(8788, { hostname: 'kith.serveousercontent.com', identityFile: './test-key' });
  assert.equal(args[args.indexOf('-R') + 1], 'kith.serveousercontent.com:80:127.0.0.1:8788');
  for (const option of ['StrictHostKeyChecking=yes', 'IdentitiesOnly=yes', 'IdentityAgent=none', 'CertificateFile=none', 'PasswordAuthentication=no', 'PreferredAuthentications=publickey,keyboard-interactive', `IdentityFile=${resolve('./test-key')}`]) {
    assert.ok(args.includes(option), option);
  }
});

test('anonymous sharing cannot borrow personal keys', () => {
  const args = serveoSshArgs(8788);
  assert.ok(args.includes('IdentityFile=none'));
  assert.ok(args.includes('PubkeyAuthentication=no'));
  assert.ok(args.includes('IdentityAgent=none'));
});

test('a reserved hostname cannot silently fall back to anonymous authentication', () => {
  assert.throws(() => serveoSshArgs(8788, { hostname: 'kith.serveousercontent.com' }), /both required/);
  assert.throws(() => serveoSshArgs(8788, { identityFile: './test-key' }), /both required/);
  for (const hostname of ['https://kith.serveousercontent.com', 'kith.serveousercontent.com/play', 'kith.example.com', 'kith.serveousercontent.com:80:evil']) {
    assert.throws(() => serveoSshArgs(8788, { hostname, identityFile: './test-key' }), /hostname/);
  }
  assert.throws(() => serveoSshArgs(0), /port/);
});
