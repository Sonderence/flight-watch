import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, flightKey } from '../src/storage.mjs';
const flight = () => ({ number: 'UA 1229', status: 'Expected', departure: { airport: 'IAH', scheduled: '2026-10-27 08:00-05:00', revised: '2026-10-27 08:35-05:00' }, arrival: { airport: 'SFO' } });
const options = { url: 'https://example.supabase.co', key: 'sb_secret_test' };
const response = value => new Response(JSON.stringify(value), { status: 200 });
test('database credentials are validated before any network access', () => {
  assert.throws(() => createStorage({}), /SUPABASE/);
  assert.throws(() => createStorage({ ...options, key: 'public' }), /backend/);
  assert.throws(() => createStorage({ ...options, url: 'https://evil.test' }), /project URL/);
});
test('source separates synthetic from real flights', () => {
  assert.notEqual(flightKey(flight(), 'synthetic'), flightKey(flight(), 'aerodatabox'));
});
test('uses persisted baseline and submits raw snapshot, state and changes together', async () => {
  const baseline = flight(); baseline.departure.revised = null;
  let sent;
  const store = createStorage({ ...options, fetchImpl: async (url, init) => {
    assert.equal(init.headers.apikey, options.key);
    if (init.method === 'GET') return response([{ version: 1, comparison_state: baseline, expires_at: '2099-01-01T00:00:00Z' }]);
    sent = JSON.parse(init.body); return response({ result: 'saved', events: 1 });
  } });
  assert.equal((await store.save(flight())).result, 'saved');
  assert.equal(sent.p_events[0].minutesChanged, 35);
  assert.equal(sent.p_expected_version, 1);
  assert.deepEqual(sent.p_snapshot, flight());
});
test('concurrent conflict rereads baseline and reuses observation id', async () => {
  let posts = 0; const ids = [];
  const store = createStorage({ ...options, fetchImpl: async (url, init) => {
    if (init.method === 'GET') return response([]);
    ids.push(JSON.parse(init.body).p_id);
    return response({ result: ++posts === 1 ? 'conflict' : 'saved' });
  } });
  await store.save(flight()); assert.equal(posts, 2); assert.equal(ids[0], ids[1]);
});
test('database errors do not expose response bodies or retry blindly', async () => {
  let calls = 0;
  const store = createStorage({ ...options, fetchImpl: async () => { calls++; return new Response('private details', { status: 403 }); } });
  await assert.rejects(store.save(flight()), error => error.message.includes('403') && !error.message.includes('private details'));
  assert.equal(calls, 1);
});
