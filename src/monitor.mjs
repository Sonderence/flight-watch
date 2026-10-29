import { validateInput } from './provider.mjs';
export function enrollment(number, date, origin, destination, departureAt, now = Date.now()) {
  const input = validateInput(number, date);
  origin = String(origin ?? '').toUpperCase(); destination = String(destination ?? '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || origin === destination) throw new Error('Enter two different three-letter airport codes.');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(departureAt ?? '') || departureAt.slice(0, 10) !== date) throw new Error('Use a departure timestamp with its local UTC offset and matching date, e.g. 2026-10-28T08:00:00-05:00.');
  const time = Date.parse(departureAt);
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date || Number(departureAt.slice(11,13))>23 || Number(departureAt.slice(14,16))>59 || (departureAt.length>=19&&departureAt[16]===':'&&Number(departureAt.slice(17,19))>59)) throw new Error('Enter a real departure date and time.');
  if (!Number.isFinite(time) || time <= now || time > now + 24 * 3600000) throw new Error('Choose a departure in the next 24 hours.');
  return { number: input.flight, departure_date: input.date, origin, destination,
    departure_at: new Date(time).toISOString(), stop_at: new Date(time + 6 * 3600000).toISOString() };
}
