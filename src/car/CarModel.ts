import * as THREE from 'three';

/**
 * Visual representation of a car. The default model is built procedurally, but
 * anything that fills this interface (e.g. a glTF made in Blender) can be used.
 * Convention: the car faces +Z, +Y is up, origin at ground level between the axles.
 */
export interface CarVisual {
  root: THREE.Group;
  /** Front wheels steer (rotation.y on the pivot) and spin (rotation.x on the wheel). */
  frontWheelPivots: THREE.Object3D[];
  wheels: THREE.Object3D[];
  wheelRadius: number;
  brakeLightMaterial: THREE.MeshStandardMaterial;
  /** Rear wheel contact points in local space, used for skid marks and smoke. */
  rearWheelOffsets: THREE.Vector3[];
}

export interface CarModelOptions {
  bodyColor: THREE.ColorRepresentation;
  stripeColor?: THREE.ColorRepresentation;
}

const LENGTH = 4.4;
const WIDTH = 1.95;
const WHEEL_RADIUS = 0.4;
const WHEEL_WIDTH = 0.34;
const AXLE_Z = 1.38;

/** Extrudes a side profile (z, y) across the car width, centered on X. */
function extrudeProfile(points: Array<[number, number]>, width: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 8,
  });
  // Shape space (x, y, extrude) -> car space (z, y, x).
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createWheel(tireMat: THREE.Material, rimMat: THREE.Material): THREE.Group {
  const wheel = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 24), tireMat);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  wheel.add(tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_RADIUS * 0.62, WHEEL_RADIUS * 0.62, WHEEL_WIDTH + 0.02, 12), rimMat);
  rim.rotation.z = Math.PI / 2;
  wheel.add(rim);
  return wheel;
}

/** Builds the default muscle-car style model. */
export function createCarModel(options: CarModelOptions): CarVisual {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const paint = new THREE.MeshPhysicalMaterial({
    color: options.bodyColor,
    metalness: 0.3,
    roughness: 0.38,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  const darkTrim = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6, metalness: 0.3 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b0f14, metalness: 0.2, roughness: 0.05, clearcoat: 1 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.2 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 });

  const half = LENGTH / 2;
  // Lower body: wedge nose, flat deck, short tail.
  const lower = new THREE.Mesh(
    extrudeProfile(
      [
        [-half, 0.3], [half - 0.15, 0.3], [half, 0.42], [half - 0.05, 0.62],
        [half - 0.9, 0.86], [-half + 0.55, 0.92], [-half, 0.86], [-half - 0.05, 0.5],
      ],
      WIDTH,
      0.1,
    ),
    paint,
  );
  lower.castShadow = true;
  lower.receiveShadow = true;
  body.add(lower);

  // Greenhouse (glass) and a painted roof panel on top.
  const cabin = new THREE.Mesh(
    extrudeProfile([[-1.25, 0.86], [0.75, 0.86], [0.1, 1.4], [-0.95, 1.42]], WIDTH - 0.3, 0.06),
    glass,
  );
  cabin.castShadow = true;
  body.add(cabin);
  const roof = new THREE.Mesh(
    extrudeProfile([[-0.92, 1.38], [0.08, 1.38], [0.02, 1.47], [-0.88, 1.48]], WIDTH - 0.45, 0.04),
    paint,
  );
  roof.castShadow = true;
  body.add(roof);

  // Racing stripes over hood, roof and trunk.
  if (options.stripeColor !== undefined) {
    const stripeMat = new THREE.MeshPhysicalMaterial({ color: options.stripeColor, roughness: 0.35, clearcoat: 1 });
    const addStripe = (x: number, y: number, z: number, length: number, tilt: number) => {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, length), stripeMat);
      stripe.position.set(x, y, z);
      stripe.rotation.x = tilt;
      body.add(stripe);
    };
    for (const x of [-0.22, 0.22]) {
      addStripe(x, 0.975, 1.02, 0.56, 0); // hood, flat part
      addStripe(x, 0.85, 1.73, 0.9, 0.274); // hood, sloped nose
      addStripe(x, 1.53, -0.42, 0.9, 0); // roof
      addStripe(x, 1.0, -1.7, 0.9, -0.06); // trunk
    }
  }

  // Rear spoiler.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(WIDTH - 0.1, 0.06, 0.38), darkTrim);
  wing.position.set(0, 1.18, -half + 0.22);
  wing.castShadow = true;
  body.add(wing);
  for (const x of [-0.65, 0.65]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.16), darkTrim);
    strut.position.set(x, 1.02, -half + 0.25);
    body.add(strut);
  }

  // Bumpers, grille and exhausts.
  const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(WIDTH - 0.05, 0.18, 0.16), darkTrim);
  frontBumper.position.set(0, 0.38, half + 0.02);
  body.add(frontBumper);
  const rearBumper = frontBumper.clone();
  rearBumper.position.z = -half - 0.07;
  body.add(rearBumper);
  for (const x of [-0.45, 0.45]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 10), chrome);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(x, 0.36, -half - 0.12);
    body.add(pipe);
  }

  // Lights: emissive so they glow through the bloom pass.
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 3 });
  const brakeLightMaterial = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a0a, emissiveIntensity: 0.8 });
  for (const x of [-0.65, 0.65]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.06), headMat);
    head.position.set(x, 0.56, half + 0.07);
    head.rotation.x = -0.5;
    body.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.06), brakeLightMaterial);
    tail.position.set(x, 0.72, -half - 0.12);
    body.add(tail);
  }

  // Wheels.
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, metalness: 0.8, roughness: 0.35 });
  const wheels: THREE.Object3D[] = [];
  const frontWheelPivots: THREE.Object3D[] = [];
  const wheelX = WIDTH / 2 - WHEEL_WIDTH / 2 + 0.04;
  for (const z of [AXLE_Z, -AXLE_Z]) {
    for (const x of [-wheelX, wheelX]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, WHEEL_RADIUS, z);
      const wheel = createWheel(tireMat, rimMat);
      pivot.add(wheel);
      root.add(pivot);
      wheels.push(wheel);
      if (z > 0) frontWheelPivots.push(pivot);
    }
  }

  return {
    root,
    frontWheelPivots,
    wheels,
    wheelRadius: WHEEL_RADIUS,
    brakeLightMaterial,
    rearWheelOffsets: [new THREE.Vector3(-wheelX, 0, -AXLE_Z), new THREE.Vector3(wheelX, 0, -AXLE_Z)],
  };
}

export const CAR_DIMENSIONS = { length: LENGTH, width: WIDTH };
