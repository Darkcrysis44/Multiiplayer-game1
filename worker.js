const rooms = new Map();

function uid() { return crypto.randomUUID().replaceAll('-', '').slice(0, 8); }
function getRoom(code) {
  let room = rooms.get(code);
  if (!room) { room = { players: new Map(), host: null, lastSnapshot: null }; rooms.set(code, room); }
  return room;
}
function send(ws, msg) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
function broadcast(room, msg, except = null) {
  for (const p of room.players.values()) if (p.ws !== except) send(p.ws, msg);
}
function playerList(room) {
  return [...room.players.values()].map(p => ({
    id:p.id, name:p.player?.name||'Hunter', level:p.player?.level||1,
    rebirths:p.player?.rebirths||0, hp:p.player?.hp??100, maxHp:p.player?.maxHp??100,
    down:!!p.player?.down, x:p.player?.x||0, y:p.player?.y||0,
    weapon:p.player?.weapon||'sword', arrowType:p.player?.arrowType||'Basic Arrow'
  }));
}

function handleSocket(request) {
  const upgrade = request.headers.get('Upgrade');
  if (!upgrade || upgrade.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', {status:426});
  const pair = new WebSocketPair();
  const client = pair[0], server = pair[1];
  server.accept();
  const state = { ws:server, id:uid(), room:null, player:{} };

  server.addEventListener('message', ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'join') {
      const code = String(m.room||'LOVE').toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,12) || 'LOVE';
      const room = getRoom(code);
      state.room = code; state.player = m.player || {};
      room.players.set(state.id, state);
      if (!room.host) room.host = state.id;
      send(server,{type:'welcome',id:state.id,host:room.host===state.id,room:code});
      broadcast(room,{type:'players',players:playerList(room)});
      if (room.lastSnapshot) send(server,room.lastSnapshot);
      return;
    }
    if (!state.room) return;
    const room = rooms.get(state.room); if (!room) return;

    if (m.type === 'input') {
      state.player = {...state.player,...(m.player||{})};
      if (state.id !== room.host) broadcast(room,{type:'input',id:state.id,keys:m.keys||{},player:state.player},server);
      return;
    }
    if (m.type === 'attack') {
      if (state.id !== room.host) broadcast(room,{type:'attack',id:state.id,angle:m.angle,weapon:m.weapon},server);
      return;
    }
    if (m.type === 'down') {
      state.player = {...state.player,...(m.player||{}),down:true};
      broadcast(room,{type:'players',players:playerList(room)}); return;
    }
    if (m.type === 'reward') {
      // Killer receives 100%; every other player receives 75% of the same reward.
      const killer = String(m.target || '');
      const gold = Math.max(0, Number(m.gold||0));
      const xp = Math.max(0, Number(m.xp||0));
      for (const p of room.players.values()) {
        const factor = p.id === killer ? 1 : 0.75;
        send(p.ws,{type:'reward',target:p.id,killer, gold:Math.floor(gold*factor), xp:Math.floor(xp*factor), factor});
      }
      return;
    }
    if (m.type === 'revive') {
      const target=room.players.get(String(m.target)); if(!target)return;
      target.player.down=false; target.player.hp=Math.max(1,Math.round((target.player.maxHp||100)*.45));
      broadcast(room,{type:'revive',target:target.id,by:state.id});
      broadcast(room,{type:'players',players:playerList(room)}); return;
    }
    if (m.type === 'snapshot' && state.id === room.host) {
      room.lastSnapshot=m;
      state.player={...state.player,...(m.players?.[state.id]||{})};
      broadcast(room,m,server);
      for(const [pid,p] of Object.entries(m.players||{})){const q=room.players.get(pid);if(q)q.player={...q.player,...p}}
      broadcast(room,{type:'players',players:playerList(room)}); return;
    }
  });

  server.addEventListener('close', () => {
    if (!state.room) return;
    const room=rooms.get(state.room); if(!room)return;
    room.players.delete(state.id);
    if(room.host===state.id){
      const next=room.players.keys().next().value||null; room.host=next;
      if(next) send(room.players.get(next).ws,{type:'host_changed',host:next});
    }
    broadcast(room,{type:'players',players:playerList(room)});
    if(room.players.size===0) rooms.delete(state.room);
  });
  return new Response(null,{status:101,webSocket:client});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') return handleSocket(request);
    return env.ASSETS.fetch(request);
  }
};
