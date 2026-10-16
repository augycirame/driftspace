# Driftspace (working title)

An infinitely generated, multiplayer 3D space sandbox that runs in the browser. Fly a ship you
built block by block, land on planets and explore them on foot, fight pirates and alien swarms,
party up with friends, and push a server-wide story forward. The story's outcome permanently
changes the galaxy for everyone.

## Run it

```bash
npm install
npm start            # http://localhost:8080
npm test             # rules, determinism, and full end-to-end multiplayer tests
```

Settings come from environment variables:

| Variable | What it does |
|---|---|
| `PORT` | Port to listen on (Render sets this). |
| `SEED` | Universe seed. A different seed gives a different galaxy. |
| `DATA_FILE` | Where the world is saved (default `data/world.json`). |
| `ADMIN` | Pilot names (comma-separated) allowed to use admin chat commands. |
| `STORY_SCALE` | Multiplies story goals, e.g. `0.25` for a small group, `4` for a busy server. |

## Put it online (Render)

`render.yaml` is a Render Blueprint: a web service (`npm ci`, then `npm start`) plus a 1 GB
disk at `/var/data` for the world save. Every push to `main` redeploys. WebSockets work on
Render with no extra setup. The disk needs a paid instance type. On the free plan, remove the
`disk` block: the game still works, but the world resets on every restart or deploy.

## The game

**Start on Haven.** New pilots spawn on foot at Haven Landing, a settlement on the starter
planet. Warden Ilse walks you through a short tutorial: dig ore, meet the quartermaster, take
off, mine an asteroid, and dock at Haven Station.

**Accounts.** Real accounts with a name and password. Passwords are hashed with scrypt, and
only hashes of session tokens are stored. Your browser stays signed in.

**Fly in 3D.** Steer with the mouse. Move with W/S and A/D, rise and sink with Space/C, roll
with Q/E. The galaxy is endless. Every sector can hold a star (red dwarfs to black holes),
orbiting planets, asteroid belts, stations and wormholes. Jump between sectors from the
galaxy map (M).

**Build your ship.** Ships are made of blocks: cockpit, hull, armor, thrusters, cargo pods,
blasters, shield generators and wings. The ship's stats (speed, turning, hull, shields, guns,
cargo) come from what it's made of. Edit it in the 3D shipyard at any station, or next to
your ship when it's parked on a planet. Ore pays for new blocks, and removed blocks are refunded.

**Land on planets.** Rocky, ice, lava, ocean, jungle and desert worlds, each with its own
terrain, sky, liquid, flora and creatures. Dig into the ground for ore (crystal deposits are
richer), raise terrain, and build structures. Gas giants have no surface to land on.

**Weapons and armor.** On foot you carry a hand weapon (pistol, rifle, shotgun, plasma or
railgun) and wear a helmet, chestplate and greaves. Gear comes in five tiers, from Scrap to
Void. Buy it at shops, or loot it from pirates, creatures and the story's bosses. Armor
reduces damage, and Void armor adds a personal shield.

**Combat.** Ships carry blasters. Pirates hunt pilots outside the safe sectors around Haven,
and other pilots can fire on you out there too. Destroyed ships respawn at your last station
and lose their cargo. On planets, creatures attack anyone who wanders too far.

**Parties of up to 4** (P). No friendly fire, shared bounties, party chat (`/p message`),
markers on each other, and a party warp that jumps you straight to a member.

**The story.** Four chapters run for the whole server, and everyone's actions count:
1. *The Silent Signal*: deliver voidstone and iron to decode a signal.
2. *The Hollow Swarm*: alien ships invade every sector, even Haven. Destroy enough of them and
   the Hive Mothership appears for a server-wide boss fight.
3. *The Ancient Gate*: pool materials to build a gate at Haven Station. It permanently opens a
   route to the Far Reach, and aetherium, a new ore, starts appearing in the deep.
4. *Echoes of the Precursors*: find and awaken five relics on distant planet surfaces. This
   permanently extends every pilot's jump range.

Then a new era begins: the chapters repeat with bigger goals, and the galaxy keeps every change
from earlier eras. Contribute at any station, and follow progress in the journal (J).

## Admin commands

Pilots named in `ADMIN` can type these in chat: `/spawn pirate|hollow [n]`, `/tp <x> <z>`,
`/land`, `/give <ore> [n]`, `/credits [n]`, `/story [n]` (advance the current goal), `/heal`.

## How it works

| Piece | Idea |
|---|---|
| `shared/universe.js`, `shared/planet.js` | Sectors and planet surfaces are **pure functions of the seed**. Server and clients generate the same galaxy independently, and nobody stores it. |
| `server/world.js` | Stores **only player changes**: mined asteroids, dug terrain, built blocks, beacons, pilots, story progress. An untouched sector or planet costs nothing. |
| `server/combat.js`, `server/surface.js` | The server decides bolts, hitscan shots, NPC and creature AI, damage, loot and bounties. |
| `server/story.js`, `shared/story.js` | The story director: community goals, chapter transitions, and the effects that change the galaxy. |
| Interest management | In space, each client subscribes to the 3×3 sectors around it. On a planet, it hears only that planet. |
| Movement | Clients simulate their own ship or pilot so controls feel instant (`shared/rules.js`). The server checks plausibility and snaps cheaters back. |
| Client | Three.js (served from `node_modules`, no CDN). `client/space.js` and `client/surface.js` are the two scenes. `client/shipyard.js` is the 3D block editor. |

Saves from the first 2D version aren't compatible with this one, so the server starts a fresh
world the first time it runs this version.
