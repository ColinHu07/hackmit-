import { existsSync } from 'node:fs';
// Node 22.3 supports loadEnvFile but predates --env-file-if-exists.
if (existsSync('.env')) process.loadEnvFile('.env');
