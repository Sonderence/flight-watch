import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('ready-to-paste function boots and authenticates without runtime packages', async () => {
  const source = await readFile(new URL('../supabase/functions/flight-worker/index.ts', import.meta.url), 'utf8');
  let handler;
  const secret = 'x'.repeat(64);
  vm.runInNewContext(source, { Request, Response, URL, URLSearchParams, AbortSignal, structuredClone, crypto, console,
    fetch: () => { throw new Error('No network expected while disabled'); },
    Deno: { env: { get: name => name === 'WORKER_CRON_SECRET' ? secret : undefined }, serve: fn => { handler = fn; } }
  });
  const unauthorized = await handler(new Request('https://example.test', { method: 'POST' }));
  assert.equal(unauthorized.status, 401);
  const disabled = await handler(new Request('https://example.test', { method: 'POST', headers: { 'x-worker-secret': secret } }));
  assert.equal((await disabled.json()).result, 'disabled');
});

test('generated email worker authenticates and defaults off without sending',async()=>{
  const source=await readFile(new URL('../supabase/functions/flight-email-worker/index.ts',import.meta.url),'utf8');
  let handler;const secret='x'.repeat(64);
  vm.runInNewContext(source,{Request,Response,URL,URLSearchParams,AbortSignal,structuredClone,crypto,console,
    fetch:()=>{throw new Error('No sending expected');},
    Deno:{env:{get:name=>name==='WORKER_CRON_SECRET'?secret:undefined},serve:fn=>{handler=fn;}}
  });
  assert.equal((await handler(new Request('https://example.test',{method:'POST'}))).status,401);
  const disabled=await handler(new Request('https://example.test',{method:'POST',headers:{'x-worker-secret':secret}}));
  assert.equal((await disabled.json()).result,'disabled');
});
