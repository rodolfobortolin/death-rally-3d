/** Visual theme of a circuit: decides the road surface, barriers, lighting and scenery. */
export type TrackTheme = 'yard' | 'quarry' | 'warehouse';

/**
 * A layout piece. `['S', length]` is a straight; `['A', degrees, radius]` is an arc,
 * positive degrees turning right (clockwise on the minimap).
 */
export type PathSegment = ['S', number] | ['A', number, number];

export interface TrackDefinition {
  id: string;
  name: string;
  /** One line shown under the track name in the menu. */
  subtitle: string;
  theme: TrackTheme;
  /** Either explicit Catmull-Rom control points... */
  controlPoints?: Array<[number, number]>;
  /** ...or a path of straights and arcs, starting at the origin heading +X. */
  path?: PathSegment[];
  roadHalfWidth: number;
  curbWidth: number;
  /** Distance from the centerline to the barrier face. */
  wallOffset: number;
}

/** The first circuit: an industrial loop with a chicane and a long back straight. */
const RUST_YARD: TrackDefinition = {
  id: 'rust-yard',
  name: 'Rust Yard',
  subtitle: 'Flowing industrial loop with a long back straight',
  theme: 'yard',
  controlPoints: [
    [0, -120], [60, -125], [110, -100], [125, -50], [100, -10], [50, 0],
    [30, 30], [60, 70], [120, 80], [140, 130], [100, 170], [20, 160],
    [-40, 175], [-100, 150], [-120, 90], [-80, 50], [-110, 0], [-120, -60], [-80, -110],
  ],
  roadHalfWidth: 7,
  curbWidth: 1.2,
  wallOffset: 10.5,
};

/*
 * The tracks below recreate the layouts of the original Death Rally (1996) circuits.
 * Scenery is a placeholder per theme for now.
 */

const HELL_MOUNTAIN: TrackDefinition = {
  id: 'hell-mountain',
  name: 'Hell Mountain',
  subtitle: 'Tight and rocky, few places to overtake',
  theme: 'quarry',
  controlPoints: [
    [-6.5, 116.8], [-51.6, 107.4], [-83.0, 81.1], [-97.5, 43.5], [-91.9, 15.3], [-74.9, -7.3], [-89.4, -33.6], [-101.7, -64.9],
    [-84.2, -89.4], [-48.2, -93.7], [-19.5, -80.0], [4.9, -66.2], [32.9, -85.0], [75.9, -93.1], [100.8, -72.4], [92.5, -41.1],
    [71.3, -12.9], [85.8, 15.3], [95.7, 46.6], [87.0, 84.2], [67.6, 109.2], [33.3, 119.3],
  ],
  roadHalfWidth: 5.5,
  curbWidth: 0.8,
  wallOffset: 8,
};

const SUBURBIA: TrackDefinition = {
  id: 'suburbia',
  name: 'Suburbia',
  subtitle: 'Long and wide, room to hang back',
  theme: 'yard',
  path: [
    ['S', 70], ['A', -80, 20], ['S', 25], ['A', 80, 20], ['S', 50], ['A', 80, 20], ['S', 25], ['A', -80, 20], ['S', 50],
    ['A', -90, 25], ['S', 20], ['A', 60, 18], ['A', -60, 18], ['S', 10], ['A', -90, 22], ['S', 110], ['A', 40, 30],
    ['A', -40, 30], ['S', 110], ['A', -45, 25], ['S', 30], ['A', 45, 20], ['S', 10], ['A', -90, 18], ['S', 49.823],
    ['A', -90, 20], ['S', 41.128],
  ],
  roadHalfWidth: 7,
  curbWidth: 1.2,
  wallOffset: 10.5,
};

const TOXIC_DUMP: TrackDefinition = {
  id: 'toxic-dump',
  name: 'Toxic Dump',
  subtitle: 'Walled chicanes between the pipelines',
  theme: 'quarry',
  path: [
    ['S', 60], ['A', 90, 15], ['S', 20], ['A', 90, 15], ['S', 40], ['A', -90, 15], ['S', 10], ['A', -90, 15], ['S', 80],
    ['A', -90, 15], ['S', 130], ['A', -90, 15], ['S', 40], ['A', -90, 15], ['S', 5], ['A', 90, 15], ['S', 30], ['A', 90, 15],
    ['S', 5], ['A', -90, 15], ['S', 40], ['A', -90, 15], ['S', 39.989], ['A', -90, 15], ['S', 70.011],
  ],
  roadHalfWidth: 6,
  curbWidth: 0.9,
  wallOffset: 9,
};

const OASIS: TrackDefinition = {
  id: 'oasis',
  name: 'Oasis',
  subtitle: 'The tightest of all, rocks everywhere',
  theme: 'quarry',
  controlPoints: [
    [-13.9, -69.9], [16.2, -57.6], [46.7, -65.6], [82.2, -61.3], [98.3, -39.2], [90.1, -16.4], [102.1, 10.0], [114.8, 41.9],
    [104.8, 69.5], [80.8, 81.8], [52.8, 65.2], [32.3, 37.0], [9.1, 12.4], [-22.0, 8.1], [-46.6, 22.2], [-65.5, 40.7],
    [-92.7, 46.8], [-120.2, 31.5], [-131.9, 8.1], [-121.1, -16.4], [-94.1, -31.8], [-72.6, -49.0], [-50.2, -67.4],
  ],
  roadHalfWidth: 5.5,
  curbWidth: 0.8,
  wallOffset: 8,
};

const DOWNTOWN: TrackDefinition = {
  id: 'downtown',
  name: 'Downtown',
  subtitle: 'Fast straights, tight hairpins',
  theme: 'warehouse',
  path: [
    ['S', 60], ['A', 90, 20], ['S', 49], ['A', 90, 20], ['S', 275], ['A', 90, 18], ['S', 10], ['A', 45, 20], ['S', 25],
    ['A', -90, 20], ['S', 25], ['A', 45, 20], ['S', 22.08], ['A', 90, 20], ['S', 295], ['A', 90, 18], ['S', 2], ['A', 90, 18],
    ['S', 150], ['A', -180, 17.5], ['S', 68],
  ],
  roadHalfWidth: 6,
  curbWidth: 0.8,
  wallOffset: 9,
};

const UTOPIA: TrackDefinition = {
  id: 'utopia',
  name: 'Utopia',
  subtitle: 'Full of corners, two blind 180s',
  theme: 'yard',
  path: [
    ['S', 50], ['A', 90, 15], ['S', 20], ['A', 90, 15], ['S', 25], ['A', -180, 15], ['S', 25], ['A', 90, 15], ['S', 20],
    ['A', 90, 15], ['S', 30], ['A', -90, 15], ['S', 5], ['A', 90, 15], ['S', 50], ['A', 90, 15], ['S', 5], ['A', -90, 15],
    ['S', 10], ['A', 90, 15], ['S', 5], ['A', 90, 15], ['S', 25], ['A', -180, 15], ['S', 25], ['A', 90, 15], ['S', 35],
    ['A', 90, 15], ['S', 100.011],
  ],
  roadHalfWidth: 6,
  curbWidth: 1.0,
  wallOffset: 9,
};

const COMPLEX: TrackDefinition = {
  id: 'complex',
  name: 'Complex',
  subtitle: 'City blocks and chicanes, brutal crossfire',
  theme: 'warehouse',
  path: [
    ['S', 40], ['A', -90, 15], ['S', 80], ['A', -90, 15], ['S', 10], ['A', -90, 15], ['S', 40], ['A', 90, 15], ['S', 5],
    ['A', 90, 15], ['S', 40], ['A', -90, 15], ['S', 5], ['A', -90, 15], ['S', 20], ['A', 90, 15], ['S', 5], ['A', 90, 15],
    ['S', 10], ['A', -90, 15], ['S', 10], ['A', -90, 15], ['S', 40], ['A', -90, 15], ['S', 15], ['A', 90, 15],
    ['A', -90, 15], ['S', 70.016],
  ],
  roadHalfWidth: 6,
  curbWidth: 0.8,
  wallOffset: 9,
};

export const TRACKS: TrackDefinition[] = [RUST_YARD, HELL_MOUNTAIN, SUBURBIA, TOXIC_DUMP, OASIS, DOWNTOWN, UTOPIA, COMPLEX];
export const DEFAULT_TRACK_ID = RUST_YARD.id;

export function trackById(id: string): TrackDefinition {
  return TRACKS.find((t) => t.id === id) ?? RUST_YARD;
}

/** Walks a path of straights and arcs and returns points spaced about `spacing` meters apart. */
export function pathToPoints(path: PathSegment[], spacing = 3): Array<[number, number]> {
  let x = 0;
  let z = 0;
  let heading = 0;
  const pts: Array<[number, number]> = [[x, z]];
  for (const seg of path) {
    if (seg[0] === 'S') {
      const n = Math.max(1, Math.round(seg[1] / spacing));
      for (let i = 0; i < n; i++) {
        x += (Math.cos(heading) * seg[1]) / n;
        z += (Math.sin(heading) * seg[1]) / n;
        pts.push([x, z]);
      }
    } else {
      const angle = (seg[1] * Math.PI) / 180;
      const radius = seg[2];
      const n = Math.max(2, Math.round((Math.abs(angle) * radius) / spacing));
      // Rotate around the arc center so the points sit exactly on the circle.
      const side = Math.sign(angle);
      const cx = x - Math.sin(heading) * radius * side;
      const cz = z + Math.cos(heading) * radius * side;
      const start = Math.atan2(z - cz, x - cx);
      for (let i = 1; i <= n; i++) {
        const a = start + (angle * i) / n;
        pts.push([cx + Math.cos(a) * radius, cz + Math.sin(a) * radius]);
      }
      heading += angle;
      x = pts[pts.length - 1][0];
      z = pts[pts.length - 1][1];
    }
  }
  // The loop closes on the first point; drop the duplicate.
  const [lx, lz] = pts[pts.length - 1];
  if (Math.hypot(lx - pts[0][0], lz - pts[0][1]) < spacing * 0.5) pts.pop();
  return pts;
}
