# Love Sword Arena — Co-op Contribution Rewards

Multiplayer reward behavior:
- The player who gets the killing blow receives 100% of the enemy's base currency and XP reward.
- Every other connected player receives 75% of the same base currency and XP reward.
- The killer's reward is never reduced because teammates are present.
- Each player's XP and level progression is processed server-side and sent back as a progression snapshot.
- Fortune passive, when owned by the receiving player, applies its normal +15% reward bonus after the 100%/75% co-op share.


## Multiplayer smoothness update
- Local co-op movement is now client-predicted at 60 FPS, matching Solo movement responsiveness.
- Server reconciliation is gradual to reduce rubber-banding while keeping the server authoritative.
- Remote players, enemies and projectiles are interpolated for smoother rendering.
- The Durable Object simulation runs at 30 Hz instead of 20 Hz for tighter multiplayer response.
- Combat, rewards, progression and enemy collisions remain server-authoritative.


## Multiplayer combat alignment fix
- Player arrows now originate from the visible front/tip area of the bow instead of the character center.
- Enemy melee targeting now closes to a tighter player hitbox before applying contact damage.
- Enemy attacks broadcast a dedicated attack FX event so multiplayer enemies visibly swing/hit like Solo.
- Enemy hit animation and impact effects are rendered client-side while damage remains server-authoritative.
