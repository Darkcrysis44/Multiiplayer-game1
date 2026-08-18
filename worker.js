export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }

      const roomId = url.searchParams.get("room") || "main";
      const id = env.GAME_ROOM.idFromName(roomId);
      const stub = env.GAME_ROOM.get(id);
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = new Map();
    this.players = new Map();
    this.projectiles = new Map();
    this.lastTick = Date.now();
    this.nextProjectileId = 1;
    this.ready = this.load();
    state.blockConcurrencyWhile(async () => { await this.ready; });
  }

  async load() {
    const saved = await this.state.storage.get("game");
    if (!saved) return;
    this.players = new Map(saved.players || []);
    this.projectiles = new Map(saved.projectiles || []);
    this.nextProjectileId = saved.nextProjectileId || 1;
  }

  async save() {
    await this.state.storage.put("game", {
      players: [...this.players],
      projectiles: [...this.projectiles],
      nextProjectileId: this.nextProjectileId
    });
  }

  fetch(request) {
    return this.ready.then(() => {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      const url = new URL(request.url);
      const room = url.searchParams.get("room") || "main";
      const playerId = crypto.randomUUID();

      server.accept();
      this.clients.set(playerId, server);

      this.players.set(playerId, {
        id: playerId,
        x: 200 + Math.random() * 300,
        y: 200 + Math.random() * 200,
        angle: 0,
        hp: 100,
        maxHp: 100,
        radius: 18,
        speed: 3.2,
        damage: 20,
        swordCooldown: 270,
        bowCooldown: 420,
        lastSword: 0,
        lastBow: 0,
        input: { up:false, down:false, left:false, right:false },
        lastSeq: 0,
        connected: true
      });

      server.addEventListener("message", e => this.onMessage(playerId, e.data));
      server.addEventListener("close", () => this.disconnect(playerId));
      server.addEventListener("error", () => this.disconnect(playerId));

      server.send(JSON.stringify({
        type: "welcome",
        playerId,
        state: this.snapshot()
      }));
      this.broadcast({ type:"playerJoined", player:this.players.get(playerId) }, playerId);
      this.startTick();

      return new Response(null, { status:101, webSocket:client });
    });
  }

  startTick() {
    if (this.tickRunning) return;
    this.tickRunning = true;
    const tick = async () => {
      const now = Date.now();
      const dt = Math.min(50, Math.max(0, now - this.lastTick));
      this.lastTick = now;
      this.simulate(dt);
      if (this.clients.size) {
        this.broadcast({ type:"stateSnapshot", state:this.snapshot() });
        await this.save();
        setTimeout(tick, 50);
      } else {
        this.tickRunning = false;
        await this.save();
      }
    };
    setTimeout(tick, 0);
  }

  onMessage(id, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const p = this.players.get(id);
    if (!p) return;

    if (msg.type === "input") {
      const seq = Number(msg.seq) || 0;
      if (seq <= p.lastSeq) return;
      p.lastSeq = seq;
      p.input = {
        up: !!msg.up, down: !!msg.down,
        left: !!msg.left, right: !!msg.right
      };
      if (Number.isFinite(msg.angle)) p.angle = msg.angle;
      return;
    }

    if (msg.type === "playerAttack") {
      if (msg.weapon === "sword") this.swordAttack(p);
      if (msg.weapon === "bow") this.bowAttack(p);
    }
  }

  simulate(dt) {
    const seconds = dt / 1000;
    for (const p of this.players.values()) {
      if (p.hp <= 0) continue;
      let dx = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
      let dy = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
      const len = Math.hypot(dx,dy) || 1;
      p.x += (dx/len) * p.speed * 60 * seconds;
      p.y += (dy/len) * p.speed * 60 * seconds;
      p.x = Math.max(p.radius, Math.min(10000-p.radius, p.x));
      p.y = Math.max(p.radius, Math.min(10000-p.radius, p.y));
    }

    for (const [id, a] of this.projectiles) {
      a.x += a.vx * 60 * seconds;
      a.y += a.vy * 60 * seconds;
      a.life -= dt;
      let hit = false;

      if (a.life <= 0) hit = true;

      if (!hit) {
        for (const p of this.players.values()) {
          if (p.id === a.ownerId || p.hp <= 0) continue;
          if (Math.hypot(p.x-a.x,p.y-a.y) <= p.radius+a.radius) {
            p.hp = Math.max(0, p.hp-a.damage);
            this.broadcast({type:"playerHpChanged", playerId:p.id, hp:p.hp});
            this.broadcast({type:"projectileHit", projectileId:id, targetId:p.id});
            hit = true;
            break;
          }
        }
      }
      if (hit) this.projectiles.delete(id);
    }
  }

  swordAttack(attacker) {
    const now = Date.now();
    if (now-attacker.lastSword < attacker.swordCooldown || attacker.hp<=0) return;
    attacker.lastSword = now;

    const range = 125;
    const halfAngle = 0.95/2;
    let target = null, best = Infinity;

    for (const p of this.players.values()) {
      if (p.id===attacker.id || p.hp<=0) continue;
      const dx=p.x-attacker.x, dy=p.y-attacker.y;
      const d=Math.hypot(dx,dy);
      if (d > range+p.radius) continue;
      const a=Math.atan2(dy,dx);
      const diff=Math.atan2(Math.sin(a-attacker.angle),Math.cos(a-attacker.angle));
      if (Math.abs(diff)>halfAngle) continue;
      if (d<best) { best=d; target=p; }
    }

    if (target) {
      target.hp=Math.max(0,target.hp-attacker.damage);
      this.broadcast({
        type:"playerHpChanged",
        playerId:target.id,
        hp:target.hp,
        attackerId:attacker.id,
        weapon:"sword"
      });
    }

    this.broadcast({
      type:"playerAttackConfirmed",
      playerId:attacker.id,
      weapon:"sword",
      attackTime:now
    });
  }

  bowAttack(attacker) {
    const now=Date.now();
    if (now-attacker.lastBow<attacker.bowCooldown || attacker.hp<=0) return;
    attacker.lastBow=now;

    const speed=7.2;
    const x=attacker.x+Math.cos(attacker.angle)*24;
    const y=attacker.y+Math.sin(attacker.angle)*24;
    const id=String(this.nextProjectileId++);

    this.projectiles.set(id,{
      id, ownerId:attacker.id, x,y,
      vx:Math.cos(attacker.angle)*speed,
      vy:Math.sin(attacker.angle)*speed,
      radius:5, damage:20, life:2400
    });

    this.broadcast({type:"arrowSpawned", projectile:this.projectiles.get(id)});
  }

  disconnect(id) {
    this.clients.delete(id);
    const p=this.players.get(id);
    if (p) {
      this.players.delete(id);
      this.broadcast({type:"playerLeft", playerId:id});
    }
    if (!this.clients.size) this.save();
  }

  snapshot() {
    return {
      players:[...this.players.values()].map(p => ({
        id:p.id,x:p.x,y:p.y,angle:p.angle,hp:p.hp,maxHp:p.maxHp
      })),
      projectiles:[...this.projectiles.values()]
    };
  }

  broadcast(obj, exceptId=null) {
    const text=JSON.stringify(obj);
    for (const [id,ws] of this.clients) {
      if (id===exceptId) continue;
      try { ws.send(text); } catch {}
    }
  }
}

export { GameRoom as GAME_ROOM };
