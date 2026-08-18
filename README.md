# Love Sword Arena Multiplayer v15 — Cloudflare Workers

Bu sürüm Cloudflare Workers Static Assets yapısına göre düzenlenmiştir.

## Klasör yapısı

- `public/index.html` — oyun
- `public/music.mp3` — orijinal solo müzik asset'i
- `worker.js` — `/ws` WebSocket multiplayer sunucusu
- `wrangler.jsonc` — Static Assets yapılandırması

## Deploy

Node.js 18+ ile:

```bash
npm install
npm run deploy
```

Cloudflare hesabına giriş gerekirse:

```bash
npx wrangler login
```

## Neden `public`?

Önceki sürümde assets directory proje köküydü. Bu, `worker.js`, config ve diğer proje dosyalarının da asset taramasına girmesine neden olabiliyordu. v15'te yalnızca `public/` statik asset olarak yüklenir.

Cloudflare'ın güncel Workers Static Assets sınırında tek bir statik dosya 25 MiB'a kadar olabilir. Orijinal `music.mp3` yaklaşık 8.6 MiB olduğu için tek başına bu sınıra takılmamalıdır.

## Multiplayer ödülleri

Bir oyuncu düşman öldürdüğünde:
- Öldüren oyuncu: %100 XP + %100 para
- Diğer oyuncular: %75 XP + %75 para

## Not

Cloudflare Dashboard'daki eski Pages sürükle-bırak yöntemi yerine bu proje için `npm run deploy` ile Workers deploy edilmesi önerilir.
