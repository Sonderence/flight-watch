import {resolveAirline} from './airlines.mjs';
const $=id=>document.getElementById(id);
const airports={IAH:['Houston','George Bush Intercontinental'],DEN:['Denver','Denver International'],ORD:['Chicago',"O’Hare International"],SFO:['San Francisco','San Francisco International'],LGA:['New York','LaGuardia'],JFK:['New York','John F. Kennedy International'],LAX:['Los Angeles','Los Angeles International'],ATL:['Atlanta','Hartsfield–Jackson'],DFW:['Dallas','Dallas Fort Worth'],SEA:['Seattle','Seattle–Tacoma']};
const sample={mode:'demo',observedAt:'2026-10-29T11:05:00Z',flight:{number:'UA 1229',airline:'United Airlines',airlineCode:'UA',status:'Expected',departure:{airport:'IAH',airportName:'George Bush Intercontinental',scheduled:'2026-10-29 08:00-05:00',revised:null,gate:'C12',terminal:'C'},arrival:{airport:'SFO',airportName:'San Francisco International',scheduled:'2026-10-29 10:10-07:00',revised:'2026-10-29 09:31-07:00',gate:null,terminal:'3'}},events:[
 {id:'demo1',type:'time_changed',field:'arrival.revised',before:'2026-10-29 10:10-07:00',after:'2026-10-29 09:31-07:00',minutesChanged:-39,observedAt:'2026-10-29T11:05:00Z'},
 {id:'demo2',type:'gate_changed',field:'departure.gate',before:'C10',after:'C12',observedAt:'2026-10-29T10:05:00Z'},
 {id:'demo3',type:'time_changed',field:'departure.revised',before:'2026-10-29 08:15-05:00',after:'2026-10-29 08:00-05:00',minutesChanged:-15,observedAt:'2026-10-29T09:05:00Z'},
 {id:'demo4',type:'status_changed',field:'status',before:'Unknown',after:'Expected',observedAt:'2026-10-29T08:05:00Z'}]};
let data=structuredClone(sample),filter='all',connection=null,lastRefresh=0;
try{connection=JSON.parse(sessionStorage.getItem('flightwatch-connection')||'null');}catch{}
function text(id,value){$(id).textContent=value??'Not provided';}
function parsed(value){if(typeof value!=='string')return null;const n=Date.parse(value.replace(' ','T'));return Number.isFinite(n)?new Date(n):null;}
function timestamp(value){const d=parsed(value);return d?new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(d):'Not yet checked';}
function timeParts(value){const m=typeof value==='string'&&value.match(/T?(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/);if(!m)return {time:'—',period:'',zone:'Time not provided'};const h=Number(m[1]);return {time:`${h%12||12}:${m[2]}`,period:h<12?'AM':'PM',zone:`Local time · UTC${m[3]==='Z'?'+00:00':m[3].replace('-','−')}`};}
function setClock(id,zoneId,value){const p=timeParts(value);$(id).replaceChildren(document.createTextNode(p.time));const small=document.createElement('small');small.textContent=p.period;$(id).append(small);text(zoneId,p.zone);}
function group(event){if(event.type?.includes('time')||event.type==='schedule_changed')return 'time';if(event.type==='gate_changed'||event.type==='terminal_changed')return 'gate';return 'status';}
function shortTime(value){const p=timeParts(value);return p.time==='—'?String(value??'Unknown'):`${p.time} ${p.period} (${p.zone.replace('Local time · ','')})`;}
function eventView(event){
 const kind=group(event),side=event.field?.startsWith('arrival.')?'Arrival':'Departure';
 let title,before=event.before,after=event.after,badge='';
 if(kind==='time'){title=event.type==='schedule_changed'?`${side} schedule updated`:`${side} estimate updated`;before=shortTime(before);after=shortTime(after);if(Number.isFinite(event.minutesChanged))badge=`${Math.abs(event.minutesChanged)} min ${event.minutesChanged<0?'earlier':'later'}`;}
 else if(event.type==='gate_changed')title=`${side} gate changed`;
 else if(event.type==='terminal_changed')title=`${side} terminal changed`;
 else if(event.type==='cancellation')title='Flight cancelled';
 else title='Flight status updated';
 const row=document.createElement('article');row.className='event';
 const icon=document.createElement('span');icon.className=`event-icon ${kind}`;icon.textContent=kind==='time'?'◷':kind==='gate'?'⇄':'!';icon.setAttribute('aria-hidden','true');
 const content=document.createElement('div'),heading=document.createElement('h3');heading.textContent=title;
 if(badge){const b=document.createElement('span');b.className='event-badge';b.textContent=badge;heading.append(b);}
 const details=document.createElement('p');details.className='event-details';
 const old=document.createElement('span');old.className='old';old.textContent=before??'Unknown';const fresh=document.createElement('span');fresh.className='new';fresh.textContent=after??'Unknown';
 details.append(old,document.createTextNode('  →  '),fresh);content.append(heading,details);
 const at=document.createElement('time');if(parsed(event.observedAt))at.dateTime=parsed(event.observedAt).toISOString();at.textContent=timestamp(event.observedAt);row.append(icon,content,at);return row;
}
function renderEvents(){const all=data.events??[],visible=all.filter(event=>filter==='all'||group(event)===filter);$('events').replaceChildren(...visible.map(eventView));$('empty-events').hidden=visible.length>0;text('empty-events',all.length?'No updates in this category.':'No changes recorded yet. The first check establishes a baseline.');text('event-count',String(all.length).padStart(2,'0'));}
function render(){
 const demo=data.mode==='demo',f=data.flight,m=data.monitor,origin=f?.departure?.airport??m?.origin,destination=f?.arrival?.airport??m?.destination;
 text('mode',demo?'DEMO DATA':'LIVE RECORDS');$('mode').classList.toggle('live',!demo);$('notice').className=`notice${demo?'':' live'}`;
 text('notice-text',demo?(f?'You’re exploring a simulated flight. Connect your tracker to see recorded live data.':'Demo tracking is stopped. Choose Track a flight to try another simulated flight.'):f?'Connected to saved flight data. Estimates may be incomplete or delayed; confirm details with your airline.':m?'Your flight is enrolled. Waiting for the first scheduled check; no estimates have been recorded yet.':'No flight is currently being tracked. Completed and expired flights are removed by the pilot’s cleanup rules.');
 text('connection',connection?'Connection settings ↗':'Connect live data ↗');
 text('track-flight',f||m?'Switch flight':'Track a flight');$('stop-flight').hidden=!(f||m);
 const carrier=resolveAirline(f,m),badge=$('airline-symbol');
 badge.replaceChildren();badge.className=`airline-symbol${carrier.icon?' airline-logo':''}`;badge.setAttribute('aria-label',carrier.name);badge.title=carrier.code?`${carrier.name} (${carrier.code})`:carrier.name;
 if(carrier.icon){const logo=document.createElement('img');logo.src=carrier.icon;logo.alt='';logo.addEventListener('error',()=>{badge.replaceChildren(document.createTextNode(carrier.code??'✈'));badge.classList.remove('airline-logo');},{once:true});badge.append(logo);}else badge.textContent=carrier.code??'✈';
 text('airline',f||m?carrier.name:'No active flight');text('number',f?.number??m?.number??'—');text('flight-count',f||m?'01':'00');
 text('status',f?.status??(m?'Waiting for check':'Not tracking'));$('status').classList.toggle('cancelled',['canceled','cancelled'].includes(f?.status?.toLowerCase()));
 text('origin',origin??'—');text('destination',destination??'—');text('origin-city',airports[origin]?.[0]??origin??'Origin');text('destination-city',airports[destination]?.[0]??destination??'Destination');
 text('origin-name',f?.departure?.airportName??airports[origin]?.[1]??'');text('destination-name',f?.arrival?.airportName??airports[destination]?.[1]??'');
 setClock('departure-time','departure-zone',f?.departure?.revised??f?.departure?.scheduled);setClock('arrival-time','arrival-zone',f?.arrival?.revised??f?.arrival?.scheduled);
 const date=f?.departure?.scheduled?.slice(0,10)??m?.departure_date;
 text('flight-date',date&&/^\d{4}-\d{2}-\d{2}$/.test(date)?new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`)).toUpperCase():'NO FLIGHT ENROLLED');
 text('departure-gate',f?.departure?.gate??'Not provided');text('arrival-gate',f?.arrival?.gate??'Not provided');text('terminal',f?.departure?.terminal??'Not provided');text('freshness',demo?'Simulated':timestamp(data.observedAt));
 text('monitor-state',demo?(f?'Demo monitoring':'Demo monitoring inactive'):m?'Tracking within pilot limits':'Monitoring inactive');text('next-check',demo?(f?'Hourly checks · within pilot limits':'Choose Track a flight to try the demo'):m?`Next eligible: ${timestamp(m.next_check_at)}`:'Choose Track a flight to get started');
 $('demo-attribution').hidden=!demo;$('refresh').hidden=demo;renderEvents();
}
function validateConnection(url,token,manageToken=''){const endpoint=new URL(url);if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.supabase.co')||endpoint.pathname!=='/functions/v1/flight-dashboard'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.port)throw new Error('Use the exact HTTPS endpoint ending /functions/v1/flight-dashboard.');if(token.length<32)throw new Error('Use your dedicated dashboard read token (at least 32 characters).');if(manageToken&&manageToken.length<32)throw new Error('The separate control token must be at least 32 characters.');return {url:endpoint.href,token,manageToken};}
async function fetchLive(config){const response=await fetch(config.url,{method:'GET',headers:{'x-dashboard-token':config.token},cache:'no-store',signal:AbortSignal.timeout(20000),redirect:'error'});if(!response.ok)throw new Error(response.status===401?'The read token was rejected. Check DASHBOARD_READ_TOKEN in function secrets.':response.status===503?'The dashboard endpoint is disabled. Check DASHBOARD_ENABLED.':`Could not load saved flight data (HTTP ${response.status}).`);const result=await response.json();if(result.mode!=='live'||!Array.isArray(result.events))throw new Error('Unexpected dashboard response. Check the endpoint URL.');return result;}
async function refresh(){if(!connection)return;if(Date.now()-lastRefresh<60000){text('announcement','Please wait one minute between refreshes.');text('notice-text','This view was refreshed recently. Wait one minute before refreshing again.');return;}$('refresh').disabled=true;try{data=await fetchLive(connection);lastRefresh=Date.now();render();text('announcement','Saved flight data refreshed.');}catch(error){$('notice').className='notice error-notice';text('notice-text',`${error.message} Showing the last loaded records; they may be stale.`);}finally{$('refresh').disabled=false;}}
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(other=>{other.classList.toggle('active',other===button);other.setAttribute('aria-pressed',String(other===button));});renderEvents();}));
$('connection').addEventListener('click',()=>{$('endpoint').value=connection?.url??'https://YOUR-PROJECT.supabase.co/functions/v1/flight-dashboard';$('read-token').value=connection?.token??'';$('manage-token').value=connection?.manageToken??'';text('connect-error','');$('connect-dialog').showModal();});
$('close-dialog').addEventListener('click',()=>$('connect-dialog').close());
$('connect-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;text('connect-error','');try{const config=validateConnection($('endpoint').value.trim(),$('read-token').value.trim(),$('manage-token').value.trim());const result=await fetchLive(config);connection=config;try{sessionStorage.setItem('flightwatch-connection',JSON.stringify(config));}catch{}data=result;lastRefresh=Date.now();render();$('connect-dialog').close();text('announcement','Connected to saved live records.');}catch(error){text('connect-error',error.message);}finally{button.disabled=false;}});
$('use-demo').addEventListener('click',()=>{connection=null;try{sessionStorage.removeItem('flightwatch-connection');}catch{}data=structuredClone(sample);filter='all';document.querySelectorAll('[data-filter]').forEach(button=>{button.classList.toggle('active',button.dataset.filter==='all');button.setAttribute('aria-pressed',String(button.dataset.filter==='all'));});render();$('connect-dialog').close();});
function controlsReady(){if(data.mode==='demo')return true;if(connection?.manageToken)return true;$('connection').click();text('connect-error','Add your separate flight control token to switch or stop flights. See UI-CONTROLS-SETUP.md.');return false;}
function localDefault(){return new Date(Date.now()+3*3600000-5*3600000).toISOString();}
$('track-flight').addEventListener('click',()=>{
 if(!controlsReady())return;
 const active=Boolean(data.flight||data.monitor),fallback=localDefault();
 text('track-heading',active?'Switch tracked flight':'Track a flight');text('save-flight',active?'Switch to this flight':'Track this flight');
 text('track-description',data.mode==='demo'?'Demo only: try switching flights without changing your live tracker.':active?'Saving replaces the current flight and clears its live status and changes. Choose a U.S. domestic departure within 24 hours.':'Choose a U.S. domestic flight departing in the next 24 hours.');
 $('flight-number').value=data.flight?.number??data.monitor?.number??'';$('flight-origin').value=data.flight?.departure?.airport??data.monitor?.origin??'';$('flight-destination').value=data.flight?.arrival?.airport??data.monitor?.destination??'';
 $('flight-day').value=fallback.slice(0,10);$('flight-time').value=fallback.slice(11,16);$('flight-offset').value='-05:00';text('track-error','');$('track-dialog').showModal();
});
$('close-track').addEventListener('click',()=>$('track-dialog').close());
$('stop-flight').addEventListener('click',()=>{if(!controlsReady())return;text('stop-error','');$('stop-dialog').showModal();});
for(const id of ['close-stop','cancel-stop'])$(id).addEventListener('click',()=>$('stop-dialog').close());
async function changeFlight(action,target){
 if(data.mode==='demo'){
  if(action==='stop')data={mode:'demo',flight:null,monitor:null,events:[],observedAt:null};
  else data={mode:'demo',observedAt:null,monitor:null,events:[],flight:{number:target.number.toUpperCase().replace(/\s/g,''),airline:'Demo flight',status:'Expected',departure:{airport:target.origin.toUpperCase(),scheduled:target.departureAt},arrival:{airport:target.destination.toUpperCase()}}};
  render();return;
 }
 if(!connection?.manageToken)throw new Error('Add your control token in Connection settings.');
 if(data.monitor&&!data.monitor.id)throw new Error('Deploy the updated flight-dashboard function before using flight controls.');
 const response=await fetch(connection.url,{method:'POST',headers:{'x-dashboard-manage-token':connection.manageToken,'Content-Type':'application/json'},
  body:JSON.stringify({action,expectedId:data.monitor?.id??null,...target}),signal:AbortSignal.timeout(20000),redirect:'error'});
 let result;try{result=await response.json();}catch{throw new Error('Update the flight-dashboard function and refresh before retrying.');}
 if(!response.ok)throw new Error(response.status===401?'Control token rejected. Check DASHBOARD_MANAGE_TOKEN; the read token cannot change flights.':result.error??`Could not change flight (HTTP ${response.status}). Refresh before retrying.`);
 try{data=await fetchLive(connection);lastRefresh=Date.now();render();}
 catch{data={mode:'live',flight:null,monitor:null,events:[],observedAt:null};render();text('notice-text','Your change was saved, but the refreshed view could not load. Refresh the view before making another change.');}
 text('announcement',action==='stop'?'Flight tracking stopped.':'New flight enrolled. Scheduled checks remain within your shared budget.');
}
$('track-form').addEventListener('submit',async event=>{
 event.preventDefault();const button=event.submitter;button.disabled=true;text('track-error','');
 try{
  const number=$('flight-number').value.trim(),origin=$('flight-origin').value.trim(),destination=$('flight-destination').value.trim(),date=$('flight-day').value;
  const departureAt=`${date}T${$('flight-time').value}:00${$('flight-offset').value}`;
  if(!/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/i.test(number.replace(/\s/g,'')))throw new Error('Enter a flight number such as F93229 or UA1229.');
  if(origin.toUpperCase()===destination.toUpperCase())throw new Error('Choose different origin and destination airports.');
  const departure=Date.parse(departureAt);if(!Number.isFinite(departure)||departure<=Date.now()||departure>Date.now()+86400000)throw new Error('Choose a departure in the next 24 hours, using the airport’s UTC offset.');
  await changeFlight('track',{number,origin,destination,date,departureAt});$('track-dialog').close();
 }catch(error){text('track-error',error.message);}finally{button.disabled=false;}
});
$('stop-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;text('stop-error','');try{await changeFlight('stop');$('stop-dialog').close();}catch(error){text('stop-error',error.message);}finally{button.disabled=false;}});
$('refresh').addEventListener('click',refresh);render();if(connection)refresh();
