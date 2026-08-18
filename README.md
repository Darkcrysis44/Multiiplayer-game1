# Love Sword Arena - Cloudflare Worker

Structure:
- `public/index.html`
- `public/music.mp3`
- `worker.js`
- `wrangler.toml`

Deploy with Wrangler from this folder. The Worker serves the files from `public/` and `/ws` is handled by the Durable Object.
