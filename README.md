# Death Rally 3D

A top-down 3D combat racing game inspired by the classic *Death Rally*, running in the browser with [Three.js](https://threejs.org/).

## Running locally

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Accelerate |
| S / ↓ | Brake / reverse |
| A D / ← → | Steer |
| Space | Handbrake (drift) |
| R | Reset car to the track |
| C | Toggle camera (classic north-up / rotating chase) |

## Project structure

```
src/
  core/    Game loop, input, renderer (post-processing), follow camera
  car/     Car model, arcade physics and track interaction
  world/   Track generation, environment (sky, lights, props), procedural textures
  fx/      Skid marks and particle systems (smoke, dust, sparks)
  ui/      HUD overlay
```

## Using your own 3D models

Everything is generated procedurally for now. Models made in Blender can replace them later by exporting to **glTF (.glb)**, placing the file in `public/models/` and loading it with Three.js' `GLTFLoader`. Cars follow the convention in `src/car/CarModel.ts`: facing +Z, Y up, 1 unit = 1 meter, origin on the ground between the axles.

## Roadmap

1. ✅ Playable base: camera, car physics, track, lighting and effects
2. Real races: laps, checkpoints and AI opponents
3. Combat: weapons, mines, turbo, damage and explosions
4. Campaign: prize money, upgrade shop and championship
