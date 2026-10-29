import {createStorage} from './storage.mjs';
import {enrollment} from './monitor.mjs';

export function createDashboardHandler(env,fetchImpl=fetch){
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'x-dashboard-token, x-dashboard-manage-token, content-type','Cache-Control':'no-store','Content-Type':'application/json'};
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
  return async request=>{
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    if(!['GET','POST'].includes(request.method))return reply({error:'Method not allowed'},405);
    const write=request.method==='POST';
    const token=env(write?'DASHBOARD_MANAGE_TOKEN':'DASHBOARD_READ_TOKEN');
    if(!token||token.length<32||request.headers.get(write?'x-dashboard-manage-token':'x-dashboard-token')!==token)return reply({error:'Unauthorized'},401);
    if(env('DASHBOARD_ENABLED')!=='true')return reply({error:'Dashboard is disabled'},503);
    if(write&&env('DASHBOARD_MANAGEMENT_ENABLED')!=='true')return reply({error:'Flight controls are not enabled. Complete the dashboard-controls setup.'},503);
    try{
      const url=env('SUPABASE_URL'),key=env('WORKER_DB_SECRET');
      createStorage({url,key,fetchImpl});
      if(write){
        if(Number(request.headers.get('content-length'))>4096)return reply({error:'Request too large'},413);
        const raw=await request.text();if(raw.length>4096)return reply({error:'Request too large'},413);
        let body;try{body=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
        if(!body||!['track','stop'].includes(body.action))return reply({error:'Choose track or stop'},400);
        const expected=body.expectedId??null;
        if(expected!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expected))return reply({error:'Refresh this page before changing flights'},400);
        let target;
        if(body.action==='track'){
          try{target=enrollment(body.number,body.date,body.origin,body.destination,body.departureAt);}catch(error){return reply({error:error.message},400);}
        }
        const response=await fetchImpl(`${url.replace(/\/$/,'')}/rest/v1/rpc/manage_pilot_flight`,{
          method:'POST',headers:{apikey:key,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),redirect:'error',
          body:JSON.stringify({p_action:body.action,p_expected_id:expected,...(target?{p_number:target.number,p_date:target.departure_date,p_origin:target.origin,p_destination:target.destination,p_departure_at:target.departure_at}:{})})
        });
        if(!response.ok)return reply({error:'Could not change the tracked flight. Check migration 004, then refresh before retrying.'},502);
        const result=await response.json();
        if(result.result==='conflict')return reply({error:'The tracked flight changed in another session. Refresh before trying again.'},409);
        return reply(result);
      }
      const read=async(table,params)=>{
        const response=await fetchImpl(`${url.replace(/\/$/,'')}/rest/v1/${table}?${new URLSearchParams(params)}`,{
          headers:{apikey:key,Accept:'application/json'},signal:AbortSignal.timeout(15000),redirect:'error'
        });
        if(!response.ok)throw new Error('Database read failed');
        const value=await response.json();if(!Array.isArray(value))throw new Error('Invalid database response');return value;
      };
      const monitors=await read('flight_monitoring',{select:'id,number,departure_date,origin,destination,departure_at,stop_at,next_check_at,attempts,last_outcome',active:'eq.true',limit:'1'});
      const monitor=monitors[0];
      if(!monitor)return reply({mode:'live',flight:null,events:[],monitor:null,observedAt:null,readAt:new Date().toISOString()});
      const id=['aerodatabox',monitor.number,monitor.origin,monitor.destination,monitor.departure_date].join('|');
      const observations=await read('flight_observations',{select:'id,observed_at,snapshot',flight_id:`eq.${id}`,expires_at:`gt.${new Date().toISOString()}`,order:'observed_at.desc',limit:'48'});
      const observationsById=new Map(observations.map(o=>[o.id,o]));
      const changes=observations.length?await read('flight_changes',{select:'observation_id,event_index,event',observation_id:`in.(${observations.map(o=>o.id).join(',')})`,order:'observation_id,event_index',limit:'150'}):[];
      const events=changes.map(c=>({...c.event,id:`${c.observation_id}/${c.event_index}`,observedAt:observationsById.get(c.observation_id)?.observed_at})).sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt));
      return reply({mode:'live',flight:observations[0]?.snapshot??null,observedAt:observations[0]?.observed_at??null,monitor,events,readAt:new Date().toISOString(),source:'AeroDataBox'});
    }catch{return reply({error:'Could not read flight data. Check the function configuration.'},500);}
  };
}
