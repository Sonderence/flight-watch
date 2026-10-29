import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('PostgreSQL: flight switching is atomic and cannot reset the shared budget',async t=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  for(const file of ['001_flight_storage.sql','002_scheduled_worker.sql','004_dashboard_controls.sql'])await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
  const day=(await db.query('select current_date::text as day')).rows[0].day;
  const departure=new Date(Date.now()+3*3600000).toISOString();
  const manage=async(action,expected,number='F93229',date=day,time=departure)=>(await db.query('select public.manage_pilot_flight($1,$2,$3,$4,$5,$6,$7) as value',[action,expected,number,date,'IAH','DEN',time])).rows[0].value;
  let id;
  await t.test('enrolls one flight and rejects a stale form without changing it',async()=>{
   const first=await manage('track',null);assert.equal(first.result,'tracking');id=first.id;
   assert.equal((await manage('track',null,'UA1229')).result,'conflict');
   assert.equal(Number((await db.query('select count(*) from public.flight_monitoring where active')).rows[0].count),1);
  });
  await t.test('invalid or out-of-window replacement leaves original enrollment intact',async()=>{
   await assert.rejects(manage('track',id,'BAD',day,departure),/Invalid flight/);
   await assert.rejects(manage('track',id,'UA1229',day,new Date(Date.now()+48*3600000).toISOString()),/24 hours/);
   assert.equal((await db.query('select id from public.flight_monitoring')).rows[0].id,id);
  });
  await t.test('repeated switching preserves all API reservations and daily cap',async()=>{
   await db.exec('update public.worker_settings set enabled=true');
   for(let i=0;i<4;i++){
    const claim=(await db.query('select public.claim_flight_check() as value')).rows[0].value;assert.equal(claim.result,'claimed');
    id=(await manage('track',id,i%2?'F93229':'UA1229')).id;
   }
   assert.equal((await db.query('select public.claim_flight_check() as value')).rows[0].value.result,'daily_limit');
   assert.equal(Number((await db.query('select sum(units) from public.worker_attempts')).rows[0].sum),8);
   assert.equal(Number((await db.query('select count(*) from public.flight_monitoring where active')).rows[0].count),1);
  });
  await t.test('stop removes only enrollment and live history, keeps usage counters, and is protected',async()=>{
   assert.equal((await manage('stop',id)).result,'stopped');
   assert.equal(Number((await db.query('select count(*) from public.flight_monitoring')).rows[0].count),0);
   assert.equal(Number((await db.query('select count(*) from public.worker_attempts')).rows[0].count),4);
   await db.exec('set role anon');await assert.rejects(manage('stop',null),/permission denied/);await db.exec('reset role');
  });
 }finally{await db.close();}
});
