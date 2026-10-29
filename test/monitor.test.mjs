import test from 'node:test';
import assert from 'node:assert/strict';
import { enrollment } from '../src/monitor.mjs';
const now = Date.parse('2026-10-27T00:00:00Z');
test('enrollment validates local departure date and caps monitoring at six hours after departure', () => {
  const flight = enrollment('ua 1229', '2026-10-27', 'iah', 'sfo', '2026-10-27T08:00:00-05:00', now);
  assert.equal(flight.number, 'UA1229');
  assert.equal(flight.departure_at, '2026-10-27T13:00:00.000Z');
  assert.equal(flight.stop_at, '2026-10-27T19:00:00.000Z');
  assert.throws(() => enrollment('UA1229', '2026-10-29', 'IAH', 'SFO', '2026-10-29T08:00:00-05:00', now), /24 hours/);
  assert.throws(() => enrollment('UA1229', '2026-10-27', 'IAH', 'SFO', '2026-10-27T08:00:00', now), /offset/);
  assert.throws(() => enrollment('UA1229', '2026-10-27', 'IAH', 'IAH', '2026-10-27T08:00:00-05:00', now), /different/);
});
