import { readFile } from 'node:fs/promises';
import { normalizeFlights } from './provider.mjs';
import { compareFlights } from './changes.mjs';

const [sample] = normalizeFlights(JSON.parse(await readFile(new URL('../fixtures/flight.json', import.meta.url), 'utf8')));
const baseline = structuredClone(sample);
baseline.departure.revised = null;
let state;
function observe(label, flight) {
  const result = compareFlights(state, flight);
  state = result.snapshot;
  console.log(`\n${label}`);
  if (!result.events.length) console.log('No new changes.');
  for (const event of result.events) {
    const delta = event.minutesChanged === undefined ? '' : ` (${event.minutesChanged > 0 ? '+' : ''}${event.minutesChanged} minutes)`;
    console.log(`${event.type}: ${event.field}: ${event.before} -> ${event.after}${delta}`);
  }
}
console.log('SIMULATED change detection — no API calls, no emails.');
observe('1. First observation establishes the baseline', baseline);
observe('2. Departure moves 35 minutes later', sample);
const gate = structuredClone(sample);
gate.departure.gate = 'B18';
observe('3. Departure gate changes', gate);
observe('4. Same update arrives again', gate);
const missing = structuredClone(gate);
missing.departure.gate = null;
observe('5. Gate is temporarily missing', missing);
observe('6. Same gate returns', gate);
const cancelled = structuredClone(gate);
cancelled.status = 'Canceled';
observe('7. Flight is cancelled', cancelled);
observe('8. Cancellation is reported again', cancelled);
