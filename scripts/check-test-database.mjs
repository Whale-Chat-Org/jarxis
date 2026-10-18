import 'dotenv/config';
import { assertTestDatabaseUrl } from './lib/test-database.mjs';

assertTestDatabaseUrl(process.env.DATABASE_URL);
