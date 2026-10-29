import { lookup, validateInput } from './provider.mjs';
import { createStorage, flightKey } from './storage.mjs';

export async function runWorker({ rpc, storage, lookupFlight }) {
  const claim = await rpc('claim_flight_check', {});
  if (claim.result !== 'claimed') return { result: claim.result };
  const target = claim.flight;
  let outcome = 'failed', stop = false;
  try {
    const input = validateInput(target.number, target.departure_date);
    const flights = await lookupFlight(input);
    const expectedKey = ['aerodatabox', input.flight, target.origin, target.destination, input.date].join('|');
    const matches = flights.filter(f => {
      try { return flightKey(f, 'aerodatabox') === expectedKey; } catch { return false; }
    });
    if (!matches.length) outcome = 'no_match';
    else if (matches.length !== 1) { outcome = 'ambiguous'; stop = true; }
    else if (matches[0].departure.countryCode !== 'US' || matches[0].arrival.countryCode !== 'US') {
      outcome = 'unsupported_route'; stop = true;
    } else {
      const flight = matches[0];
      const saved = await storage.save(flight, { source: 'aerodatabox', observedAt: new Date().toISOString(), observationId: claim.attempt_id });
      if (!['saved', 'duplicate', 'stale'].includes(saved.result)) throw new Error('Unexpected save result');
      outcome = saved.result;
      stop = ['arrived', 'canceled', 'cancelled', 'diverted'].includes(String(flight.status).toLowerCase());
    }
  } catch {
    // Failure consumes the reservation; no provider retry. Pause until operator
    // review instead of repeatedly spending quota on a broken configuration.
    stop = true;
  }
  await rpc('finish_flight_check', { p_attempt_id: claim.attempt_id, p_outcome: outcome, p_stop: stop });
  return { result: outcome, stopped: stop };
}

export function createWorkerHandler(env, fetchImpl = fetch) {
  return async request => {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const secret = env('WORKER_CRON_SECRET');
    if (!secret || secret.length < 32 || request.headers.get('x-worker-secret') !== secret) return new Response('Unauthorized', { status: 401 });
    // A second explicit kill switch prevents accidental live activation on deploy.
    if (env('WORKER_LIVE_ENABLED') !== 'true') return Response.json({ result: 'disabled' });
    try {
      const url = env('SUPABASE_URL');
      const key = env('WORKER_DB_SECRET');
      const rapidKey = env('RAPIDAPI_KEY');
      if (!rapidKey) throw new Error('Missing flight key');
      const storage = createStorage({ url, key, fetchImpl }); // Validates endpoint before RPC.
      const rpc = async (name, body) => {
        const response = await fetchImpl(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
          method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(15000), redirect: 'error'
        });
        if (!response.ok) throw new Error('Database RPC failed');
        return response.json();
      };
      const result = await runWorker({ rpc, storage, lookupFlight: input => lookup({ ...input, key: rapidKey, fetchImpl }) });
      console.info(JSON.stringify({ worker: 'flight-worker', ...result }));
      return Response.json(result);
    } catch {
      return Response.json({ result: 'worker_error', message: 'Check database setup and function secrets. No automatic provider retry.' }, { status: 500 });
    }
  };
}
