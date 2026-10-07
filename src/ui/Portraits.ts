import * as THREE from 'three';


/**
 * Renders a small 3/4 view of a car into a data URL, using the main renderer.
 * The frame is drawn to the WebGL canvas and copied immediately, before the
 * browser presents it, so nothing flashes on screen.
 */
export function renderCarPortrait(
  renderer: THREE.WebGLRenderer,
  car: THREE.Object3D,
  environment: THREE.Texture | null,
  width = 240,
  height = 144,
): string {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15120f);
  scene.environment = environment;
  scene.environmentIntensity = 0.8;
  scene.add(new THREE.HemisphereLight(0xc8d8f0, 0x3a2a1a, 1.4));
  const sun = new THREE.DirectionalLight(0xffe0c0, 3);
  sun.position.set(4, 8, 6);
  scene.add(sun);

  const model = car.clone(true);
  model.position.set(0, 0, 0);
  model.rotation.set(0, Math.PI / 2 + 0.55, 0); // nose towards the right, 3/4 view
  model.visible = true;
  // Drop lights carried by the car (headlights) so the portrait lighting stays consistent.
  model.traverse((o) => {
    if ((o as THREE.Light).isLight) o.visible = false;
  });
  scene.add(model);

  const camera = new THREE.PerspectiveCamera(28, width / height, 0.1, 50);
  camera.position.set(1.3, 3.3, 7.0);
  camera.lookAt(0.1, 0.55, 0);

  const pr = renderer.getPixelRatio();
  const size = renderer.getSize(new THREE.Vector2());
  const prevTarget = renderer.getRenderTarget();
  const prevToneMapping = renderer.toneMapping;
  renderer.setRenderTarget(null);
  renderer.setViewport(0, 0, width, height);
  renderer.setScissor(0, 0, width, height);
  renderer.setScissorTest(true);
  renderer.render(scene, camera);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // The viewport sits at the bottom-left of the drawing buffer.
  const src = renderer.domElement;
  ctx.drawImage(src, 0, src.height - height * pr, width * pr, height * pr, 0, 0, canvas.width, canvas.height);

  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, size.x, size.y);
  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevToneMapping;
  return canvas.toDataURL('image/png');
}
