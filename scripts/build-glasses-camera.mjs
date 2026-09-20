import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Require the intended server on every build, then check the signed artifact
// before installation. Reusing an old build must never silently ship an old host.
const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
  if (!['--server', '--team', '--derived-data', '--device'].includes(args[index]) || !args[index + 1]
    || options.has(args[index])) throw new Error('Use --server https://HOST --team TEAM [--derived-data PATH] [--device ID].');
  options.set(args[index], args[index + 1]);
}
if (!options.has('--server') || !options.has('--team')) throw new Error('An explicit --server and --team are required.');
const server = new URL(options.get('--server'));
if (server.protocol !== 'https:' || server.username || server.password || server.search || server.hash
  || !['', '/'].includes(server.pathname)) throw new Error('--server must be an HTTPS origin, without credentials, a path or query.');
const root = fileURLToPath(new URL('../', import.meta.url));
const derivedData = resolve(options.get('--derived-data') || `${tmpdir()}/kith-camera-${server.hostname}`);
const app = resolve(derivedData, 'Build/Products/Debug-iphoneos/BondimalsCamera.app');
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer' };
function run(command, arguments_, capture = false) {
  const result = spawnSync(command, arguments_, { cwd: root, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}). ${capture ? result.stderr : ''}`);
  return result.stdout?.trim();
}
run('xcrun', ['xcodebuild', '-project', 'glasses-ios/BondimalsCamera.xcodeproj', '-scheme', 'BondimalsCamera',
  '-configuration', 'Debug', '-destination', 'generic/platform=iOS', '-derivedDataPath', derivedData,
  `DEVELOPMENT_TEAM=${options.get('--team')}`, 'CODE_SIGN_STYLE=Automatic',
  `BONDIMALS_SERVER_URL=${server.origin}`, '-allowProvisioningUpdates', 'build']);
const embeddedServer = run('/usr/libexec/PlistBuddy', ['-c', 'Print :KithGameServerURL', `${app}/Info.plist`], true);
if (embeddedServer !== server.origin) throw new Error(`Refusing to install: built server ${embeddedServer} does not match ${server.origin}.`);
const version = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', `${app}/Info.plist`], true);
console.log(`Verified Kith Camera ${version}: ${embeddedServer}\n${app}`);
if (options.has('--device')) run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', options.get('--device'), app]);
