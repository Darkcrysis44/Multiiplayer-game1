# Love Sword Arena — Complete Server-Authoritative Multiplayer

## Structure

- `public/index.html` — game client
- `public/music.mp3` — music asset
- `worker.js` — Cloudflare Worker + Durable Object game server
- `wrangler.toml` — Worker, Assets and Durable Object configuration

## Server authority

The Durable Object owns:

- player positions and movement
- HP
- sword cooldown / hit validation
- bow cooldown
- projectile simulation and collision
- damage
- room state snapshots

The client sends input and attack requests; it does not authoritatively change HP.

## Deploy

Deploy as a Cloudflare Worker using Wrangler. Do not deploy this package as Pages-only if you want the multiplayer server.

The client connects to `/ws?room=<room>`.
