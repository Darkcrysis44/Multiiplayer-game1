# Love Sword Arena v26 — Solo Combat Reference

Multiplayer weapon combat now uses the Solo arena combat implementation as its single reference:
- Sword: 270ms cooldown, 125px reach, 0.95 rad facing cone, Solo slash animation.
- Bow: 420ms cooldown, 7.2 projectile speed, 2.4s life, arrow origin at the Solo bow/string center (24px forward).
- Multiplayer damage remains server authoritative.
- Local and remote sword slash visuals use the same Solo arc timing.
- Local and remote bow visuals use the same Solo bow/string geometry.
