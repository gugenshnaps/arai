import * as THREE from 'three';
import { loadAvatar, updateAvatar, playExpression, placeAvatarAtWorld } from './avatar.js';
import { askAI } from './ai.js';
import { startListening, speak, isSpeechRecognitionSupported } from './voice.js';
import { isARSupported, initAR, updateAR, animateARObjects } from './ar.js';
import { loadXR8, startXR8 } from './xr8.js';

// ── DOM refs ──────────────────────────────────────────────────────────────
const video         = document.getElementById('camera');
const canvas        = document.getElementById('three-canvas');
const talkBtn       = document.getElementById('talk-btn');
const talkIcon      = document.getElementById('talk-icon');
const talkLabel     = document.getElementById('talk-label');
const statusText    = document.getElementById('status-text');
const statusDot     = document.getElementById('status-dot');
const userText      = document.getElementById('user-text');
const aiText        = document.getElementById('ai-text');
const textInputRow  = document.getElementById('text-input-row');
const textInput     = document.getElementById('text-input');
const sendBtn       = document.getElementById('send-btn');

// ── State ─────────────────────────────────────────────────────────────────
let appState = 'loading'; // loading | ready | listening | thinking | speaking
let cameraStarted = false;
let xr8Mode = false; // true when running inside 8th Wall SLAM

// ── Status helpers ────────────────────────────────────────────────────────
const STATUS_MESSAGES = {
  loading:   'Загрузка...',
  ready:     'Готов — нажми TALK',
  listening: 'Слушаю...',
  thinking:  'Думаю...',
  speaking:  'Говорит...',
};

const DOT_CLASSES = ['active', 'listening', 'thinking'];

function setState(state) {
  appState = state;
  statusText.textContent = STATUS_MESSAGES[state] ?? state;
  statusText.classList.toggle('error', false);

  DOT_CLASSES.forEach((c) => statusDot.classList.remove(c));
  if (state === 'ready' || state === 'speaking') statusDot.classList.add('active');
  if (state === 'listening') statusDot.classList.add('listening');
  if (state === 'thinking')  statusDot.classList.add('thinking');

  talkBtn.disabled = state !== 'ready';
  talkBtn.classList.toggle('listening', state === 'listening');
  talkBtn.classList.toggle('thinking',  state === 'thinking' || state === 'speaking');

  talkIcon.textContent  = state === 'listening' ? '🔴' : '🎤';
  talkLabel.textContent = state === 'listening' ? 'STOP' : 'TALK';
}

function showError(msg) {
  statusText.textContent = msg;
  statusText.classList.add('error');
  statusDot.className = '';
  setTimeout(() => setState('ready'), 3000);
}

function showTranscript(user, ai) {
  if (user !== null) {
    userText.textContent = `Вы: ${user}`;
    userText.classList.add('visible');
  }
  if (ai !== null) {
    aiText.textContent = `AI: ${ai}`;
    aiText.classList.add('visible');
  }
}

function hideTranscript() {
  userText.classList.remove('visible');
  aiText.classList.remove('visible');
}

// ── Camera setup (non-blocking) ───────────────────────────────────────────
async function startCamera() {
  if (cameraStarted) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    console.warn('getUserMedia not available');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    video.srcObject = stream;
    // Don't await play() — it can hang on iOS Safari due to autoplay policy.
    // The video element has autoplay+playsinline+muted so it will start automatically.
    video.play().catch((err) => console.warn('video.play() warning:', err));
    cameraStarted = true;
  } catch (err) {
    console.warn('Camera unavailable:', err);
  }
}

// ── Three.js scene ────────────────────────────────────────────────────────
function buildScene() {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = true; // needed for WebXR AR mode

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    35,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(0, 1.35, 3.5);
  camera.lookAt(0, 1.0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const rimLight = new THREE.DirectionalLight(0x00f5ff, 1.8);
  rimLight.position.set(2, 3, -2);
  scene.add(rimLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.7);
  fillLight.position.set(-1, 2, 3);
  scene.add(fillLight);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera };
}

// ── Shared AI response flow ───────────────────────────────────────────────
async function handleAIResponse(transcript) {
  showTranscript(transcript, null);

  setState('thinking');
  let reply;
  try {
    reply = await askAI(transcript);
  } catch (err) {
    showError(err.message);
    return;
  }

  showTranscript(null, reply);
  setState('speaking');
  playExpression('happy', 0.7, 1500);
  await speak(reply);
  setState('ready');
}

// ── Talk button (voice) ───────────────────────────────────────────────────
async function handleTalk() {
  if (appState !== 'ready') return;

  if (!cameraStarted) startCamera();
  hideTranscript();

  setState('listening');
  let transcript;
  try {
    transcript = await startListening();
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('service-not-allowed')) {
      // Browser / WebView permanently blocks SpeechRecognition → text input
      showTextInput();
      setState('ready');
    } else if (msg.includes('not-allowed')) {
      // User denied mic permission → guide them to fix it
      showError('Разреши микрофон: Настройки → Safari → Микрофон');
    } else {
      showError(msg || 'Ошибка распознавания');
    }
    return;
  }

  if (!transcript) { showError('Ничего не услышал.'); return; }
  await handleAIResponse(transcript);
}

// ── Text input fallback ───────────────────────────────────────────────────
function showTextInput() {
  talkBtn.style.display = 'none';
  textInputRow.style.display = 'flex';
  statusText.textContent = 'Напиши сообщение';
  textInput.focus();
}

async function handleTextSend() {
  const text = textInput.value.trim();
  if (!text || appState !== 'ready') return;
  textInput.value = '';
  hideTranscript();
  if (!cameraStarted) startCamera();
  await handleAIResponse(text);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

// Loading overlay
const loaderEl = document.createElement('div');
loaderEl.id = 'avatar-loader';
loaderEl.innerHTML = '<div class="loader-ring"></div>';
document.body.appendChild(loaderEl);

function hideLoader() {
  loaderEl.classList.add('hidden');
  setTimeout(() => loaderEl.remove(), 600);
}

async function init() {
  // 1. Build Three.js scene FIRST so UI feels alive
  let scene, camera, renderer;
  try {
    ({ renderer, scene, camera } = buildScene());
  } catch (err) {
    console.error('WebGL init failed:', err);
    hideLoader();
    statusText.textContent = 'WebGL не поддерживается';
    return;
  }

  // 2. Set UI to ready state — user can press TALK even before avatar loads
  if (!isSpeechRecognitionSupported()) {
    statusText.textContent = 'Открой в Safari или Chrome';
    statusText.classList.add('error');
    hideLoader();
  } else {
    setState('ready');
    hideLoader();
  }

  // 3. Start camera in background — never blocks anything
  startCamera();

  // 4. Load avatar in background with timeout
  loadAvatar(scene, {
    onProgress: (val) => {
      if (appState === 'ready' && !userText.classList.contains('visible')) {
        statusText.textContent = `Аватар ${val}`;
      }
    },
    onLoaded: () => {
      if (appState === 'ready') setState('ready');
    },
  }).catch((err) => {
    console.error('Avatar failed to load:', err);
  });

  // 5a. Check WebXR AR support (Android Chrome / Vision Pro)
  try {
    const arSupported = await isARSupported();
    if (arSupported) {
      const arBtn = initAR(renderer, scene);
      document.getElementById('controls').prepend(arBtn);
    }
  } catch (err) {
    console.warn('WebXR AR setup failed:', err);
  }

  // 5b. Show "ENTER AR" button immediately on touch devices.
  //     XR8 engine (~10 MB) loads lazily only when the user taps the button.
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    const btn = document.createElement('button');
    btn.id = 'xr8-btn';
    btn.textContent = '🌍 ENTER AR';
    btn.addEventListener('click', enterXR8Mode);
    document.getElementById('controls').prepend(btn);
  }

  // 6. Render loop — setAnimationLoop works both in normal and XR mode
  //    frame is non-null only during an active WebXR AR session
  function animate(time, frame) {
    updateAR(frame, renderer);
    animateARObjects(scene, time);
    updateAvatar(time);
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(animate);
}

// ── XR8 SLAM AR mode ──────────────────────────────────────────────────────────

async function enterXR8Mode() {
  const xr8Btn = document.getElementById('xr8-btn');
  if (xr8Btn) { xr8Btn.disabled = true; xr8Btn.textContent = '⏳ Загрузка AR...'; }

  // Load the 8th Wall engine binary on demand (~10 MB, first time only)
  try {
    statusText.textContent = 'Загрузка AR движка...';
    await loadXR8();
  } catch (err) {
    console.error('XR8 load failed:', err);
    showError('AR движок недоступен. Попробуй позже.');
    if (xr8Btn) { xr8Btn.disabled = false; xr8Btn.textContent = '🌍 ENTER AR'; }
    return;
  }

  xr8Mode = true;

  // Swap visuals: hide camera feed + old canvas, show xr8 canvas
  const xrCanvas = document.getElementById('xr-canvas');
  document.getElementById('camera').style.display = 'none';
  document.getElementById('three-canvas').style.display = 'none';
  xrCanvas.style.display = 'block';

  // Hide WebXR button if present (not needed in XR8 mode)
  const webxrBtn = document.getElementById('ar-enter-btn');
  if (webxrBtn) webxrBtn.style.display = 'none';
  if (xr8Btn) xr8Btn.style.display = 'none';

  statusText.textContent = 'Наводи камеру на пол...';
  statusText.classList.remove('error');

  startXR8(xrCanvas, {
    onSceneReady: (scene) => {
      // Load avatar into XR8's Three.js scene
      loadAvatar(scene, {
        onProgress: (val) => {
          if (appState !== 'listening' && appState !== 'thinking') {
            statusText.textContent = `Загрузка аватара ${val}`;
          }
        },
        onLoaded: () => setState('ready'),
      }).catch((err) => console.error('Avatar load error in XR8:', err));
    },

    onSurfaceFound: () => {
      if (appState === 'loading' || statusText.textContent.includes('Наводи')) {
        statusText.textContent = 'Тапни чтобы поставить персонажа';
      }
    },

    onAvatarPlace: (position) => {
      placeAvatarAtWorld(position);
      if (appState === 'ready') {
        statusText.textContent = 'Готов — нажми TALK';
      }
    },

    onFrame: (time) => {
      updateAvatar(time);
      animateARObjects(
        // pass a stub scene — animateARObjects uses scene.traverse
        // which works on XR8's scene too
        { traverse: (fn) => { /* objects are in XR8 scene, animation handled in updateAvatar */ } },
        time
      );
    },
  });
}

// Wire buttons
talkBtn.addEventListener('click', handleTalk);
sendBtn.addEventListener('click', handleTextSend);
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleTextSend();
});

// Kick off
init();
