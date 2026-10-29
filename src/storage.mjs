import { compareFlights } from './changes.mjs';

export function flightKey(flight, source) {
  compareFlights(null, flight); // Validate identity before any database request.
  if (!['synthetic', 'aerodatabox'].includes(source)) throw new Error('Unknown data source.');
  return [source, flight.number.replace(/\s/g, '').toUpperCase(), flight.departure.airport.toUpperCase(), flight.arrival.airport.toUpperCase(), flight.departure.scheduled.slice(0, 10)].join('|');
}

export function createStorage({ url, key, fetchImpl = fetch }) {
  if (!url || !key) throw new Error('Add SUPABASE_URL and SUPABASE_SECRET_KEY to .env. See DATABASE-SETUP.md.');
  const base = new URL(url);
  if (base.protocol !== 'https:' || !base.hostname.endsWith('.supabase.co') || base.username || base.password || base.port || base.pathname !== '/' || base.search || base.hash) throw new Error('Use your HTTPS Supabase project URL, e.g. https://PROJECT.supabase.co');
  if (!key.startsWith('sb_secret_')) throw new Error('Use a backend Supabase secret key (sb_secret_...), not a publishable key.');
  async function request(path, body) {
    const response = await fetchImpl(new URL(`/rest/v1/${path}`, base), {
      method: body ? 'POST' : 'GET',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000), redirect: 'error'
    });
    if (!response.ok) throw new Error(`Database request failed (HTTP ${response.status}). Check the project, secret key, and migration. No secrets or response bodies were logged.`);
    return response.json();
  }
  return {
    async save(flight, { source = 'synthetic', observedAt = new Date().toISOString(), observationId = crypto.randomUUID() } = {}) {
      if (!Number.isFinite(Date.parse(observedAt))) throw new Error('Invalid observation time.');
      const id = flightKey(flight, source);
      for (let attempt = 0; attempt < 3; attempt++) {
        const query = new URLSearchParams({ id: `eq.${id}`, select: 'version,comparison_state,observed_at,expires_at' });
        const rows = await request(`flight_tracks?${query}`);
        if (!Array.isArray(rows)) throw new Error('Unexpected database response.');
        const row = rows[0];
        const previous = row?.expires_at && Date.parse(row.expires_at) > Date.now() ? row.comparison_state : null;
        const { snapshot, events } = compareFlights(previous, flight);
        const result = await request('rpc/save_flight_observation', {
          p_id: observationId, p_flight_id: id, p_source: source, p_expected_version: row?.version ?? 0,
          p_observed_at: observedAt, p_snapshot: flight, p_state: snapshot, p_events: events
        });
        if (result.result !== 'conflict') return { ...result, flightId: id };
      }
      throw new Error('Flight changed concurrently. Retry this same observation ID later.');
    }
  };
}
