# MBG Rebuild

Personal, non-distributed rebuild of Marble Blast Gold in TypeScript +
Three.js + Vite, ported from the MIT-licensed
[MBHaxe](https://github.com/RandomityGuy/MBHaxe) recreation (see
[ATTRIBUTION.md](ATTRIBUTION.md)). Code only — game assets live in the
gitignored `./mbg-data/` folder and are never committed or bundled.

## Layout

- `reference/` (gitignored) — MBHaxe clone, `mbg` branch, built for web.
  The behavioral spec and A/B reference. Serve on port 8371.
- `mbg-data/` (gitignored) — MBG game data (interiors, missions, shapes,
  textures, sounds), copied from `reference/data/`. Loaded at runtime.
- `src/` — the rewrite.
  - `torque/` — parsers for Torque formats (.dif so far)
  - `assets/` — runtime asset index over `mbg-data/filesystem.manifest`
  - `render/` — Three.js mesh building from parsed formats

## Running

- Rewrite: `npm run dev` (port 8372). Pick an interior with
  `?dif=data/interiors/beginner/<name>.dif`.
- Reference: `npx http-server reference -p 8371 -c-1` — the playable
  MBHaxe web build.

Rebuild the reference after pulling changes: in `reference/`,
`haxelib newrepo` deps are already installed; run `haxe compile-js.hxml`.

## Status

- [x] Phase 0: reference MBHaxe web build playable locally
- [x] Slice 1 (partial): .dif parser + interior rendering with textures
- [x] Slice 2: marble physics port (Marble.hx force model + contact solver +
      continuous collision), chase camera, WASD/mouse/jump controls
- [x] Tier 1 graphics: shadows, ACES tone mapping, bloom, SSAO, SMAA
      (toggle with G; `?gfx=classic` for the faithful look)
- [x] .mis mission parser (interiors, pads, items, triggers, sun, marble
      attributes) — levels load by mission: `?mis=data/missions/beginner/<name>.mis`
- [x] .dts shape rendering (v19-24): pads, signs, gems (random color skins),
      powerup items; "col" meshes feed the collision world
- [x] Gameplay loop: Ready/Set/Go, gameplay clock + time bonuses, gem
      collection + all-gems finish rule, end-pad finish detection,
      InBounds/OutOfBounds/Help triggers, OOB auto-respawn, HUD from the
      original UI sprites, SuperJump/SuperSpeed/TimeTravel effects
- [ ] Audio (rolling, bounce, pickup, music)
- [ ] Remaining powerup effects (ShockAbsorber/SuperBounce/Helicopter states),
      bumpers, fans, trapdoors, tornado
- [ ] Pathed interiors (moving platforms), .dts marble model + skies
- [ ] Menus/level select in the rewrite

## Coordinate-system note

The rewrite uses raw Torque coordinates (right-handed, Z-up) — verified
against the original game's level previews. MBHaxe negates X everywhere to
compensate for Heaps' left-handed projection; Three.js is right-handed, so
we don't. The physics core ports sign-identically (it's chirality-agnostic);
only `getMarbleAxis` and the camera math carry the mirror conjugation
(negated yaw/pitch, swapped cross-product order).
