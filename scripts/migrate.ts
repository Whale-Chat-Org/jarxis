import 'dotenv/config';
import { spawnSync } from 'node:child_process';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to deploy migrations');
const result = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: process.env,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Migrations applied');
