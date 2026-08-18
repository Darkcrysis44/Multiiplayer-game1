const PROTOCOL = 2;
const WORLD = { minX: 30, maxX: 770, minY: 62, maxY: 570 };
const TICK_MS = 50;
const PLAYER_RADIUS = 18;
const PLAYER_SPEED = 3.2;
const SWORD_RANGE = 125;
const SWORD_HALF_ANGLE = 0.95;
const SWORD_DAMAGE = 14;
const BOW_COOLDOWN = 420;
const SWORD_COOLDOWN = 270;
const ARROW_SPEED = 7.2;
const ARROW_LIFE_MS = 2400;
const ARROW_DAMAGE = 16;
const ARROW_RADIUS = 5;

function finite(n, fallback=0) {
  return Number.isFinite(Number(n)) ? Number(n) : fallback;
}
function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
function normAngle(a){
  a=finite(a,0);
  return Math.atan2(Math.sin(a),Math.cos(a));
}
function segmentCircleHit(x1,y1,x2,y2,cx,cy,r){
  const dx=x2-x1, dy=y2-y1;
  const len2=dx*dx+dy*dy;
  if(len2===0) return Math.hypot(cx-x1,cy-y1)<=r;
  const t=clamp(((cx-x1)*dx+(cy-y1)*dy)/len2,0,1);
  const px=x1+dx*t, py=y1+dy*t;
  return Math.hypot(cx-px,cy-py)<=r;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket")
        return new Response("Expected WebSocket", {status:426});
      const room = (url.searchParams.get("room") || "love-sword-arena")
        .replace(/[^a-zA-Z0-9_-]/g,"").slice(0,64) || "love-sword-arena";
      const id = env.ROOM.idFromName(room);
      return env.ROOM.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

export class Room {
  constructor(state) {
    this.state = state;
    this.clients = new Map();
    this.players = new Map();
    this.projectiles = new Map();
    this.lastTick = Date.now();
    this.tickScheduled = false;
    this.nextProjectile = 1;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("WebSocket only", {status:426});

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const id = crypto.randomUUID();
    const now = Date.now();

    const player = {
      id, x:400, y:300, angle:0, hp:100, maxHp:100,
      radius:PLAYER_RADIUS, speed:PLAYER_SPEED, weapon:"sword",
      input:{up:false,down:false,left:false,right:false},
      inputSeq:0, lastAttackSeq:0, lastSword: -SWORD_COOLDOWN,
      lastBow: -BOW_COOLDOWN, connectedAt:now, lastSeen:now,
      mutedUntil:0,
      inputWindowStart:now, inputWindowCount:0,
      attackWindowStart:now, attackWindowCount:0
    };

    this.clients.set(id, server);
    this.players.set(id, player);

    server.send(JSON.stringify({
      type:"welcome",
      protocol:PROTOCOL,
      playerId:id,
      serverTime:now,
      state:this.snapshot()
    }));

    this.broadcast({type:"playerJoined", player:this.publicPlayer(player)}, id);
    this.ensureTick();

    server.addEventListener("message", e => {
      if (typeof e.data !== "string" || e.data.length > 8192) {
        try { server.close(1009, "message too large"); } catch {}
        return;
      }
      try { this.onMessage(id, JSON.parse(e.data)); } catch {}
    });

    const disconnect = () => this.disconnect(id);
    server.addEventListener("close", disconnect);
    server.addEventListener("error", disconnect);

    return new Response(null,{status:101,webSocket:client});
  }

  onMessage(id,m) {
    const p=this.players.get(id);
    if(!p || !m || typeof m.type!=="string") return;
    const now=Date.now();
    if(now-p.lastSeen > 10000) return;
    p.lastSeen=now;

    if(m.type==="input") {
      if(now<p.mutedUntil) return;
      if(now-p.inputWindowStart>=1000){p.inputWindowStart=now;p.inputWindowCount=0;}
      if(++p.inputWindowCount>30){p.mutedUntil=now+1000;return;}
      const seq=Number(m.seq);
      if(!Number.isSafeInteger(seq) || seq<=p.inputSeq || seq-p.inputSeq>10000) return;
      p.inputSeq=seq;
      p.input={
        up:!!m.up, down:!!m.down,
        left:!!m.left, right:!!m.right
      };
      if(Number.isFinite(Number(m.angle))) p.angle=normAngle(m.angle);
      if(m.weapon==="bow" || m.weapon==="sword") p.weapon=m.weapon;
      return;
    }

    if(m.type==="playerAttack") {
      if(now<p.mutedUntil) return;
      if(now-p.attackWindowStart>=1000){p.attackWindowStart=now;p.attackWindowCount=0;}
      if(++p.attackWindowCount>12){p.mutedUntil=now+1000;return;}
      const attackSeq=Number(m.seq);
      if(!Number.isSafeInteger(attackSeq) || attackSeq<=p.lastAttackSeq) return;
      p.lastAttackSeq=attackSeq;
      const weapon=m.weapon==="bow" ? "bow" : "sword";
      const angle=normAngle(m.angle);
      p.weapon=weapon;
      p.angle=angle;
      this.attack(p,weapon,angle,attackSeq);
      return;
    }
  }

  attack(p,weapon,angle,attackSeq) {
    const now=Date.now();
    if(p.hp<=0) return;

    if(weapon==="sword"){
      if(now-p.lastSword<SWORD_COOLDOWN) return;
      p.lastSword=now;

      this.broadcast({
        type:"attackConfirmed",
        playerId:p.id, attackId:attackSeq,
        weapon:"sword", angle, serverTime:now
      });

      const target=this.findSwordTarget(p,angle);
      if(target){
        target.hp=Math.max(0,target.hp-SWORD_DAMAGE);
        this.broadcast({
          type:"hpChanged", playerId:target.id,
          hp:target.hp, maxHp:target.maxHp,
          attackerId:p.id, weapon:"sword"
        });
      }
      return;
    }

    if(now-p.lastBow<BOW_COOLDOWN) return;
    p.lastBow=now;

    this.broadcast({
      type:"attackConfirmed",
      playerId:p.id, attackId:attackSeq,
      weapon:"bow", angle, serverTime:now
    });

    // Match Solo: arrow starts at the player's position, then moves forward.
    const id=String(this.nextProjectile++);
    const q={
      id, ownerId:p.id,
      x:p.x, y:p.y,
      vx:Math.cos(angle)*ARROW_SPEED,
      vy:Math.sin(angle)*ARROW_SPEED,
      angle, life:ARROW_LIFE_MS, damage:ARROW_DAMAGE, radius:ARROW_RADIUS
    };
    this.projectiles.set(id,q);
    this.broadcast({type:"projectileSpawned",id,projectile:q});
    this.ensureTick();
  }

  findSwordTarget(a,angle){
    let best=null,bestD=Infinity;
    for(const p of this.players.values()){
      if(p.id===a.id || p.hp<=0 || !p.connected) continue;
      const dx=p.x-a.x,dy=p.y-a.y,d=Math.hypot(dx,dy);
      // Body radius is included so touching the target counts.
      if(d>SWORD_RANGE+p.radius) continue;
      const da=Math.atan2(Math.sin(Math.atan2(dy,dx)-angle),
                          Math.cos(Math.atan2(dy,dx)-angle));
      if(Math.abs(da)>SWORD_HALF_ANGLE) continue;
      if(d<bestD){bestD=d;best=p;}
    }
    return best;
  }

  gameTick(){
    const now=Date.now();
    const dt=Math.min(100,Math.max(0,now-this.lastTick))/1000;
    this.lastTick=now;

    for(const p of this.players.values()){
      if(!p.connected || p.hp<=0) continue;
      let dx=(p.input.right?1:0)-(p.input.left?1:0);
      let dy=(p.input.down?1:0)-(p.input.up?1:0);
      const len=Math.hypot(dx,dy);
      if(len){dx/=len;dy/=len;}
      p.x=clamp(p.x+dx*p.speed*60*dt,WORLD.minX,WORLD.maxX);
      p.y=clamp(p.y+dy*p.speed*60*dt,WORLD.minY,WORLD.maxY);
    }

    for(const [id,q] of this.projectiles){
      const oldX=q.x,oldY=q.y;
      q.x += q.vx*60*dt;
      q.y += q.vy*60*dt;
      q.life -= dt*1000;

      let hit=null;
      for(const p of this.players.values()){
        if(p.id===q.ownerId || p.hp<=0 || !p.connected) continue;
        if(segmentCircleHit(oldX,oldY,q.x,q.y,p.x,p.y,p.radius+q.radius)){
          hit=p; break;
        }
      }

      if(hit){
        hit.hp=Math.max(0,hit.hp-q.damage);
        this.broadcast({type:"hpChanged",playerId:hit.id,hp:hit.hp,maxHp:hit.maxHp,
          attackerId:q.ownerId,weapon:"bow"});
        this.broadcast({type:"projectileRemoved",id});
        this.projectiles.delete(id);
      } else if(q.life<=0){
        this.broadcast({type:"projectileRemoved",id});
        this.projectiles.delete(id);
      }
    }

    if(this.clients.size){
      this.broadcast({type:"state",serverTime:now,state:this.snapshot()});
      this.ensureTick();
    } else {
      this.tickScheduled=false;
    }
  }

  ensureTick(){
    if(this.tickScheduled) return;
    this.tickScheduled=true;
    this.state.storage.setAlarm(Date.now()+TICK_MS).catch(()=>{
      this.tickScheduled=false;
    });
  }

  async alarm(){
    this.tickScheduled=false;
    this.gameTick();
  }

  snapshot(){
    const players={};
    for(const p of this.players.values()) players[p.id]=this.publicPlayer(p);
    return {
      players,
      projectiles:[...this.projectiles.values()],
      serverTime:Date.now()
    };
  }

  publicPlayer(p){
    return {
      id:p.id,x:p.x,y:p.y,angle:p.angle,hp:p.hp,maxHp:p.maxHp,
      weapon:p.weapon
    };
  }

  broadcast(msg,except=null){
    const text=JSON.stringify(msg);
    for(const [id,ws] of this.clients){
      if(id===except) continue;
      try{ws.send(text)}catch{}
    }
  }

  disconnect(id){
    const ws=this.clients.get(id);
    this.clients.delete(id);
    const p=this.players.get(id);
    if(p){
      p.connected=false;
      this.players.delete(id);
      this.broadcast({type:"playerLeft",id});
    }
    try{ws?.close()}catch{}
    if(this.clients.size) this.ensureTick();
  }
}
