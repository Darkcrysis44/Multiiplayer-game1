/*
 Love Sword Arena — multiplayer relay/room server
 Node.js 18+ recommended.
 Start: npm install && npm start
 Then open http://localhost:8787/
*/
const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const WebSocket=require('ws');

const PORT=process.env.PORT||8787;
const ROOT=__dirname;
const rooms=new Map();

function id(){return crypto.randomBytes(4).toString('hex')}
function roomState(code){if(!rooms.has(code))rooms.set(code,{players:new Map(),host:null,lastSnapshot:null});return rooms.get(code)}
function send(ws,msg){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(msg))}
function broadcast(room,msg,except=null){for(const p of room.players.values())if(p.ws!==except)send(p.ws,msg)}
function playerList(room){return [...room.players.values()].map(p=>({id:p.id,name:p.player?.name||'Hunter',level:p.player?.level||1,rebirths:p.player?.rebirths||0,hp:p.player?.hp??100,maxHp:p.player?.maxHp??100,down:!!p.player?.down,x:p.player?.x||0,y:p.player?.y||0,weapon:p.player?.weapon||'sword'}))}

const server=http.createServer((req,res)=>{
 let u=new URL(req.url,'http://localhost');
 let file=u.pathname==='/'?'/index.html':u.pathname;
 const full=path.normalize(path.join(ROOT,file));
 if(!full.startsWith(ROOT)){res.writeHead(403);return res.end('Forbidden')}
 fs.readFile(full,(err,data)=>{
  if(err){res.writeHead(404);return res.end('Not found')}
  const type=full.endsWith('.html')?'text/html; charset=utf-8':full.endsWith('.mp3')?'audio/mpeg':'application/octet-stream';
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache'});res.end(data);
 });
});
const wss=new WebSocket.Server({server});

wss.on('connection',ws=>{
 const client={ws,id:id(),room:null,player:{}};
 ws.on('message',raw=>{
  let m;try{m=JSON.parse(raw)}catch(e){return}
  if(m.type==='join'){
   const code=String(m.room||'LOVE').toUpperCase().slice(0,12);
   const room=roomState(code);client.room=code;client.player=m.player||{};
   room.players.set(client.id,client);
   if(!room.host)room.host=client.id;
   send(ws,{type:'welcome',id:client.id,host:room.host===client.id,room:code});
   broadcast(room,{type:'players',players:playerList(room)});
   if(room.lastSnapshot)send(ws,room.lastSnapshot);
   return;
  }
  if(!client.room)return;
  const room=rooms.get(client.room);if(!room)return;
  if(m.type==='input'){client.player={...client.player,...(m.player||{})};if(client.id!==room.host)broadcast(room,{type:'input',id:client.id,keys:m.keys||{},player:client.player},ws);return}
  if(m.type==='attack'){if(client.id!==room.host)broadcast(room,{type:'attack',id:client.id,angle:m.angle,weapon:m.weapon},ws);return}
  if(m.type==='down'){client.player={...client.player,...(m.player||{}),down:true};broadcast(room,{type:'players',players:playerList(room)});return}
  if(m.type==='reward'){
   const target=room.players.get(String(m.target));if(target)send(target.ws,{type:'reward',target:target.id,gold:Number(m.gold||0),xp:Number(m.xp||0)});
   return;
  }
  if(m.type==='revive'){
   const target=room.players.get(String(m.target));if(!target)return;
   target.player.down=false;target.player.hp=Math.max(1,Math.round((target.player.maxHp||100)*.45));
   broadcast(room,{type:'revive',target:target.id,by:client.id});
   broadcast(room,{type:'players',players:playerList(room)});
   return;
  }
  if(m.type==='snapshot'&&client.id===room.host){
   room.lastSnapshot=m;
   client.player={...client.player,...(m.players?.[client.id]||{})};
   broadcast(room,m,ws);
   // Keep server-side player metadata fresh for the roster.
   for(const [pid,p] of Object.entries(m.players||{})){const q=room.players.get(pid);if(q)q.player={...q.player,...p}}
   broadcast(room,{type:'players',players:playerList(room)});
   return;
  }
 });
 ws.on('close',()=>{
  if(!client.room)return;const room=rooms.get(client.room);if(!room)return;
  room.players.delete(client.id);
  if(room.host===client.id){
   const next=room.players.keys().next().value||null;room.host=next;
   if(next){const p=room.players.get(next);send(p.ws,{type:'host_changed',host:next})}
  }
  broadcast(room,{type:'players',players:playerList(room)});
  if(room.players.size===0)rooms.delete(client.room);
 });
});
server.listen(PORT,()=>console.log(`Love Sword Arena multiplayer: http://localhost:${PORT}`));
