import test from 'node:test';
import assert from 'node:assert/strict';
import { lookup, normalizeFlights, validateInput } from '../src/provider.mjs';

test('validates flight numbers and real calendar dates', () => {
  assert.deepEqual(validateInput('aa 100', '2026-10-27'), { flight: 'AA100', date: '2026-10-27' });
  assert.throws(() => validateInput('AA100', '2026-02-30'));
  assert.throws(() => validateInput('../bad', '2026-10-27'));
});
test('missing fields stay unknown rather than becoming on time', () => {
  const [f] = normalizeFlights([{}]);
  assert.equal(f.status, 'Unknown'); assert.equal(f.departure.gate, null);
  assert.throws(() => normalizeFlights({}));
});
test('uses departure date and disables paid add-on; no content means no matches', async () => {
  const result = await lookup({ flight: 'AA100', date: '2026-10-27', key: 'test', fetchImpl: async (url, options) => {
    assert.equal(url.searchParams.get('withFlightPlan'), 'false');
    assert.equal(url.searchParams.get('dateLocalRole'), 'Departure');
    assert.equal(options.redirect, 'error');
    return new Response(null, { status: 204 });
  } });
  assert.deepEqual(result, []);
});
test('quota errors do not trigger retries or expose provider bodies', async () => {
  let calls = 0;
  await assert.rejects(lookup({ flight: 'AA100', date: '2026-10-27', key: 'secret', fetchImpl: async () => { calls++; return new Response('secret', { status: 429 }); } }), /quota/);
  assert.equal(calls, 1);
});
