# Adding assets to Sniper Rage (Level 2)

The engine work is done. This file is the contract for dropping models and
textures in. Nothing here is required for the game to run: with an empty
manifest every call falls back to the procedural geometry, so you can upgrade
one prop at a time and the game stays playable throughout.

## Where things go

Put files beside the page and set the base path once:

```js
ASSETS.base = "assets/";
```

Folder layout that the manifest below assumes:

```
index.html
assets/
  props/      barrel.glb, crate.glb, scaffold.glb, pipe.glb, block.glb ...
  chars/      hostile_a.glb, hostile_b.glb ...
  weapons/    ranger50.glb, falconx.glb, viper7.glb, titansr.glb, ragex.glb
  env/        golden_hour.hdr
  draco/      draco_decoder.js, draco_decoder.wasm   (only if models are Draco compressed)
```

## Declaring a prop

```js
ASSETS.models.barrel = {
  url: "props/barrel.glb",
  scale: 1,
  rotY: 0,
  lod: [ { url:"props/barrel_lod1.glb", at:35 } ],   // optional
  collide: "box"        // "box" (default) or "none"
};
```

Then, in a sector builder, the primitive becomes a fallback:

```js
Assets.place("barrel", x, y, z, () => barrel(x, y, z, "ground", MAT.rust));
```

If the model loaded, you get the model. If it did not, you get the barrel the
game already builds. Either way the sector still works and the firing-line
audit still passes.

## Declaring a character

Rigged, with named animation clips:

```js
ASSETS.characters.hostile_a = {
  url: "chars/hostile_a.glb",
  scale: 1,
  clips: {
    idle:  "Idle",
    walk:  "Walk",
    run:   "Run",
    aim:   "Aim",
    fire:  "Fire",
    hit:   "HitReact",
    death: "Death"
  }
};
```

`Assets.spawnCharacter("hostile_a")` returns `{ root, mixer, actions, play(slot) }`.
`play()` cross-fades between clips. The clone is skeleton aware, so several
enemies can share one loaded file without sharing a pose.

The existing `Enemy` class keeps its hitboxes, its cover AI and its state
machine. Wiring a character in means swapping what `build()` puts in `root`
and calling `play()` from the state transitions that already exist.

## Collision

Detailed meshes are bad raycast targets. `Assets.place` automatically adds a
hidden box proxy sized from the model's bounding box and registers that as the
shootable surface, so hit detection stays cheap however dense the art is. Pass
`collide:"none"` for decoration that should not stop a bullet.

## Repeated props

For anything placed many times, use one instanced draw call:

```js
Assets.instance(geometry, material, [
  {x:0,y:0,z:0}, {x:2,y:0,z:0,ry:0.5}, {x:4,y:0,z:0,scale:2}
]);
```

## Texture sets

PBR sets go in `ASSETS.textures` as `{ map, normalMap, roughnessMap, aoMap, metalnessMap }`
paths. Note that `aoMap` requires a second UV set on the geometry, so bake AO
into the roughness or supply `uv2` if you want it to show.

## Compression, since mobile is the constraint

- Prefer **KTX2 / Basis** textures over PNG. A 2K PNG is roughly 12MB in VRAM;
  the same image as KTX2 is under 2MB.
- Prefer **Draco** or **Meshopt** compressed geometry. Set `ASSETS.dracoPath`
  to the decoder folder and the loader picks it up automatically.
- Keep foreground props under about 20k triangles and characters under 30k.
- Two LOD steps is usually enough: full detail, then a half-density version
  past 35m.
- Budget: for the installable build I would keep the whole asset payload under
  about 60MB. Past that, first launch on a phone gets unpleasant.

## Licensing

Only use assets you own or that are genuinely CC0 or similarly licensed, and
keep a record of the source for each one. I will not reproduce assets from
existing games or films.

## Verifying

`Assets.report()` returns `{loader, models, characters, declared, failed}`.
If `failed` is above zero, those entries fell back to primitives and the paths
are wrong. The loading toast on the main menu shows the same count.
