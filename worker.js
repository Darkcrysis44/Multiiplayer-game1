const MAX_PLAYERS = 4;
const TICK_MS = 8;        // ~120 Hz authoritative simulation (ultra smooth co-op)
const STATE_MS = 16;      // ~60 Hz snapshots; client prediction covers the rest
const WIDTH = 1200, HEIGHT = 700;
const TYPES = {
  broken:[.55,1,1,21,'Broken Heart','Common'], charger:[.10,.8,1.8,19,'Heart Charger','Uncommon'],
  duelist:[.06,1.15,1.2,22,'Heart Duelist','Uncommon'], archer:[.06,.9,.72,20,'Cupid Archer','Uncommon'],
  lancer:[.05,1.25,.95,24,'Rose Lancer','Uncommon'], tank:[.04,2.2,.55,27,'Grief Tank','Rare'],
  mage:[.03,1,.58,22,'Heart Mage','Rare'], splitter:[.03,1.5,.8,23,'Split Heart','Rare'],
  sentinel:[.02,1.65,.46,25,'Rose Sentinel','Rare'], guard:[.02,1.15,.62,24,'Cupid Guard','Uncommon'],
  mimic:[.02,1.4,.7,24,'Heart Mimic','Rare'], assassin:[.01,.72,1.65,18,'Love Assassin','Epic'],
  brute:[.01,2.7,.38,31,'Heart Brute','Epic'], berserker:[.01,1.35,1.3,24,'Love Berserker','Epic'],
  lovebreaker:[.01,2,.95,27,'Love Breaker','Epic'], witch:[.005,1.05,.5,22,'Heart Witch','Legendary'], witchling:[0, .22, .28, 16, 'Witchling','Common']
};
const BOSS_DEFS = [
  {name:'Heartbreaker',icon:'💔',hp:7,spd:.70,atk:3.4,skill:'dash'},
  {name:'Rose Colossus',icon:'🌹',hp:11,spd:.42,atk:4.5,skill:'slam'},
  {name:'Cupid Tyrant',icon:'🏹',hp:8,spd:.58,atk:3.2,skill:'volley'},
  {name:'Broken Duchess',icon:'👑',hp:6.5,spd:.82,atk:3.0,skill:'summon'},
  {name:'Grief Knight',icon:'🛡️',hp:9,spd:.62,atk:4.0,skill:'shield'},
  {name:'Passion Beast',icon:'🔥',hp:8.5,spd:1.05,atk:3.7,skill:'charge'},
  {name:'Toxic Lover',icon:'☠️',hp:7.5,spd:.72,atk:3.1,skill:'poison'},
  {name:'Shadow Heart',icon:'🌑',hp:6,spd:1.15,atk:3.0,skill:'blink'},
  {name:'Love Reaper',icon:'🗡️',hp:10,spd:.76,atk:4.2,skill:'scythe'},
  {name:'Final Heart',icon:'❤️‍🔥',hp:14,spd:.55,atk:5.0,skill:'nova'}
];
const UPGRADE_CHOICES = [
  {id:'hp',icon:'❤️',name:'Vitality',desc:'Max HP +25'}, {id:'atk',icon:'⚔️',name:'Sharpness',desc:'Attack +4'},
  {id:'spd',icon:'💨',name:'Grace',desc:'Speed +0.35'}, {id:'crit',icon:'✨',name:'True Love',desc:'Crit +5%'},
  {id:'armor',icon:'🛡️',name:'Protection',desc:'Armor +3'}, {id:'heal',icon:'💗',name:'Second Heart',desc:'Heal 35% HP'}
];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const cleanRoom=s=>String(s||'LOVE').toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,24)||'LOVE';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket endpoint', {status:426});
      const room = cleanRoom(url.searchParams.get('room'));
      return env.ROOM.get(env.ROOM.idFromName(room)).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

export class Room {
  constructor(state) {
    this.state=state; this.sockets=new Map(); this.players=new Map();
    this.phase='lobby'; this.wave=1; this.enemies=[]; this.spawned=0; this.nextEnemy=1;
    this.lastTick=Date.now(); this.lastState=0; this.stateSeq=0; this.nextTickAlarm=null; this.countdownAt=0;
    this.offer=null; this.picks=new Map(); this.attackSeq=0; this.projectiles=[];
  }
  async fetch(request) {
    if(request.headers.get('Upgrade')!=='websocket') return new Response('Room online');
    if(this.sockets.size>=MAX_PLAYERS) return new Response('Room full',{status:429});
    const pair=new WebSocketPair(), client=pair[0], server=pair[1]; server.accept();
    const id=crypto.randomUUID();
    this.sockets.set(id,server);
    this.players.set(id,{id,name:'Player',x:WIDTH/2,y:HEIGHT/2,hp:100,maxHp:100,atk:14,spd:3.2,armor:0,crit:.08,ix:0,iy:0,angle:0,weapon:'sword',lastAttack:0,skillCd:0,skill:'',downed:false,reviveProgress:0,level:1,rebirths:0,mult:1,passives:[]});
    this.send(id,{type:'welcome',id,serverNow:Date.now(),phase:this.phase,wave:this.wave,state:this.snapshotFor(id),serverAuthoritative:true});
    this.broadcastPlayers(); this.ensureAlarm();
    const onMessage=e=>{try{this.message(id,JSON.parse(e.data))}catch{}};
    const cleanup=()=>{this.sockets.delete(id);this.players.delete(id);this.picks.delete(id);this.broadcastPlayers();if(this.players.size===0){this.resetRoom();}};
    server.addEventListener('message',onMessage); server.addEventListener('close',cleanup); server.addEventListener('error',cleanup);
    return new Response(null,{status:101,webSocket:client});
  }
  resetRoom(){this.phase='lobby';this.wave=1;this.enemies=[];this.projectiles=[];this.spawned=0;this.offer=null;this.picks.clear();this.countdownAt=0;}
  async ensureAlarm(){if(this.nextTickAlarm)return;this.nextTickAlarm=Date.now()+TICK_MS;try{await this.state.storage.setAlarm(this.nextTickAlarm)}catch{this.nextTickAlarm=null}}
  async alarm(){this.nextTickAlarm=null;const now=Date.now();this.tick(now);if(this.sockets.size)await this.ensureAlarm()}
  message(id,m){const p=this.players.get(id);if(!p)return;
    if(m.type==='join'){p.name=String(m.name||'Player').slice(0,20)||'Player';this.setStats(p,m.stats);if(m.progression){p.level=clamp(Number(m.progression.level)||p.level,1,9999);p.xp=clamp(Number(m.progression.xp)||0,0,1e12);p.rebirths=clamp(Number(m.progression.rebirths)||p.rebirths,0,9999);p.mult=clamp(Number(m.progression.mult)||p.mult,1,1000);p.progressRev=clamp(Number(m.progression.progressRev)||p.progressRev,0,1e9);}this.broadcastPlayers();this.broadcastState(true);return;}
    if(m.type==='progressSync' && m.progression){
      const pr=m.progression;
      const rev=clamp(Number(pr.progressRev)||0,0,1e9);
      if(rev>=p.progressRev){
        p.level=clamp(Number(pr.level)||p.level,1,9999);p.xp=clamp(Number(pr.xp)||0,0,1e12);p.rebirths=clamp(Number(pr.rebirths)||p.rebirths,0,9999);p.mult=clamp(Number(pr.mult)||p.mult,1,1000);
        p.progressRev=rev;
        this.send(id,{type:'progression',progression:this.progression(p)});this.broadcastState(true);
      }
      return;
    }
    if(m.type==='restartRequest' && this.phase==='gameover' && this.players.size>=1){
      if(m.stats)this.setStats(p,m.stats);
      this.phase='countdown';this.enemies=[];this.spawned=0;this.wave=1;this.picks.clear();this.offer=null;this.countdownAt=Date.now()+1200;
      for(const q of this.players.values()){q.x=WIDTH/2;q.y=HEIGHT/2;q.hp=q.maxHp;q.downed=false;q.reviveProgress=0;q.ix=0;q.iy=0;q.lastAttack=0}
      this.broadcast({type:'serverRestart',startAt:this.countdownAt,serverNow:Date.now()});this.broadcastState(true);return;
    }
    if(m.type==='startRequest' && this.phase==='lobby' && this.players.size>=1){
      this.setStats(p,m.stats);this.phase='countdown';this.enemies=[];this.spawned=0;this.wave=1;this.picks.clear();this.offer=null;this.countdownAt=Date.now()+2000;
      this.broadcast({type:'serverStart',startAt:this.countdownAt,serverNow:Date.now()});this.broadcastState(true);return;
    }
    if(m.type==='input' && (this.phase==='battle'||this.phase==='countdown')){
      p.angle=Number.isFinite(Number(m.angle))?Number(m.angle):p.angle;
      if(p.downed){p.ix=0;p.iy=0;return}
      p.ix=clamp(Number(m.x)||0,-1,1);p.iy=clamp(Number(m.y)||0,-1,1);return;
    }
    if(m.type==='weaponChange' && !p.downed){p.weapon=String(m.weapon||'sword')==='bow'?'bow':'sword';this.broadcastState(true);return;}
    if(m.type==='attack' && this.phase==='battle' && !p.downed){this.serverAttack(p,m);return;}
    if(m.type==='skill' && this.phase==='battle' && !p.downed){this.serverSkill(p,m);return;}
    if(m.type==='upgradePick' && this.phase==='upgrade' && this.offer && m.offerId===this.offer.id && !this.picks.has(id)){
      const choice=String(m.choice||'');if(!this.offer.choices.some(c=>c.id===choice))return;
      this.picks.set(id,choice);this.applyUpgrade(p,choice);this.broadcast({type:'upgradeProgress',picked:this.picks.size,total:this.players.size});this.broadcast({type:'upgradePicked',playerId:id,choice});
      if(this.picks.size>=this.players.size){this.phase='countdown';this.wave++;this.spawned=0;this.enemies=[];this.offer=null;this.countdownAt=Date.now()+900;this.broadcast({type:'upgradeReady',wave:this.wave,startAt:this.countdownAt,serverNow:Date.now()});}
    }
  }
  setStats(p,s){
    if(!s)return;
    p.atk=clamp(Number(s.atk)||p.atk,1,10000);
    p.spd=clamp(Number(s.spd)||p.spd,.5,20);
    p.maxHp=clamp(Number(s.maxHp)||p.maxHp,20,100000);
    p.hp=clamp(Number(s.hp)||p.maxHp,1,p.maxHp);
    p.downed=false;p.reviveProgress=0;
    p.armor=clamp(Number(s.armor)||p.armor,0,1000);
    p.crit=clamp(Number(s.crit)||p.crit,0,1);
    p.skill=String(s.skill||p.skill||'').slice(0,32);p.skillCd=0;
    p.level=clamp(Number(s.level)||1,1,9999);
    p.xp=clamp(Number(s.xp)||0,0,1e12);
    p.progressRev=clamp(Number(s.progressRev)||0,0,1e9);
    p.rebirths=clamp(Number(s.rebirths)||0,0,9999);
    p.mult=clamp(Number(s.mult)||1,1,1000);
    p.passives=Array.isArray(s.passives)?s.passives.slice(0,32).map(String):[];
  }
  applyUpgrade(p,c){if(c==='hp'){p.maxHp+=25;p.hp+=25}else if(c==='atk')p.atk+=4;else if(c==='spd')p.spd+=.35;else if(c==='crit')p.crit=clamp(p.crit+.05,0,1);else if(c==='armor')p.armor+=3;else if(c==='heal')p.hp=Math.min(p.maxHp,p.hp+p.maxHp*.35)}
  spawn(typeOverride=null, sourceX=null, sourceY=null){
    let x,y;
    if(Number.isFinite(sourceX)&&Number.isFinite(sourceY)){x=sourceX;y=sourceY;}
    else {const side=Math.floor(Math.random()*4);if(side===0){x=Math.random()*WIDTH;y=-40}else if(side===1){x=WIDTH+40;y=Math.random()*HEIGHT}else if(side===2){x=Math.random()*WIDTH;y=HEIGHT+40}else{x=-40;y=Math.random()*HEIGHT}}
    let roll=Math.random(),type=typeOverride;
    if(!type){if(this.wave%5===0&&this.spawned===0)type='boss';else{let acc=0;for(const[k,v]of Object.entries(TYPES)){acc+=v[0];if(roll<acc){type=k;break}}}}
    let mult=1+this.wave*.15,hp=(34+this.wave*15)*mult,spd=.55+this.wave*.045+Math.random()*.35,atk=7+this.wave*1.7,r=21;
    if(type==='boss'){
      const bossDef=BOSS_DEFS[(Math.floor(this.wave/5)-1)%BOSS_DEFS.length];hp*=bossDef.hp;spd*=bossDef.spd;atk*=bossDef.atk;r=44;
    }else{
      const t=TYPES[type]||TYPES.broken;hp*=t[1];spd*=t[2];r=t[3];
      if(type==='charger')atk*=1.15;if(type==='tank')atk*=1.35;if(type==='duelist')atk*=1.65;if(type==='assassin')atk*=2;
      if(type==='brute')atk*=1.7;if(type==='lovebreaker')atk*=3;if(type==='berserker')atk*=2.35;if(type==='lancer')atk*=1.9;if(type==='witch')atk*=1.45;
    }
    if(type==='witchling'){hp=28+this.wave*8;spd=.28;atk=4+this.wave*.6;r=16;}
    const bossIndex=type==='boss'?Math.floor(this.wave/5)-1:-1;
    const bossDef=type==='boss'?BOSS_DEFS[bossIndex]:null;
    this.enemies.push({id:'e'+this.nextEnemy++,x,y,hp,maxHp:hp,r,speed:spd,atk,hit:0,attack:.7+Math.random(),type,
      boss:type==='boss',bossIndex,bossDef,lastShot:0,shootRange:type==='archer'?280:type==='mage'?330:type==='witch'?390:type==='mimic'?130:type==='sentinel'?150:250,
      keepDistance:['archer','mage','witch'].includes(type),specialCd:type==='boss'?1.8+Math.random()*1.2:type==='witch'?9.5:99,
      contactDamage:0,inContact:false,shieldT:0,jumpT:0,chargeT:0,shock:false,poison:0,
      name:type==='boss'?bossDef.name:(TYPES[type]?.[4]||'Broken Heart'),rarity:type==='boss'?'Legendary':(TYPES[type]?.[5]||'Common')});
    this.spawned++;
  }
  xpNeed(level){return Math.floor(100*Math.pow(1.12,Math.max(0,level-1)))}
  awardXp(p,amount){
    if(!p||!amount)return;
    p.xp=Math.max(0,p.xp+Math.max(0,Number(amount)||0));
    let leveled=false;
    while(p.xp>=this.xpNeed(p.level)){
      p.xp-=this.xpNeed(p.level); p.level++; leveled=true;
      const scale=p.mult||1;
      p.maxHp+=Math.round(12*scale); p.atk+=Math.round(2.5*scale*10)/10; p.spd+=.05*scale; p.armor+=.35*scale;
      p.hp=p.maxHp;
    }
    p.progressRev++;
    return leveled;
  }
  progression(p){return {level:p.level||1,xp:p.xp||0,rebirths:p.rebirths||0,mult:p.mult||1,progressRev:p.progressRev||0}}
  killEnemy(e,owner){
    if(!e||!this.enemies.some(x=>x.id===e.id))return;
    const reward=e.boss?80+this.wave*8:3+Math.floor(this.wave*.9);
    const xp=(e.boss?180:25)+this.wave*6;
    this.enemies=this.enemies.filter(x=>x.id!==e.id);
    if(e.type==='splitter'&&!e.boss&&this.enemies.length<15){
      for(let i=0;i<2;i++)this.spawn('broken',e.x+(i?14:-14),e.y);
      this.spawned=Math.max(0,this.spawned-2);
    }
    const p=owner?this.players.get(owner):null;
    if(p){
      // Killer gets full reward
      this.awardXp(p,xp);
      this.send(owner,{type:'reward',reward,xp,progression:this.progression(p)});
      
      // Other alive players get 75% of the reward
      const sharedReward=Math.floor(reward*0.75);
      const sharedXp=Math.floor(xp*0.75);
      for(const [id,player] of this.players){
        if(id!==owner && !player.downed){
          this.awardXp(player,sharedXp);
          this.send(id,{type:'reward',reward:sharedReward,xp:sharedXp,progression:this.progression(player)});
        }
      }
    }
  }
  serverSkill(p,m){
    const now=Date.now();
    if(p.skillCd>0)return;
    const skill=String(m.skill||p.skill||'');
    const angle=Number.isFinite(Number(m.angle))?Number(m.angle):p.angle;
    p.angle=angle;
    const stats=p.atk;
    const defs={nova:{cd:8},dash:{cd:5},barrage:{cd:10},moon:{cd:7},storm:{cd:12},bloom:{cd:9},break:{cd:11},eclipse:{cd:14},divine:{cd:18},cataclysm:{cd:16}};
    if(!defs[skill])return;
    p.skillCd=defs[skill].cd;
    const hitIds=[];
    const damage=(e,mult)=>{
      if(!e||e.hp<=0)return;
      let d=stats*mult;if(Math.random()<p.crit)d*=2;if(e.shieldT>0)d*=.35;
      e.hp=Math.max(0,e.hp-d);e.hit=.12;hitIds.push({id:e.id,damage:d});
    };
    const hitRadius=(radius,mult)=>{for(const e of this.enemies)if(dist(e,p)<radius)damage(e,mult)};
    const cone=(range,width,mult)=>{
      for(const e of this.enemies){
        const dx=e.x-p.x,dy=e.y-p.y,d=Math.hypot(dx,dy);if(d>range)continue;
        let da=Math.atan2(dy,dx)-angle;da=Math.atan2(Math.sin(da),Math.cos(da));
        if(Math.abs(da)<width)damage(e,mult);
      }
    };

    if(skill==='nova'){
      hitRadius(190,3);
    }else if(skill==='dash'){
      p.x=clamp(p.x+Math.cos(angle)*180,30,WIDTH-30);p.y=clamp(p.y+Math.sin(angle)*180,62,HEIGHT-30);hitRadius(75,2);
    }else if(skill==='barrage'){
      for(let j=-2;j<=2;j++){const a=angle+j*.18;for(const e of this.enemies){
        const dx=e.x-p.x,dy=e.y-p.y,d=Math.hypot(dx,dy);let da=Math.atan2(dy,dx)-a;da=Math.atan2(Math.sin(da),Math.cos(da));
        if(d<165&&Math.abs(da)<.65)damage(e,2.2);
      }}
    }else if(skill==='moon'){
      this.projectiles.push({id:'s'+(++this.attackSeq),owner:p.id,x:p.x,y:p.y,vx:Math.cos(angle)*7,vy:Math.sin(angle)*7,angle,life:2.2,damage:stats*5,skill:'moon',radius:18});
    }else if(skill==='storm'){
      hitRadius(260,2.5);
      for(let i=0;i<10;i++){const a=Math.random()*Math.PI*2,d=70+Math.random()*220;
        this.projectiles.push({id:'s'+(++this.attackSeq),owner:p.id,x:p.x+Math.cos(a)*d,y:p.y+Math.sin(a)*d,vx:0,vy:0,angle:a,life:1,damage:stats*1.5,skill:'storm',rain:true,radius:20});
      }
    }else if(skill==='bloom'){
      // Lunar Bloom: forward crescent plus a small heal.
      cone(210,.9,2.8);p.hp=Math.min(p.maxHp,p.hp+p.maxHp*.18);
    }else if(skill==='break'){
      // Passion Break: narrow heavy strike with knockback.
      cone(220,.42,4.6);
      for(const e of this.enemies)if(e.hp>0&&dist(e,p)<220){const dx=e.x-p.x,dy=e.y-p.y,d=Math.hypot(dx,dy)||1;e.x=clamp(e.x+dx/d*35,0,WIDTH);e.y=clamp(e.y+dy/d*35,62,HEIGHT)}
    }else if(skill==='eclipse'){
      // Heart Eclipse: crossing waves, intentionally different from Barrage.
      for(const off of [0,Math.PI/2])for(let j=-1;j<=1;j++){const a=angle+off+j*.28;for(const e of this.enemies){
        const dx=e.x-p.x,dy=e.y-p.y,d=Math.hypot(dx,dy);let da=Math.atan2(dy,dx)-a;da=Math.atan2(Math.sin(da),Math.cos(da));
        if(d<235&&Math.abs(da)<.30)damage(e,2.0);
      }}
    }else if(skill==='divine'){
      p.hp=Math.min(p.maxHp,p.hp+p.maxHp*.35);hitRadius(155,2.4);
    }else if(skill==='cataclysm'){
      for(const e of this.enemies){const d=dist(e,p);if(d<330&&d>120)damage(e,3.2);else if(d<=120)damage(e,5.2)}
    }

    for(const h of hitIds){const e=this.enemies.find(q=>q.id===h.id);if(e&&e.hp<=0)this.killEnemy(e,p.id)}
    this.broadcast({type:'skillFx',skill,baseSkill:skill,from:p.id,x:p.x,y:p.y,angle,hitIds,heal:p.hp,serverNow:now});
    this.broadcastState(true);
  }
  serverAttack(p,m){
    const now=Date.now();if(now-p.lastAttack<450)return;p.lastAttack=now;
    const weapon=m.weapon==='bow'?'bow':'sword';p.weapon=weapon;
    const angle=Number.isFinite(Number(m.angle))?Number(m.angle):p.angle;p.angle=angle;
    if(weapon==='bow'){
      const projectile={
        id:'a'+(++this.attackSeq),owner:p.id,x:p.x+Math.cos(angle)*22,y:p.y+Math.sin(angle)*22,
        vx:Math.cos(angle)*8.5,vy:Math.sin(angle)*8.5,angle,life:1.8,damage:clamp(Number(m.stats?.atk)||p.atk,1,10000),
        crit:Math.random()<p.crit,hit:false,radius:8
      };
      this.projectiles.push(projectile);
      this.broadcast({type:'fx',kind:'projectile',projectile:{id:projectile.id,owner:p.id,x:projectile.x,y:projectile.y,vx:projectile.vx,vy:projectile.vy,angle,weapon:'bow'},serverNow:now});
      return;
    }
    let best=null,bestAlong=Infinity;
    const maxRange=135,hitWidth=48,ca=Math.cos(angle),sa=Math.sin(angle);
    for(const e of this.enemies){
      const rx=e.x-p.x,ry=e.y-p.y,along=rx*ca+ry*sa;
      if(along<0||along>maxRange)continue;
      const side=Math.abs(-rx*sa+ry*ca),radius=(e.r||20)+hitWidth;
      if(side>radius)continue;
      if(along<bestAlong){best=e;bestAlong=along}
    }
    let hitX=p.x+ca*maxRange,hitY=p.y+sa*maxRange;
    if(best){
      hitX=best.x;hitY=best.y;
      let dmg=clamp(Number(m.stats?.atk)||p.atk,1,10000);if(best.shieldT>0)dmg*=.35;if(Math.random()<p.crit)dmg*=2;
      best.hp-=dmg;best.hit=.12;
      if(best.hp<=0){this.killEnemy(best,p.id);}
    }
    this.broadcast({type:'fx',kind:'attack',attackId:++this.attackSeq,from:p.id,x:p.x,y:p.y,angle,weapon:'sword',hit:!!best,hitX,hitY,serverNow:now});
  }
  tick(now){
    const raw=Math.max(0,Math.min(250,now-this.lastTick));this.lastTick=now;
    if(this.phase==='countdown' && now>=this.countdownAt){this.phase='battle';this.broadcast({type:'phase',phase:'battle',wave:this.wave,serverNow:now});}
    if(this.phase!=='battle')return;
    const dt=raw/1000;
    for(const p of this.players.values()){p.skillCd=Math.max(0,(p.skillCd||0)-raw/1000);
      if(p.downed){p.ix=0;p.iy=0;continue}
      const l=Math.hypot(p.ix,p.iy)||1;p.x=clamp(p.x+p.ix/l*p.spd*60*dt,30,WIDTH-30);p.y=clamp(p.y+p.iy/l*p.spd*60*dt,62,HEIGHT-30);
    }
    // Authoritative co-op arrows: move on the server and damage only on actual collision.
    for(const a of this.projectiles){
      // Continuous/swept collision: test the whole arrow segment for this server tick.
      // This prevents tunnelling and makes damage happen exactly when the moving arrow
      // reaches the first enemy, rather than before it visually arrives.
      const prevX=a.x,prevY=a.y;
      const stepX=a.vx*60*dt,stepY=a.vy*60*dt;
      const nextX=prevX+stepX,nextY=prevY+stepY;
      a.x=nextX;a.y=nextY;a.life-=dt;
      let first=null,bestT=Infinity;
      const segLenSq=stepX*stepX+stepY*stepY||1;
      const hurtPlayer=(target,raw)=>{
      if(!target||target.downed)return;
      const dmg=Math.max(1,raw-target.armor*.7);target.hp=Math.max(0,target.hp-dmg);
      this.broadcast({type:'enemyAttack',enemyId:null,playerId:target.id,damage:dmg,x:target.x,y:target.y,serverNow:now});
      if(target.hp<=0){target.hp=0;target.downed=true;target.reviveProgress=0;target.ix=target.iy=0;this.broadcast({type:'downed',playerId:target.id,x:target.x,y:target.y});}
    };
    const fireEnemyShot=(e,target,count=1,speed=5.2,damageMult=.8,kind='arrow',spread=.22)=>{
      const a=Math.atan2(target.y-e.y,target.x-e.x);for(let j=0;j<count;j++){const aa=a+(count>1?(j-(count-1)/2)*spread:0);
        this.projectiles.push({id:'b'+(++this.attackSeq),owner:'enemy',source:e.id,x:e.x+Math.cos(aa)*18,y:e.y+Math.sin(aa)*18,
          vx:Math.cos(aa)*speed,vy:Math.sin(aa)*speed,angle:aa,life:kind==='fire'?3:2.6,damage:e.atk*damageMult,radius:kind==='magic'?10:8,crit:false,kind});}
      this.broadcast({type:'enemyShoot',enemyId:e.id,x:e.x,y:e.y,angle:a,count,speed,kind,serverNow:now});
    };
    const spawnWitchling=(e)=>{if(this.enemies.length>=15)return;this.spawn('witchling',e.x+38,e.y+18);this.spawned--;};

    for(const e of this.enemies){
      e.hit=Math.max(0,(e.hit||0)-dt);e.specialCd=Math.max(0,(e.specialCd||0)-dt);e.shieldT=Math.max(0,(e.shieldT||0)-dt);e.poison=Math.max(0,(e.poison||0)-dt);
      let target=null,bd=Infinity;for(const p of this.players.values()){if(p.downed)continue;const d=dist(e,p);if(d<bd){bd=d;target=p}}
      if(!target)continue;
      const dx=target.x-e.x,dy=target.y-e.y,d=Math.hypot(dx,dy)||1,contact=e.boss?72:46;

      // Bosses retain the Solo boss roster and special attacks.
      if(e.boss){
        if(e.specialCd<=0){
          e.specialCd=2.2+Math.random()*1.5;const a=Math.atan2(dy,dx),sk=e.bossDef?.skill;
          if(sk==='dash'){e.dashT=.55;e.dashA=a}
          else if(sk==='charge'){e.chargeT=.65;e.chargeA=a}
          else if(sk==='blink'){e.x=clamp(target.x-Math.cos(a)*150,60,WIDTH-60);e.y=clamp(target.y-Math.sin(a)*150,90,HEIGHT-60);this.broadcast({type:'bossFx',kind:'blink',enemyId:e.id,x:e.x,y:e.y})}
          else if(sk==='slam'){if(bd<210)hurtPlayer(target,e.atk*1.6);this.broadcast({type:'bossFx',kind:'slam',enemyId:e.id,x:e.x,y:e.y})}
          else if(sk==='shield'){e.shieldT=1.2;this.broadcast({type:'bossFx',kind:'shield',enemyId:e.id,x:e.x,y:e.y})}
          else if(sk==='summon'){for(let i=0;i<2;i++)this.spawn();this.spawned=Math.max(0,this.spawned-2);this.broadcast({type:'bossFx',kind:'summon',enemyId:e.id,x:e.x,y:e.y})}
          else if(sk==='volley'||sk==='scythe'||sk==='nova'){const count=sk==='volley'?7:5;fireEnemyShot(e,target,count,sk==='scythe'?5.8:4.7,.45,'arrow',.18);this.broadcast({type:'bossFx',kind:'volley',enemyId:e.id,x:e.x,y:e.y})}
          else if(sk==='poison'){fireEnemyShot(e,target,1,3.8,.65,'magic',0)}
        }
        if(e.dashT>0){e.dashT-=dt;e.x+=Math.cos(e.dashA)*7*60*dt;e.y+=Math.sin(e.dashA)*7*60*dt}
        else if(e.chargeT>0){e.chargeT-=dt;e.x+=Math.cos(e.chargeA)*8*60*dt;e.y+=Math.sin(e.chargeA)*8*60*dt}
      }

      // Exact Solo enemy behaviors.
      if(e.type==='archer'){
        if(d>280){e.x+=dx/d*e.speed*60*dt;e.y+=dy/d*e.speed*60*dt}else if(d<190){e.x-=dx/d*e.speed*60*dt;e.y-=dy/d*e.speed*60*dt}
        e.lastShot=(e.lastShot||0)+dt;if(e.lastShot>=1.25&&d<=280){e.lastShot=0;fireEnemyShot(e,target,1,5.2,.8,'arrow',0)}
      }else if(e.type==='mage'){
        if(d>330){e.x+=dx/d*e.speed*60*dt;e.y+=dy/d*e.speed*60*dt}else if(d<250){e.x-=dx/d*e.speed*60*dt;e.y-=dy/d*e.speed*60*dt}
        e.lastShot=(e.lastShot||0)+dt;if(e.lastShot>=2&&d<=330){e.lastShot=0;fireEnemyShot(e,target,3,3.8,.9,'magic',.22)}
      }else if(e.type==='witch'){
        if(d>390){e.x+=dx/d*e.speed*60*dt;e.y+=dy/d*e.speed*60*dt}else if(d<300){e.x-=dx/d*e.speed*60*dt;e.y-=dy/d*e.speed*60*dt}
        e.lastShot=(e.lastShot||0)+dt;if(e.lastShot>=2&&d<=390){e.lastShot=0;fireEnemyShot(e,target,1,4.4,1.15,'fire',0)}
        if(e.specialCd<=0){e.specialCd=9.5;spawnWitchling(e);this.broadcast({type:'bossFx',kind:'summon',enemyId:e.id,x:e.x,y:e.y})}
      }else if(e.type==='witchling'){
        if(d>90){e.x+=dx/d*e.speed*60*dt;e.y+=dy/d*e.speed*60*dt}else{e.attack=(e.attack||0)-dt;if(e.attack<=0){e.attack=1.8;hurtPlayer(target,e.atk)}}
      }else if(e.type==='brute'){
        if(e.jumpT>0){e.jumpT-=dt;e.x+=Math.cos(e.jumpA)*7.5*60*dt;e.y+=Math.sin(e.jumpA)*7.5*60*dt;if(e.jumpT<=0){if(dist(e,target)<90)hurtPlayer(target,e.atk*1.8);this.broadcast({type:'bossFx',kind:'slam',enemyId:e.id,x:e.x,y:e.y})}}
        else if(d>contact){e.x+=dx/d*e.speed*60*dt;e.y+=dy/d*e.speed*60*dt}else{e.attack-=dt;if(e.attack<=0){e.attack=2.1;e.jumpT=.65;e.jumpA=Math.atan2(dy,dx)}}
      }else if(e.type==='guard'){
        if(d>170){e.x+=dx/d*e.speed*60*dt;e.y+=dy/d*e.speed*60*dt}else{e.attack-=dt;if(e.attack<=0){e.attack=1.25;hurtPlayer(target,e.atk)}}
      }else if(e.type==='mimic'){
        if(d>130){e.x+=dx/d*e.speed*60*dt;e.y+=dy/d*e.speed*60*dt}else{e.lastShot=(e.lastShot||0)+dt;if(e.lastShot>=1.55){e.lastShot=0;fireEnemyShot(e,target,1,4.5,.9,'arrow',0)}}
      }else if(e.type==='sentinel'){
        if(d>150){e.x+=dx/d*e.speed*60*dt;e.y+=dy/d*e.speed*60*dt}else{e.lastShot=(e.lastShot||0)+dt;if(e.lastShot>=1.7){e.lastShot=0;fireEnemyShot(e,target,1,4.1,.75,'arrow',0)}}
      }else if(e.type==='lovebreaker'){
        e.attack-=dt;e.specialCd-=dt;
        if(e.specialCd<=0){e.specialCd=4.8;e.chargeT=.55;e.chargeA=Math.atan2(dy,dx)}
        if(e.chargeT>0){e.chargeT-=dt;e.x+=Math.cos(e.chargeA)*8.5*60*dt;e.y+=Math.sin(e.chargeA)*8.5*60*dt;if(e.chargeT<=0){if(dist(e,target)<105)hurtPlayer(target,e.atk*2.2);fireEnemyShot(e,target,3,4.8,.55,'arrow',.35)}}
        else if(d>contact+8){e.x+=dx/d*e.speed*60*dt;e.y+=dy/d*e.speed*60*dt}else if(e.attack<=0){e.attack=1;hurtPlayer(target,e.atk*1.25)}
      }else if(!e.boss){
        if(d>contact){e.x+=dx/d*e.speed*60*dt;e.y+=dy/d*e.speed*60*dt}
      }else if(!e.dashT&&!e.chargeT&&d>contact){e.x+=dx/d*e.speed*60*dt;e.y+=dy/d*e.speed*60*dt}

      // Melee contact: hit on first actual touch, then repeat like Solo's attack timers.
      if(!['archer','mage','witch','witchling','brute','guard','mimic','sentinel','lovebreaker'].includes(e.type) && (!e.boss || (!e.dashT&&!e.chargeT))){
        const touching=dist(e,target)<contact;
        if(touching){e.inContact=true;e.contactDamage=(e.contactDamage||0)-dt;if(e.contactDamage<=0){e.contactDamage=e.type==='charger'?.48:e.type==='assassin'?.42:e.type==='berserker'?.36:e.type==='lancer'?.62:.78;hurtPlayer(target,e.atk)}}else{e.inContact=false;e.contactDamage=0}
      }
      e.x=clamp(e.x,-60,WIDTH+60);e.y=clamp(e.y,-60,HEIGHT+60);
    }
    const targetCount=this.wave%5===0?1:this.wave*3+4;
    if(this.spawned<targetCount&&this.enemies.length<Math.min(6+this.wave,15))this.spawn();
    if(this.spawned>=targetCount&&this.enemies.length===0){this.phase='upgrade';this.offer={id:String(Date.now())+Math.random(),choices:[...UPGRADE_CHOICES].sort(()=>Math.random()-.5).slice(0,3)};this.picks.clear();this.broadcast({type:'upgradeOffer',offerId:this.offer.id,choices:this.offer.choices,serverNow:now});return;}
    if(now-this.lastState>=STATE_MS)this.broadcastState(false)
  }
  snapshotFor(id){const p=this.players.get(id);return this.makeState(p)}
  makeState(p){return {phase:this.phase,wave:this.wave,stateSeq:this.stateSeq,serverNow:Date.now(),player:p?{x:p.x,y:p.y,hp:p.hp,maxHp:p.maxHp,angle:p.angle,atk:p.atk,spd:p.spd,armor:p.armor,crit:p.crit,weapon:p.weapon||'sword',skill:p.skill||'',skillCd:p.skillCd||0,downed:!!p.downed,reviveProgress:p.reviveProgress||0,progression:this.progression(p)}:null,players:[...this.players.values()].map(q=>({id:q.id,name:q.name,x:q.x,y:q.y,hp:q.hp,maxHp:q.maxHp,angle:q.angle,weapon:q.weapon||'sword',skill:q.skill||'',skillCd:q.skillCd||0,downed:!!q.downed,reviveProgress:q.reviveProgress||0,level:q.level||1,xp:q.xp||0,rebirths:q.rebirths||0,mult:q.mult||1,progressRev:q.progressRev||0})),enemies:this.enemies,projectiles:this.projectiles.map(a=>({id:a.id,owner:a.owner,source:a.source,x:a.x,y:a.y,vx:a.vx,vy:a.vy,angle:a.angle,life:a.life,kind:a.kind||null,skill:a.skill||null,radius:a.radius||8}))}}
  broadcastState(force=false){
    const now=Date.now();
    if(!force && now-this.lastState<STATE_MS)return;
    this.lastState=now;
    this.stateSeq++;
    for(const id of this.sockets.keys())this.send(id,{type:'state',...this.makeState(this.players.get(id))});
  }
  broadcastPlayers(){this.broadcast({type:'players',players:[...this.players.values()].map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,hp:p.hp,maxHp:p.maxHp,angle:p.angle,weapon:p.weapon||'sword',skill:p.skill||'',skillCd:p.skillCd||0,downed:!!p.downed,reviveProgress:p.reviveProgress||0}))})}
  send(id,msg){const ws=this.sockets.get(id);if(ws)try{ws.send(JSON.stringify(msg))}catch{}}
  broadcast(msg){const d=JSON.stringify(msg);for(const[id,ws]of this.sockets){try{ws.send(d)}catch{this.sockets.delete(id);this.players.delete(id)}}}
}
