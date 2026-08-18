# Love Sword Arena - Multiplayer

Cloudflare Worker + Durable Object multiplayer build based on the original Love Sword Arena project.

## Deploy

From this folder:

```bash
npx wrangler deploy
```

The Worker entrypoint is `worker.js`, static assets are in `public/`, and the Durable Object binding is `ROOM`.
