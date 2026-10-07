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
/**
 * Levels per part. Each level adds one point (engine: speed and acceleration), so a
 * fully upgraded car gains 8 rating points: a little more than the next tier has stock,
 * and never enough to catch a car two tiers up.
 */
export const MAX_UPGRADE_LEVEL = 2;
export const MAX_RATING = 10;
export const FULL_UPGRADES: CarUpgrades = { engine: MAX_UPGRADE_LEVEL, tires: MAX_UPGRADE_LEVEL, armor: MAX_UPGRADE_LEVEL };

export interface CarDef {
  id: string;
  name: string;
  tagline: string;
  bodyType: CarBodyType;
  color: number;
  /** 1 = starter ... 6 = end-game supercar. Stock rating total rises 6 points per tier. */
  tier: number;
  /** Shop price for the campaign, as in the original game. */
  price: number;
  stats: CarStats;
}

/** The lineup of the original Death Rally, in its showroom colors. */
export const CARS: CarDef[] = [
  {
    id: 'vagabond',
    name: 'Vagabond',
    tagline: 'Tired old bug. Dirt cheap and easy to throw around, but slow and it folds under fire.',
    bodyType: 'vagabond',
    color: 0x5a2bc8,
    tier: 1,
    price: 500,
    stats: { speed: 1, acceleration: 2, handling: 4, armor: 1 },
  },
  {
    id: 'dervish',
    name: 'Dervish',
    tagline: 'Pickup with a bull bar. A real step up in pace, and it can take a few hits.',
    bodyType: 'dervish',
    color: 0xd9a514,
    tier: 2,
    price: 2500,
    stats: { speed: 3, acceleration: 4, handling: 3, armor: 4 },
  },
  {
    id: 'sentinel',
    name: 'Sentinel',
    tagline: 'Solid four-door sedan. No weak spots, and tough for its class.',
    bodyType: 'sentinel',
    color: 0xc81e1e,
    tier: 3,
    price: 6500,
    stats: { speed: 4, acceleration: 5, handling: 5, armor: 6 },
  },
  {
    id: 'shrieker',
    name: 'Shrieker',
    tagline: 'Muscle coupe. Loud, quick off the line and happy to trade paint.',
    bodyType: 'shrieker',
    color: 0x1c62c8,
    tier: 4,
    price: 11500,
    stats: { speed: 6, acceleration: 7, handling: 6, armor: 7 },
  },
  {
    id: 'wraith',
    name: 'Wraith',
    tagline: 'Rear-engined sports car. Razor-sharp handling and serious speed.',
    bodyType: 'wraith',
    color: 0xd41616,
    tier: 5,
    price: 25000,
    stats: { speed: 8, acceleration: 8, handling: 9, armor: 7 },
  },
  {
    id: 'deliverator',
    name: 'Deliverator',
    tagline: 'The ultimate machine. Fastest, toughest and built for the title.',
    bodyType: 'deliverator',
    color: 0x58c81e,
    tier: 6,
    price: 45000,
    stats: { speed: 10, acceleration: 10, handling: 9, armor: 9 },
  },
];

export const DEFAULT_CAR_ID = 'vagabond';
export const TIER_NAMES = ['', 'STARTER', 'ROOKIE', 'CONTENDER', 'VETERAN', 'ELITE', 'SUPERCAR'];

export function carById(id: string): CarDef {
  return CARS.find((c) => c.id === id) ?? CARS.find((c) => c.id === DEFAULT_CAR_ID)!;
}

/** Ratings after upgrades, clamped to the scale. */
export function effectiveStats(def: CarDef, upgrades: CarUpgrades = STOCK_UPGRADES): CarStats {
  const cap = (v: number) => Math.min(MAX_RATING, v);
  const level = (v: number) => Math.max(0, Math.min(MAX_UPGRADE_LEVEL, Math.floor(v)));
  const engine = level(upgrades.engine);
  return {
    speed: cap(def.stats.speed + engine),
    acceleration: cap(def.stats.acceleration + engine),
    handling: cap(def.stats.handling + level(upgrades.tires)),
    armor: cap(def.stats.armor + level(upgrades.armor)),
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
      handbrakeGrip: 1.0 + s.handling * 0.1,
    },
    maxHealth: Math.round(60 + s.armor * 10),
  };
}
