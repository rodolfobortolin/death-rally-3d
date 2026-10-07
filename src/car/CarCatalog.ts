import type { CarBodyType } from './CarModel';
import { DEFAULT_CAR_SPEC, type CarSpec } from './CarPhysics';

/** Ratings on a 1..10 scale. Upgrades raise these; `buildCar` turns them into physics. */
export interface CarStats {
  speed: number;
  acceleration: number;
  handling: number;
  armor: number;
}

/** Shop upgrade levels per part (0 = stock). Each level adds to one or more ratings. */
export interface CarUpgrades {
  engine: number;
  tires: number;
  armor: number;
}

export const STOCK_UPGRADES: CarUpgrades = { engine: 0, tires: 0, armor: 0 };
export const MAX_UPGRADE_LEVEL = 3;
export const MAX_RATING = 10;

export interface CarDef {
  id: string;
  name: string;
  tagline: string;
  bodyType: CarBodyType;
  color: number;
  stripe: number;
  number: number;
  stats: CarStats;
}

export const CARS: CarDef[] = [
  {
    id: 'vagabond',
    name: 'Vagabond',
    tagline: 'Light dune buggy. Quick off the line and nimble, but it falls apart fast.',
    bodyType: 'buggy',
    color: 0xc8201a,
    stripe: 0xf2f2f2,
    number: 1,
    stats: { speed: 3, acceleration: 7, handling: 8, armor: 2 },
  },
  {
    id: 'dervish',
    name: 'Dervish',
    tagline: 'Street muscle car. No weak spots, no real strengths either.',
    bodyType: 'muscle',
    color: 0x1c1c1e,
    stripe: 0xd8241a,
    number: 1,
    stats: { speed: 5, acceleration: 5, handling: 5, armor: 5 },
  },
  {
    id: 'sentinel',
    name: 'Sentinel',
    tagline: 'Armored pickup. Slow to get going, but it shrugs off bullets and mines.',
    bodyType: 'pickup',
    color: 0x6f757c,
    stripe: 0xf0b020,
    number: 1,
    stats: { speed: 4, acceleration: 3, handling: 4, armor: 9 },
  },
  {
    id: 'shrieker',
    name: 'Shrieker',
    tagline: 'Tuned muscle car. Highest top speed, twitchy in the corners, thin skin.',
    bodyType: 'muscle',
    color: 0xd62870,
    stripe: 0x111111,
    number: 1,
    stats: { speed: 9, acceleration: 6, handling: 3, armor: 3 },
  },
];

export const DEFAULT_CAR_ID = 'dervish';

export function carById(id: string): CarDef {
  return CARS.find((c) => c.id === id) ?? CARS.find((c) => c.id === DEFAULT_CAR_ID)!;
}

/** Ratings after upgrades, clamped to the scale. */
export function effectiveStats(def: CarDef, upgrades: CarUpgrades = STOCK_UPGRADES): CarStats {
  const cap = (v: number) => Math.min(MAX_RATING, v);
  return {
    speed: cap(def.stats.speed + upgrades.engine),
    acceleration: cap(def.stats.acceleration + upgrades.engine),
    handling: cap(def.stats.handling + upgrades.tires),
    armor: cap(def.stats.armor + upgrades.armor * 1.5),
  };
}

export interface BuiltCar {
  spec: CarSpec;
  maxHealth: number;
}

/** Maps ratings to physics and armor. A rating of 4 gives the default spec. */
export function buildCar(def: CarDef, upgrades: CarUpgrades = STOCK_UPGRADES): BuiltCar {
  const s = effectiveStats(def, upgrades);
  return {
    spec: {
      ...DEFAULT_CAR_SPEC,
      maxSpeed: 36 + s.speed * 1.5,
      acceleration: 14 + s.acceleration * 1.5,
      steering: 2.1 + s.handling * 0.1,
      grip: 6.5 + s.handling * 0.5,
      handbrakeGrip: 1.6 + s.handling * 0.1,
    },
    maxHealth: Math.round(60 + s.armor * 10),
  };
}
