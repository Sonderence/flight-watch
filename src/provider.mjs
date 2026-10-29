export function validateInput(number, date) {
  const flight = String(number ?? '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(flight) || !/[A-Z]/.test(flight.slice(0, 3))) throw new Error('Enter a flight number such as AA100.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Enter a real departure date as YYYY-MM-DD.');
  return { flight, date };
}

export function normalizeFlights(data) {
  if (!Array.isArray(data)) throw new Error('Unexpected provider response: expected a list of flights.');
  return data.map(f => {
    if (!f || typeof f !== 'object') throw new Error('Unexpected flight record.');
    const movement = m => ({
      airport: m?.airport?.iata ?? m?.airport?.icao ?? null,
      airportName: m?.airport?.name ?? null,
      countryCode: m?.airport?.countryCode ?? null,
      scheduled: m?.scheduledTime?.local ?? m?.scheduledTime?.utc ?? null,
      revised: m?.revisedTime?.local ?? m?.revisedTime?.utc ?? null,
      terminal: m?.terminal ?? null, gate: m?.gate ?? null,
      quality: m?.quality ?? []
    });
    return { number: f.number ?? null, airline: f.airline?.name ?? null, airlineCode: f.airline?.iata ?? f.airline?.icao ?? null,
      status: f.status ?? 'Unknown', departure: movement(f.departure), arrival: movement(f.arrival) };
  });
}

export async function lookup({ flight, date, key, fetchImpl = fetch }) {
  const url = new URL(`https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flight)}/${date}`);
  url.search = new URLSearchParams({ dateLocalRole: 'Departure', withFlightPlan: 'false', withAircraftImage: 'false', withLocation: 'false' });
  const response = await fetchImpl(url, { headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': url.hostname, Accept: 'application/json' }, signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (response.status === 204) return [];
  if (!response.ok) {
    const messages = { 401: 'API key was rejected.', 403: 'Access denied. Check the subscription and key.', 429: 'Provider quota or rate limit reached. No retry was made.' };
    throw new Error(messages[response.status] ?? `Provider returned HTTP ${response.status}. No retry was made.`);
  }
  return normalizeFlights(await response.json());
}
