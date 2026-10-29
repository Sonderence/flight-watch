import { readFile } from 'node:fs/promises';
import { normalizeFlights } from './provider.mjs';
import { createStorage } from './storage.mjs';

try {
  const storage = createStorage({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY });
  const [flight] = normalizeFlights(JSON.parse(await readFile(new URL('../fixtures/flight.json', import.meta.url), 'utf8')));
  const stage = process.argv[2];
  if (!['baseline', 'delay', 'cancel'].includes(stage)) throw new Error('Choose baseline, delay, or cancel. See DATABASE-SETUP.md.');
  if (stage === 'baseline') flight.departure.revised = null;
  if (stage === 'cancel') flight.status = 'Canceled';
  const result = await storage.save(flight);
  console.log('Synthetic data saved in Supabase. No flight API calls or emails.');
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
