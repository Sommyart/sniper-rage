# Changelog

Ordered oldest to newest. Version tags match the snapshot names used during
development.

---

## v10 — baseline
Core game: waves, enemy AI, five weapons, 50-round magazine, 3.0s reload,
credits, score, headshots, missions, localStorage save, HUD, scope.

## v11 — engine upgrade
Post-processing chain via EffectComposer: SSAO, bloom, depth of field that
tracks scope range, SMAA, grade shader. Four quality tiers with auto-detection.

## v12 — assets integrated
Supplied GLB models replace procedural geometry for the rifle and characters.
Asset loader falls back to procedural shapes when a model is missing.

## v13 — environment
Five sectors, each with its own sky shader, fog, lighting, weather particles and
zone names. Sectors rotate every three waves.

## v14 — real assets
Rigged soldier with a full 114-joint skeleton, all 16 bone slots mapped. Rifle
split into 8 animated parts: bolt cycles per shot, magazine drops on reload,
trigger pulls. Environment dressed with scaffolding, barriers, cones, signs,
construction props and a scanned ruins block. Occluder and firing-line audits
confirmed unchanged by the dressing pass.

## v15 — PBR surfaces *(reverted)*
Replaced the flat Lambert palette with 33 physically shaded materials carrying
procedural albedo, normal and roughness maps. Added image-based lighting baked
per sector from the sky shader. Fixed quality detection so ambient occlusion
switches on by default.

**Reverted at the user's request**: the scene came out too dark. Standard
materials shade dimmer than Lambert under the same lights, ambient occlusion
darkened every corner on top of that, and no exposure compensation was applied
to balance either. Restored from the v14 snapshot.

## v17 — touch controls reworked
Removed the arrow pad entirely. Movement moved to a floating analog joystick
under the right thumb; aiming became a drag anywhere on the left. Action pads
moved to the left to clear the movement thumb. Added a **TOUCH SIDES** setting
that mirrors the stick and all five pads in one tap, saved between sessions.

## v18 — first-person hands fixed
The arms were being built and attached correctly but were posed **inside the
camera's near plane** — the right arm sat at view z +0.096, behind the lens — so
they were clipped away every frame. The arm rotation sign was inverted, swinging
the hands backwards into the camera instead of forward onto the weapon.
Corrected the rotation and refitted both shoulders. Verified by measurement: both
hands project inside the frame and land on the weapon body, support hand forward
on the barrel, trigger hand back at the grip.

## v19 — new rifle and enemy
- Rifle replaced with the sci-fi model, decimated 28k to 15.5k triangles,
  textures repacked to 1024 and 512. Orientation and scale verified: muzzle 1.46
  units ahead of the holder, weapon 0.45 x 0.65 x 1.07 in view units.
- Enemy replaced with the low-poly terrorist, decimated 99.5k to 29.5k
  triangles. The 66-joint skeleton survived decimation and all 17 bone slots
  mapped. Walk clip wired, rifle parented to the hand bone.
- **Regression**: the new rifle exports generic node names, so the bolt,
  magazine and trigger bindings all fail. The weapon no longer animates its
  moving parts.

## v20 — army enemy, hands off
- Enemy replaced with the army character.
  **Note**: this model has no skeleton and no animation clips, so enemies now
  run through the auto-rigger rather than a supplied rig. Movement is stiffer.
- First-person hands switched off behind `SHOW_FP_ARMS`, set to false. The pose
  constants are left in place and still fitted to the grip.

**Testing note**: the development container was reset before this change, which
wiped the build directory, the ten test suites and the node tooling. This
version was verified by JavaScript syntax check, GLB structure validation of all
three embedded models, and confirmation that no ungated path can attach the
arms. The full suites were not re-run.

## v21 — grenades, visibility, saved runs, deployment

### Frag grenades
- Hold `G` on a keyboard, or hold the FRAG pad on touch, to aim. Power charges
  over 0.85s and maps onto a throw of roughly 14m to 50m. Release to throw.
- The arc you see is the arc the grenade flies: the preview runs the same fixed
  timestep integrator against the same collision set as the live projectile, so
  the preview cannot disagree with the throw.
- Drawn as a string of round beads with a thin line beneath, plus a landing
  ring. A one-pixel line is invisible against a bright sky and `linewidth` is
  ignored on every WebGL platform, which is why beads rather than a thick line.
- 2.6s fuse, 7.6m radius, 260 damage at the centre falling off to nothing at the
  edge. Bounces off concrete at 0.34 restitution.
- **A target the blast cannot see still takes half damage.** This is the point
  of the weapon: a hostile wedged into a floor slab where no bullet can reach
  him is reachable with a grenade, without turning cover into decoration.
- Self-damage inside 5.4m, so lobbing one at your own feet costs you.
- Carried: 3 at the start, capped at 5, topped up on a cleared wave.

### Wave 2 hostiles no longer vanish into the blocks
Concrete, sand, rust and a soldier's kit all sit in the same narrow band of
desaturated greys and browns, so at range a hostile against an unfinished slab
had nothing separating him from it. Three fixes, in order of how much they do:
- **Unit tape.** Coloured tape on the arm, shoulder, back and chest, in one
  colour per archetype: amber basic, cyan armored, red elite, violet heavy. It
  is unlit, so it holds up in the night and snow sectors, and it doubles as a
  read on what you are looking at. This is what real units do about the same
  problem.
- **A brightness lift** of `#343029` emissive on every hostile, so figures come
  out of the dark interiors instead of merging with them.
- **Target markers**, a setting under TARGET MARKERS, bracketing hostiles that
  have a line on you. Default on at distance.

### Saved runs
- The run is written to `localStorage` under `sniper_rage_run_v1` on every wave
  change, on pause, on tab hide and on `pagehide`, so a closed tab or a killed
  browser does not cost progress.
- CONTINUE appears on the main menu whenever a saved run exists, labelled with
  the wave, score and health so it is obvious what resuming gets you.
- The snapshot carries wave, score, credits, health, grenades, weapon, sector
  and mission progress.
- SAVE AND QUIT in the pause menu, and a plain statement if the browser refuses
  local storage rather than a silent failure.

### Deployment
- `build/package.js` now ships and precaches the four environment models.
  Before this they were fetched from `assets/` at run time and were **not** in
  the service worker's precache list, so "offline" meant playing in an empty lot
  with no ruins and no scaffolding. That was a real bug in the previous PWA
  package, not a new feature.
- The packager refuses to build if the page fetches a model it does not ship,
  so this cannot silently regress.
- Repo restructured: one copy of each binary. `assets/` and `sniper-rage.html`
  are the sources, `public/` is build output and is not committed.
- `vercel.json` builds the site on deploy.

### Testing
`build/verify.js` drives the packaged site in a real browser with software
WebGL and asserts 22 checks across all three features: charge curve, throw
distance, the arc rising and falling under gravity, blast damage at the centre,
no damage outside the radius, tape and lift on every hostile in wave 2, the
autosave payload, CONTINUE appearing after a full page reload, and every
restored field. 22 passed, 0 failed.

Note that the software renderer manages about 2 fps, so the harness steps the
simulation by fixed timesteps rather than waiting on the wall clock. An earlier
wall-clock version of these tests reported two false failures for that reason.

### Still open
- The rifle's bolt, magazine and trigger remain unbound from v19.
- Enemies still run through the auto-rigger; the army model has no skeleton.
- The ten headless suites lost in the container reset are still not rebuilt.
- Asset licences are still uncleared, and this repository is public.

---

## Test suites

Ten headless suites covered boot and cover slots, line-of-sight audits across
all five sectors, combat and scoring, wave progression, the ammunition exploit,
36000-frame stability, all three input schemes, magnification steps, the stall
breaker, sector teardown and rebuild, the composer chain per tier, and supplied
skeleton mapping.

Every version through v19 ran clean at zero errors. **The suite files were lost
in the container reset and are not in this repository.** Rebuilding them is
worth doing before the multiplayer work starts, since that rewrite will touch
nearly every system they covered.
