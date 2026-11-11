# SNIPER RAGE

A browser-based 3D tactical sniper game. Three.js, one page, no build step
needed to play it: open `sniper-rage.html` and it runs.

Five sectors, endless waves, four enemy archetypes, five weapons, frag
grenades, missions, saved runs, and full offline play once installed.

Built by Sommyart Imagery.

---

## Play it

| | |
|---|---|
| **Hosted** | see the deployment section below |
| **One file** | download `sniper-rage.html` and open it in any browser |
| **Offline** | open the hosted link once, then install from the menu |

The hosted copy and the downloadable file are the same game. The hosted copy
adds a manifest and a service worker, which is what lets it install to a home
screen and run with the network off.

---

## Controls

### Keyboard and mouse
| Action | Key |
|---|---|
| Move | `W` `A` `S` `D` |
| Look | mouse |
| Fire | left mouse |
| Scope | right mouse |
| Magnification | mouse wheel while scoped |
| Hold breath | `Shift` |
| Reload | `R` |
| Switch weapon | `1`–`5` or `Q` |
| **Frag grenade** | **hold `G`, release to throw** |
| Pause | `Esc` |

### Touch
Movement is a joystick under the **right** thumb. Aiming is a drag anywhere on
the **left** side of the screen. Both can be mirrored in Settings under SIDES,
because handedness is personal.

The pads are FIRE, SCOPE, BREATH, RELOAD, WEAPON and **FRAG**. Hold FRAG and
lift your thumb to throw.

---

## Frag grenades

Hold to aim. Power charges over 0.85 seconds and maps onto a throw of roughly
14 to 50 metres from the firing deck. Release to throw.

The arc drawn on screen is the arc the grenade flies. The preview runs the same
fixed-timestep integrator against the same collision set as the live
projectile, so the two cannot disagree.

| | |
|---|---|
| Fuse | 2.6s |
| Radius | 7.6m |
| Damage at centre | 260, falling to nothing at the edge |
| Through cover | **half damage** |
| Self-damage | inside 5.4m |
| Carried | 3 at start, 5 maximum, topped up on a cleared wave |

Half damage through cover is the whole point of the weapon. A hostile wedged
into a floor slab where no bullet can reach him is reachable with a grenade,
and cover is still worth taking.

---

## Saved runs

The run is saved automatically on every wave change, on pause, when the tab is
hidden, and on `pagehide`. Closing the tab or losing the browser does not cost
progress.

**CONTINUE** appears on the main menu whenever a saved run exists, labelled
with the wave, score and health. The pause menu also has SAVE AND QUIT.

The snapshot holds wave, score, credits, health, grenades, weapon, sector and
mission progress, under the `localStorage` key `sniper_rage_run_v1`. If the
browser refuses local storage the game says so rather than failing quietly.

---

## Repository layout

```
sniper-rage.html      the game: source of truth, three.js from a CDN
assets/               the four environment models, fetched at run time
build/package.js      packager: inlines three.js, writes public/
build/vendor/         three.js r128, vendored for the offline build
build/verify.js       22-check browser verification of the game
docs/                 asset notes and the APK routes
vercel.json           build and cache headers for the hosted deploy
public/               BUILD OUTPUT, not committed
```

One copy of every binary. `public/` is derived and gitignored.

### Building the hosted site

```bash
node build/package.js
```

Writes `public/`: `index.html` with a manifest linked, a standalone
`sniper-rage.html`, the icons, a service worker stamped with the build, and
`assets/`. Three.js is inlined, so the built page has no external dependency
at all. The soundtrack and the character and weapon models are already base64
inside the page.

The packager refuses to build if the page fetches a model it does not ship.

### Verifying it

```bash
cd build && npm install jsdom playwright && node verify.js
```

Drives the packaged site in a real browser with software WebGL and asserts 22
checks across grenades, wave 2 visibility and saved runs. The software renderer
manages about 2 fps, so the harness steps the simulation by fixed timesteps
rather than waiting on the wall clock.

---

## Offline and installing

Open the hosted link once and the service worker precaches the page and all
four environment models. After that it plays with the network off.

To install: **05 INSTALL APP** in the menu, or the browser's own Add to Home
Screen. `docs/BUILD-APK.md` covers turning it into an Android APK.

---

## Known gaps

These are real and worth stating plainly.

- **The rifle's moving parts are unbound.** The sci-fi rifle exports generic
  node names (`Cylinder.004_0`, `Cube.006_2`), so the bolt, magazine and
  trigger bindings fail. The weapon fires correctly but does not animate.
- **Enemies are auto-rigged.** The army character model ships no skeleton and
  no animation clips, so enemies run through the auto-rigger. Movement is
  stiffer than a supplied rig would give.
- **The headless test suites are gone.** Ten suites covering line of sight,
  stability over 36000 frames, input schemes and sector teardown were lost in a
  container reset. `build/verify.js` covers the v21 features only. Rebuilding
  the rest is worth doing before the multiplayer work starts.
- **Asset licences are uncleared.** The models came from Sketchfab and this
  repository is public, which counts as distribution. Check each model's
  licence before treating this as shippable.

## Multiplayer

Not built. `MULTIPLAYER-PLAN.md` holds the sequencing and the two decisions
that block starting: whether the single-file architecture survives, and where
rigged, animated characters come from.

## Licence

Code by Sommyart Imagery. Third-party models are under their own licences,
which are not yet cleared. See the note above.
