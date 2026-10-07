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
 * fully upgraded car gains 8 rating points: about what the next tier has stock, and
 * never enough to catch a car two tiers up.
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
  stripe: number;
  number: number;
  /** 1 = starter ... 4 = end-game supercar. Stock rating total rises about 7 points per tier. */
  tier: number;
  /** Shop price for the campaign. */
  price: number;
  stats: CarStats;
}

export const CARS: CarDef[] = [
  {
    id: 'vagabond',
    name: 'Vagabond',
    tagline: 'Rusty dune buggy. Cheap, light and nimble, but slow and it falls apart fast.',
    bodyType: 'buggy',
    color: 0xc8201a,
    stripe: 0xf2f2f2,
    number: 1,
    tier: 1,
    price: 0,
    stats: { speed: 2, acceleration: 4, handling: 5, armor: 2 },
  },
  {
    id: 'dervish',
    name: 'Dervish',
    tagline: 'Street muscle car. No weak spots, no real strengths either.',
    bodyType: 'muscle',
    color: 0x1c1c1e,
    stripe: 0xd8241a,
    number: 1,
    tier: 2,
    price: 15000,
    stats: { speed: 5, acceleration: 5, handling: 5, armor: 5 },
  },
  {
    id: 'sentinel',
    name: 'Sentinel',
    tagline: 'Armored pickup. Heavy and quick enough, and it shrugs off bullets and mines.',
    bodyType: 'pickup',
    color: 0x6f757c,
    stripe: 0xf0b020,
    number: 1,
    tier: 3,
    price: 40000,
    stats: { speed: 6, acceleration: 5, handling: 6, armor: 9 },
  },
  {
    id: 'shrieker',
    name: 'Shrieker',
    tagline: 'The supercar. Brutal speed and grip with real armor. Built for the title.',
    bodyType: 'muscle',
    color: 0xd62870,
    stripe: 0x111111,
    number: 1,
    tier: 4,
    price: 90000,
    stats: { speed: 9, acceleration: 9, handling: 8, armor: 7 },
  },
];

export const DEFAULT_CAR_ID = 'vagabond';
export const TIER_NAMES = ['', 'STARTER', 'CONTENDER', 'VETERAN', 'SUPERCAR'];

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
      handbrakeGrip: 1.6 + s.handling * 0.1,
    },
    maxHealth: Math.round(60 + s.armor * 10),
  };
}
