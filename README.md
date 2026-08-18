# Love Sword Arena — Cloudflare Multiplayer v14

Bu paket Cloudflare Workers/Assets için hazırlanmıştır. Önceki sürümdeki `server.js + ws` Node sunucusu Cloudflare Pages/Workers deploy'una uygun olmadığı için kaldırıldı. Artık WebSocket endpoint'i `/ws` üzerinden Worker tarafından yönetiliyor.

## Cloudflare deploy

Bu klasörü GitHub'a yükleyip Cloudflare Workers'ta `wrangler deploy` ile deploy edebilirsin.

Yerel:

```bash
npm install
npm run dev
```

Deploy:

```bash
npm run deploy
```

Cloudflare Dashboard'dan Git entegrasyonu kullanıyorsan build command olarak `npm run deploy` ve framework preset olarak Workers/None kullan. `wrangler.jsonc` dosyası root'ta kalmalı.

## Multiplayer reward sistemi

Bir oyuncu düşmanı öldürdüğünde:
- öldüren oyuncu: **%100 XP + %100 para**
- diğer tüm oyuncular: **%75 XP + %75 para**

Örneğin 100 XP / 40 para veren düşman:
- Killer → 100 XP + 40 para
- diğer oyuncu → 75 XP + 30 para

Bu ödül server tarafından dağıtıldığı için her oyuncu kendi client'ından sahte reward üretmeye çalışmamalı; production'da ayrıca server-side combat validation önerilir.

## Önemli

Cloudflare Worker'daki oda state'i şu an Worker isolate belleğindedir. Küçük/tek-isolate testleri için yeterlidir. Gerçek production multiplayer için Cloudflare Durable Objects ile oda başına kalıcı WebSocket state'e geçirmek önerilir.
