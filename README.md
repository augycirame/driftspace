# Driftspace (working title)

An infinitely generated, multiplayer space-exploration sandbox. This folder is the first
playable prototype: a shared, endless galaxy that runs in the browser.

## Run it

```bash
cd space-mmo
npm install
npm start            # http://localhost:8080
npm test             # determinism + end-to-end multiplayer tests
```

To play together, open the URL in a few browser tabs, or put the server somewhere friends can
reach it. Settings come from environment variables: `PORT`, `SEED` (a different seed gives a
different universe) and `DATA_FILE` (where the world is saved, by default `data/world.json`).

## What you can do today

- **Fly** a ship through an endless galaxy. Each sector can hold a star (from red dwarfs to
  black holes), orbiting planets, asteroid belts, a nebula, a station or a wormhole.
- **Mine** asteroids for five ores. Ore gets richer the farther you travel from Haven
  Station, so there's always a reason to push outward.
- **Trade and upgrade** at stations: engine, mining laser, cargo hold, jump drive.
- **Hyperspace jump** from the galaxy map (M). Jump range grows with upgrades. Wormholes fling
  you hundreds of sectors away in one trip.
- **Build** anything, block by block, anywhere in space (B), using the ore you mined. Builds
  are permanent and everyone sees them. A **beacon** puts your mark on every player's galaxy map.
- **Play together**: you see other pilots' ships, their mining beams and their builds, and
  there's galaxy-wide chat.

## How it works

The architecture is chosen so the universe can be infinite and shared, and still cheap to run.

| Piece | Idea |
|---|---|
| `shared/universe.js` | A sector's contents are a **pure function of `(seed, x, y)`**. Nobody stores the universe. Server and clients generate the same sector independently. Smooth noise at the galaxy scale creates dense clusters, voids and regional color. |
| `server/world.js` | The server stores **only player changes on top of the generated universe**: mined asteroids (they grow back after 30 minutes), placed blocks, beacons and pilot profiles. An untouched sector costs zero bytes. |
| Interest management | Each client subscribes to the 3×3 sectors around itself. Updates go only to the players who can see them, so player count doesn't multiply bandwidth. |
| Movement | The client simulates its own ship so flying feels instant (`shared/rules.js`). The server checks every update for plausible speed and snaps cheaters back. Mining, building, trading and jumping are fully decided by the server. |
| Persistence | Saved to a JSON file every 15 s and on shutdown (atomic write). |

A pilot name is claimed by a random token stored in the browser on first use. That's enough
for a prototype, but it isn't real accounts.

## Road to the full game

This prototype proves the core loop and the architecture. Getting to "the ultimate sandbox
MMO" is a long road. A rough order:

1. **Depth of play**: ship combat and PvP zones, NPC factions and pirates, crafting chains
   (ore → refined materials → components), functional blocks (thrusters, turrets, storage,
   refineries, shipyards) so player builds become working ships and stations.
2. **Landing on planets**: procedural planet surfaces using the same seed-plus-changes model,
   with terrain you can dig into and edit.
3. **Player economy and society**: player-run markets, contracts, guilds, territory claims,
   and naming systems you discover first.
4. **Scale-out server**: move from one process to sector-sharded servers with seamless
   handoff, a real database (e.g. Postgres for profiles, a key-value store for sector changes),
   binary netcode, real accounts.
5. **Engine**: the 2D canvas client is a fast way to prove gameplay. A 3D client (Three.js/
   WebGPU, or Godot/Unity/Unreal for native) can use the same server protocol and the same
   universe generator, ported to its language.

## Files

```
shared/   rng.js (hashing, noise), universe.js (procedural galaxy), rules.js (economy, physics)
server/   server.js (HTTP + WebSocket), world.js (authoritative game state)
client/   index.html, style.css, main.js (rendering, input, HUD, galaxy map)
test/     universe.test.js, server.test.js
```
