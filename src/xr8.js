/**
 * 8th Wall Engine Binary (SLAM) integration module.
 * Provides surface detection and world tracking for any browser
 * including iOS Safari — no WebXR required.
 *
 * Free as of Feb 2026: https://8thwall.org
 * Binary license: limited-use (free for commercial/noncommercial)
 */
import * as THREE from 'three';

// ── Internal state ────────────────────────────────────────────────────────────
let _scene   = null;
let _camera  = null;
let _reticle = null;
let _placed  = false;

// ── Public API ────────────────────────────────────────────────────────────────

/** True if the XR8 engine script has finished loading */
export function isXR8Loaded() {
  return typeof window.XR8 !== 'undefined';
}

/**
 * Run a callback once XR8 is ready.
 * XR8 is loaded via <script> tag and fires 'xrloaded' on window.
 */
export function onXR8Ready(callback) {
  if (isXR8Loaded()) {
    callback();
  } else {
    window.addEventListener('xrloaded', callback, { once: true });
  }
}

/**
 * Start the 8th Wall SLAM AR session on the given canvas.
 *
 * @param {HTMLCanvasElement} canvas - full-screen canvas for XR8
 * @param {{
 *   onSceneReady: (scene, camera) => void,
 *   onSurfaceFound: () => void,
 *   onFrame: (time: number) => void,
 *   onAvatarPlace: (position: THREE.Vector3) => void,
 * }} callbacks
 */
export function startXR8(canvas, { onSceneReady, onSurfaceFound, onFrame, onAvatarPlace }) {
  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(),  // Draws the live camera feed
    XR8.Threejs.pipelineModule(),            // Creates Three.js scene inside XR8
    XR8.XrController.pipelineModule(),       // SLAM world tracking

    // Our custom module — sets up scene content and per-frame logic
    _buildSceneModule({ onSceneReady, onSurfaceFound, onFrame }),
  ]);

  // Tap anywhere → hit-test the SLAM surface → place avatar
  canvas.addEventListener('touchstart', (e) => {
    _onTap(e, canvas, onAvatarPlace);
  }, { passive: true });

  // Also support click for desktop testing
  canvas.addEventListener('click', (e) => {
    _onClick(e, canvas, onAvatarPlace);
  });

  XR8.run({ canvas, allowedDevices: XR8.XrConfig.device().ANY });
}

/** Return the live XR8 Three.js scene reference */
export function getXRScene() {
  return _scene ? XR8.Threejs.xrScene() : null;
}

/** Reset placement (allow user to reposition avatar) */
export function resetPlacement() {
  _placed = false;
  if (_reticle) _reticle.visible = false;
}

// ── Scene pipeline module ─────────────────────────────────────────────────────

function _buildSceneModule({ onSceneReady, onSurfaceFound, onFrame }) {
  let surfaceFoundFired = false;

  return {
    name: 'ar-ai-scene',

    onStart: ({ canvas }) => {
      const { scene, camera } = XR8.Threejs.xrScene();
      _scene  = scene;
      _camera = camera;

      // ── Lighting ──────────────────────────────────────────────────────────
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));

      const rim = new THREE.DirectionalLight(0x00f5ff, 1.8);
      rim.position.set(2, 3, -2);
      scene.add(rim);

      const fill = new THREE.DirectionalLight(0xffffff, 0.7);
      fill.position.set(-1, 2, 3);
      scene.add(fill);

      // ── Reticle (cyan ring on detected surface) ───────────────────────────
      _reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.10, 0.16, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: 0x00f5ff,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.80,
        })
      );
      _reticle.visible = false;
      scene.add(_reticle);

      // Outer pulse ring (dimmer, slightly larger)
      const outerRing = new THREE.Mesh(
        new THREE.RingGeometry(0.16, 0.22, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: 0x00f5ff,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.25,
        })
      );
      outerRing.visible = false;
      scene.add(outerRing);
      _reticle.userData.outerRing = outerRing;

      // Sync the camera projection to prevent aspect-ratio distortion
      XR8.XrController.updateCameraProjectionMatrix({
        origin: camera.position,
        facing: camera.quaternion,
      });

      onSceneReady(scene, camera);
    },

    onUpdate: ({ processCpuResult }) => {
      // ── Sync camera projection matrix from SLAM ───────────────────────────
      const matrix = processCpuResult?.reality?.cameraProjectionMatrix;
      if (matrix && _camera) {
        _camera.projectionMatrix.fromArray(matrix);
        _camera.projectionMatrixInverse
          .copy(_camera.projectionMatrix)
          .invert();
      }

      // ── Move reticle to the centre hit-test result ────────────────────────
      if (!_placed) {
        const hit = _centreHitTest();
        const outer = _reticle?.userData.outerRing;
        if (hit) {
          _reticle.visible = true;
          _reticle.position.copy(hit.position);
          _reticle.quaternion.copy(hit.rotation);
          if (outer) {
            outer.visible = true;
            outer.position.copy(hit.position);
            outer.quaternion.copy(hit.rotation);
          }
          if (!surfaceFoundFired) {
            surfaceFoundFired = true;
            onSurfaceFound();
          }
        } else {
          _reticle.visible = false;
          if (outer) outer.visible = false;
        }
      }

      onFrame(performance.now());
    },
  };
}

// ── Hit testing ───────────────────────────────────────────────────────────────

/** Hit-test at the centre of the screen — used to drive the reticle */
function _centreHitTest() {
  try {
    const hits = XR8.XrController.hitTest(0.5, 0.5, {
      includedHitTestTypes: ['FEATURE_POINT', 'ESTIMATED_SURFACE'],
    });
    return hits?.length ? hits[0] : null;
  } catch {
    return null;
  }
}

function _onTap(e, canvas, onAvatarPlace) {
  if (_placed) return;
  const touch = e.touches[0];
  _doHitAndPlace(
    touch.clientX / window.innerWidth,
    touch.clientY / window.innerHeight,
    onAvatarPlace
  );
}

function _onClick(e, canvas, onAvatarPlace) {
  if (_placed) return;
  _doHitAndPlace(
    e.clientX / window.innerWidth,
    e.clientY / window.innerHeight,
    onAvatarPlace
  );
}

function _doHitAndPlace(nx, ny, onAvatarPlace) {
  try {
    const hits = XR8.XrController.hitTest(nx, ny, {
      includedHitTestTypes: ['FEATURE_POINT', 'ESTIMATED_SURFACE'],
    });
    if (hits?.length) {
      _placed = true;
      if (_reticle) {
        _reticle.visible = false;
        const outer = _reticle.userData.outerRing;
        if (outer) outer.visible = false;
      }
      onAvatarPlace(hits[0].position);
    }
  } catch (err) {
    console.warn('XR8 hitTest failed:', err);
  }
}
