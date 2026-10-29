import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { compareFlights } from '../src/changes.mjs';

test('PostgreSQL: migrations, concurrency guards, worker budgets and cleanup', async t => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    for (const file of ['001_flight_storage.sql', '002_scheduled_worker.sql']) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }
    const rpc = async () => (await db.query('select public.claim_flight_check() as value')).rows[0].value;
    const enroll = async () => {
      await db.exec(`insert into public.flight_monitoring(number,departure_date,origin,destination,departure_at,stop_at)
        values('UA1229',current_date,'IAH','SFO',now()+interval '1 hour',now()+interval '7 hours');`);
    };
    const finish = async (id, stop = false) => db.query('select public.finish_flight_check($1,$2,$3)', [id, 'saved', stop]);
    const ready = async () => db.exec("update public.flight_monitoring set next_check_at = now() - interval '1 hour';");

    await t.test('default disabled and anonymous access denied', async () => {
      assert.equal((await rpc()).result, 'disabled');
      await db.exec('set role anon');
      await assert.rejects(db.query('select public.claim_flight_check()'), /permission denied/);
      await assert.rejects(db.query('select * from public.worker_attempts'), /permission denied/);
      await db.exec('reset role');
    });
    await enroll();
    await t.test('single pilot and minimum hourly interval', async () => {
      await assert.rejects(db.exec(`insert into public.flight_monitoring(number,departure_date,origin,destination,departure_at,stop_at)
        values('AA100',current_date,'ORD','LGA',now(),now()+interval '1 hour')`), /duplicate key/);
      await db.exec('update public.worker_settings set enabled = true');
      assert.equal((await rpc()).result, 'claimed');
      assert.equal((await rpc()).result, 'idle');
    });
    await t.test('four attempts in 24 hours, including unfinished reservations', async () => {
      for (let i = 0; i < 3; i++) { await ready(); assert.equal((await rpc()).result, 'claimed'); }
      await ready(); assert.equal((await rpc()).result, 'daily_limit');
      assert.equal((await db.query('select sum(units)::integer as units from public.worker_attempts')).rows[0].units, 8);
    });
    await t.test('rolling 35-day limit does not reset at calendar month boundaries', async () => {
      await db.exec("update public.worker_attempts set reserved_at = now() - interval '2 days';");
      await db.exec("insert into public.worker_attempts(reserved_at) select now() - interval '2 days' from generate_series(1,36);");
      assert.equal((await rpc()).result, 'budget_exhausted');
      await db.exec("update public.worker_attempts set reserved_at = now() - interval '36 days';");
      assert.equal((await rpc()).result, 'claimed');
    });

    let flightId;
    let latest;
    await t.test('baseline and changes persist atomically, repeated observation is idempotent', async () => {
      const monitor = (await db.query('select departure_date::text as day from public.flight_monitoring')).rows[0];
      const flight = { number: 'UA1229', status: 'Expected', departure: { airport: 'IAH', scheduled: `${monitor.day} 08:00-05:00` }, arrival: { airport: 'SFO' } };
      flightId = `aerodatabox|UA1229|IAH|SFO|${monitor.day}`;
      const save = async (id, version, snapshot, state, events, timestamp) => (await db.query(
        'select public.save_flight_observation($1,$2,$3,$4,$5,$6,$7,$8) as value',
        [id, flightId, 'aerodatabox', version, timestamp, JSON.stringify(snapshot), JSON.stringify(state), JSON.stringify(events)]
      )).rows[0].value;
      const timestamp = new Date(Date.now() - 3000).toISOString();
      assert.equal((await save(crypto.randomUUID(), 0, flight, flight, [], timestamp)).result, 'saved');
      const changed = structuredClone(flight); changed.departure.revised = `${monitor.day} 08:35-05:00`;
      const delta = compareFlights(flight, changed); const id = crypto.randomUUID();
      const later = new Date(Date.now() - 1000).toISOString();
      assert.equal((await save(id, 1, changed, delta.snapshot, delta.events, later)).events, 1);
      assert.equal((await save(id, 1, changed, delta.snapshot, delta.events, later)).result, 'duplicate');
      assert.equal((await save(crypto.randomUUID(), 1, changed, delta.snapshot, [], later)).result, 'conflict');
      assert.equal((await save(crypto.randomUUID(), 2, flight, flight, [], timestamp)).result, 'stale');
      assert.equal((await db.query('select count(*)::integer as total from public.flight_changes')).rows[0].total, 1);
      latest = { save, changed, state: delta.snapshot };
    });
    await t.test('stop deletes live contents and blocks late responses recreating them', async () => {
      const claim = (await db.query("select id from public.worker_attempts where monitoring_id is not null order by reserved_at desc limit 1")).rows[0];
      await finish(claim.id, true);
      assert.equal((await db.query('select count(*)::integer as total from public.flight_tracks')).rows[0].total, 0);
      assert.equal((await db.query('select count(*)::integer as total from public.flight_changes')).rows[0].total, 0);
      assert.equal((await db.query('select count(*)::integer as total from public.worker_attempts')).rows[0].total, 41);
      await assert.rejects(latest.save(crypto.randomUUID(), 0, latest.changed, latest.state, [], new Date().toISOString()), /active monitor/);
    });
    await t.test('expired monitors stop even when global live switch is disabled', async () => {
      await enroll();
      await db.exec("update public.flight_monitoring set departure_at = now() - interval '7 hours', stop_at = now() - interval '1 hour'; update public.worker_settings set enabled=false;");
      await db.query('select public.purge_expired_flight_data()');
      assert.equal((await db.query('select count(*)::integer as total from public.flight_monitoring')).rows[0].total, 0);
    });
  } finally { await db.close(); }
});
