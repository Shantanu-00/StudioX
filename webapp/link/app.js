// app.js — StudioX Link application router, state manager, and UI engine

import { api, isMockMode, ApiError } from './api.js';
import { renderCard } from './cards.js';
import { UploadManager, formatBytes } from './upload.js';
import { createVoice, getRecognitionCtor, pickLang, VOICE, getSpeakAnswers, setSpeakAnswers, speakAnswer, voiceUnavailableHint } from './voice.js';

// --- State ---
const state = {
  route: { screen: 'loading', code: null },
  me: null, // { linkId, phoneName, tvName }
  isOffline: !navigator.onLine,
  isMock: isMockMode(),
  nowPlaying: null, // { mediaId, title, t, playing }
  messages: [], // Message[]
  lastCursor: null,
  activeUpload: null, // { manager, mediaId, percent, text }
  composerMode: 'MESSAGE', // 'MESSAGE' | 'ASK'
  composerText: '',
  pendingQuestion: null, // { text, askedAt, timerId, timedOut }
  activeModal: null, // 'settings' | 'upload' | null
  voice: { state: 'idle', message: '' }, // mirrors voice.js onChange
  firstPollDone: false,
  pairForm: {
    code: '',
    phoneName: 'My phone',
    error: null,
    loading: false,
    alreadyLinkedTv: null
  }
};

// --- Time & String Helpers ---
function formatTime(seconds) {
  if (typeof seconds !== 'number' || isNaN(seconds)) return '';
  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatClockTime(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

function formatDateHeader(isoString) {
  try {
    const d = new Date(isoString);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'TODAY';
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'YESTERDAY';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  } catch (_) {
    return '';
  }
}

function formatCode(rawCode) {
  const clean = (rawCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (clean.length > 3) {
    return `${clean.slice(0, 3)}-${clean.slice(3)}`;
  }
  return clean;
}

// --- Router ---
export function navigateTo(path, replace = false) {
  const url = new URL(path, window.location.origin);
  if (replace) {
    window.history.replaceState(null, '', url.pathname + url.search);
  } else {
    window.history.pushState(null, '', url.pathname + url.search);
  }
  handleRoute();
}

function parseCurrentRoute() {
  const path = window.location.pathname;
  // Route /link/p/<CODE>
  const pairMatch = path.match(/\/link\/p\/([A-Za-z0-9_-]+)/);
  if (pairMatch) {
    return { screen: 'pair', code: pairMatch[1].replace(/[^A-Za-z0-9]/g, '').toUpperCase() };
  }
  // Check search query fallback: ?code=XYZ
  const params = new URLSearchParams(window.location.search);
  if (params.get('code')) {
    return { screen: 'pair', code: params.get('code').replace(/[^A-Za-z0-9]/g, '').toUpperCase() };
  }
  return { screen: 'home', code: null };
}

async function handleRoute() {
  const route = parseCurrentRoute();
  state.route = route;

  // Verify authentication / pairing status
  try {
    const me = await api.getMe();
    state.me = me;
    state.pairForm.alreadyLinkedTv = me ? me.tvName : null;
  } catch (err) {
    state.me = null;
    state.pairForm.alreadyLinkedTv = null;
  }

  if (route.screen === 'pair') {
    state.pairForm.code = route.code || '';
    state.pairForm.error = null;
    renderApp();
  } else {
    if (state.me) {
      state.route.screen = 'thread';
      startPolling();
    } else {
      state.route.screen = 'not-paired';
      stopPolling();
    }
    renderApp();
  }
}

// --- Polling Engine ---
let messagePollTimer = null;
let nowPlayingPollTimer = null;
let pollBackoffMs = 2000;

function startPolling() {
  stopPolling();
  pollNowPlaying();
  pollMessages();
}

function stopPolling() {
  if (messagePollTimer) clearTimeout(messagePollTimer);
  if (nowPlayingPollTimer) clearTimeout(nowPlayingPollTimer);
  messagePollTimer = null;
  nowPlayingPollTimer = null;
}

async function pollNowPlaying() {
  if (!state.me || state.isOffline) {
    nowPlayingPollTimer = setTimeout(pollNowPlaying, 5000);
    return;
  }

  try {
    const now = await api.getNow(state.me.linkId);
    const wasPlaying = state.nowPlaying && state.nowPlaying.playing;
    state.nowPlaying = (now && now.title) ? now : null;

    // ASK is the default when something is playing
    if (state.nowPlaying && state.nowPlaying.playing && !wasPlaying) {
      state.composerMode = 'ASK';
    }

    updateNowPlayingStrip();
  } catch (e) {
    // silently wait for next tick
  }

  nowPlayingPollTimer = setTimeout(pollNowPlaying, 5000);
}

async function pollMessages() {
  if (!state.me || state.isOffline) {
    const delay = document.visibilityState === 'hidden' ? 15000 : 2000;
    messagePollTimer = setTimeout(pollMessages, delay);
    return;
  }

  try {
    let hasMore = true;
    let newMessagesFound = false;

    while (hasMore) {
      const res = await api.getMessages(state.me.linkId, state.lastCursor);
      const incoming = (res && res.messages) ? res.messages : [];

      if (incoming.length > 0) {
        newMessagesFound = true;
        incoming.forEach((msg) => {
          // De-duplicate by id
          const existingIdx = state.messages.findIndex((m) => m.id === msg.id);
          if (existingIdx !== -1) {
            state.messages[existingIdx] = msg;
          } else {
            // Check if this matches a status message for an ongoing upload/processing
            if (msg.kind === 'status' && msg.mediaId) {
              const statusIdx = state.messages.findIndex((m) => m.kind === 'status' && m.mediaId === msg.mediaId);
              if (statusIdx !== -1) {
                state.messages[statusIdx] = msg;
              } else {
                state.messages.push(msg);
              }
            } else {
              state.messages.push(msg);
            }
            if (state.firstPollDone && getSpeakAnswers()) speakAnswer(msg);
          }

          // If this is an AI answer, clear pending question bubble
          if (msg.kind === 'answer' && state.pendingQuestion) {
            clearPendingQuestion();
          }
        });

        if (res.cursor) {
          state.lastCursor = res.cursor;
        } else if (incoming.length > 0) {
          state.lastCursor = incoming[incoming.length - 1].id;
        }
      }

      // Loop while 50 come back (pagination spec)
      hasMore = incoming.length === 50;
    }

    pollBackoffMs = 2000;
    state.firstPollDone = true;
    hideOfflineBanner();

    if (newMessagesFound) {
      renderThreadMessages();
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      state.me = null;
      stopPolling();
      navigateTo('/link/', true);
      return;
    }
    // Exponential backoff up to 10s on failure
    pollBackoffMs = Math.min(10000, pollBackoffMs * 1.5);
    showOfflineBanner();
  }

  const nextInterval = document.visibilityState === 'hidden' ? 15000 : pollBackoffMs;
  messagePollTimer = setTimeout(pollMessages, nextInterval);
}

function clearPendingQuestion() {
  if (state.pendingQuestion && state.pendingQuestion.timerId) {
    clearTimeout(state.pendingQuestion.timerId);
  }
  state.pendingQuestion = null;
}

// --- DOM Rendering Engine (Strict textContent / createElement) ---
const appEl = document.getElementById('app');

function renderApp() {
  appEl.replaceChildren();

  // 1. Header (Always present)
  appEl.appendChild(createHeader());

  // 2. Now Playing strip (pinned under header)
  const nowPlayingEl = createNowPlayingStrip();
  appEl.appendChild(nowPlayingEl);

  // 3. Offline notice bar
  const offlineEl = createOfflineBanner();
  appEl.appendChild(offlineEl);

  // 4. Main Body
  const mainEl = document.createElement('main');
  mainEl.className = 'main-screen';

  if (state.route.screen === 'pair') {
    mainEl.appendChild(createPairScreen());
  } else if (state.route.screen === 'not-paired') {
    mainEl.appendChild(createNotPairedScreen());
  } else if (state.route.screen === 'thread') {
    mainEl.appendChild(createThreadScreen());
  } else {
    // Loading state
    const loader = document.createElement('div');
    loader.className = 'center-card-screen';
    const tag = document.createElement('p');
    tag.className = 'mono';
    tag.textContent = 'CONNECTING...';
    loader.appendChild(tag);
    mainEl.appendChild(loader);
  }

  appEl.appendChild(mainEl);

  // 5. Active Modals / Sheets
  if (state.activeModal === 'settings') {
    appEl.appendChild(createSettingsModal());
  } else if (state.activeModal === 'upload') {
    appEl.appendChild(createUploadSheet());
  }
}

// --- Header Component ---
function createHeader() {
  const header = document.createElement('header');
  header.className = 'app-header';

  // Left: Wordmark + Mock Chip
  const left = document.createElement('div');
  left.className = 'header-left';

  const link = document.createElement('a');
  link.className = 'wordmark';
  link.href = '/link/';
  link.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo('/link/');
  });

  const studioText = document.createTextNode('STUDIO');
  const xSpan = document.createElement('span');
  xSpan.className = 'wordmark-x';
  xSpan.textContent = 'X';
  link.appendChild(studioText);
  link.appendChild(xSpan);
  left.appendChild(link);

  if (state.isMock) {
    const mockChip = document.createElement('span');
    mockChip.className = 'mock-chip';
    mockChip.textContent = 'MOCK';
    mockChip.title = 'Running in mock demo mode';
    left.appendChild(mockChip);
  }
  header.appendChild(left);

  // Right: Status Chip + Settings Button
  const right = document.createElement('div');
  right.className = 'header-right';

  const statusChip = document.createElement('div');
  statusChip.className = 'status-chip mono';
  statusChip.id = 'header-status-chip';

  const ind = document.createElement('span');
  ind.className = 'status-indicator';

  const statusLabel = document.createElement('span');

  if (state.isOffline) {
    ind.classList.add('offline');
    statusLabel.textContent = 'OFFLINE';
  } else if (state.me && state.me.tvName) {
    ind.classList.add('linked');
    statusLabel.textContent = `LINKED TO ${state.me.tvName.toUpperCase()}`;
  } else {
    ind.classList.add('not-linked');
    statusLabel.textContent = 'NOT LINKED';
  }

  statusChip.appendChild(ind);
  statusChip.appendChild(statusLabel);
  right.appendChild(statusChip);

  if (state.me) {
    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'header-btn';
    settingsBtn.setAttribute('aria-label', 'Open settings');
    settingsBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`;
    settingsBtn.addEventListener('click', () => {
      state.activeModal = 'settings';
      renderApp();
    });
    right.appendChild(settingsBtn);
  }

  header.appendChild(right);
  return header;
}

// --- Now Playing Strip Component ---
function createNowPlayingStrip() {
  const strip = document.createElement('aside');
  strip.className = 'now-playing-strip';
  strip.id = 'now-playing-strip';
  strip.style.display = (state.nowPlaying && state.nowPlaying.title) ? 'flex' : 'none';

  const ind = document.createElement('span');
  ind.className = 'now-playing-indicator';

  const text = document.createElement('span');
  text.className = 'now-playing-text mono';
  text.id = 'now-playing-title';

  if (state.nowPlaying && state.nowPlaying.title) {
    const tFormatted = formatTime(state.nowPlaying.t);
    text.textContent = `NOW PLAYING · ${state.nowPlaying.title} · ${tFormatted}`;
  }

  strip.appendChild(ind);
  strip.appendChild(text);

  if (voiceAvailable()) {
    const askBtn = document.createElement('button');
    askBtn.type = 'button';
    askBtn.id = 'strip-ask-btn';
    askBtn.className = 'strip-ask-btn mono';
    askBtn.textContent = 'ASK ABOUT THIS';
    askBtn.setAttribute('aria-pressed', 'false');
    askBtn.addEventListener('click', () => toggleVoice());
    strip.appendChild(askBtn);
  }
  return strip;
}

function updateNowPlayingStrip() {
  const strip = document.getElementById('now-playing-strip');
  const text = document.getElementById('now-playing-title');
  if (!strip || !text) return;

  if (state.nowPlaying && state.nowPlaying.title) {
    strip.style.display = 'flex';
    const tFormatted = formatTime(state.nowPlaying.t);
    text.textContent = `NOW PLAYING · ${state.nowPlaying.title} · ${tFormatted}`;
  } else {
    strip.style.display = 'none';
  }
}

// --- Offline Banner Component ---
function createOfflineBanner() {
  const banner = document.createElement('div');
  banner.className = 'offline-banner mono';
  banner.id = 'offline-banner';
  banner.textContent = 'OFFLINE · RETRYING';
  banner.style.display = state.isOffline ? 'block' : 'none';
  return banner;
}

function showOfflineBanner() {
  const b = document.getElementById('offline-banner');
  if (b) b.style.display = 'block';
  const chip = document.getElementById('header-status-chip');
  if (chip) {
    chip.replaceChildren();
    const ind = document.createElement('span');
    ind.className = 'status-indicator offline';
    const lbl = document.createElement('span');
    lbl.textContent = 'OFFLINE';
    chip.appendChild(ind);
    chip.appendChild(lbl);
  }
}

function hideOfflineBanner() {
  if (state.isOffline) return;
  const b = document.getElementById('offline-banner');
  if (b) b.style.display = 'none';
}

// --- Screen 1: Pair Screen ---
function createPairScreen() {
  const container = document.createElement('section');
  container.className = 'center-card-screen';

  const card = document.createElement('div');
  card.className = 'center-card';

  const tag = document.createElement('span');
  tag.className = 'screen-tag mono';
  tag.textContent = 'LINK // PAIR';
  card.appendChild(tag);

  const headline = document.createElement('h1');
  headline.className = 'screen-headline';
  headline.textContent = 'Link this phone to your TV.';
  card.appendChild(headline);

  // If already linked to another TV
  if (state.pairForm.alreadyLinkedTv) {
    const notice = document.createElement('div');
    notice.className = 'error-banner';
    notice.textContent = `Already linked to ${state.pairForm.alreadyLinkedTv}`;
    card.appendChild(notice);

    const openThreadBtn = document.createElement('button');
    openThreadBtn.type = 'button';
    openThreadBtn.className = 'secondary-btn mono';
    openThreadBtn.textContent = 'OPEN THREAD';
    openThreadBtn.addEventListener('click', () => {
      navigateTo('/link/');
    });
    card.appendChild(openThreadBtn);

    const relinkPrompt = document.createElement('p');
    relinkPrompt.className = 'screen-desc';
    relinkPrompt.textContent = 'Or link to this TV instead:';
    card.appendChild(relinkPrompt);
  }

  // Display code large (3-3 formatted)
  const codeBox = document.createElement('div');
  codeBox.className = 'pair-code-display';
  codeBox.textContent = formatCode(state.pairForm.code) || '--- ---';
  card.appendChild(codeBox);

  // Phone name input
  const formGroup = document.createElement('div');
  formGroup.className = 'form-group';

  const label = document.createElement('label');
  label.className = 'form-label mono';
  label.htmlFor = 'pair-phone-name';
  label.textContent = 'NAME THIS PHONE';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'pair-phone-name';
  input.className = 'form-input';
  input.maxLength = 30;
  input.value = state.pairForm.phoneName;
  input.placeholder = 'My phone';
  input.addEventListener('input', (e) => {
    state.pairForm.phoneName = e.target.value;
  });

  formGroup.appendChild(label);
  formGroup.appendChild(input);
  card.appendChild(formGroup);

  if (state.pairForm.error) {
    const errBox = document.createElement('div');
    errBox.className = 'error-banner';
    errBox.textContent = state.pairForm.error;
    card.appendChild(errBox);

    if (state.pairForm.error.includes('expired')) {
      const hint = document.createElement('p');
      hint.className = 'scan-hint mono';
      hint.textContent = 'SCAN AGAIN FROM TV';
      card.appendChild(hint);
    }
  }

  // Link button
  const linkBtn = document.createElement('button');
  linkBtn.type = 'button';
  linkBtn.className = 'primary-btn mono';
  linkBtn.textContent = state.pairForm.loading ? 'LINKING...' : 'LINK';
  linkBtn.disabled = state.pairForm.loading || !state.pairForm.code;

  linkBtn.addEventListener('click', async () => {
    state.pairForm.loading = true;
    state.pairForm.error = null;
    linkBtn.textContent = 'LINKING...';
    linkBtn.disabled = true;

    try {
      const res = await api.redeemPairing(state.pairForm.code, state.pairForm.phoneName);
      linkBtn.textContent = 'LINK ESTABLISHED';
      setTimeout(() => {
        state.pairForm.loading = false;
        navigateTo('/link/');
      }, 700);
    } catch (err) {
      state.pairForm.loading = false;
      linkBtn.textContent = 'LINK';
      linkBtn.disabled = false;

      if (err.status === 404 || err.status === 410) {
        state.pairForm.error = 'This code has expired. Show a new code on the TV.';
      } else if (err.status === 409) {
        state.pairForm.error = 'This pairing code has already been redeemed.';
      } else {
        state.pairForm.error = err.message || 'Failed to link phone. Try again.';
      }
      renderApp();
    }
  });

  card.appendChild(linkBtn);
  container.appendChild(card);
  return container;
}

// --- Screen 2: Not Paired Home Screen ---
function createNotPairedScreen() {
  const container = document.createElement('section');
  container.className = 'center-card-screen';

  const card = document.createElement('div');
  card.className = 'center-card';

  const tag = document.createElement('span');
  tag.className = 'screen-tag mono';
  tag.textContent = 'STUDIOX // LINK';
  card.appendChild(tag);

  const headline = document.createElement('h1');
  headline.className = 'screen-headline';
  headline.textContent = 'Connect to Fire TV';
  card.appendChild(headline);

  const desc = document.createElement('p');
  desc.className = 'screen-desc';
  desc.textContent = 'On your TV, open StudioX → LINK and scan the code.';
  card.appendChild(desc);

  // Manual code input
  const formGroup = document.createElement('div');
  formGroup.className = 'form-group';

  const label = document.createElement('label');
  label.className = 'form-label mono';
  label.htmlFor = 'manual-code-input';
  label.textContent = 'OR ENTER 6-CHARACTER CODE';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'manual-code-input';
  input.className = 'form-input code-input';
  input.maxLength = 7; // allow for K7Q-4XZ
  input.placeholder = 'K7Q-4XZ';
  input.autocomplete = 'off';
  input.spellcheck = false;

  input.addEventListener('input', (e) => {
    const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    e.target.value = formatCode(raw);
    submitBtn.disabled = raw.length !== 6;
  });

  formGroup.appendChild(label);
  formGroup.appendChild(input);
  card.appendChild(formGroup);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'primary-btn mono';
  submitBtn.textContent = 'CONTINUE';
  submitBtn.disabled = true;

  submitBtn.addEventListener('click', () => {
    const clean = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length === 6) {
      navigateTo(`/link/p/${clean}`);
    }
  });

  card.appendChild(submitBtn);
  container.appendChild(card);
  return container;
}

// --- Screen 3: Thread Screen ---
let threadContainerEl = null;

function createThreadScreen() {
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.position = 'relative';
  container.style.overflow = 'hidden';

  // Thread scroll area
  threadContainerEl = document.createElement('div');
  threadContainerEl.className = 'thread-container';
  threadContainerEl.id = 'thread-messages';
  threadContainerEl.setAttribute('role', 'log');
  threadContainerEl.setAttribute('aria-live', 'polite');

  // Track scroll position for "NEW ↓" pill
  threadContainerEl.addEventListener('scroll', () => {
    const threshold = 60;
    const distanceToBottom = threadContainerEl.scrollHeight - threadContainerEl.scrollTop - threadContainerEl.clientHeight;
    state.isNearBottom = distanceToBottom <= threshold;
    if (state.isNearBottom) {
      hideNewPill();
    }
  });

  container.appendChild(threadContainerEl);

  // Floating "NEW ↓" Pill
  const newPill = document.createElement('button');
  newPill.type = 'button';
  newPill.className = 'new-pill-btn';
  newPill.id = 'new-messages-pill';
  newPill.textContent = 'NEW ↓';
  newPill.style.display = 'none';
  newPill.addEventListener('click', () => {
    scrollToBottom();
    hideNewPill();
  });
  container.appendChild(newPill);

  // Composer
  container.appendChild(createComposer());

  // Render initial message list
  setTimeout(() => {
    renderThreadMessages();
    scrollToBottom(true);
  }, 0);

  return container;
}

function showNewPill() {
  const pill = document.getElementById('new-messages-pill');
  if (pill) pill.style.display = 'flex';
}

function hideNewPill() {
  const pill = document.getElementById('new-messages-pill');
  if (pill) pill.style.display = 'none';
}

function scrollToBottom(force = false) {
  if (!threadContainerEl) return;
  if (force || state.isNearBottom) {
    threadContainerEl.scrollTop = threadContainerEl.scrollHeight;
  }
}

function renderThreadMessages() {
  if (!threadContainerEl) return;

  const wasAtBottom = state.isNearBottom;
  threadContainerEl.replaceChildren();

  let lastDateGroup = null;

  state.messages.forEach((msg) => {
    // Date group divider
    if (msg.at) {
      const dateHeader = formatDateHeader(msg.at);
      if (dateHeader && dateHeader !== lastDateGroup) {
        lastDateGroup = dateHeader;
        const divider = document.createElement('div');
        divider.className = 'date-divider';
        const txt = document.createElement('span');
        txt.className = 'date-divider-text mono';
        txt.textContent = dateHeader;
        divider.appendChild(txt);
        threadContainerEl.appendChild(divider);
      }
    }

    const row = renderMessageRow(msg);
    if (row) {
      threadContainerEl.appendChild(row);
    }
  });

  // Render active upload progress row if uploading
  if (state.activeUpload) {
    threadContainerEl.appendChild(renderActiveUploadRow());
  }

  // Render pending AI Question bubble if waiting for answer
  if (state.pendingQuestion) {
    threadContainerEl.appendChild(renderPendingAiBubble());
  }

  if (wasAtBottom) {
    scrollToBottom(true);
  } else {
    showNewPill();
  }
}

function renderMessageRow(msg) {
  const isOutbound = msg.from && (msg.from.kind === 'phone' || msg.kind === 'question');
  const isSystemStatus = msg.kind === 'status';

  if (isSystemStatus) {
    const row = document.createElement('div');
    row.className = 'msg-row system-status';
    row.appendChild(renderStatusLine(msg));
    return row;
  }

  const row = document.createElement('div');
  row.className = `msg-row ${isOutbound ? 'outbound' : 'inbound'}`;

  // Inbound label (TV, AI CO-VIEWER, SYSTEM) + timestamp
  if (!isOutbound) {
    const meta = document.createElement('div');
    meta.className = 'msg-meta mono';

    const sender = document.createElement('span');
    sender.className = 'msg-sender';
    if (msg.from && msg.from.kind === 'ai') {
      sender.textContent = 'AI CO-VIEWER';
    } else if (msg.from && msg.from.kind === 'tv') {
      sender.textContent = 'TV';
    } else {
      sender.textContent = (msg.from && msg.from.name) ? msg.from.name.toUpperCase() : 'SYSTEM';
    }

    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = formatClockTime(msg.at);

    meta.appendChild(sender);
    meta.appendChild(time);
    row.appendChild(meta);
  }

  // Card or Bubble Content
  if (msg.kind === 'share' && msg.card) {
    const cardEl = renderCard(msg);
    if (cardEl) row.appendChild(cardEl);
  } else {
    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    if (msg.kind === 'answer') {
      // Parse [mm:ss] timestamp chips safely
      renderTextWithTimestampChips(bubble, msg.text || '');

      // Sources list if present
      if (msg.card && Array.isArray(msg.card.sources)) {
        const sourcesEl = renderSourcesList(msg.card.sources);
        if (sourcesEl) bubble.appendChild(sourcesEl);
      }
    } else {
      bubble.textContent = msg.text || '';
    }

    // If outbound question with timestamp 't'
    if (msg.kind === 'question' && typeof msg.t === 'number') {
      const qTag = document.createElement('span');
      qTag.className = 'bubble-question-tag mono';
      qTag.textContent = `ASKED AT ${formatTime(msg.t)}`;
      bubble.appendChild(qTag);
    }

    row.appendChild(bubble);
  }

  // Outbound timestamp at bottom
  if (isOutbound && msg.at) {
    const time = document.createElement('div');
    time.className = 'msg-meta mono';
    time.style.marginTop = '4px';
    const timeSpan = document.createElement('span');
    timeSpan.className = 'msg-time';
    timeSpan.textContent = formatClockTime(msg.at);
    time.appendChild(timeSpan);
    row.appendChild(time);
  }

  return row;
}

// Safely parses [mm:ss] timestamp chips without innerHTML
function renderTextWithTimestampChips(container, rawText) {
  const regex = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(rawText)) !== null) {
    // Preceding text segment
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(rawText.slice(lastIndex, match.index)));
    }
    // Timestamp chip
    const chip = document.createElement('span');
    chip.className = 'timestamp-chip mono';
    chip.textContent = match[1];
    container.appendChild(chip);

    lastIndex = regex.lastIndex;
  }

  // Trailing text segment
  if (lastIndex < rawText.length) {
    container.appendChild(document.createTextNode(rawText.slice(lastIndex)));
  }
}

// Render sources list for answers
function renderSourcesList(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  const wrap = document.createElement('div');
  wrap.className = 'sources-container';

  const label = document.createElement('div');
  label.className = 'sources-label mono';
  label.textContent = 'SOURCES';
  wrap.appendChild(label);

  const ul = document.createElement('ul');
  ul.className = 'sources-list';

  sources.forEach((s) => {
    if (!s || !s.url || !s.url.startsWith('https://')) return;
    const li = document.createElement('li');
    li.className = 'source-item';
    const a = document.createElement('a');
    a.className = 'source-link';
    a.href = s.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = s.title || s.url;
    li.appendChild(a);
    ul.appendChild(li);
  });

  wrap.appendChild(ul);
  return wrap;
}

// Full-width mono system status line
function renderStatusLine(msg) {
  const line = document.createElement('div');
  line.className = 'system-status-line mono';

  const header = document.createElement('div');
  header.className = 'status-line-header';

  const textSpan = document.createElement('span');
  const rawStatus = (msg.status && msg.status.state) ? msg.status.state : (msg.text || '');
  textSpan.textContent = rawStatus;

  // Add blinking cursor if processing or waiting
  if (rawStatus.includes('PROCESSING') || rawStatus.includes('▍') || rawStatus.includes('ANALYSING')) {
    textSpan.textContent = rawStatus.replace('▍', '').trim() + ' ';
    const cursor = document.createElement('span');
    cursor.className = 'blinking-cursor';
    cursor.textContent = '▍';
    textSpan.appendChild(cursor);
  }

  header.appendChild(textSpan);
  line.appendChild(header);

  // If progress is given
  if (msg.status && typeof msg.status.progress === 'number') {
    const track = document.createElement('div');
    track.className = 'status-progress-track';
    const fill = document.createElement('div');
    fill.className = 'status-progress-fill';
    fill.style.width = `${Math.min(100, Math.round(msg.status.progress * 100))}%`;
    track.appendChild(fill);
    line.appendChild(track);
  }

  return line;
}

// Active Upload Row in Thread
function renderActiveUploadRow() {
  const row = document.createElement('div');
  row.className = 'upload-progress-row mono';

  const top = document.createElement('div');
  top.className = 'upload-row-top';

  const status = document.createElement('span');
  status.className = 'upload-status-text';
  status.textContent = state.activeUpload.text || `UPLOADING ${state.activeUpload.percent}%`;
  top.appendChild(status);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'upload-cancel-btn';
  cancelBtn.textContent = 'CANCEL';
  cancelBtn.addEventListener('click', () => {
    if (state.activeUpload && state.activeUpload.manager) {
      state.activeUpload.manager.cancel();
      state.activeUpload = null;
      renderThreadMessages();
    }
  });
  top.appendChild(cancelBtn);
  row.appendChild(top);

  const track = document.createElement('div');
  track.className = 'status-progress-track';
  const fill = document.createElement('div');
  fill.className = 'status-progress-fill';
  fill.style.width = `${state.activeUpload.percent || 0}%`;
  track.appendChild(fill);
  row.appendChild(track);

  return row;
}

// Pending AI Bubble
function renderPendingAiBubble() {
  const row = document.createElement('div');
  row.className = 'msg-row inbound';

  const meta = document.createElement('div');
  meta.className = 'msg-meta mono';
  const sender = document.createElement('span');
  sender.className = 'msg-sender';
  sender.textContent = 'AI CO-VIEWER';
  meta.appendChild(sender);
  row.appendChild(meta);

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (state.pendingQuestion.timedOut) {
    bubble.textContent = 'No answer yet. It will appear here.';
  } else {
    bubble.textContent = 'Thinking ';
    const cursor = document.createElement('span');
    cursor.className = 'blinking-cursor';
    cursor.textContent = '▍';
    bubble.appendChild(cursor);
  }

  row.appendChild(bubble);
  return row;
}

// --- Screen 4: Composer Component ---
// --- Voice input (Web Speech API; fake recogniser in mock mode) ---
let activeSend = null;
let voiceCtl = null;

// Mock recogniser: lets every state be tested without a mic (?mock=1 / localhost).
// Append &voice=denied | &voice=silent to the URL to simulate those errors.
class MockRecognition {
  start() {
    const mode = new URLSearchParams(window.location.search).get('voice');
    this._t = [];
    if (mode === 'denied') { this._t.push(setTimeout(() => { this.onerror && this.onerror({ error: 'not-allowed' }); this.onend && this.onend(); }, 400)); return; }
    if (mode === 'silent') { this._t.push(setTimeout(() => { this.onerror && this.onerror({ error: 'no-speech' }); this.onend && this.onend(); }, 1200)); return; }
    const words = 'What did they say about sleep'.split(' ');
    words.forEach((_, i) => {
      this._t.push(setTimeout(() => {
        const last = i === words.length - 1;
        const r = Object.assign([{ transcript: words.slice(0, i + 1).join(' ') }], { isFinal: last });
        this.onresult && this.onresult({ results: [r] });
      }, 700 + i * 350));
    });
    this._t.push(setTimeout(() => this.stop(), 700 + words.length * 350 + 200));
  }
  stop() { this._t.forEach(clearTimeout); this._t = []; setTimeout(() => this.onend && this.onend(), 0); }
  abort() { this._t.forEach(clearTimeout); this._t = []; }
}

function voiceCtor() {
  return getRecognitionCtor() || (state.isMock ? MockRecognition : null);
}

function voiceAvailable() {
  return !!voiceCtor();
}

function getVoice() {
  if (!voiceCtl) {
    voiceCtl = createVoice({
      Ctor: voiceCtor(),
      lang: pickLang(),
      onChange: (c) => {
        state.voice = { state: c.state, message: c.message };
        syncVoiceUI();
      },
      onInterim: (text) => {
        state.composerText = text;
        const ta = document.getElementById('composer-textarea');
        if (ta) { ta.value = text; ta.dispatchEvent(new Event('input')); }
      },
      onFinal: (text) => {
        state.composerText = text;
        state.composerMode = 'ASK';
        if (activeSend) activeSend('question');
      }
    });
  }
  return voiceCtl;
}

function toggleVoice() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  getVoice().toggle();
}

function syncVoiceUI() {
  const listening = state.voice.state === VOICE.LISTENING;
  const status = document.getElementById('voice-status');
  if (status) {
    // No mic in this browser: say so once in ASK mode, so typing is the obvious path.
    const fallback = state.composerMode === 'ASK' && !voiceAvailable() ? voiceUnavailableHint() : '';
    status.textContent = state.voice.message || fallback;
    status.classList.toggle('is-error', state.voice.state === VOICE.ERROR);
    status.classList.toggle('is-listening', listening);
  }
  const mic = document.getElementById('mic-btn');
  if (mic) {
    mic.setAttribute('aria-pressed', String(listening));
    mic.setAttribute('aria-label', listening ? 'Stop listening' : 'Ask by voice');
    mic.classList.toggle('is-listening', listening);
  }
  const strip = document.getElementById('strip-ask-btn');
  if (strip) {
    strip.setAttribute('aria-pressed', String(listening));
    strip.textContent = listening ? 'LISTENING…' : 'ASK ABOUT THIS';
    strip.classList.toggle('is-listening', listening);
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && voiceCtl && voiceCtl.state === VOICE.LISTENING) voiceCtl.cancel();
});

function createComposer() {
  const composer = document.createElement('div');
  composer.className = 'composer-wrap';

  // Mode Toggle (MESSAGE / ASK)
  const modeBar = document.createElement('div');
  modeBar.className = 'composer-mode-bar';

  const control = document.createElement('div');
  control.className = 'segmented-control mono';

  const msgBtn = document.createElement('button');
  msgBtn.type = 'button';
  msgBtn.className = `segmented-btn ${state.composerMode === 'MESSAGE' ? 'active' : ''}`;
  msgBtn.textContent = 'MESSAGE';
  msgBtn.addEventListener('click', () => {
    state.composerMode = 'MESSAGE';
    renderApp();
  });

  const askBtn = document.createElement('button');
  askBtn.type = 'button';
  askBtn.className = `segmented-btn ${state.composerMode === 'ASK' ? 'active is-ask' : ''}`;
  askBtn.textContent = 'ASK';
  askBtn.addEventListener('click', () => {
    state.composerMode = 'ASK';
    renderApp();
  });

  control.appendChild(msgBtn);
  control.appendChild(askBtn);
  modeBar.appendChild(control);
  composer.appendChild(modeBar);

  // Voice status line (aria-live)
  const voiceStatus = document.createElement('div');
  voiceStatus.id = 'voice-status';
  voiceStatus.className = 'voice-status mono';
  voiceStatus.setAttribute('role', 'status');
  voiceStatus.setAttribute('aria-live', 'polite');
  composer.appendChild(voiceStatus);

  // Input Row
  const row = document.createElement('div');
  row.className = 'composer-row';

  // + Button for Upload Sheet
  const plusBtn = document.createElement('button');
  plusBtn.type = 'button';
  plusBtn.className = 'composer-action-btn';
  plusBtn.setAttribute('aria-label', 'Upload video to TV');
  plusBtn.textContent = '+';
  plusBtn.addEventListener('click', () => {
    state.activeModal = 'upload';
    renderApp();
  });
  row.appendChild(plusBtn);

  // Textbox Box
  const box = document.createElement('div');
  box.className = 'composer-input-box';

  const textarea = document.createElement('textarea');
  textarea.className = 'composer-textarea';
  textarea.id = 'composer-textarea';
  textarea.rows = 1;
  textarea.maxLength = 2000;
  textarea.placeholder = state.composerMode === 'ASK' ? "Ask about what's playing…" : 'Message TV…';
  textarea.value = state.composerText;

  const autoResize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 96)}px`;
  };

  textarea.addEventListener('input', (e) => {
    state.composerText = e.target.value;
    autoResize();
    const hasContent = state.composerText.trim().length > 0;
    if (hasContent) {
      sendBtn.classList.add('is-active');
    } else {
      sendBtn.classList.remove('is-active');
    }
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  box.appendChild(textarea);
  row.appendChild(box);

  // Mic Button (hidden when speech recognition is unsupported)
  if (voiceAvailable()) {
    const micBtn = document.createElement('button');
    micBtn.type = 'button';
    micBtn.id = 'mic-btn';
    micBtn.className = 'composer-action-btn mic-btn';
    micBtn.setAttribute('aria-label', 'Ask by voice');
    micBtn.setAttribute('aria-pressed', 'false');
    micBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>`;
    micBtn.addEventListener('click', () => toggleVoice());
    row.appendChild(micBtn);
  }

  // Send Button
  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = `composer-send-btn ${state.composerText.trim() ? 'is-active' : ''}`;
  sendBtn.setAttribute('aria-label', 'Send message');
  sendBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;

  const doSend = async (forcedKind) => {
    const text = state.composerText.trim();
    if (!text || !state.me) return;

    state.composerText = '';
    textarea.value = '';
    textarea.style.height = 'auto';
    sendBtn.classList.remove('is-active');

    const kind = forcedKind || (state.composerMode === 'ASK' ? 'question' : 'text');

    // If ASK, start pending AI question bubble with 30s timeout
    if (kind === 'question') {
      const qTimer = setTimeout(() => {
        if (state.pendingQuestion) {
          state.pendingQuestion.timedOut = true;
          renderThreadMessages();
        }
      }, 30000);

      state.pendingQuestion = {
        text,
        askedAt: Date.now(),
        timerId: qTimer,
        timedOut: false
      };
    }

    try {
      const sentMsg = await api.postMessage(state.me.linkId, { kind, text });
      state.messages.push(sentMsg);
      renderThreadMessages();
      scrollToBottom(true);
    } catch (err) {
      console.error('Failed to send:', err);
    }
  };

  sendBtn.addEventListener('click', () => doSend());
  activeSend = doSend;
  row.appendChild(sendBtn);

  composer.appendChild(row);
  syncVoiceUI();
  return composer;
}

// --- Screen 6: Upload Sheet Modal ---
function createUploadSheet() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Upload video');

  const sheet = document.createElement('div');
  sheet.className = 'sheet-panel';

  const header = document.createElement('div');
  header.className = 'sheet-header';
  const title = document.createElement('span');
  title.className = 'sheet-title mono';
  title.textContent = 'UPLOAD VIDEO TO TV';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'sheet-close-btn';
  closeBtn.setAttribute('aria-label', 'Close dialog');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => {
    state.activeModal = null;
    renderApp();
  });
  header.appendChild(closeBtn);
  sheet.appendChild(header);

  let selectedFile = null;

  const fileInfo = document.createElement('div');
  fileInfo.className = 'screen-desc';
  fileInfo.textContent = 'Select an MP4/H.264 video to transmit to StudioX on your Fire TV.';
  sheet.appendChild(fileInfo);

  // Hidden real file input
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'video/*';
  fileInput.style.display = 'none';

  const selectBtn = document.createElement('button');
  selectBtn.type = 'button';
  selectBtn.className = 'secondary-btn mono';
  selectBtn.textContent = 'CHOOSE VIDEO FILE';
  selectBtn.addEventListener('click', () => fileInput.click());
  sheet.appendChild(selectBtn);

  const preview = document.createElement('div');
  preview.className = 'form-group';
  preview.style.display = 'none';
  const fileDetail = document.createElement('div');
  fileDetail.className = 'mono';
  preview.appendChild(fileDetail);
  sheet.appendChild(preview);

  const errorEl = document.createElement('div');
  errorEl.className = 'error-banner';
  errorEl.style.display = 'none';
  sheet.appendChild(errorEl);

  const uploadBtn = document.createElement('button');
  uploadBtn.type = 'button';
  uploadBtn.className = 'primary-btn mono';
  uploadBtn.textContent = 'TRANSMIT TO TV';
  uploadBtn.disabled = true;

  fileInput.addEventListener('change', () => {
    errorEl.style.display = 'none';
    if (!fileInput.files || fileInput.files.length === 0) return;
    const file = fileInput.files[0];

    // Check size < 4 GiB
    if (file.size > 4 * 1024 * 1024 * 1024) {
      errorEl.textContent = 'File exceeds maximum 4 GiB limit.';
      errorEl.style.display = 'block';
      uploadBtn.disabled = true;
      return;
    }

    selectedFile = file;
    fileDetail.textContent = `${file.name} · ${formatBytes(file.size)}`;
    preview.style.display = 'block';
    selectBtn.textContent = 'CHANGE FILE';
    uploadBtn.disabled = false;
  });

  uploadBtn.addEventListener('click', () => {
    if (!selectedFile) return;

    state.activeModal = null;
    renderApp();

    const manager = new UploadManager({
      onProgress: (prog) => {
        state.activeUpload = {
          manager,
          mediaId: manager.mediaId,
          percent: prog.percent,
          text: prog.text
        };
        renderThreadMessages();
      },
      onStatus: (status) => {
        if (status === 'PROCESSING') {
          state.activeUpload = null;
          renderThreadMessages();
        }
      },
      onComplete: ({ mediaId }) => {
        state.activeUpload = null;
        renderThreadMessages();
      },
      onError: (err) => {
        console.error('Upload error:', err);
        state.activeUpload = null;
        renderThreadMessages();
      }
    });

    state.activeUpload = {
      manager,
      mediaId: null,
      percent: 0,
      text: 'STARTING UPLOAD...'
    };
    renderThreadMessages();

    manager.start(selectedFile).catch((e) => {
      console.error('Upload start failed:', e);
      state.activeUpload = null;
      renderThreadMessages();
    });
  });

  sheet.appendChild(uploadBtn);
  overlay.appendChild(sheet);
  return overlay;
}

// --- Screen 7: Settings Modal ---
function createSettingsModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Settings');

  const sheet = document.createElement('div');
  sheet.className = 'sheet-panel';

  const header = document.createElement('div');
  header.className = 'sheet-header';
  const title = document.createElement('span');
  title.className = 'sheet-title mono';
  title.textContent = 'SETTINGS';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'sheet-close-btn';
  closeBtn.setAttribute('aria-label', 'Close settings');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => {
    state.activeModal = null;
    renderApp();
  });
  header.appendChild(closeBtn);
  sheet.appendChild(header);

  // Phone name & TV name info
  const infoWrap = document.createElement('div');
  infoWrap.className = 'card-keyval-list';

  const phoneRow = document.createElement('div');
  phoneRow.className = 'card-keyval-row';
  const phoneLabel = document.createElement('span');
  phoneLabel.className = 'card-row-name mono';
  phoneLabel.textContent = 'THIS PHONE';
  const phoneVal = document.createElement('span');
  phoneVal.className = 'card-row-detail';
  phoneVal.textContent = state.me ? state.me.phoneName : '—';
  phoneRow.appendChild(phoneLabel);
  phoneRow.appendChild(phoneVal);

  const tvRow = document.createElement('div');
  tvRow.className = 'card-keyval-row';
  const tvLabel = document.createElement('span');
  tvLabel.className = 'card-row-name mono';
  tvLabel.textContent = 'LINKED TV';
  const tvVal = document.createElement('span');
  tvVal.className = 'card-row-detail';
  tvVal.textContent = state.me ? state.me.tvName : '—';
  tvRow.appendChild(tvLabel);
  tvRow.appendChild(tvVal);

  infoWrap.appendChild(phoneRow);
  infoWrap.appendChild(tvRow);
  sheet.appendChild(infoWrap);

  // Read answers aloud toggle (only where speech synthesis exists)
  if (window.speechSynthesis || state.isMock) {
    const speakRow = document.createElement('button');
    speakRow.type = 'button';
    speakRow.className = 'switch-row';
    speakRow.setAttribute('role', 'switch');
    const speakLabel = document.createElement('span');
    speakLabel.className = 'card-row-name mono';
    speakLabel.textContent = 'READ ANSWERS ALOUD';
    const speakKnob = document.createElement('span');
    speakKnob.className = 'switch-knob';
    speakKnob.setAttribute('aria-hidden', 'true');
    const paintSwitch = () => {
      const on = getSpeakAnswers();
      speakRow.setAttribute('aria-checked', String(on));
      speakRow.classList.toggle('is-on', on);
      speakKnob.textContent = on ? 'ON' : 'OFF';
    };
    speakRow.addEventListener('click', () => {
      const on = !getSpeakAnswers();
      setSpeakAnswers(on);
      if (!on && window.speechSynthesis) window.speechSynthesis.cancel();
      paintSwitch();
    });
    paintSwitch();
    speakRow.appendChild(speakLabel);
    speakRow.appendChild(speakKnob);
    sheet.appendChild(speakRow);
  }

  // Unlink button
  const unlinkBtn = document.createElement('button');
  unlinkBtn.type = 'button';
  unlinkBtn.className = 'danger-btn mono';
  unlinkBtn.textContent = 'UNLINK THIS PHONE';
  unlinkBtn.addEventListener('click', async () => {
    try {
      await api.deleteMe();
      state.me = null;
      state.activeModal = null;
      stopPolling();
      navigateTo('/link/');
    } catch (e) {
      console.error('Failed to unlink:', e);
    }
  });
  sheet.appendChild(unlinkBtn);

  // About line
  const about = document.createElement('p');
  about.className = 'mono';
  about.style.textAlign = 'center';
  about.style.color = 'var(--smoke)';
  about.style.marginTop = '8px';
  about.textContent = 'STUDIOX LINK · v0.1';
  sheet.appendChild(about);

  overlay.appendChild(sheet);
  return overlay;
}

// --- Network & Lifecycle Listeners ---
window.addEventListener('online', () => {
  state.isOffline = false;
  hideOfflineBanner();
  renderApp();
  if (state.me) startPolling();
});

window.addEventListener('offline', () => {
  state.isOffline = true;
  showOfflineBanner();
});

window.addEventListener('popstate', () => {
  handleRoute();
});

// Accommodate on-screen virtual keyboard with visualViewport
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    if (appEl) {
      appEl.style.height = `${window.visualViewport.height}px`;
      scrollToBottom();
    }
  });
}

// Initial bootstrap
handleRoute();
