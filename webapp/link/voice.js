// voice.js — Voice input state machine (Web Speech API) and optional spoken answers.
// Pure logic: the recogniser constructor is injected so it can be tested with a fake.

export const VOICE = {
  IDLE: 'idle',
  LISTENING: 'listening',
  ERROR: 'error'
};

export const VOICE_MESSAGES = {
  listening: 'Listening…',
  nospeech: "Didn't catch that — try again",
  denied: 'Microphone is blocked. Allow it in your browser or phone settings for this site, then tap the mic again.',
  nomic: 'No microphone found on this device.',
  network: 'Speech service unavailable. Check your connection and try again.',
  error: "Couldn't start listening — try again"
};

export function getRecognitionCtor(win = (typeof window !== 'undefined' ? window : {})) {
  if (win.isSecureContext === false) return null;
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

// Why there is no mic, as one quiet line for the composer ('' when voice works).
export function voiceUnavailableHint(win = (typeof window !== 'undefined' ? window : {})) {
  if (getRecognitionCtor(win)) return '';
  if (win.isSecureContext === false) return 'Voice needs a secure (https) page. Type your question instead.';
  return "Voice isn't available in this browser. Type your question, or open this page in Chrome or Safari.";
}

export function pickLang(nav = (typeof navigator !== 'undefined' ? navigator : {})) {
  return (nav && nav.language) || 'en-US';
}

// createVoice({ Ctor, lang, silenceMs, onChange, onInterim, onFinal })
// onChange({ state, reason, message }) · onInterim(text) · onFinal(text)
export function createVoice(opts) {
  const { Ctor, lang = 'en-US', silenceMs = 2500, onChange = () => {}, onInterim = () => {}, onFinal = () => {} } = opts;
  let rec = null;
  let state = VOICE.IDLE;
  let heard = '';
  let finalText = '';
  let silenceTimer = null;
  let delivered = false;

  function set(next, reason) {
    state = next;
    onChange({ state, reason: reason || null, message: reason ? (VOICE_MESSAGES[reason] || VOICE_MESSAGES.error) : (next === VOICE.LISTENING ? VOICE_MESSAGES.listening : '') });
  }
  function clearSilence() { if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; } }
  function armSilence() {
    clearSilence();
    silenceTimer = setTimeout(() => { if (rec) { try { rec.stop(); } catch (e) { /* already stopped */ } } }, silenceMs);
  }
  function deliver() {
    if (delivered) return;
    delivered = true;
    const text = (finalText || heard).trim();
    if (text) { set(VOICE.IDLE); onFinal(text); } else { set(VOICE.ERROR, 'nospeech'); }
  }

  function start() {
    if (!Ctor) { set(VOICE.ERROR, 'error'); return false; }
    if (state === VOICE.LISTENING) return false;
    heard = ''; finalText = ''; delivered = false;
    try {
      rec = new Ctor();
      rec.lang = lang;
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      rec.onresult = (ev) => {
        let interim = ''; let fin = '';
        for (let i = 0; i < ev.results.length; i++) {
          const r = ev.results[i];
          const t = r[0] && r[0].transcript ? r[0].transcript : '';
          if (r.isFinal) fin += t; else interim += t;
        }
        finalText = fin;
        heard = (fin + interim).trim();
        onInterim(heard);
        armSilence();
      };
      rec.onerror = (ev) => {
        clearSilence();
        const code = ev && ev.error;
        delivered = true;
        if (code === 'no-speech') set(VOICE.ERROR, 'nospeech');
        else if (code === 'not-allowed' || code === 'service-not-allowed') set(VOICE.ERROR, 'denied');
        else if (code === 'audio-capture') set(VOICE.ERROR, 'nomic');
        else if (code === 'network') set(VOICE.ERROR, 'network');
        else if (code === 'aborted') set(VOICE.IDLE);
        else set(VOICE.ERROR, 'error');
      };
      rec.onend = () => { clearSilence(); rec = null; deliver(); };
      rec.start();
      set(VOICE.LISTENING);
      armSilence();
      return true;
    } catch (e) {
      rec = null; clearSilence();
      set(VOICE.ERROR, 'error');
      return false;
    }
  }

  function stop() {
    clearSilence();
    if (rec) { try { rec.stop(); } catch (e) { /* ignore */ } }
  }
  function cancel() {
    clearSilence(); delivered = true;
    if (rec) { try { rec.abort(); } catch (e) { /* ignore */ } rec = null; }
    set(VOICE.IDLE);
  }
  function toggle() { if (state === VOICE.LISTENING) { stop(); return false; } return start(); }

  return { start, stop, cancel, toggle, get state() { return state; } };
}

// --- Spoken answers ---
const SPEAK_KEY = 'studiox.link.speakAnswers';

export function getSpeakAnswers(store = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try { return !!store && store.getItem(SPEAK_KEY) === '1'; } catch (e) { return false; }
}
export function setSpeakAnswers(on, store = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try { if (store) store.setItem(SPEAK_KEY, on ? '1' : '0'); } catch (e) { /* storage blocked */ }
}

// Strip [mm:ss] chips, URLs and markdown noise. Sources are never passed in.
export function speakableText(text) {
  return String(text || '')
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

export function speakAnswer(msg, synth = (typeof speechSynthesis !== 'undefined' ? speechSynthesis : null), Utter = (typeof SpeechSynthesisUtterance !== 'undefined' ? SpeechSynthesisUtterance : null), lang = pickLang()) {
  if (!synth || !Utter || !msg || msg.kind !== 'answer' || !msg.from || msg.from.kind !== 'ai') return false;
  const t = speakableText(msg.text);
  if (!t) return false;
  synth.cancel();
  const u = new Utter(t);
  u.lang = lang;
  synth.speak(u);
  return true;
}
