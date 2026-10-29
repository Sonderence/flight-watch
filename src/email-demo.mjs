import { formatFlightEmail } from './email.mjs';
console.log('OFFLINE EMAIL PREVIEW — no API requests, no emails sent.');
console.log(formatFlightEmail({ test:true, number:'DEMO100',origin:'ORD',destination:'DEN',observedAt:'2026-10-29T12:00:00Z',
  events:[{type:'time_changed',field:'arrival.revised',before:'2026-10-29 08:20-06:00',after:'2026-10-29 07:41-06:00',minutesChanged:-39}]
},'pilot@example.com').text);
