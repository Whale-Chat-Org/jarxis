import { writeFile } from 'node:fs/promises';
import { publicLoginUrl } from '../src/lib/ml/login';

const destination = process.env.ML_BROWSER_CAPTURE;
const url = publicLoginUrl('claude', process.argv.at(-1) ?? '');
if (!destination || !url) process.exitCode = 1;
else await writeFile(destination, url, { mode: 0o600, flag: 'wx' });
