import test from 'node:test';
import assert from 'node:assert/strict';
import {formatFlightEmail,sendFlightEmail,runEmailWorker,createEmailHandler} from '../src/email.mjs';
const payload={test:true,number:'DEMO100',origin:'ORD',destination:'DEN',observedAt:'2026-10-29T12:00:00Z',
  events:[{type:'time_changed',field:'arrival.revised',before:'2026-10-29 08:20-06:00',after:'2026-10-29 07:41-06:00',minutesChanged:-39}]};
const item={id:'test-id',token:'lease',payload,recipient:'pilot@example.com',result:'claimed'};
test('email explains earlier estimates and marks synthetic tests',()=>{
  const mail=formatFlightEmail(payload,item.recipient);
  assert.match(mail.subject,/\[TEST\]/);assert.match(mail.text,/39 minutes earlier/);
  assert.match(mail.text,/AeroDataBox/);assert.match(mail.text,/estimates/);
  assert.throws(()=>formatFlightEmail(payload,'first@example.com,second@example.com'));
});
test('provider retries use immutable idempotency key and single-recipient test sender',async()=>{
  const bodies=[],keys=[];
  for(let i=0;i<2;i++){
    const sent=await sendFlightEmail({item,key:'private',fetchImpl:async(url,init)=>{
      assert.equal(url,'https://api.resend.com/emails');assert.equal(init.redirect,'error');
      bodies.push(init.body);keys.push(init.headers['Idempotency-Key']);
      return Response.json({id:'provider-id'});
    }});
    assert.equal(sent.result,'accepted');
  }
  assert.equal(bodies[0],bodies[1]);assert.equal(keys[0],keys[1]);
  assert.deepEqual(JSON.parse(bodies[0]).to,['pilot@example.com']);
});
test('retries timeouts and throttling but not bad keys or invalid recipients',async()=>{
  for(const status of [401,403,422,429,500]){
    const response=await sendFlightEmail({item,key:'private',fetchImpl:async()=>new Response('sensitive body',{status})});
    assert.equal(response.result,status===429||status>=500?'retry':'failed');
    assert.equal(response.error,`HTTP_${status}`);
  }
  assert.equal((await sendFlightEmail({item,key:'private',fetchImpl:async()=>{throw new Error('secret');}})).result,'retry');
});
test('worker does not send while idle and records accepted separately from delivered',async()=>{
  let calls=0;
  assert.equal((await runEmailWorker({rpc:async()=>({result:'idle'}),fetchImpl:async()=>{calls++;}})).result,'idle');
  assert.equal(calls,0);
  let finished;
  const result=await runEmailWorker({key:'private',recipient:item.recipient,rpc:async(name,body)=>{
    if(name==='claim_flight_email')return item;finished=body;
  },fetchImpl:async()=>Response.json({id:'provider-id'})});
  assert.equal(result.result,'accepted');assert.equal(finished.p_token,'lease');assert.equal(finished.p_provider_id,'provider-id');
});
test('email handler requires existing Cron secret and explicit sending switch',async()=>{
  const secret='x'.repeat(64);let calls=0;
  const handler=createEmailHandler(name=>name==='WORKER_CRON_SECRET'?secret:undefined,async()=>{calls++;});
  assert.equal((await handler(new Request('https://example.test',{method:'POST'}))).status,401);
  const disabled=await handler(new Request('https://example.test',{method:'POST',headers:{'x-worker-secret':secret}}));
  assert.equal((await disabled.json()).result,'disabled');assert.equal(calls,0);
});
