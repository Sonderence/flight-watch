import test from 'node:test';
import assert from 'node:assert/strict';
import {createDashboardHandler} from '../src/dashboard.mjs';
const token='r'.repeat(64);
const values={DASHBOARD_READ_TOKEN:token,DASHBOARD_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',WORKER_DB_SECRET:'sb_secret_private'};
const request=()=>new Request('https://example.supabase.co/functions/v1/flight-dashboard',{headers:{'x-dashboard-token':token}});
test('read-only dashboard rejects unauthenticated writes and supports preflight',async()=>{
 let calls=0;const handler=createDashboardHandler(name=>values[name],async()=>{calls++;});
 assert.equal((await handler(new Request(request().url))).status,401);
 assert.equal((await handler(new Request(request().url,{method:'PUT'}))).status,405);
 assert.equal((await handler(new Request(request().url,{method:'POST',headers:{'x-dashboard-token':token}}))).status,401);
 assert.equal((await handler(new Request(request().url,{method:'OPTIONS'}))).status,204);assert.equal(calls,0);
});

test('management requires its own token and validates before making database requests',async()=>{
 let calls=0;const admin='m'.repeat(64);
 const settings={...values,DASHBOARD_MANAGE_TOKEN:admin,DASHBOARD_MANAGEMENT_ENABLED:'true'};
 const handler=createDashboardHandler(name=>settings[name],async(url,init)=>{
  calls++;assert.ok(url.endsWith('/rpc/manage_pilot_flight'));assert.ok(!url.includes('aerodatabox'));
  const body=JSON.parse(init.body);assert.equal(body.p_action,'track');assert.equal(body.p_number,'F93229');assert.equal(body.p_expected_id,null);
  return Response.json({result:'tracking',id:'new-id'});
 });
 const post=body=>new Request(request().url,{method:'POST',headers:{'x-dashboard-manage-token':admin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await handler(post({action:'track',number:'bad'}))).status,400);assert.equal(calls,0);
 const future=new Date(Date.now()+3*3600000).toISOString().replace(/\.\d{3}Z$/,'Z');
 const result=await handler(post({action:'track',number:'F93229',origin:'IAH',destination:'DEN',date:future.slice(0,10),departureAt:future}));
 assert.equal(result.status,200);assert.equal(calls,1);
});

test('stale control requests return conflict and management defaults off',async()=>{
 const admin='m'.repeat(64);
 const post=()=>new Request(request().url,{method:'POST',headers:{'x-dashboard-manage-token':admin},body:JSON.stringify({action:'stop',expectedId:null})});
 const settings={...values,DASHBOARD_MANAGE_TOKEN:admin};let calls=0;
 const handler=createDashboardHandler(name=>settings[name],async()=>{calls++;return Response.json({result:'conflict'});});
 assert.equal((await handler(post())).status,503);assert.equal(calls,0);
 settings.DASHBOARD_MANAGEMENT_ENABLED='true';assert.equal((await handler(post())).status,409);assert.equal(calls,1);
});
test('dashboard reads database only and preserves current raw missing values',async()=>{
 const visited=[];
 const handler=createDashboardHandler(name=>values[name],async(url,init)=>{
  visited.push(url);assert.equal(init.headers.apikey,'sb_secret_private');assert.equal(init.body,undefined);
  if(url.includes('/flight_monitoring?'))return Response.json([{number:'F93229',departure_date:'2026-10-29',origin:'IAH',destination:'DEN'}]);
  if(url.includes('/flight_observations?'))return Response.json([{id:'obs1',observed_at:'2026-10-29T11:00:00Z',snapshot:{number:'F9 3229',departure:{gate:null}}}]);
  return Response.json([{observation_id:'obs1',event_index:0,event:{type:'gate_changed',before:'A1',after:'A2'}}]);
 });
 const response=await handler(request());const data=await response.json();assert.equal(data.flight.departure.gate,null);assert.equal(data.events[0].observedAt,'2026-10-29T11:00:00Z');
 assert.equal(visited.length,3);assert.ok(visited.every(url=>url.startsWith('https://example.supabase.co/rest/v1/')));assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.ok(!JSON.stringify(data).includes('sb_secret_'));
});
test('empty dashboard is explicit and does not substitute demo data',async()=>{
 const handler=createDashboardHandler(name=>values[name],async()=>Response.json([]));
 const data=await(await handler(request())).json();assert.equal(data.mode,'live');assert.equal(data.flight,null);assert.deepEqual(data.events,[]);
});
