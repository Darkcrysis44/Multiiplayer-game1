# Love Sword Arena — Strong Server-Authoritative Multiplayer

## What is authoritative

The Cloudflare Durable Object is the game server for each room. The browser is **not** allowed to authoritatively set:

- player X/Y position
- HP
- sword hit results
- bow hit results
- projectile movement
- damage
- cooldown validation

The client only sends:
- movement input + aim angle
- weapon selection
- an attack sequence number

The server assigns the player ID from the WebSocket connection and ignores any client-supplied target/player identity.

## Multiplayer flow

```text
Client input
  -> Cloudflare Worker
  -> Durable Object room
  -> server simulation / collision
  -> authoritative state
  -> WebSocket broadcast
  -> every client renders the same state
```

Sword:
- 270 ms server cooldown
- 125 px range
- 0.95 rad total angle
- target body radius included
- damage decided by server

Bow:
- 420 ms server cooldown
- 7.2 speed
- 2.4 s lifetime
- projectile is spawned and simulated by server
- swept segment/circle collision prevents fast arrows tunnelling through players

Movement:
- server owns velocity/position
- client sends only WASD/arrow input
- client may predict locally for responsiveness
- periodic server snapshots reconcile the prediction

## Deploy

Deploy this folder as a **Cloudflare Worker**, not as Pages-only static hosting.

`public/` contains the static game:
- `public/index.html`
- `public/music.mp3`

The Worker serves those assets and `/ws` is the multiplayer WebSocket endpoint.

Requires a Durable Object binding named `ROOM` with class `Room`, configured by `wrangler.toml`.
