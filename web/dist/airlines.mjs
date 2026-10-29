// Local airline identification, not an API or a logo service.
const carriers = [
  ['UA','UAL','United Airlines'],['F9','FFT','Frontier Airlines'],['AA','AAL','American Airlines'],
  ['DL','DAL','Delta Air Lines'],['WN','SWA','Southwest Airlines'],['B6','JBU','JetBlue Airways'],
  ['AS','ASA','Alaska Airlines'],['NK','NKS','Spirit Airlines'],['G4','AAY','Allegiant Air'],
  ['HA','HAL','Hawaiian Airlines'],['OO','SKW','SkyWest Airlines']
];
const byCode=new Map(carriers.flatMap(([iata,icao,name])=>[[iata,{code:iata,name}],[icao,{code:iata,name}]]));
const byName=new Map(carriers.map(([code,,name])=>[name.toLowerCase(),{code,name}]));
byName.set('united',{code:'UA',name:'United Airlines'});
byName.set('delta airlines',{code:'DL',name:'Delta Air Lines'});

export function resolveAirline(flight,monitor){
  const number=String(flight?.number??monitor?.number??'').replace(/\s/g,'').toUpperCase();
  const explicit=String(flight?.airlineCode??'').toUpperCase();
  const reported=typeof flight?.airline==='string'?flight.airline.trim():'';
  let carrier=byCode.get(explicit)??byName.get(reported.toLowerCase());
  if(!carrier){
    const prefix=number.match(/^([A-Z]{3})(?=\d)/)?.[1]??number.match(/^([A-Z0-9]{2})(?=\d)/)?.[1];
    const code=/^[A-Z0-9]{2,3}$/.test(explicit)?explicit:prefix??null;
    carrier=byCode.get(code)??{code,name:reported&&reported!=='Demo flight'?reported:code?`Airline ${code}`:'Airline not provided'};
  }
  return {...carrier,icon:carrier.code==='UA'?'assets/united.ico':null};
}
