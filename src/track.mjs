import { createStorage } from './storage.mjs';
import { enrollment } from './monitor.mjs';
try {
  const target = enrollment(...process.argv.slice(2));
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  createStorage({ url, key }); // Enforce our trusted project endpoint and secret-key requirements.
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/flight_monitoring`, {
    method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify(target), signal: AbortSignal.timeout(15000), redirect: 'error'
  });
  if (!response.ok) throw new Error(`Could not enroll flight (HTTP ${response.status}). Check migration 002 and whether a pilot flight is already active. No API units used.`);
  console.log('Flight enrolled in Supabase. No flight lookup was made. The enabled cloud worker will check it within its time window and quota limits.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
