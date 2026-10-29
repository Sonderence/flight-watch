import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAirline} from '../web/dist/airlines.mjs';
test('United examples and existing snapshots resolve UA and the local United icon',()=>{
 for(const flight of [{number:'UA 1229'},{number:'UAL1229'},{number:'UA1229',airline:'United Airlines'},{number:'UA1229',airlineCode:'UA'}]){
  const airline=resolveAirline(flight);assert.equal(airline.code,'UA');assert.equal(airline.name,'United Airlines');assert.equal(airline.icon,'assets/united.ico');
 }
});
test('switching airlines cannot retain the United or hardcoded Frontier icon',()=>{
 assert.deepEqual(resolveAirline({number:'F9 3229'}),{code:'F9',name:'Frontier Airlines',icon:null});
 assert.equal(resolveAirline(null,{number:'DAL123'}).code,'DL');
 assert.equal(resolveAirline({number:'AA123'}).code,'AA');
 assert.equal(resolveAirline({number:'6E123'}).code,'6E');
 assert.equal(resolveAirline(null,null).code,null);
});
test('provider airline identity takes priority over a codeshare flight prefix',()=>{
 assert.equal(resolveAirline({number:'UA1229',airlineCode:'OO',airline:'SkyWest Airlines'}).code,'OO');
 assert.equal(resolveAirline({number:'UA1229',airline:'SkyWest Airlines'}).code,'OO');
});
