import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const root=new URL('../web/dist/',import.meta.url);
const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css','/airlines.mjs':'airlines.mjs','/assets/united.ico':'assets/united.ico'};
createServer(async(req,res)=>{
 const file=files[new URL(req.url,'http://localhost').pathname];
 if(!file){res.writeHead(404);res.end('Not found');return;}
 try{const content=await readFile(new URL(file,root));res.writeHead(200,{'Content-Type':file.endsWith('.js')||file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.ico')?'image/x-icon':'text/html','Cache-Control':'no-store'});res.end(content);}catch{res.writeHead(500);res.end('Could not load page');}
}).listen(Number(process.argv[2]??4173),'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${process.argv[2]??4173}`));
