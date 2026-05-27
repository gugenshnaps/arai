import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const VRM_URL = `${import.meta.env.BASE_URL}models/AliciaSolid.vrm`;

let vrm = null;
let idleTime = 0;
let lastTimestamp = 0;
let baseY = 0;
let arPlaced = false;

/**
 * @param {'overlay'|'ar'} mode
 * overlay = camera background mode (big, centered on screen)
 * ar = world mode (hidden until user taps floor)
 */
export async function loadAvatar(scene, { onProgress, onLoaded, onError, mode = 'overlay' } = {}) {
  if (vrm) {
    if (vrm.scene.parent) vrm.scene.parent.remove(vrm.scene);
    scene.add(vrm.scene);
    mode === 'ar' ? _prepareForAR() : _positionOverlay();
    onLoaded?.();
    return vrm;
  }

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  return new Promise((resolve, reject) => {
    loader.load(
      VRM_URL,
      (gltf) => {
        vrm = gltf.userData.vrm;
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);
        VRMUtils.rotateVRM0(vrm);
        scene.add(vrm.scene);
        mode === 'ar' ? _prepareForAR() : _positionOverlay();
        onLoaded?.();
        resolve(vrm);
      },
      (progress) => {
        if (progress.lengthComputable) {
          onProgress?.(`${Math.round((progress.loaded / progress.total) * 100)}%`);
        } else {
          onProgress?.(`${Math.round(progress.loaded / 1024)} KB`);
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

/** Normal mode: avatar centered over camera feed */
function _positionOverlay() {
  if (!vrm) return;
  arPlaced = false;
  vrm.scene.visible = true;
  vrm.scene.rotation.set(0, 0, 0);

  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(17.5)) * 3.5;
  const scale = (visibleHeight * 0.55) / size.y;
  vrm.scene.scale.setScalar(scale);

  baseY = -center.y * scale - visibleHeight * 0.12;
  vrm.scene.position.set(-center.x * scale, baseY, 0);
}

/** AR mode: hide avatar until user taps the blue ring */
function _prepareForAR() {
  if (!vrm) return;
  arPlaced = false;
  vrm.scene.visible = false;
  vrm.scene.scale.setScalar(1);
  vrm.scene.position.set(0, -10, 0);
  vrm.scene.rotation.set(0, 0, 0);
  baseY = 0;
}

export function updateAvatar(timestamp) {
  if (!vrm || !vrm.scene.visible) return;

  const delta = lastTimestamp ? Math.min((timestamp - lastTimestamp) / 1000, 0.1) : 0;
  lastTimestamp = timestamp;
  idleTime += delta;

  // Gentle bob — absolute position, NOT += (old code caused drift/jitter)
  vrm.scene.position.y = baseY + Math.sin(idleTime * 1.2) * 0.012;

  if (vrm.humanoid) {
    const head = vrm.humanoid.getNormalizedBoneNode('head');
    if (head) {
      head.rotation.y = Math.sin(idleTime * 0.35) * 0.12;
      head.rotation.x = Math.sin(idleTime * 0.28) * 0.05;
    }
    const spine = vrm.humanoid.getNormalizedBoneNode('spine');
    if (spine) spine.rotation.z = Math.sin(idleTime * 0.5) * 0.02;
  }

  if (vrm.expressionManager) {
    const blinkCycle = idleTime % 4;
    if (blinkCycle > 3.85) {
      const t = (blinkCycle - 3.85) / 0.15;
      vrm.expressionManager.setValue('blink', t < 0.5 ? t * 2 : (1 - t) * 2);
    } else {
      vrm.expressionManager.setValue('blink', 0);
    }
    vrm.expressionManager.update();
  }

  vrm.update(delta);
}

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

/** Place avatar on detected floor (AR mode) */
export function placeAvatarAtWorld(worldPos) {
  if (!vrm) return;

  // Real-world scale: ~1.6 m tall
  vrm.scene.scale.setScalar(1.0);
  vrm.scene.rotation.set(0, 0, 0);

  const box = new THREE.Box3().setFromObject(vrm.scene);
  vrm.scene.position.set(
    worldPos.x,
    worldPos.y - box.min.y,
    worldPos.z
  );

  baseY = vrm.scene.position.y;
  arPlaced = true;
  vrm.scene.visible = true;
}

export function isAvatarPlacedInAR() {
  return arPlaced;
}
