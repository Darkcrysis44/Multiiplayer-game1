# Love Sword Arena — Co-op Multiplayer Edition

Bu sürüm mevcut solo arena sistemini korur ve üstüne oda tabanlı co-op multiplayer ekler.

## Özellikler
- Aynı `index.html` içindeki mevcut solo level/XP/rebirth/gear/shop sistemi korunur.
- Oda kodu ile 2+ oyuncu aynı maça bağlanabilir.
- İlk giren oyuncu host olur; düşerse/disconnect olursa sıradaki oyuncuya host rolü aktarılır.
- Host düşmanların, wave'in ve projectile dünyasının otoritesidir; diğer oyuncular kendi inputlarını host'a yollar.
- Oyuncular aynı arena içinde görünür.
- Solo level, XP, rebirth, silah, armor, accessory ve passive ilerlemesi oyuncunun kendi tarayıcısında korunur.
- Oyuncu ölünce klasik solo reset yerine **DOWNED** durumuna geçer.
- Yakındaki yaşayan takım arkadaşı `E` ile veya paneldeki revive düğmesiyle oyuncuyu yaklaşık %45 HP ile diriltebilir.
- Wave/world snapshot host tarafından yaklaşık 11 FPS civarında paylaşılır.
- Host ayrılırsa server yeni host seçer ve mevcut world snapshot'ını yeni host'a gönderir.

## Çalıştırma
Node.js 18+ kurulu olmalı.

```bash
npm install
npm start
```

Sonra tarayıcıda:
`http://localhost:8787/`

İki farklı cihaz aynı LAN'daysa server bilgisayarının LAN IP'si üzerinden:
`http://SUNUCU-IP:8787/`

İnternet üzerinden oynatmak için bu Node sunucusunu HTTPS/WSS destekleyen bir hosting'e koymak gerekir. `PORT` environment variable ile port değiştirilebilir.

## Oyun akışı
1. Love Sword Arena'yı aç.
2. Multiplayer kartından `CREATE ROOM` veya aynı oda kodunu girip `JOIN` seç.
3. Diğer oyuncular aynı kodla bağlansın.
4. İlk oyuncu host olur ve düşman dünyasını simüle eder.
5. Wave temizlenince host'un wave-upgrade ekranı açılır; oyuncuların kalıcı level/gear ilerlemeleri korunur.
6. Bir oyuncu 0 HP olduğunda downed olur. Yakındaki takım arkadaşı E'ye basarak revive gönderir.
7. Host ayrılırsa oda içindeki sonraki oyuncu host olur.

## Not
Bu sürüm dışarıdan bir matchmaking servisi gerektirmez; `server.js` küçük bir WebSocket oda sunucusudur. Production için HTTPS reverse proxy, rate limiting, authentication ve server-side anti-cheat eklenmesi önerilir.
