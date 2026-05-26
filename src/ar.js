import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';

// ── Module state ─────────────────────────────────────────────────────────────
let hitTestSource = null;
let hitTestSourceRequested = false;
let reticle = null;

// ── Support check ─────────────────────────────────────────────────────────────
/** Returns true if the browser supports immersive-ar WebXR sessions */
export async function isARSupported() {
  if (!navigator.xr) return false;
  try {
    return await navigator.xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
/**
 * Prepare the renderer for WebXR, add reticle and tap controller to the scene.
 * Returns the ARButton DOM element — caller must append it to the page.
 */
export function initAR(renderer, scene) {
  renderer.xr.enabled = true;

  // Reticle — cyan ring that tracks detected floor / table surface
  const ring = new THREE.RingGeometry(0.10, 0.16, 32).rotateX(-Math.PI / 2);
  reticle = new THREE.Mesh(
    ring,
    new THREE.MeshBasicMaterial({
      color: 0x00f5ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.80,
    })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // Outer glow pulse ring (slightly bigger, dimmer)
  const outerRing = new THREE.Mesh(
    new THREE.RingGeometry(0.16, 0.20, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: 0x00f5ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.30,
    })
  );
  outerRing.matrixAutoUpdate = false;
  scene.add(outerRing);

  // Keep outer ring in sync with reticle
  reticle.userData.outerRing = outerRing;

  // Tap controller — fires 'select' when user taps the screen in AR
  const controller = renderer.xr.getController(0);
  controller.addEventListener('select', () => _placeObject(scene));
  scene.add(controller);

  // Standard Three.js AR button
  const btn = ARButton.createButton(renderer, {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: document.getElementById('ui') },
  });
  btn.id = 'ar-enter-btn';

  return btn;
}

// ── Per-frame update ──────────────────────────────────────────────────────────
/**
 * Call this every frame from the animation loop.
 * Updates reticle position from the WebXR hit-test result.
 * @param {XRFrame|null} frame
 * @param {THREE.WebGLRenderer} renderer
 */
export function updateAR(frame, renderer) {
  if (!frame || !reticle) return;

  const referenceSpace = renderer.xr.getReferenceSpace();
  const session = renderer.xr.getSession();
  if (!session) return;

  // Request hit-test source once per session
  if (!hitTestSourceRequested) {
    session.requestReferenceSpace('viewer').then((viewerSpace) => {
      session.requestHitTestSource({ space: viewerSpace }).then((source) => {
        hitTestSource = source;
      });
    });
    session.addEventListener('end', () => {
      hitTestSourceRequested = false;
      hitTestSource = null;
    });
    hitTestSourceRequested = true;
  }

  // Move reticle to first hit-test result
  if (hitTestSource) {
    const results = frame.getHitTestResults(hitTestSource);
    const outerRing = reticle.userData.outerRing;

    if (results.length) {
      const matrix = results[0].getPose(referenceSpace).transform.matrix;
      reticle.visible = true;
      reticle.matrix.fromArray(matrix);
      if (outerRing) {
        outerRing.visible = true;
        outerRing.matrix.fromArray(matrix);
      }
    } else {
      reticle.visible = false;
      if (outerRing) outerRing.visible = false;
    }
  }
}

// ── Object placement ──────────────────────────────────────────────────────────
/**
 * Place a glowing holographic figure at the current reticle position.
 * Called automatically on screen tap while in AR session.
 */
function _placeObject(scene) {
  if (!reticle?.visible) return;

  const group = new THREE.Group();

  // Ground ring — emissive glow at floor level
  const floorRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.10, 0.012, 8, 32),
    new THREE.MeshStandardMaterial({
      color: 0x00f5ff,
      emissive: 0x00f5ff,
      emissiveIntensity: 3.5,
      transparent: true,
      opacity: 0.9,
    })
  );
  floorRing.rotation.x = -Math.PI / 2;
  group.add(floorRing);

  // Body capsule — central holographic figure
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.055, 0.24, 8, 16),
    new THREE.MeshStandardMaterial({
      color: 0xaaeeff,
      emissive: 0x00bbff,
      emissiveIntensity: 1.6,
      transparent: true,
      opacity: 0.88,
      metalness: 0.2,
      roughness: 0.1,
    })
  );
  body.position.y = 0.20;
  group.add(body);

  // Head sphere
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 16, 16),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x00f5ff,
      emissiveIntensity: 1.4,
      transparent: true,
      opacity: 0.95,
    })
  );
  head.position.y = 0.42;
  group.add(head);

  // Floating orb above head
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 12, 12),
    new THREE.MeshStandardMaterial({
      color: 0xbf00ff,
      emissive: 0xbf00ff,
      emissiveIntensity: 4,
      transparent: true,
      opacity: 0.95,
    })
  );
  orb.position.y = 0.60;
  group.add(orb);

  // Store references for animation
  group.userData.isARObject = true;
  group.userData.orbRef    = orb;
  group.userData.orbBaseY  = orb.position.y;
  group.userData.spawnTime = performance.now();

  // Place at reticle world position
  group.position.setFromMatrixPosition(reticle.matrix);

  scene.add(group);
}

// ── Animate placed objects ────────────────────────────────────────────────────
/**
 * Rotate and animate all placed AR objects.
 * Call from the render loop with the current timestamp.
 * @param {THREE.Scene} scene
 * @param {number} time - performance.now() equivalent from rAF
 */
export function animateARObjects(scene, time) {
  scene.traverse((obj) => {
    if (!obj.userData.isARObject) return;

    const t = time - obj.userData.spawnTime;

    // Slow rotation
    obj.rotation.y = t * 0.0007;

    // Floating orb
    const orb = obj.userData.orbRef;
    if (orb) {
      orb.position.y = obj.userData.orbBaseY + Math.sin(t * 0.0022) * 0.035;
    }
  });
}
