import 'dotenv/config';
import { db } from '../src/db';
import { runWorker } from '../src/lib/providers/worker';

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
try {
  await runWorker(controller.signal);
} catch {
  console.error('Providers worker could not start. Check its runtime configuration.');
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
