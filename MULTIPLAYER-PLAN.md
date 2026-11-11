# Co-op multiplayer: scope and sequencing

Planning document. No multiplayer code exists yet.

---

## The honest framing

This is not a feature bolted onto SNIPER RAGE. It is a different program that
reuses its art and feel.

The game today is one HTML file where the client decides everything, including
whether a shot hit. The requirement that the server own enemy state, health,
waves and damage validation, and never trust the client on hits, inverts the
direction every system currently runs in. Enemy AI, the wave manager, scoring,
credits and hit registration all move server-side. The client becomes a renderer
with prediction on top.

Expect several sessions. The first produces no playable multiplayer, only
scaffolding.

---

## Two decisions needed before any code

**1. Does the single-file architecture survive?**

A Colyseus server and a client importing shared state cannot live in one HTML
file. This means a real repository with a build step, which costs the
open-it-and-play portability that is currently the project's best property.
That tradeoff should be made deliberately, not discovered halfway through.

**2. Where do animated characters come from?**

The spec calls for remote players using realistic character GLBs with walking,
running, crouching, aiming, shooting and reload animations.

Every character asset supplied so far has either no rig at all (the army
character) or a single clip (the terrorist's one walk). There is no animation
set to share. Either a properly rigged and animated character gets sourced,
Mixamo would cover it, or remote players will be stiff figures sliding around,
which undercuts the point of third-person representation.

This is the single biggest risk to the result looking right.

---

## Proposed sequencing

Prove the hard part first. Visual quality is the easy part to add later; a
networking model that does not hold up is expensive to discover late.

### Phase 1 — plumbing
Colyseus server, room creation with shareable codes, join flow, guest identity,
heartbeat and reconnect. Remote players drawn as plain capsules. Movement and
rotation synchronised with interpolation and client-side prediction.

**Done when:** two browsers join one room and see each other move smoothly.

### Phase 2 — authoritative simulation
Enemy spawning, AI, health and death move to the server. Wave progression
becomes shared state. Hit registration becomes a server-validated claim rather
than a client decision. Scores, credits and mission progress synchronise.

**Done when:** two players clear a wave together and neither client can fake a
kill.

### Phase 3 — co-op rules
Downed state with the DOWNED and REVIVE prompts, timed revive by teammates,
shared game over when everyone is eliminated. Synchronised audio events for
shots, reloads, enemy alerts and wave transitions.

### Phase 4 — characters and polish
Real character GLBs for remote players with the full animation set, shared
animation data, LOD. Team HUD: connected teammates, health, connection status.
Floating teammate labels with name, health bar and distance, readable without
blocking the view, visually distinct from enemies.

### Phase 5 — deployment
Server as a Node.js web service on Render, frontend as a static site. Server URL
through an environment variable. WSS in production, localhost permitted in
development only.

---

## Preserved throughout

Non-negotiable, carried from single player unchanged:

- 50-round magazine
- exactly 3.0 second reload
- all five weapon tiers and their progression
- the construction site and all five sectors
- the wave system
- the sniper scope and its optical render
- existing HUD behaviour, extended rather than replaced

---

## Target architecture

```
client/
  rendering/        Three.js scene, cameras, post-processing
  player/           local first-person, input, prediction
  remote/           third-person characters, interpolation, animation
  net/              Colyseus client, message handling, reconnect
  ui/               HUD, team panel, room screens
  audio/

server/
  rooms/            room lifecycle, matchmaking, codes
  sync/             player, enemy and wave synchronisation
  sim/              authoritative enemy AI and wave logic
  validation/       damage and hit validation
  identity/         guest identity

shared/             state schema and constants used by both sides
```

Every player ends up with two representations: local first-person, and remote
third-person as seen by everyone else.

---

## Performance notes

- Send movement deltas at a fixed tick, not full state per frame
- Interpolate remote positions; predict locally and reconcile
- Share animation mixers across remote characters rather than one per player
- LOD on remote characters, since at eight-plus players most are distant
