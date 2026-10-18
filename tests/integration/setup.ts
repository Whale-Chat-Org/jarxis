import 'dotenv/config';
import { assertTestDatabaseUrl } from '../../scripts/lib/test-database.mjs';
assertTestDatabaseUrl(process.env.DATABASE_URL);
Object.assign(process.env, { NODE_ENV: 'test' });
