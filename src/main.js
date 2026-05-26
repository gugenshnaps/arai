import * as THREE from 'three';
import { loadAvatar, updateAvatar, playExpression } from './avatar.js';
import { askAI } from './ai.js';
import { startListening, speak, isSpeechRecognitionSupported } from './voice.js';

// ── DOM refs ──────────────────────────────────────────────────────────────
const video      = document.getElementById('camera');
const canvas     = document.getElementById('three-canvas');
const talkBtn    = document.getElementById('talk-btn');
const talkIcon   = document.getElementById('talk-icon');
const talkLabel  = document.getElementById('talk-label');
const statusText = document.getElementById('status-text');
const statusDot  = document.getElementById('status-dot');
const userText   = document.getElementById('user-text');
const aiText     = document.getElementById('ai-text');

// ── State ─────────────────────────────────────────────────────────────────
let appState = 'loading'; // loading | ready | listening | thinking | speaking
let cameraStarted = false;

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

// ── Talk flow ─────────────────────────────────────────────────────────────
async function handleTalk() {
  if (appState !== 'ready') return;

  // Lazy-start camera on first TALK click — works around iOS autoplay restrictions
  if (!cameraStarted) startCamera();

  hideTranscript();

  // 1. Listen
  setState('listening');
  let transcript;
  try {
    transcript = await startListening();
  } catch (err) {
    showError(err.message);
    return;
  }

  if (!transcript) {
    showError('Ничего не услышал.');
    return;
  }

  showTranscript(transcript, null);

  // 2. Ask AI
  setState('thinking');
  let reply;
  try {
    reply = await askAI(transcript);
  } catch (err) {
    showError(err.message);
    return;
  }

  showTranscript(null, reply);

  // 3. Speak
  setState('speaking');
  playExpression('happy', 0.7, 1500);
  await speak(reply);

  setState('ready');
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

function init() {
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
      // Only show progress if we're still in ready state and haven't talked yet
      if (appState === 'ready' && !userText.classList.contains('visible')) {
        statusText.textContent = `Аватар ${val}`;
      }
    },
    onLoaded: () => {
      if (appState === 'ready') setState('ready');
    },
  }).catch((err) => {
    console.error('Avatar failed to load:', err);
    // Don't show as error — AI still works without avatar
  });

  // 5. Render loop — always runs even without avatar
  function animate(timestamp) {
    requestAnimationFrame(animate);
    updateAvatar(timestamp);
    renderer.render(scene, camera);
  }
  animate();
}

// Wire Talk button
talkBtn.addEventListener('click', handleTalk);

// Kick off
init();
