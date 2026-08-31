# Attribution

## Fonts

- **Baloo 2** (`public/fonts/`) by Ek Type — SIL Open Font License 1.1.
  Used for the HUD and menu text.

This project is a personal, non-distributed TypeScript/Three.js rebuild of
Marble Blast Gold, ported from and behaviorally referenced against
**MBHaxe** by [RandomityGuy](https://github.com/RandomityGuy):

- MBHaxe — https://github.com/RandomityGuy/MBHaxe (MIT License)
  - The physics simulation, collision handling, Torque format parsers
    (.dif / .dts / .mis), and gameplay constants in this codebase are
    derived from MBHaxe's source (primarily the `mbg` branch).
- MBHaxe itself draws on the **OpenMBU** project and the wider Marble Blast
  community's reverse-engineering work on the Torque Game Engine formats.

## Assets

Marble Blast Gold game assets and levels (interiors, missions, shapes,
textures, sounds, music, UI art) are copyrighted content of their original
rights holders. They are **not** included in this repository and are never
bundled into builds. The code loads them at runtime from a local,
gitignored `./mbg-data/` directory. This project is for personal use only:
no public deployments, no distribution of builds containing these assets or
the Marble Blast name.
