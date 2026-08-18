export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', {status:426});
      const room = (url.searchParams.get('room') || 'love-sword-arena').slice(0,64);
      const id = env.ROOM.idFromName(room);
      return env.ROOM.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

export class Room {
  constructor(state) { this.state=state; this.clients=new Map(); this.players=new Map(); }
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket only',{status:426});
    const pair=new WebSocketPair(); const [client,server]=Object.values(pair); server.accept();
    const id=crypto.randomUUID();
    const p={id,x:400,y:300,hp:100,maxHp:100,angle:0,weapon:'sword',attackCd:0,lastAttack:0,updated:Date.now()};
    this.clients.set(id,server); this.players.set(id,p);
    server.send(JSON.stringify({type:'welcome',id,players:Object.fromEntries(this.players)}));
    this.broadcast({type:'playerJoined',player:p},id);
    server.addEventListener('message',e=>{try{this.onMessage(id,JSON.parse(e.data))}catch{}});
    server.addEventListener('close',()=>{this.clients.delete(id);this.players.delete(id);this.broadcast({type:'playerLeft',id})});
    return new Response(null,{status:101,webSocket:client});
  }
  broadcast(msg,except){const s=JSON.stringify(msg);for(const [id,ws] of this.clients)if(id!==except)try{ws.send(s)}catch{}}
  send(id,msg){try{this.clients.get(id)?.send(JSON.stringify(msg))}catch{}}
  onMessage(id,m){
    const p=this.players.get(id);if(!p)return;
    if(m.type==='join')return;
    if(m.type==='playerState'){
      p.x=Math.max(30,Math.min(770,Number(m.x)||p.x));p.y=Math.max(60,Math.min(570,Number(m.y)||p.y));p.angle=Number(m.angle)||0;p.weapon=m.weapon==='bow'?'bow':'sword';p.updated=Date.now();
      this.broadcast({type:'state',players:Object.fromEntries(this.players)});return;
    }
    if(m.type==='playerAttack') this.attack(p,m);
  }
  attack(p,m){
    const now=Date.now();const cd=m.weapon==='bow'?420:270;
    if(now-p.lastAttack<cd || p.hp<=0)return;
    p.lastAttack=now;p.weapon=m.weapon==='bow'?'bow':'sword';p.angle=Number(m.angle)||p.angle;
    this.broadcast({type:'attackConfirmed',playerId:p.id,attackId:m.attackId,weapon:p.weapon});
    if(p.weapon==='bow'){
      const id=crypto.randomUUID(); const a=p.angle; const projectile={id,x:p.x+Math.cos(a)*38,y:p.y+Math.sin(a)*38,vx:Math.cos(a)*7.2,vy:Math.sin(a)*7.2,life:2.4,ownerId:p.id};
      this.broadcast({type:'projectileSpawned',id,projectile});
      // Server-authoritative projectile simulation is handled by a short alarm.
      this.state.storage.put('projectile:'+id,projectile); this.schedule(); return;
    }
    const target=this.findSwordTarget(p); if(!target)return;
    const damage=14;target.hp=Math.max(0,target.hp-damage);
    this.broadcast({type:'hpChanged',playerId:target.id,hp:target.hp,maxHp:target.maxHp});
  }
  findSwordTarget(a){let best=null,bd=Infinity;for(const p of this.players.values()){if(p.id===a.id||p.hp<=0)continue;const dx=p.x-a.x,dy=p.y-a.y,d=Math.hypot(dx,dy);if(d>143)continue;let da=Math.atan2(Math.sin(Math.atan2(dy,dx)-a.angle),Math.cos(Math.atan2(dy,dx)-a.angle));if(Math.abs(da)>.475)continue;if(d<bd){best=p;bd=d}}return best}
  async alarm(){await this.stepProjectiles()}
  async stepProjectiles(){const list=await this.state.storage.list({prefix:'projectile:'});for(const [key,q] of list){q.x+=q.vx*60*.05;q.y+=q.vy*60*.05;q.life-=.05;let hit=null;for(const p of this.players.values()){if(p.id===q.ownerId||p.hp<=0)continue;if(Math.hypot(p.x-q.x,p.y-q.y)<=24){hit=p;break}}if(hit){hit.hp=Math.max(0,hit.hp-16);this.broadcast({type:'hpChanged',playerId:hit.id,hp:hit.hp,maxHp:hit.maxHp});this.broadcast({type:'projectileRemoved',id:q.id});await this.state.storage.delete(key);continue}if(q.life<=0){this.broadcast({type:'projectileRemoved',id:q.id});await this.state.storage.delete(key)}else await this.state.storage.put(key,q)}if((await this.state.storage.list({prefix:'projectile:',limit:1})).size)this.schedule()}
  async schedule(){try{await this.state.storage.setAlarm(Date.now()+50)}catch{}}
}
