export class Room {
  constructor(state) {
    this.state = state;
    this.clients = new Map();
    this.players = new Map();
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket only", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const id = crypto.randomUUID();
    const player = {
      id, x: 400, y: 300, hp: 100, maxHp: 100,
      angle: 0, weapon: "sword", lastAttack: 0
    };

    this.clients.set(id, server);
    this.players.set(id, player);

    this.send(id, {
      type: "welcome",
      id,
      players: Object.fromEntries(this.players)
    });
    this.broadcast({ type: "playerJoined", player }, id);

    server.addEventListener("message", event => {
      try {
        const msg = JSON.parse(event.data);
        this.onMessage(id, msg);
      } catch (_) {}
    });

    server.addEventListener("close", () => {
      this.clients.delete(id);
      this.players.delete(id);
      this.broadcast({ type: "playerLeft", id });
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  send(id, msg) {
    const ws = this.clients.get(id);
    if (!ws) return;
    try { ws.send(JSON.stringify(msg)); } catch (_) {}
  }

  broadcast(msg, exceptId = null) {
    const data = JSON.stringify(msg);
    for (const [id, ws] of this.clients) {
      if (id === exceptId) continue;
      try { ws.send(data); } catch (_) {}
    }
  }

  onMessage(id, msg) {
    const p = this.players.get(id);
    if (!p || !msg || typeof msg.type !== "string") return;

    if (msg.type === "playerState") {
      if (Number.isFinite(Number(msg.x))) p.x = Math.max(30, Math.min(770, Number(msg.x)));
      if (Number.isFinite(Number(msg.y))) p.y = Math.max(60, Math.min(570, Number(msg.y)));
      if (Number.isFinite(Number(msg.angle))) p.angle = Number(msg.angle);
      p.weapon = msg.weapon === "bow" ? "bow" : "sword";
      this.broadcast({ type: "state", players: Object.fromEntries(this.players) });
      return;
    }

    if (msg.type === "playerAttack") this.attack(p, msg);
  }

  attack(p, msg) {
    const now = Date.now();
    const weapon = msg.weapon === "bow" ? "bow" : "sword";
    const cooldown = weapon === "bow" ? 420 : 270;

    if (p.hp <= 0 || now - p.lastAttack < cooldown) return;

    p.lastAttack = now;
    if (Number.isFinite(Number(msg.angle))) p.angle = Number(msg.angle);
    p.weapon = weapon;

    this.broadcast({
      type: "attackConfirmed",
      playerId: p.id,
      attackId: msg.attackId || crypto.randomUUID(),
      weapon
    });

    if (weapon === "bow") {
      const a = p.angle;
      const projectile = {
        id: crypto.randomUUID(),
        x: p.x + Math.cos(a) * 38,
        y: p.y + Math.sin(a) * 38,
        vx: Math.cos(a) * 7.2,
        vy: Math.sin(a) * 7.2,
        life: 2.4,
        ownerId: p.id
      };
      this.broadcast({ type: "projectileSpawned", projectile });
      this.state.storage.put("projectile:" + projectile.id, projectile);
      this.schedule();
      return;
    }

    const target = this.findSwordTarget(p);
    if (!target) return;

    target.hp = Math.max(0, target.hp - 14);
    this.broadcast({
      type: "hpChanged",
      playerId: target.id,
      hp: target.hp,
      maxHp: target.maxHp
    });
  }

  findSwordTarget(attacker) {
    let best = null;
    let bestDistance = Infinity;

    for (const target of this.players.values()) {
      if (target.id === attacker.id || target.hp <= 0) continue;

      const dx = target.x - attacker.x;
      const dy = target.y - attacker.y;
      const distance = Math.hypot(dx, dy);

      if (distance > 143) continue;

      const targetAngle = Math.atan2(dy, dx);
      const diff = Math.atan2(
        Math.sin(targetAngle - attacker.angle),
        Math.cos(targetAngle - attacker.angle)
      );

      if (Math.abs(diff) > 0.475) continue;

      if (distance < bestDistance) {
        best = target;
        bestDistance = distance;
      }
    }
    return best;
  }

  async alarm() {
    await this.stepProjectiles();
  }

  async stepProjectiles() {
    const list = await this.state.storage.list({ prefix: "projectile:" });

    for (const [key, projectile] of list) {
      projectile.x += projectile.vx * 3;
      projectile.y += projectile.vy * 3;
      projectile.life -= 0.05;

      let hit = null;
      for (const player of this.players.values()) {
        if (player.id === projectile.ownerId || player.hp <= 0) continue;
        if (Math.hypot(player.x - projectile.x, player.y - projectile.y) <= 24) {
          hit = player;
          break;
        }
      }

      if (hit) {
        hit.hp = Math.max(0, hit.hp - 16);
        this.broadcast({
          type: "hpChanged",
          playerId: hit.id,
          hp: hit.hp,
          maxHp: hit.maxHp
        });
        this.broadcast({ type: "projectileRemoved", id: projectile.id });
        await this.state.storage.delete(key);
      } else if (projectile.life <= 0) {
        this.broadcast({ type: "projectileRemoved", id: projectile.id });
        await this.state.storage.delete(key);
      } else {
        await this.state.storage.put(key, projectile);
      }
    }

    const remaining = await this.state.storage.list({
      prefix: "projectile:",
      limit: 1
    });

    if (remaining.size > 0) this.schedule();
  }

  schedule() {
    return this.state.storage.setAlarm(Date.now() + 50);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }

      const roomName = (url.searchParams.get("room") || "love-sword-arena").slice(0, 64);
      const id = env.ROOM.idFromName(roomName);
      return env.ROOM.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};
