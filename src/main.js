import * as THREE from 'three';
import { loadAvatar, updateAvatar, playExpression } from './avatar.js';
import { askAI } from './ai.js';
import { startListening, speak, isSpeechRecognitionSupported, stopSpeaking } from './voice.js';

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

// ── Camera setup ──────────────────────────────────────────────────────────
async function startCamera() {
  try {
    const constraints = {
      video: {
        facingMode: { ideal: 'environment' }, // rear camera on mobile
        width:  { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    console.warn('Camera unavailable, running without AR background:', err);
    // Graceful fallback: dark background is shown via CSS body background
  }
}

// ── Three.js scene ────────────────────────────────────────────────────────
function buildScene() {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,       // transparent so camera shows through
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();

  // Perspective camera — FOV tuned for portrait mobile
  const camera = new THREE.PerspectiveCamera(
    35,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(0, 1.35, 3.5);
  camera.lookAt(0, 1.0, 0);

  // Lighting: ambient base + cyan rim + soft fill
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);

  const rimLight = new THREE.DirectionalLight(0x00f5ff, 1.8);
  rimLight.position.set(2, 3, -2);
  scene.add(rimLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
  fillLight.position.set(-1, 2, 3);
  scene.add(fillLight);

  // Handle resize
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
    showError('Ничего не услышал. Попробуй ещё раз.');
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

async function init() {
  // Start camera in parallel with scene build
  await Promise.allSettled([startCamera()]);

  const { renderer, scene, camera } = buildScene();

  // Load VRM avatar
  try {
    await loadAvatar(scene, {
      onProgress: (pct) => {
        statusText.textContent = `Загрузка аватара ${pct}%`;
      },
      onLoaded: () => {
        loaderEl.classList.add('hidden');
        setTimeout(() => loaderEl.remove(), 600);
      },
    });
  } catch (err) {
    console.error('Avatar failed to load:', err);
    loaderEl.classList.add('hidden');
    setTimeout(() => loaderEl.remove(), 600);
    statusText.textContent = 'Аватар не загружен';
  }

  // Validate speech support
  if (!isSpeechRecognitionSupported()) {
    talkBtn.disabled = true;
    showError('SpeechRecognition не поддерживается. Используй Chrome.');
  } else {
    setState('ready');
  }

  // Render loop
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
