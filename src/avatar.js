import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// VRM avatar URL — free sample hosted on pixiv GitHub Pages
const VRM_URL = 'https://pixiv.github.io/three-vrm/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm';

let vrm = null;
const timer = new THREE.Timer();
let idleTime = 0;

/**
 * Load and add VRM avatar to the scene.
 * Calls onProgress(percent) during load, onLoaded() when done.
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

        // Face camera (VRM models face -Z by default)
        VRMUtils.rotateVRM0(vrm);

        scene.add(vrm.scene);
        _positionAvatar();

        onLoaded?.();
        resolve(vrm);
      },
      (progress) => {
        if (progress.lengthComputable) {
          const pct = Math.round((progress.loaded / progress.total) * 100);
          onProgress?.(pct);
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

/** Position & scale avatar to be centered and fill ~55% of viewport height */
function _positionAvatar() {
  if (!vrm) return;

  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = new THREE.Vector3();
  box.getSize(size);

  const targetHeight = window.innerHeight * 0.0014; // scale factor for perspective camera
  const scale = targetHeight / size.y;
  vrm.scene.scale.setScalar(scale);

  // Re-center after scaling
  const center = new THREE.Vector3();
  box.getCenter(center);
  vrm.scene.position.set(-center.x * scale, -center.y * scale + 0.05, 0);
}

/**
 * Called every animation frame.
 * @param {number} timestamp — passed from requestAnimationFrame
 */
export function updateAvatar(timestamp) {
  if (!vrm) return;

  timer.update(timestamp);
  const delta = timer.getDelta();
  idleTime += delta;

  // Gentle floating up/down
  vrm.scene.position.y += Math.sin(idleTime * 1.2) * 0.0003;

  // Subtle head look-around via VRM humanoid
  if (vrm.humanoid) {
    const head = vrm.humanoid.getNormalizedBoneNode('head');
    if (head) {
      head.rotation.y = Math.sin(idleTime * 0.4) * 0.12;
      head.rotation.x = Math.sin(idleTime * 0.3) * 0.04;
    }
  }

  // Blink via blendShapes every ~4 seconds
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

/** Play a named expression (for future emotion support). */
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
