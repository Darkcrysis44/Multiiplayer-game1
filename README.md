# Love Sword Arena - Multiplayer Skills Synced

This build keeps the full previous game and adds server-authoritative multiplayer skill synchronization.

- R skill use is sent to the Cloudflare Durable Object.
- Server validates skill/cooldown and applies damage.
- Nova, Rose Barrage, Moon Slash, Heartstorm and Love Dash are synchronized.
- Moon Slash projectile is authoritative and damages on collision.
- Skill effects are broadcast to all players.
- Existing revive, restart, upgrade, sword and bow systems are preserved.

- Solo and Co-op now use one persistent progression profile: level, XP, rebirth multiplier, and persistent level/gear stats are synchronized exactly.
- Co-op no longer re-applies level stat gains when receiving the same progression snapshot, preventing stat stacking after reconnects or repeated snapshots.
- The server treats the progression revision as monotonic and applies the exact persistent stats sent by the profile.
