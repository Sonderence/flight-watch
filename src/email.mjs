import { createStorage } from './storage.mjs';

export function formatFlightEmail(payload, recipient) {
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(recipient ?? '')) throw new Error('Invalid pilot recipient');
  const title = `${payload.test ? '[TEST] ' : ''}Flight update: ${payload.number} (${payload.origin} to ${payload.destination})`;
  const lines = payload.events.map(event => {
    if (event.type === 'cancellation') return 'The provider reports this flight is cancelled.';
    const side = event.field?.startsWith('arrival.') ? 'Arrival' : 'Departure';
    if (event.type === 'gate_changed') return `${side} gate changed from ${event.before} to ${event.after}.`;
    if (event.type === 'time_changed' && Number.isFinite(event.minutesChanged)) {
      return `${side} estimate moved ${Math.abs(event.minutesChanged)} minutes ${event.minutesChanged < 0 ? 'earlier' : 'later'}: ${event.before} -> ${event.after}.`;
    }
    throw new Error('Unsupported email event');
  });
  return {
    from: 'Flight Disruption Tracker <onboarding@resend.dev>', to: [recipient],
    subject: title.replace(/[\r\n]/g,' '),
    text: [title, '', ...lines, '', `Observed at: ${payload.observedAt}`,
      'Times include the local UTC offset. Revised times are estimates, not proof of takeoff or landing.',
      payload.test ? 'This is a simulated test; no real disruption is asserted.' : 'Check your airline for the latest information.',
      'Flight data source: AeroDataBox — https://aerodatabox.com',
      'Personal pilot only. Stop alerts by disabling email_settings.enabled in your Supabase project.'
    ].join('\n')
  };
}

export async function sendFlightEmail({ item, key, fetchImpl = fetch }) {
  const body = formatFlightEmail(item.payload, item.recipient);
  let response;
  try {
    response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `flight-alert/${item.id}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000), redirect: 'error'
    });
  } catch { return { result: 'retry', error: 'network_or_timeout' }; }
  if (!response.ok) return { result: response.status===429 || response.status>=500 ? 'retry' : 'failed', error: `HTTP_${response.status}` };
  let data;
  try { data=await response.json(); } catch { return { result: 'retry', error: 'invalid_provider_response' }; }
  if (typeof data.id !== 'string' || !data.id) return { result: 'retry', error: 'missing_provider_id' };
  return { result: 'accepted', providerId: data.id };
}

export async function runEmailWorker({ rpc, key, recipient, fetchImpl = fetch }) {
  const item = await rpc('claim_flight_email', { p_recipient: recipient });
  if (item.result !== 'claimed') return { result: item.result };
  let sent;
  try { sent = await sendFlightEmail({ item, key, fetchImpl }); }
  catch { sent = { result: 'failed', error: 'invalid_message' }; }
  await rpc('finish_flight_email', { p_id: item.id, p_token: item.token,
    p_result: sent.result, p_provider_id: sent.providerId ?? null, p_error: sent.error ?? null });
  // Accepted means accepted by Resend, not confirmed inbox delivery.
  return { result: sent.result };
}

export function createEmailHandler(env, fetchImpl=fetch) {
  return async request => {
    if (request.method!=='POST') return new Response('Method not allowed',{status:405});
    const secret=env('WORKER_CRON_SECRET');
    if (!secret || secret.length<32 || request.headers.get('x-worker-secret')!==secret) return new Response('Unauthorized',{status:401});
    if (env('EMAIL_LIVE_ENABLED')!=='true') return Response.json({result:'disabled'});
    try {
      const url=env('SUPABASE_URL'), dbKey=env('WORKER_DB_SECRET'), key=env('RESEND_API_KEY'), recipient=env('PILOT_EMAIL');
      createStorage({url,key:dbKey,fetchImpl});
      if (!key || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(recipient??'')) throw new Error('Missing email configuration');
      const rpc=async(name,body)=>{
        const response=await fetchImpl(`${url.replace(/\/$/,'')}/rest/v1/rpc/${name}`,{
          method:'POST',headers:{apikey:dbKey,'Content-Type':'application/json'},body:JSON.stringify(body),
          signal:AbortSignal.timeout(15000),redirect:'error'
        });
        if(!response.ok) throw new Error('Email database operation failed');
        return response.json();
      };
      const result=await runEmailWorker({rpc,key,recipient,fetchImpl});
      console.info(JSON.stringify({worker:'flight-email-worker',...result}));
      return Response.json(result);
    } catch { return Response.json({result:'email_worker_error',message:'Check migration 003 and email configuration.'},{status:500}); }
  };
}
