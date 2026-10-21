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

**Fly in 3D.** Space is fully three-dimensional: star systems sit at different heights above and
below the galactic plane, and planet orbits are tilted. Steer with the mouse. Move with W/S and A/D, rise and sink with Space/C, roll
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

## Graphics

Press **O** for Options to pick a graphics quality: Low, Medium, High or Ultra. Medium and above
add bloom glow, real-time shadows on planets, sky domes with a visible sun, and textured terrain
with rippling water. High and Ultra render at higher resolution, add lens flares, sharper planet
textures and denser plant life. Planet surfaces in space are generated on the GPU from 3D noise
(seamless, with relief and glowing atmospheres), and space has a procedural nebula sky that
changes color from region to region. Phones and small screens start on Low; the choice is saved
in the browser.

### Art style

Three styles, switched under Options (**O**) → Art style and saved in the browser:

- **Realistic** (default): physically based lighting from a real sky (Rayleigh and Mie
  scattering, a cloud layer that follows the weather, stars and a moon at night), soft shadows,
  film-like tone mapping and grain. Terrain has cliffs, shore sand, snow and wet ground with
  scanned (CC0) surface detail; wind-blown grass, leafy trees and reflective water. People are
  real, rigged human bodies (from MakeHuman's CC0 assets, see `tools/people/`): men and women
  of every build, age and ethnicity, elves with pointed ears and stocky dwarves, with real eyes
  and hair (long and flowing, bobs, ponytails, buns or short), real skin tones from very fair to
  very dark with flushed cheeks, creases and freckles, and motion-captured movement: idling,
  walking, running, nodding and shaking their heads, bards dancing, pilots gripping their rifles. Pilots wear a flight suit with harness, belt
  pouches, gloves, boots and knee pads, rifle at the ready; natives wear tunics, robes, cloaks,
  helmets and crowns. Ships are panelled hulls with rivets, chipped paint and grime, a glass
  canopy, glowing bell nozzles, swept wings with navigation lights and cannons. In space: a Milky
  Way with dust lanes, countless faint stars, and reflections on hulls.
- **Anime**: a grounded, painted look like a seinen anime series. Natural, slightly
  warm colors; fine sepia ink lines; one crisp, soft-toned light/shadow edge. Surfaces are
  painted with tonal patches and brush mottling. Masonry (temples, shrines, ruins, dungeon walls,
  boulders) gets hand-drawn stonework: irregular stones with mortar lines. Skies are soft and
  bright with brushy clouds, and forests mix tall layered pines with leafy crowns. Pilots are
  drawn like a character sheet: real proportions, a narrow, steady gaze, hair slicked back with
  braids at the temples (in natural hair colors), a rough tunic in the pilot's color with a rope
  belt and wrapped wrists, dark trousers and tall boots. Armor shows as leather or plate.
- **Chibi**: bright and cute. Bold black ink, punchy colors, blue-violet cel shadows and a rim
  light; big-headed chibi pilots with huge shining eyes, spiky hair, a shine band and a
  streaming scarf; anime-eyed creatures; film-style skies with towering clouds and cherry
  petals drifting on green worlds.

Both anime styles add drifting snow on ice worlds, embers over lava and sunlit motes elsewhere,
a painted nebula with twinkling four-point stars in space, and speed lines near top speed.

## The content library (`shared/content/`)

Everything planets are made of lives in plain data files. Planet generation draws from them,
so **adding an entry adds it to the galaxy**. No other code changes are needed.

| File | What's in it |
|---|---|
| `terrains.js` | 20 terrains (canyonlands, crystal tundra, fungal forests, toxic swamps, bone wastes, glass deserts…): hills, colors, liquids, ores, flora, and biome tags. Each planet picks one that suits its type. |
| `creatures.js` | 58 creatures (plus each alien race's warriors and villagers) with body plans (quad, serpent, flyer, blob, insect, biped, golem, crab, tentacled, strider) and behaviors (aggressive, territorial, passive, swarm, plus ruin guardians and faction soldiers). Each planet gets up to three species that match its terrain. Dungeon dwellers and five bosses live only underground. |
| `aliens.js` | Six alien races (Vashti, Krell, Myrmidar, Lumen, Thralls of Ix, Ostrakar), each friendly, neutral or hostile, with their own look, ships and villages. |
| `dungeons.js` | Five dungeon themes (Sunken Crypt, Hive Warren, The Forge Below, Crystal Caverns, Drowned Temple of Ix) with their monsters, bosses and treasure. |
| `structures.js` | 22 structures built from simple shapes: Precursor obelisks, monolith rings, sunken ziggurats, fallen colossi, vaults, shrines and temples, Imperial garrisons, Inquisition spires, rebel hideouts, wrecks, pilgrim camps and the Cathedral. Some have loot caches, guardians or soldiers. |
| `relics.js` | 18 relics with lasting bonuses (damage, armor, speed, mining, jump range, luck, regeneration, shields). Pilots carry two. |
| `factions.js` | The Radiant Empire, its holy capital Aurelis, the Unbound rebellion, the five ancient gods, and their blessings. |

In game, the **Codex (K)** shows the whole library and fills in as you discover things.

## Powers of the galaxy

- **The Radiant Empire** rules a large region of space from **Aurelis**, its holy capital,
  where the Emperor is worshipped as the Radiant Throne. Imperial patrols police their space and
  hunt pirates. Their stations sell better gear to pilots in good standing, and turn away pilots
  the Empire considers enemies.
- **Aurelis, the Holy Capital**: a golden cathedral-station (the Sanctum) over a garden world
  with the Cathedral of the Radiant Throne, pilgrim camps and an Inquisition spire. Citizens of
  the Empire can pay a tithe there for the Radiant Benediction (+20% damage and armor).
- **The Unbound** rebellion holds the frontier around the Empire's edge. Rebel raiders and
  Imperial patrols fight each other there, and every kill counts toward the war score.
- **Reputation**: destroying a faction's ships or soldiers, raiding their bases, or praying to
  the old gods (heresy to the Empire) changes your standing. Ranks run from "Wanted" to
  "Exalted" for the Empire, and "Suspect" to "Hero of the Unbound" for the rebels. Each faction
  attacks only pilots it considers enemies, and anyone who shoots at it.
- **The ancient gods**: Vael, Kharon-Ul, Isareth, Mor-Seth and Oruun have shrines and temples on
  worlds that suit them. Praying gives a 15-minute blessing. After five prayers, a god gives you
  its own legendary relic.
- **Ancient ruins**: Precursor obelisks, monolith rings, ziggurats, fallen colossi and sealed
  vaults, guarded by sentinels and the occasional Vault Colossus. Each ruin's cache can be
  searched once per pilot, for credits, gear and relics. Ruins appear on about a third of
  star systems, more often on ancient terrains such as glass deserts and bone wastes.

## Aliens

Out in the wilds, beyond human space, alien races claim clusters of star systems. They build
villages on worlds that suit them and fly their own ships. Friendly and neutral races trade
exotic gear at their villages. Neutral races defend their homes; hostile ones (the Krell and the
Thralls of Ix) attack on sight. Shoot at any of them and their kin turn on you.

## Dungeons

About one planet in six has a dungeon entrance: a crypt stairway, a hive mound, the gate of a
forge, a crystal cave or a drowned temple. Walk up and press E to go underground. Each dungeon
is a seeded maze of rooms and corridors, with monsters that wake up when they see you, chests,
and a boss in the deepest room guarding a treasure vault (which usually holds a relic). Your
party enters the same copy of the dungeon together. Difficulty grows the farther the planet is
from Haven, and a dungeon resets a couple of minutes after everyone has left.

## Swords

Energy blades and greatswords swing in an arc in front of you (left mouse). Swing three times in
quick succession and the third is a **sword skill**: a glowing spin that strikes everything
around you for double damage. **Q** is **Vorpal Strike**, a lunge that runs you through
everything in a line (every 5 seconds). Swords work in dungeons too. Every hit throws sparks
and a damage number; spells open a magic circle under the caster.

## The Mercenary Guild

Every city has a **guild hall** (walk up and press E) and every station a guild terminal (in the
station menu). The contract board posts new work every hour: hunts, **wanted** outlaws (named,
monstrous creatures that turn up when you near their lair), dungeon clearances, ore supply runs and
space bounties on pirate, Hollow and alien ships. Hold up to three contracts; they show in your
journal and HUD, and finished ones are turned in at any guild board for credits and **merit**.

Merit raises your guild rank from **F** to **S** (Novice, Hired blade, Sellsword, Veteran, Elite,
Ace, Legend). You can take work up to one rank above your own, C-rank contracts and up also pay
out gear, and every promotion is announced to the galaxy. Other pilots see your rank next to your
name. Dropping a contract costs a little merit.

## Item grades and enhancement

Weapons and armor come in five grades: **common**, **rare** (blue), **epic** (purple), **unique**
(gold) and **legendary** (orange). Higher grades have stronger base stats and one to four bonus
stats: sharpness, swiftness, precision (critical hits for double damage), life drain and reach
on weapons; toughness and vitality on armor. Unique and legendary pieces carry their own names.
Loot grades get better further from home, and skilled crafters forge better grades more often.
Crafted gear is signed by its maker.

At a workbench, smithy or station (C) you can **enhance** gear from +1 up to +10, paying credits
and ore. Each level adds about 7% damage or 6% armor. The first levels always succeed; past +5,
a failed attempt costs a level.

## Native peoples, towns and realms

Every landable world is inhabited. Humans (the Reachfolk), elves (the Eldar), dwarves (the
Khazar), vampires (the Nocturne) and the werewolf clans settle the worlds that suit them, in one
to six towns per world: hamlets, villages, walled towns and cities, each built in its people's
style (thatched timber halls and round stone keeps, white elven spires, dwarven stone halls,
gothic manors, clan longhouses). Towns are full of named people with jobs: rulers, stewards,
captains and guards, merchants, smiths, priests, healers, mages, innkeepers, hunters, farmers
and bards. They go about their day, defend their homes, and at night vampires and werewolves
(who change form) hunt outsiders who haven't earned their trust.

**Realms and politics** (R). Towns belong to realms (kingdoms, councils, chiefdoms, conclaves,
thaneholds, night courts, clans) with rulers, treasuries, stability and relations with their
neighbors. The server simulates every visited world: relations drift, realms ally or go to
war, wars are fought (raids on towns while you watch) and won (a town changes hands, or tribute
is paid), rulers die and are succeeded or overthrown, and famines, plagues, festivals and
bandit seasons come and go. A chronicle records it all. Your standing with each realm moves
with what you do: trade, quests, conversation, or killing its people.

**Money.** Each realm mints its own coin (crowns, silver leaves, marks, sovereigns, fangs) at an
exchange rate that rises and falls with its stability and wars. Town markets trade goods
(grain, ale, elven silk, mithril, bloodwine, furs…) at prices driven by supply, demand and
events. Buy where it's made, sell where it's wanted. Credits work too, at a 10% markup.

**Talking** (E). Every townsperson greets you according to who you are to them and what's
happening: war, famine, festival, night, weather. They trade, change money, heal, teach magic,
lift curses, share rumors and hand out work. With an `ANTHROPIC_API_KEY` and `AI_ENABLED=1` set on
the server (off by default, since API calls are billed),
you can also simply talk to them: each one is voiced by Claude with their own character sheet
(people, temperament, job, town, realm, ruler, wars, recent events, how they regard you), and
they react within their role: open their shop, offer work, end the conversation, or (if
gravely insulted, and armed) attack. Good conversations win a little standing. Calls are rate
limited per player and capped per day (`AI_DAILY_LIMIT`, default 3000); `NPC_MODEL` picks the
model (default `claude-opus-5-5`). Otherwise NPCs use scripted dialogue.

**Cities.** The capital of a realm with more than one town is a walled city: a paved plaza
with a fountain, the keep and market stalls; avenues out to three gates; ring streets lined with
rows of two- to four-storey houses in the people's style (timber and tile, white elven stone,
dwarven stone with flat roofs, gothic dark stone, clan logs), a guild hall, inns, a temple,
a smithy, towers, street lamps and trees, and a busy crowd.

**Climate, weather and day.** Worlds are frozen, cold, temperate, humid, arid or scorching, with
weather that comes and goes: rain, thunderstorms, snow, blizzards, fog, sandstorms and ashfall
(the worst of which wear you down outside towns unless your armor is good). Every world turns at
its own pace, with sunsets, starry nights and a moon. Small worlds have low gravity.

## Questlines

Ask anyone for work. Quests come from what is actually happening: a famine needs grain, a plague
needs herbs, bandits need clearing (then their chief), a war needs iron, then soldiers, then
someone to carry the terms of peace (or a threat), feuding realms need envoys (deliver the letter
faithfully or rewrite it into an insult and start a war), hunters want beasts thinned, smiths want
ore, merchants want trade runs, and mages want dungeons cleared and ruins searched. Finishing one
stage of a line leads to the next. When the world changes underneath a quest (the famine ends,
the giver dies, the war is won, the town is conquered) the quest rewrites itself. Outcomes feed
back into the realms: stability, relations, war scores, peace treaties and the chronicle.
Quests are tracked on the HUD, the radar and in the journal (J).

## Skills, magic and powers (U)

- **Skills** grow with use: combat, mining, trade, speech, piloting, magic and crafting, each with
  a lasting bonus.
- **Magic**: mages, priests and healers teach spells for local coin: Firebolt, Frost Nova, Mending,
  Blink, Chain Lightning, Ward and Sunlance. Cast with 1-4; mana regenerates.
- **Superpowers** come from the old gods: pray at one god's shrines three times and they grant
  their power. Vael: flight. Kharon-Ul: Forge-Strength. Isareth: the Pale Aegis
  (invulnerability). Mor-Seth: Hunter's Stride (speed). Oruun: the Silent Veil (unseen). Press F.
- **Curses**: a vampire's bite can make you a vampire (stronger at night, drink blood from your
  hits, burn in daylight away from towns); a werewolf's bite at night can make you a werewolf
  (T to become a great wolf at night: fast, tough, deadly claws, no guns or spells). Your own
  kind stop hunting you. A priest can cure either.
- **Mechs**: mech frames are sold at stations and Haven's trade hall, or crafted. Equip one, then
  G to climb in: a shoulder cannon with splash damage, jump jets, and armor that soaks the hits.
  It repairs itself while you're out of it.

## Materials, crafting and bases

Dig for stone (and, on the right worlds, silver, mana crystal and deep mithril), chop trees for
wood, and hunt for hide. Craft weapons, armor, mech frames and focus relics (C) at your own
workbench, in a town with a smith, or aboard a station; crafting skill unlocks higher tiers and
sometimes produces a masterwork.

Build bases from timber and stone walls, doors, beds (you wake up there), storage chests,
workbenches, turrets that shoot whatever threatens you, and claim banners that keep everyone
else from digging or building within 30 m. In space, a docking port turns anything you build into
a station other pilots can dock at (free repairs, ore at 80%, refits, crafting), and turrets
defend it from pirates and the Hollow.

## Physics

Stars pull on ships, and black holes pull hard: the accretion disk strips shields and burns the
hull, and anything that crosses the event horizon is flung 15-40 sectors across the galaxy.
Each planet has its own surface gravity.

## The AI director

An AI runs the game from the inside. Every minute it measures deaths, kills, income, quests and
server load (tick time, creatures, ships), and turns three dials: **difficulty** (enemy
strength), **loot** (reward multiplier) and **spawns** (how much the world spawns, cut back when
the server is struggling). When nothing has happened for a while it stages world events: raids,
festivals, famines, plagues, a god's omen blessing a planet, pirate bounty convoys, mining
bonanzas. With an API key, a Claude **game master** reviews the numbers every 15 minutes and
makes the bigger calls, bounded: each dial moves at most 0.15 per decision and stays within
limits, and events come from a fixed menu. Admins can read its state with `/director`.

## Admin commands

Pilots named in `ADMIN` can type these in chat: `/spawn pirate|hollow|imperial|rebel [n]`,
`/tp <x> <z>`, `/land`, `/give <ore> [n]`, `/credits [n]`, `/story [n]` (advance the current
goal), `/rep empire|rebellion <n>`, `/relic <id>`, `/goto <structure|dungeon|village>` (on a
planet), `/town [i]`, `/pos <x> <z>`, `/war`, `/event famine|plague|festival|raiders`, `/mech [tier]`,
`/spells`, `/power <id>`, `/curse vampire|werewolf|none`, `/director [event]`, `/heal`.

## How it works

| Piece | Idea |
|---|---|
| `shared/universe.js`, `shared/planet.js` | Sectors and planet surfaces are **pure functions of the seed**. Server and clients generate the same galaxy independently, and nobody stores it. |
| `server/world.js` | Stores **only player changes**: mined asteroids, dug terrain, built blocks, beacons, pilots, story progress. An untouched sector or planet costs nothing. |
| `server/combat.js`, `server/surface.js` | The server decides bolts, hitscan shots, NPC and creature AI, damage, loot and bounties. |
| `server/story.js`, `shared/story.js` | The story director: community goals, chapter transitions, and the effects that change the galaxy. |
| `shared/towns.js`, `server/politics.js`, `server/natives.js` | Towns, realms and people are generated from the seed; what happens to them afterwards (wars, deaths, coups, markets) is simulated and saved per visited world. |
| `server/talk.js`, `server/quests.js`, `server/ai.js` | Conversations, markets and quests; Claude voices townsfolk with structured, role-limited replies. |
| `server/powers.js`, `server/bases.js`, `server/director.js` | Skills, magic, powers, curses and mechs; bases, stations and crafting; the AI director. |
| `server/guild.js`, `shared/guild.js` | The Mercenary Guild: contract boards, ranks and merit, wanted outlaws. |
| Interest management | In space, each client subscribes to the 3×3 sectors around it. On a planet, it hears only that planet. |
| Movement | Clients simulate their own ship or pilot so controls feel instant (`shared/rules.js`). The server checks plausibility and snaps cheaters back. |
| Client | Three.js (served from `node_modules`, no CDN). `client/space.js` and `client/surface.js` are the two scenes. `client/shipyard.js` is the 3D block editor. |

Saves from the first 2D version aren't compatible with this one, so the server starts a fresh
world the first time it runs this version.
