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
| Space | Handbrake: tap with steering to throw the car into a drift; hold the throttle to power-slide out, countersteer to straighten |
| J / Z | Machine gun |
| K / X | Drop mine |
| Shift / L | Turbo |
| R | Reset car to the track |
| C | Toggle camera (classic north-up / rotating chase) |
| F | Show / hide the FPS counter |
| Esc / P | Pause |

## Gameplay

- Race against up to 7 AI rivals over 1 to 8 laps, on easy, normal or hard.
- Pick your car in the menu. Cars come in tiers, from the **Vagabond** starter buggy (tier 1) through the **Dervish** muscle car and the armored **Sentinel** pickup up to the **Shrieker** supercar (tier 4). Each has top speed, acceleration, handling and armor ratings (`src/car/CarCatalog.ts`). Engine, tire and armor upgrades add at most 8 rating points, about one tier: a maxed car roughly matches the next tier stock and never catches a car two tiers up. Rivals race in the same class as your car.
- Every car has armor, a hood-mounted machine gun, mines and a turbo tank.
- Wrecked cars explode, damage anything nearby and are out of the race, left burning on the track as obstacles; whoever caused it gets the kill. If you get wrecked, the race is over for you. Turn on RESPAWN in the menu to bring wrecks back after a few seconds instead.
- Floating crates on the track refill **repair** (green), **ammo** (yellow), **turbo** (blue) and **mines** (red).
- Weapons stay locked for the first 4 seconds after the start.

## Project structure

```
src/
  core/    Game loop and state machine, input, renderer (post-processing), camera
  car/     Car model, arcade physics and track interaction
  race/    Race flow (countdown, laps, standings, results), racers, pickups
  ai/      AI drivers: racing line, braking, overtaking, mine dodging, combat
  combat/  Machine gun (hitscan), mines, damage and wrecks
  world/   Track generation, environment (sky, lights, props), procedural textures
  fx/      Explosions, particles, skid marks, tracers
  audio/   Procedural sound effects (Web Audio, no files)
  ui/      Menus, HUD and minimap
```

## Using your own 3D models

Everything is generated procedurally for now. Models made in Blender can replace them later by exporting to **glTF (.glb)**, placing the file in `public/models/` and loading it with Three.js' `GLTFLoader`. Cars follow the convention in `src/car/CarModel.ts`: facing +Z, Y up, 1 unit = 1 meter, origin on the ground between the axles.

## Roadmap

1. ✅ Playable base: camera, car physics, track, lighting and effects
2. ✅ Real races: laps, standings and AI opponents, start menu
3. ✅ Combat: weapons, mines, turbo, damage, explosions and power-ups
4. Campaign: prize money, upgrade shop and championship
