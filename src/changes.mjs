// These are normalized adapter snapshots, not raw API responses.
const known = value => typeof value === 'string' && value.trim() !== '' && value.toLowerCase() !== 'unknown';
const compact = value => String(value ?? '').replace(/\s/g, '').toUpperCase();
function identity(flight) {
  const { number, departure, arrival } = flight ?? {};
  const date = departure?.scheduled?.slice(0, 10);
  if (!known(number) || !known(departure?.airport) || !known(arrival?.airport) || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
    throw new Error('Comparison requires flight number, route, and scheduled departure date.');
  }
  return [compact(number), compact(departure.airport), compact(arrival.airport), date].join('|');
}

// Provider local timestamps use a space; normalize it before comparing instants.
function instant(value) {
  if (!known(value) || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value.replace(' ', 'T'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function compareFlights(previous, current) {
  const id = identity(current);
  if (previous && identity(previous) !== id) throw new Error('Cannot compare different flights, routes, or departure dates.');
  const snapshot = structuredClone(current);
  const events = [];
  if (!previous) return { snapshot, events }; // First observation establishes a baseline.

  const add = (type, field, before, after, extra = {}) => {
    events.push({ type, field, before, after, ...extra });
  };
  const oldStatus = previous.status;
  if (!known(current.status)) snapshot.status = oldStatus;
  else if (known(oldStatus) && compact(oldStatus) !== compact(current.status)) {
    add(compact(current.status) === 'CANCELED' || compact(current.status) === 'CANCELLED' ? 'cancellation' : 'status_changed', 'status', oldStatus, current.status);
  }

  for (const side of ['departure', 'arrival']) {
    snapshot[side] ??= {};
    for (const field of ['gate', 'terminal', 'scheduled', 'revised']) {
      const before = previous[side]?.[field];
      const after = current[side]?.[field];
      // Missing fields are not evidence of a real change. Preserve the last known
      // value for comparison only; display freshness from the current observation.
      if (!known(after)) snapshot[side][field] = before ?? null;
      if (['gate', 'terminal'].includes(field) && known(before) && known(after) && compact(before) !== compact(after)) {
        add(`${field}_changed`, `${side}.${field}`, before, after);
      }
    }
    const before = previous[side]?.revised ?? previous[side]?.scheduled;
    const after = current[side]?.revised;
    const a = instant(before), b = instant(after);
    if (a !== null && b !== null && a !== b) {
      add('time_changed', `${side}.revised`, before, after, { minutesChanged: (b - a) / 60000 });
    }
    const oldScheduled = previous[side]?.scheduled;
    const newScheduled = current[side]?.scheduled;
    const s1 = instant(oldScheduled), s2 = instant(newScheduled);
    if (s1 !== null && s2 !== null && s1 !== s2) add('schedule_changed', `${side}.scheduled`, oldScheduled, newScheduled, { minutesChanged: (s2 - s1) / 60000 });
  }
  return { snapshot, events };
}
