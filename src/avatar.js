import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// VRM avatar — Alicia Solid via jsDelivr CDN (stable, free, MIT)
// jsDelivr mirrors the pixiv/three-vrm GitHub repo reliably
const VRM_URL = 'https://cdn.jsdelivr.net/gh/pixiv/three-vrm/packages/three-vrm/examples/models/VRM1_Alicia_Solid.vrm';

let vrm = null;
let idleTime = 0;
let lastTimestamp = 0;

/**
 * Load and add VRM avatar to the scene.
 */
export async function loadAvatar(scene, { onProgress, onLoaded, onError } = {}) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  return new Promise((resolve, reject) => {
    loader.load(
      VRM_URL,
      (gltf) => {
        vrm = gltf.userData.vrm;

        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);

        // rotateVRM0 only affects VRM 0.x models — safe to call for both versions
        VRMUtils.rotateVRM0(vrm);

        scene.add(vrm.scene);
        _positionAvatar();

        onLoaded?.();
        resolve(vrm);
      },
      (progress) => {
        if (progress.lengthComputable) {
          const pct = Math.round((progress.loaded / progress.total) * 100);
          onProgress?.(`${pct}%`);
        } else {
          const kb = Math.round(progress.loaded / 1024);
          onProgress?.(`${kb} KB`);
        }
      },
      (error) => {
        console.error('Avatar load error:', error);
        onError?.(error);
        reject(error);
      }
    );
  });
}

/** Scale and center the avatar in the viewport */
function _positionAvatar() {
  if (!vrm) return;

  // Measure bounding box
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // Target: avatar fills ~60% of viewport height
  // Camera is at z=3.5 with FOV=35, so visible height at z=0 ≈ 2*tan(17.5°)*3.5 ≈ 2.2 units
  const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(17.5)) * 3.5;
  const targetHeight = visibleHeight * 0.65;
  const scale = targetHeight / size.y;

  vrm.scene.scale.setScalar(scale);

  // Center horizontally, position vertically so feet are near bottom quarter
  vrm.scene.position.set(
    -center.x * scale,
    -center.y * scale - visibleHeight * 0.18,
    0
  );
}

/**
 * Called every animation frame — drives idle float, head sway, blinking.
 * @param {number} timestamp — from requestAnimationFrame
 */
export function updateAvatar(timestamp) {
  if (!vrm) return;

  // Universal delta calculation — no THREE.Timer dependency
  const delta = lastTimestamp ? Math.min((timestamp - lastTimestamp) / 1000, 0.1) : 0;
  lastTimestamp = timestamp;
  idleTime += delta;

  // Gentle floating
  vrm.scene.position.y += Math.sin(idleTime * 1.1) * 0.0002;

  if (vrm.humanoid) {
    // Slow head look-around
    const head = vrm.humanoid.getNormalizedBoneNode('head');
    if (head) {
      head.rotation.y = Math.sin(idleTime * 0.35) * 0.1;
      head.rotation.x = Math.sin(idleTime * 0.28) * 0.04;
    }

    // Subtle spine sway
    const spine = vrm.humanoid.getNormalizedBoneNode('spine');
    if (spine) {
      spine.rotation.z = Math.sin(idleTime * 0.5) * 0.02;
    }
  }

  // Blink every ~4 seconds
  if (vrm.expressionManager) {
    const blinkCycle = idleTime % 4;
    if (blinkCycle > 3.85) {
      const t = (blinkCycle - 3.85) / 0.15;
      const blink = t < 0.5 ? t * 2 : (1 - t) * 2;
      vrm.expressionManager.setValue('blink', blink);
    } else {
      vrm.expressionManager.setValue('blink', 0);
    }
    vrm.expressionManager.update();
  }

  vrm.update(delta);
}

/** Play a named expression (happy, sad, angry, relaxed…) */
export function playExpression(name, weight = 1, duration = 800) {
  if (!vrm?.expressionManager) return;
  vrm.expressionManager.setValue(name, weight);
  vrm.expressionManager.update();
  setTimeout(() => {
    vrm.expressionManager.setValue(name, 0);
    vrm.expressionManager.update();
  }, duration);
}

export function isAvatarLoaded() {
  return vrm !== null;
}

/**
 * Place the avatar at an absolute world position (used in XR8 SLAM mode).
 * The avatar stands upright at the given floor position.
 * @param {THREE.Vector3} worldPos - position returned by XR8 hit test
 */
export function placeAvatarAtWorld(worldPos) {
  if (!vrm) return;
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const height = box.max.y - box.min.y;
  vrm.scene.position.set(worldPos.x, worldPos.y, worldPos.z);
  // Correct for the fact that avatar origin may not be at feet
  vrm.scene.position.y -= box.min.y * vrm.scene.scale.y;
  vrm.scene.scale.setScalar(0.8); // reasonable real-world scale ~1.5m tall
  vrm.scene.rotation.y = 0;
}
