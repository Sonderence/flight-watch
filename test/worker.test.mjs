import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorker, createWorkerHandler } from '../src/worker.mjs';
const target = { number: 'UA1229', departure_date: '2026-10-27', origin: 'IAH', destination: 'SFO' };
const observation = () => ({ number: 'UA 1229', status: 'Expected', departure: { airport: 'IAH', countryCode: 'US', scheduled: '2026-10-27 08:00-05:00' }, arrival: { airport: 'SFO', countryCode: 'US' } });
function harness({ result = 'claimed', flights = [observation()], fail = false } = {}) {
  const calls = []; const saves = []; let lookups = 0;
  return { calls, saves, count: () => lookups, dependencies: {
    rpc: async (name, body) => { calls.push({ name, body }); return { result, attempt_id: 'attempt-1', flight: target }; },
    storage: { save: async (...args) => { saves.push(args); return { result: 'saved' }; } },
    lookupFlight: async () => { lookups++; if (fail) throw new Error('secret error'); return flights; }
  } };
}
test('disabled, exhausted and idle claims never call provider', async () => {
  for (const result of ['disabled', 'budget_exhausted', 'daily_limit', 'idle']) {
    const h = harness({ result }); await runWorker(h.dependencies);
    assert.equal(h.count(), 0); assert.equal(h.saves.length, 0);
  }
});
test('worker uses reserved observation id and saves the matched route once', async () => {
  const h = harness(); assert.equal((await runWorker(h.dependencies)).result, 'saved');
  assert.equal(h.count(), 1); assert.equal(h.saves[0][1].observationId, 'attempt-1');
  assert.equal(h.saves[0][1].source, 'aerodatabox');
});
test('no match is not cancellation, ambiguous matches stop, international flights stop', async () => {
  const other = observation(); other.arrival.airport = 'LAX';
  const international = observation(); international.arrival.countryCode = 'CA';
  for (const [flights, expected] of [[[other], 'no_match'], [[observation(), observation()], 'ambiguous'], [[international], 'unsupported_route']]) {
    const h = harness({ flights }); assert.equal((await runWorker(h.dependencies)).result, expected);
    assert.equal(h.saves.length, 0);
  }
});
test('terminal statuses stop after saving; failure pauses without a provider retry', async () => {
  const f = observation(); f.status = 'Canceled';
  const h = harness({ flights: [f] }); assert.equal((await runWorker(h.dependencies)).stopped, true);
  assert.equal(h.saves.length, 1);
  const failed = harness({ fail: true });
  assert.deepEqual(await runWorker(failed.dependencies), { result: 'failed', stopped: true });
  assert.equal(failed.count(), 1);
});
test('handler rejects unauthenticated requests and missing secrets before database calls', async () => {
  let calls = 0;
  const handler = createWorkerHandler(() => undefined, async () => { calls++; });
  assert.equal((await handler(new Request('https://example.test', { method: 'POST' }))).status, 401);
  assert.equal(calls, 0);
});
test('deployment switch off cannot spend quota even with a valid worker secret', async () => {
  let calls = 0; const secret = 'x'.repeat(64);
  const handler = createWorkerHandler(name => name === 'WORKER_CRON_SECRET' ? secret : undefined, async () => { calls++; });
  const result = await handler(new Request('https://example.test', { method: 'POST', headers: { 'x-worker-secret': secret } }));
  assert.equal((await result.json()).result, 'disabled'); assert.equal(calls, 0);
});
