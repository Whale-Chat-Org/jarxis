import 'dotenv/config';
import { runWorker } from '../src/lib/ml/worker';
import { db } from '../src/db';

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
try {
  await runWorker(controller.signal);
} catch {
  console.error('ML worker could not start. Check its runtime configuration.');
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
