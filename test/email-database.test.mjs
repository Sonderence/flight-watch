import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('PostgreSQL: transactional email outbox, budget, leases, retention and cancellation',async t=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  for(const file of ['001_flight_storage.sql','002_scheduled_worker.sql','003_email_alerts.sql'])await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
  const day=(await db.query('select current_date::text as day')).rows[0].day;
  await db.exec(`insert into public.flight_monitoring(number,departure_date,origin,destination,departure_at,stop_at)
   values('UA1229',current_date,'IAH','SFO',now()+interval '1 hour',now()+interval '7 hours');`);
  let version=0;
  const save=async(events,source='aerodatabox')=>{
    const id=crypto.randomUUID();const snapshot={number:'UA1229',departure:{airport:'IAH',scheduled:`${day} 08:00-05:00`},arrival:{airport:'SFO'}};
    const result=await db.query('select public.save_flight_observation($1,$2,$3,$4,$5,$6,$7,$8) as value',[
      id,`${source}|UA1229|IAH|SFO|${day}`,source,source==='synthetic'?0:version,
      new Date(Date.now()-20000+version*100).toISOString(),JSON.stringify(snapshot),JSON.stringify(snapshot),JSON.stringify(events)]);
    if(source==='aerodatabox')version++;return {id,result:result.rows[0].value};
  };
  const count=async()=>Number((await db.query('select count(*) from public.email_outbox')).rows[0].count);
  const gate={type:'gate_changed',field:'departure.gate',before:'C1',after:'C2'};
  const time=minutes=>({type:'time_changed',field:'arrival.revised',before:'08:20-06:00',after:'07:41-06:00',minutesChanged:minutes});
  const claim=async(recipient='pilot@example.com')=>(await db.query('select public.claim_flight_email($1) as value',[recipient])).rows[0].value;
  const finish=async(item,result='accepted')=>db.query('select public.finish_flight_email($1,$2,$3,$4,$5)',[item.id,item.token,result,result==='accepted'?'provider-id':null,null]);
  await t.test('disabled inserts no outbox, with no retroactive backfill',async()=>{
    await save([gate]);assert.equal(await count(),0);
    assert.equal((await claim()).result,'disabled');
    await db.exec('update public.email_settings set enabled=true');assert.equal(await count(),0);
  });
  await t.test('small time updates and synthetic changes are filtered; threshold is inclusive',async()=>{
    await save([time(14),time(-14),{type:'status_changed'}]);assert.equal(await count(),0);
    await save([gate],'synthetic');assert.equal(await count(),0);
    await save([time(15),time(-39),gate,{type:'cancellation'}]);assert.equal(await count(),1);
    const payload=(await db.query('select payload from public.email_outbox')).rows[0].payload;
    assert.equal(payload.events.length,4);
  });
  await t.test('overlapping sender claims cannot reserve one message twice',async()=>{
    const item=await claim();assert.equal(item.result,'claimed');
    assert.equal((await claim()).result,'idle');
    await finish(item);
    const row=(await db.query('select * from public.email_outbox')).rows[0];
    assert.equal(row.status,'accepted');assert.equal(row.payload,null);assert.equal(row.recipient,null);
  });
  await t.test('expired send lease retains same message id and freezes recipient',async()=>{
    await save([gate]);const first=await claim();
    // Free a daily test slot without changing the real sender's logic.
    await db.exec("update public.email_attempts set reserved_at=now()-interval '2 days'; update public.email_outbox set lease_until=now()-interval '1 minute' where status='sending';");
    const retry=await claim('changed@example.com');assert.equal(retry.id,first.id);assert.equal(retry.recipient,first.recipient);assert.notEqual(retry.token,first.token);
    await finish(first);assert.equal((await db.query('select status from public.email_outbox where id=$1',[first.id])).rows[0].status,'sending');
    await finish(retry);
  });
  await t.test('daily and rolling limits include all reserved requests',async()=>{
    await save([gate]);const next=await claim();assert.equal(next.result,'claimed');await finish(next,'failed');
    assert.equal((await claim()).result,'email_daily_limit');
    await db.exec("update public.email_attempts set reserved_at=now()-interval '2 days'; insert into public.email_attempts(reserved_at) select now()-interval '2 days' from generate_series(1,16);");
    assert.equal((await claim()).result,'email_budget_exhausted');
  });
  await t.test('terminal live-data cleanup does not discard an already queued cancellation',async()=>{
    await save([{type:'cancellation'}]);const before=await count();
    await db.exec('update public.flight_monitoring set active=false where active');
    assert.equal(await count(),before);
    assert.equal(Number((await db.query('select count(*) from public.flight_tracks where source=\'aerodatabox\'')).rows[0].count),0);
  });
  await t.test('six-hour expiry erases pending provider contents; disabling cancels unsent mail',async()=>{
    await db.exec("update public.email_outbox set expires_at=now()-interval '1 minute' where status='pending'; select public.purge_email_data();");
    assert.equal(Number((await db.query('select count(*) from public.email_outbox where payload is not null')).rows[0].count),0);
    await db.exec("insert into public.email_outbox(payload) values('{\"test\":true}'); update public.email_settings set enabled=false;");
    assert.equal((await db.query('select status from public.email_outbox order by created_at desc limit 1')).rows[0].status,'cancelled');
    await db.exec('set role anon');await assert.rejects(db.query("select public.claim_flight_email('pilot@example.com')"),/permission denied/);await db.exec('reset role');
  });
 }finally{await db.close();}
});
