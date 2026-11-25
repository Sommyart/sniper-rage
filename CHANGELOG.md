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

## v27 — third person

- The player is now a visible soldier: Mixamo's "Swat Guy" (urban camo, so he
  reads apart from the hostiles), textures cut to 1024 and mesh halved, 1.9 MB.
- He plays the shared motion-capture clips: run when moving, aim at rest,
  fire on each shot, the death fall at zero health. His upper body bends with
  the camera's pitch so the rifle follows the aim. The VSS is seated between
  his hands in the aiming pose, as on the hostiles.
- Camera over the right shoulder (0.66 right, 0.38 up, 2.9 back), turning with
  the aim, and pulled in when a pillar or wall would come between camera and
  head.
- Shots still travel down the camera line, so the crosshair stays exact; the
  flash and tracer leave his muzzle and the tracer converges on the aim line.
- Bringing the scope up slides the camera into his eyes and hides him, so the
  PSO-1 view is unchanged.
- SETTINGS > VIEW switches between THIRD PERSON (default) and FIRST PERSON.
- Page 15.4 MB -> 17.9 MB. `build/verify.js`: 22 of 22 pass.

---

## v26 — the sniper upgrade

- **Rifle:** the VSS Vintorez with PSO-1 scope by the Arms Museum on Sketchfab,
  CC0 (credit not required, commercial use allowed). Its 37 parts were kept
  separate, textures cut from 2048 to 1024 and the file from 19 MB to 3.3 MB.
  It replaces the v23 rifle for the player and for every hostile.
- **Real moving parts:** the model's own magazine drops out and returns over
  the reload, and its bolt carrier, visible in the receiver window, snaps back
  on every shot. Each part is lifted to a pivot in rifle space so it can be
  slid whatever its own nesting.
- **Shot effects:** a first-person flash of three crossed planes with a
  star-pronged texture at the measured muzzle, a smoke wisp that hangs after
  the shot, and spent brass thrown from the right of the receiver.
- **Gloved hands:** the Swat soldier's own hands, posed in his aiming clip and
  fitted so the right hand closes on the pistol grip and the left sits on the
  handguard. Legs, neck and head are folded away.
- **Metal:** sky reflection on the viewmodel cut to 0.28; at full strength the
  photographed sky turned blued steel bright blue.
- **Scope:** the PSO-1 reticle: aiming chevron, three holdover chevrons, a mil
  scale with 10-mil marks, the post, and the stadiametric rangefinder (2 to 10
  hundred metres for a 1.7 m man). It glows red in the night sector, as the
  real battery-lit reticle does. The marks are drawn to the lens, not
  calibrated to the game's variable zoom, so read the rangefinder as a guide.
- A procedural bolt knob was tried on the v23 rifle and removed: that model
  already has a bolt handle, fused into its solid mesh.
- Page 16.4 MB -> 15.4 MB. `build/verify.js`: 22 of 22 pass.

---

## v25 — motion-captured hostiles (Mixamo)

- Hostiles are now Mixamo's "Swat" (basic and armored) and "Gas Mask" (elite
  and heavy) characters, driven by six motion-capture clips: rifle run, aiming
  idle, firing, crouched aiming, hit reaction and rifle death.
- Each AI state plays its clip with crossfades: advance runs, cover kneels,
  peek aims, fire fires, a hit flinches for 0.35 s, and death plays the real
  fall instead of tipping the rig over.
- Mixamo bodies hold no weapon, so the rifle is seated in the aiming pose,
  barrel from the trigger hand through the support hand, then parented to the
  right hand.
- The unit tape now rides the upper-arm and chest bones; on a moving body the
  old fixed heights left it floating in the air.
- Textured uniforms get a much smaller visibility lift (#0f0e0c instead of
  #343029); the full lift bleached them grey. The built-in fallback soldiers
  keep the original lift.
- Size: textures cut from 4096 to 1024 and the Gas Mask mesh halved (41k to
  21k triangles). 143 MB and 6 MB of FBX became 1.6 MB and 1.5 MB of GLB.
- Licence: Mixamo allows its characters and animations in games, commercial
  ones included, but not redistribution as standalone files. They therefore
  exist only embedded in the game page; no Mixamo file is committed on its own.
- A cartoon CC0 set (Quaternius Toon Shooter) was tried first and rejected:
  fully animated, but its style clashed with the photographed site.
- Page 11.9 MB -> 16.4 MB. `build/verify.js`: 22 of 22 pass.

---

## v24 — photographed surfaces and sky (Poly Haven, CC0)

All new assets are from Poly Haven, whose licence page states every asset is
CC0: no credit required, free for commercial use. Downloaded through Josiah's
browser, since this build environment cannot reach the site directly.

- Surfaces: worn concrete (walls, pillars, slabs), worn concrete floor,
  asphalt, rusty metal, corrugated iron (shipping containers) and plywood.
  Diffuse maps at 1024 for the big surfaces and 512 for the rest; the metals
  and containers also take normal and roughness/metal maps.
- Brightness held: every diffuse map was normalised to a neutral mid grey and
  each material's colour scaled to undo it, so surfaces keep the brightness
  they had. This is the fix for what made the reverted PBR pass too dark.
- The wall concrete's stains were softened to 38% contrast; at full contrast
  they read as a leopard pattern.
- Texture coordinates are re-projected from world space after each sector is
  built, so a texture repeats every 1.2 to 4 metres instead of stretching once
  across a 30 m slab.
- Sky: "Industrial Sunset (Pure Sky)" HDRI as the backdrop and reflection light
  for the late-afternoon construction site, rotated so its sun lines up with
  the game's sun. Fog matched to the photographed horizon. The other four
  sectors keep their painted skies.
- three.js r128 RGBELoader (MIT) vendored for the sky.
- Page 8.5 MB -> 11.9 MB. `build/verify.js`: 22 of 22 pass.

---

## v23 — Josiah's own sniper rifle

The first-person rifle is now Josiah's own model, supplied as GLB, OBJ, DAE
and FBX with a separate texture pack. The GLB was used.

- 41,278 triangles, one mesh. The GLB carried no textures, so the base colour,
  normal, roughness and metalness maps from the pack were baked into it. Base
  colour and normal at 2048, roughness and metalness packed into one 1024 map.
  The displacement map is not used by the game and was left out.
- Turned to face down the barrel: it was modelled along +X with the muzzle at
  +X, and the game holds the rifle looking down -Z.
- An overbright specular extension (factor 2.0) from the Blender export was
  removed so the metal does not glare.
- 31 MB of source files became one 4.1 MB GLB, embedded in the page. The page
  is now 8.5 MB.
- It is one solid mesh, so the bolt, magazine and trigger do not animate. The
  whole rifle still kicks on recoil and dips on reload.
- `build/verify.js`: 22 of 22 pass.

---

## v22 — third-party models removed

All six Sketchfab models are gone: the sci-fi rifle, the army soldier, the
first-person arms extracted from it, the ruins, the construction props and the
scaffold stairs. Each was CC-BY-4.0, which requires crediting the author, and
the decision was to remove them rather than ship them with credits.

- The game now draws its own rifle, soldiers and site dressing, using the
  fallbacks that were already there for a missing model.
- The page drops from 7.7 MB to 3.1 MB, and `assets/` no longer exists.
- The brightness lift that keeps wave 2 hostiles visible was only applied to
  the downloaded soldier's materials, so the built-in soldiers had lost it. It
  is now on the built-in materials too. `build/verify.js`: 22 of 22 pass.
- This also closes the v19 and v20 gaps: no unbound rifle parts, no auto-rigged
  enemies, no uncleared licences.

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

---

## v28 — mobile shooter HUD, stances, faster handling, sniper lineup

**Handling**
- Walk speed 3.4 to 5.6 m/s, sprint 8.6 m/s (Shift unscoped, or the touch
  stick pushed to its rim while heading forward). Shift while scoped still
  holds breath. Acceleration, scope-in and touch look are all quicker.

**Stances**
- Stand, crouch (C) and prone (Z), plus two touch buttons. Camera height,
  move speed and weapon sway change with stance (sway 1.0 / 0.7 / 0.45).
- New Mixamo clips: Prone Idle, Prone Forward, Prone Firing Rifle and Crouch
  Walking, embedded in the page like the rest.

**HUD**
- Round glass touch buttons with line icons, a compass strip with heading,
  a minimap (structures, the firing deck, and hostiles that are firing,
  peeking, spotted or close), and a weapon bar with ammo and a stance toggle.

**Sniper lineup**
- Slot 1 VSS Vintorez (unchanged), 2 SPR A3G, 3 MK22 .338, 4 M200 .408,
  5 M107 .50, each a real model in first person and in the soldier's hands.
  Armory cards list calibre, effective range and weight.
- Models from Sketchfab under CC BY 4.0, credited on the new Credits screen:
  "FN SPR A3G" by 8sianDude, "Sniper Rifle" by awakov_dawid, "CheyTac M200"
  by sanekcloff, "M107 Sniper Rifle" by zacharykozak. Textures cut to 2048
  (colour, normal) and 1024 (the rest) as JPEG, re-oriented barrel to -Z.
- The page is now about 45 MB; aimed at phones that run CODM.

## v29 — intro sequence and native app feel

**Intro** (about 7.5 s, tap to skip, plays every launch)
- Black screen, a scope reticle settles on a target with a heartbeat, a
  gunshot flashes and cracks the screen (a new crack pattern each launch,
  with crack, boom, glass and brass sounds), SNIPER RAGE slams in with a
  glitch on RAGE, then "Developed by Sommyart Imagery". It holds on the
  studio card with a loading bar until the game is ready, so on a first
  launch the download happens behind the intro instead of a blank page.
- It sits at the top of the page, so it starts as soon as the first bytes
  arrive. Sound needs one tap on phones (browser rule); the visuals do not.

**App mode** (Android app or installed copy)
- No INSTALL APP entry, no text selection, long-press menu, pinch or
  double-tap zoom, or image dragging. Full screen with system bars hidden
  from the first touch. The phone's back button pauses the mission or steps
  back a menu instead of closing the app.
- Black splash, status and navigation colours.

## v30 — filmed intro shot from Google Flow

- The gunshot in the intro is now real footage: an 8 s 720p clip generated
  in Google Flow (Veo 3.1 Lite) on Josiah's account, a round smashing
  through glass in a dark ruin, with its own sound. Re-encoded to 2.9 MB
  and embedded. Timeline: reticle and heartbeat on black, cut to the clip,
  title over the hole left in the glass, studio card, game.
- Phones only allow sound after a touch: the clip starts muted on a cold
  launch and the first tap turns the sound on; a second tap skips.
- The drawn crack sequence from v29 stays as the fallback if a device
  cannot play the clip.

## v31 — in-game updates

- A new deploy now downloads in the background while the old version keeps
  playing. A banner slides in at the top with the download progress, then
  "NEW VERSION vNN IS READY" with UPDATE NOW and LATER. UPDATE NOW saves the
  run and restarts the game on the new version, on the same screen; nothing
  is reinstalled. LATER hides it for ten minutes.
- The game checks on launch, whenever it comes back to the foreground, and
  every 20 minutes. The version number comes from this changelog.
- The service worker no longer replaces itself silently on an update; a first
  install still takes over at once.
- The Android app needs no rebuild for this or any content update: it opens
  the live game and caches it.

## v32 — fixes from the phone recording

- **No more "to show your cursor" notice.** Phones send fake mouse events
  after every tap; the game took them for a real mouse, hid the touch
  controls and asked for pointer lock, which made Chrome show that notice.
  Taps can no longer switch the game into mouse mode or request the lock.
- The "ASSETS N OF N LOADED" toast is gone (now only a console warning when
  something fails).
- **The Flow intro now actually plays on phones.** The hosted page carried
  50 MB of base64 inside the HTML, and parsing it froze the phone's main
  thread, so the intro's timers never ran and the old reticle simply sat
  there. The hosted page is now 1.8 MB; models, textures, sky, music and the
  intro clip are separate hashed files in assets/, downloaded in parallel
  and cached for good. The single-file sniper-rage.html stays all-in-one.
- Intro titles now follow the clip's own clock, with a fallback to the
  drawn version if the clip cannot load within a few seconds.
- Updates reuse unchanged asset files, so an update downloads only what
  changed. Phones on a build older than v31 are moved onto this one directly.

## v33 — a real Android app

- The Android app is now built with Capacitor and carries the whole game
  inside it, like Bike Rush and Operation Ninja. It never opens Chrome or
  the website: no Vercel address, no browser loading, no "Running in Chrome",
  no pop-ups. Landscape, full screen with the system bars hidden, screen kept
  awake. Built by a GitHub Actions workflow (.github/workflows/android-apk.yml).
- Updates inside the app: on launch and every 20 minutes it reads
  /app/update.json from the site; if a newer build exists it downloads
  /app/bundle-vNN.zip in the background with the same banner and progress,
  then UPDATE NOW switches to it on the spot (Capgo updater plugin, manual
  mode, no account or service).
- The website keeps its own service-worker updates as before.

## v34 — phone layout, aiming, unscope

- Menu fits a phone held sideways: smaller title, menu in two columns.
- The game's fonts (Oswald, JetBrains Mono, SIL OFL) are now inside the game.
  Phones and the offline app have neither Bahnschrift nor Google Fonts, so
  Android was falling back to a handwriting font.
- Touch controls rearranged like mobile shooters: movement stick on the left,
  aim by dragging anywhere on the right half, including dragging from the
  FIRE button while shooting. The v28 buttons had covered most of the old
  aiming area. SIDES mirrors everything.
- Scope button now simply toggles. While scoped a red X appears to unscope at
  once, and tapping the magnification readout steps the zoom.

## v35 — faster scoped aim, full-screen updates

- Scoped aiming on touch is about three times faster than before (it slowed
  to 28% of normal; now 58% times the new SCOPE SENSITIVITY, default 1.5).
  SCOPE SENSITIVITY in Settings tunes it from 0.5 to 4.0.
- Updates now take over the whole screen with a large percentage and a bar;
  the game pauses and nothing else can be touched until the download is
  complete, then it installs and restarts by itself.

## v36 — split screen, full-speed scope

- Touch screen split in two: the LEFT half aims (drag anywhere, including
  from FIRE and SCOPE in its bottom corner); the RIGHT half is the movement
  pad, with reload, frag, weapon, crouch and prone in one column on the right
  edge. BREATH only appears while scoped. SIDES mirrors it all.
- Scoped aim on touch no longer slows down at all, and touch aiming is about
  35% quicker overall. SCOPE SENSITIVITY still adjusts it (default 1.0).

## v37 — GAME display font

- Josiah's chosen display face, GAME by Giovanni Luca Mendola (SIL Open Font
  License 1.1), is built in for the title, menus, screen headings, the intro
  titles. Oswald stays for small text and numbers, where
  GAME's small digits are hard to read. Credited on the Credits screen.
