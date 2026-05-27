import * as THREE from 'three';
import { loadAvatar, updateAvatar, playExpression, placeAvatarAtWorld } from './avatar.js';
import { askAI } from './ai.js';
import { startListening, speak, isSpeechRecognitionSupported } from './voice.js';

window.__ARAI_BOOT = true;

const video        = document.getElementById('camera');
const canvas       = document.getElementById('three-canvas');
const talkBtn      = document.getElementById('talk-btn');
const talkIcon     = document.getElementById('talk-icon');
const talkLabel    = document.getElementById('talk-label');
const statusText   = document.getElementById('status-text');
const statusDot    = document.getElementById('status-dot');
const userText     = document.getElementById('user-text');
const aiText       = document.getElementById('ai-text');
const textInputRow = document.getElementById('text-input-row');
const textInput    = document.getElementById('text-input');
const sendBtn      = document.getElementById('send-btn');

statusText.textContent = 'Загрузка...';

let appState = 'loading';
let cameraStarted = false;
let mainRenderer = null;
let updateAR = null;
let animateARObjects = null;
let loadXR8, startXR8, fitXRCanvas;

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

async function startCamera() {
  if (cameraStarted) return;
  if (!navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    video.play().catch(() => {});
    cameraStarted = true;
  } catch (err) {
    console.warn('Camera unavailable:', err);
  }
}

function buildScene() {
  const renderer = new THREE.WebGLRenderer({
    canvas, alpha: true, antialias: true, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.35, 3.5);
  camera.lookAt(0, 1.0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const rim = new THREE.DirectionalLight(0x00f5ff, 1.8);
  rim.position.set(2, 3, -2);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(-1, 2, 3);
  scene.add(fill);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera };
}

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
    if (msg.includes('service-not-allowed') || msg.includes('не поддерживается')) {
      showTextInput();
      setState('ready');
    } else if (msg.includes('not-allowed')) {
      showError('Разреши микрофон: Настройки → Safari → Микрофон');
    } else {
      showError(msg || 'Ошибка распознавания');
    }
    return;
  }
  if (!transcript) { showError('Ничего не услышал.'); return; }
  await handleAIResponse(transcript);
}

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

async function init() {
  let scene, camera, renderer;
  try {
    ({ renderer, scene, camera } = buildScene());
    mainRenderer = renderer;
  } catch (err) {
    statusText.textContent = 'WebGL не поддерживается';
    return;
  }

  if (!isSpeechRecognitionSupported()) showTextInput();
  setState('ready');
  window.__ARAI_READY = true;
  startCamera();

  renderer.setAnimationLoop((time, frame) => {
    updateAR?.(frame, renderer);
    animateARObjects?.(scene, time);
    updateAvatar(time);
    renderer.render(scene, camera);
  });

  loadAvatar(scene, {
    onProgress: (val) => {
      if (appState === 'ready' && !userText.classList.contains('visible')) {
        statusText.textContent = `Аватар ${val}`;
      }
    },
    onLoaded: () => { if (appState === 'ready') setState('ready'); },
  }).catch((err) => console.error('Avatar failed:', err));

  import('./ar.js').then(async (ar) => {
    updateAR = ar.updateAR;
    animateARObjects = ar.animateARObjects;
    try {
      if (await ar.isARSupported()) {
        document.getElementById('controls').prepend(ar.initAR(renderer, scene));
      }
    } catch (e) { console.warn('WebXR:', e); }
  }).catch((e) => console.warn('AR module:', e));

  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    const btn = document.createElement('button');
    btn.id = 'xr8-btn';
    btn.textContent = '🌍 ENTER AR';
    btn.addEventListener('click', enterXR8Mode);
    document.getElementById('controls').prepend(btn);
  }
}

async function enterXR8Mode() {
  const xr8Btn = document.getElementById('xr8-btn');
  if (xr8Btn) { xr8Btn.disabled = true; xr8Btn.textContent = '⏳ Загрузка AR...'; }

  try {
    statusText.textContent = 'Загрузка AR движка...';
    if (!loadXR8) ({ loadXR8, startXR8, fitXRCanvas } = await import('./xr8.js'));
    await loadXR8();
  } catch (err) {
    showError('AR движок недоступен');
    if (xr8Btn) { xr8Btn.disabled = false; xr8Btn.textContent = '🌍 ENTER AR'; }
    return;
  }

  if (mainRenderer) mainRenderer.setAnimationLoop(null);
  document.body.classList.add('ar-mode');

  const xrCanvas = document.getElementById('xr-canvas');
  document.getElementById('camera').style.display = 'none';
  document.getElementById('three-canvas').style.display = 'none';
  xrCanvas.style.display = 'block';

  document.getElementById('ar-enter-btn')?.style.setProperty('display', 'none');
  if (xr8Btn) xr8Btn.style.display = 'none';

  statusText.textContent = 'Наводи камеру на пол...';
  statusText.classList.remove('error');
  fitXRCanvas(xrCanvas);

  startXR8(xrCanvas, {
    onSceneReady: (scene) => {
      loadAvatar(scene, {
        onProgress: (val) => {
          if (appState !== 'listening' && appState !== 'thinking') {
            statusText.textContent = `Загрузка аватара ${val}`;
          }
        },
        onLoaded: () => setState('ready'),
      }).catch((e) => console.error('Avatar XR8:', e));
    },
    onSurfaceFound: () => {
      if (statusText.textContent.includes('Наводи')) {
        statusText.textContent = 'Тапни чтобы поставить персонажа';
      }
    },
    onAvatarPlace: (pos) => {
      placeAvatarAtWorld(pos);
      if (appState === 'ready') statusText.textContent = 'Готов — нажми TALK';
    },
    onFrame: (time) => {
      updateAvatar(time);
      animateARObjects?.({ traverse: () => {} }, time);
    },
  });
}

talkBtn.addEventListener('click', handleTalk);
sendBtn.addEventListener('click', handleTextSend);
textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleTextSend(); });

init().catch((err) => {
  statusText.textContent = '⚠ ' + (err?.message || String(err)).slice(0, 70);
  statusText.style.color = '#ff4466';
});
