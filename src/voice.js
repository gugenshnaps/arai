const LANG = 'ru-RU';

// ── Speech Recognition ────────────────────────────────────────────────────

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

/** Returns true if SpeechRecognition is available in this browser */
export function isSpeechRecognitionSupported() {
  return Boolean(SpeechRecognition);
}

/**
 * Listen for one utterance and resolve with the transcript.
 * @returns {Promise<string>}
 */
export function startListening() {
  return new Promise((resolve, reject) => {
    if (!SpeechRecognition) {
      reject(new Error('SpeechRecognition не поддерживается в этом браузере'));
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = LANG;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript.trim();
      resolve(transcript);
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech') {
        reject(new Error('Речь не распознана. Попробуй ещё раз.'));
      } else {
        reject(new Error(`Ошибка распознавания: ${event.error}`));
      }
    };

    recognition.onend = () => {
      // If onresult hasn't fired, resolve with empty string
      // (onerror covers real failures)
    };

    recognition.start();
  });
}

// ── Speech Synthesis ─────────────────────────────────────────────────────

/** Pick the best available voice for the given language */
function pickVoice(lang) {
  const voices = window.speechSynthesis.getVoices();
  // Prefer a female Russian voice for the AR companion feel
  return (
    voices.find((v) => v.lang === lang && v.name.toLowerCase().includes('female')) ||
    voices.find((v) => v.lang === lang) ||
    voices.find((v) => v.lang.startsWith(lang.split('-')[0])) ||
    null
  );
}

/** Strip emoji — uses explicit Unicode ranges for maximum browser compatibility */
function cleanForSpeech(text) {
  return text
    // Emoticons, misc symbols, dingbats, transport, misc pictographs
    .replace(/[\u2600-\u27BF]/g, '')
    // Enclosed chars, supplemental arrows
    .replace(/[\u2B00-\u2BFF]/g, '')
    // Miscellaneous symbols and pictographs, emoticons (most emoji live here)
    .replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]/g, '')
    // Variation selectors + ZWJ used in emoji sequences
    .replace(/[\u200D\uFE00-\uFE0F]/g, '')
    // Collapse extra spaces left by removals
    .replace(/\s{2,}/g, ' ')
    .trim();
}

let currentUtterance = null;

/**
 * Speak the given text. Cancels any in-progress speech.
 * @param {string} text
 * @param {string} [lang]
 * @returns {Promise<void>} resolves when speech ends
 */
export function speak(text, lang = LANG) {
  text = cleanForSpeech(text);
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 0.95;
    utterance.pitch = 1.1;
    utterance.volume = 1;

    // Voice list may not be loaded yet on first call
    const assignVoice = () => {
      const voice = pickVoice(lang);
      if (voice) utterance.voice = voice;
    };

    if (window.speechSynthesis.getVoices().length > 0) {
      assignVoice();
    } else {
      window.speechSynthesis.onvoiceschanged = assignVoice;
    }

    utterance.onend = () => resolve();
    utterance.onerror = () => resolve(); // resolve anyway so UI doesn't hang

    currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  });
}

/** Stop any current speech immediately */
export function stopSpeaking() {
  window.speechSynthesis.cancel();
}

export function isSpeaking() {
  return window.speechSynthesis.speaking;
}
