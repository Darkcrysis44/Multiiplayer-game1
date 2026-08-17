# Love Sword Arena — Multiplayer Lag Compensation v27

This build keeps the Solo-feel local sword animation and adds server-side lag compensation for multiplayer attacks. Sword hit validation uses a short server history (up to 650ms) and includes enemy body radius, so ~300–400ms RTT is much less likely to make a visually connected sword hit miss.

Bow origin remains aligned to the bow/string and is also timestamped for the same authoritative timing model.
