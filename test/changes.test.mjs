import test from 'node:test';
import assert from 'node:assert/strict';
import { compareFlights } from '../src/changes.mjs';
const flight = () => ({ number: 'UA 1229', status: 'Expected', departure: { airport: 'IAH', scheduled: '2026-10-27 08:00-05:00', revised: null, gate: 'C1' }, arrival: { airport: 'SFO', scheduled: '2026-10-27 10:10-07:00' } });

test('first observation and identical observations generate no alerts', () => {
  assert.deepEqual(compareFlights(null, flight()).events, []);
  assert.deepEqual(compareFlights(flight(), flight()).events, []);
});
test('delay and recovery compare revised times against the previous observation', () => {
  const a = flight(), b = flight(); b.departure.revised = '2026-10-27 08:35-05:00';
  const delayed = compareFlights(a, b);
  assert.equal(delayed.events[0].minutesChanged, 35);
  assert.deepEqual(compareFlights(delayed.snapshot, b).events, []);
  const recovered = flight(); recovered.departure.revised = recovered.departure.scheduled;
  assert.equal(compareFlights(delayed.snapshot, recovered).events[0].minutesChanged, -35);
});
test('missing values and their return do not create duplicate gate alerts', () => {
  const a = flight(), b = flight(); b.departure.gate = null;
  const missing = compareFlights(a, b);
  assert.equal(b.departure.gate, null);
  assert.deepEqual(missing.events, []);
  assert.deepEqual(compareFlights(missing.snapshot, a).events, []);
  b.departure.gate = 'C2';
  assert.equal(compareFlights(missing.snapshot, b).events[0].type, 'gate_changed');
});
test('first available gate is information, not a gate change', () => {
  const a = flight(); a.departure.gate = null;
  assert.deepEqual(compareFlights(a, flight()).events, []);
});
test('cancellation fires once; unknown status does not erase it', () => {
  const a = flight(), b = flight(); b.status = 'Canceled';
  const cancelled = compareFlights(a, b);
  assert.equal(cancelled.events[0].type, 'cancellation');
  assert.deepEqual(compareFlights(cancelled.snapshot, b).events, []);
  const unknown = flight(); unknown.status = 'Unknown';
  assert.equal(compareFlights(cancelled.snapshot, unknown).snapshot.status, 'Canceled');
});
test('compares equivalent timestamps by instant and ignores invalid estimates', () => {
  const a = flight(), b = flight(); b.departure.revised = '2026-10-27T13:00:00Z';
  assert.deepEqual(compareFlights(a, b).events, []);
  b.departure.revised = 'invalid';
  assert.deepEqual(compareFlights(a, b).events, []);
});
test('rejects another route or day but accepts flight-number spaces', () => {
  const a = flight(), b = flight(); b.number = 'UA1229';
  assert.deepEqual(compareFlights(a, b).events, []);
  b.arrival.airport = 'LAX'; assert.throws(() => compareFlights(a, b), /different flights/);
  b.arrival.airport = 'SFO'; b.departure.scheduled = '2026-10-28 08:00-05:00';
  assert.throws(() => compareFlights(a, b), /different flights/);
});
