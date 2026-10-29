import { readFile, writeFile, open, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { lookup, normalizeFlights, validateInput } from './provider.mjs';

const root = new URL('../', import.meta.url);
const args = process.argv.slice(2);
try {
  if (!args.includes('--live')) {
    const sample = JSON.parse(await readFile(new URL('fixtures/flight.json', root), 'utf8'));
    console.log(JSON.stringify({ mode: 'SIMULATED — not a real flight', source: 'Synthetic fixture', flights: normalizeFlights(sample) }, null, 2));
  } else {
    const { flight, date } = validateInput(args[0], args[1]);
    if (process.env.LIVE_LOOKUP_ENABLED !== 'true') throw new Error('Live mode is disabled. Check the free subscription and billing controls, then set LIVE_LOOKUP_ENABLED=true in .env.');
    if (!process.env.RAPIDAPI_KEY) throw new Error('Add your RapidAPI key to the local .env file.');
    // One local process at a time; reserve quota before sending, even if the request fails.
    const lockPath = new URL('.usage.lock', root);
    const lock = await open(lockPath, 'wx');
    try {
      const usagePath = new URL('.usage.json', root);
      let usage = { reservedUnits: 0 };
      try { usage = JSON.parse(await readFile(usagePath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (!Number.isSafeInteger(usage.reservedUnits) || usage.reservedUnits < 0) throw new Error('Invalid usage ledger; live lookup blocked.');
      if (usage.reservedUnits + 2 > 20) throw new Error('Experiment cap reached: 20 units total. Live lookup blocked.');
      await writeFile(usagePath, JSON.stringify({ reservedUnits: usage.reservedUnits + 2 }));
      const flights = await lookup({ flight, date, key: process.env.RAPIDAPI_KEY });
      console.log(JSON.stringify({ mode: 'LIVE', source: 'AeroDataBox — https://aerodatabox.com', retrievedAt: new Date().toISOString(), reservedUnits: usage.reservedUnits + 2, flights }, null, 2));
      if (!flights.length) console.log('No matching flight returned; this does not mean the flight is cancelled.');
    } finally { await lock.close(); await unlink(lockPath); }
  }
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'Another lookup is running or a previous lock remains. Live lookup blocked.' : error.name === 'TimeoutError' ? 'Provider timed out. No retry was made.' : error.message);
  process.exitCode = 1;
}
