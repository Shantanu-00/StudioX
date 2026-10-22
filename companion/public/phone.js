'use strict';
// Phone side of a StudioX link. Upload sends the raw file with a PUT so the
// server can stream it to disk; camera only asks for permission in this build.

const $ = (id) => document.getElementById(id);
const id = location.pathname.split('/')[2] || '';
const keyName = `studiox:${id}`;
let phoneKey = sessionStorage.getItem(keyName) || '';

const COPY = {
  upload: {
    tag: 'LINK // UPLOAD',
    headline: 'Send a podcast to the TV.',
    lede: 'Pick a video from this phone. Keep this page open until the TV confirms.',
  },
  camera: {
    tag: 'LINK // CAMERA',
    headline: 'Lend StudioX your camera.',
    lede: 'Stand the phone facing you. Gestures are read here; the video never leaves this phone.',
  },
};

function signal(text, tone) {
  $('signal-text').textContent = text;
  $('signal').className = `signal ${tone || ''}`;
}

function say(text, tone) {
  $('status').textContent = text;
  $('status').className = `status ${tone || ''}`;
}

async function api(path, init = {}) {
  const res = await fetch(`/api/phone/${encodeURIComponent(id)}${path}`, {
    ...init,
    headers: {'Content-Type': 'application/json', 'X-Phone-Key': phoneKey, ...init.headers},
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  return 'Browser';
}

async function start() {
  try {
    const info = await api('');
    const copy = COPY[info.kind];
    $('tag').textContent = copy.tag;
    $('headline').textContent = copy.headline;
    $('lede').textContent = copy.lede;
    const joined = await api('/join', {
      method: 'POST',
      body: JSON.stringify({device: deviceName()}),
    });
    phoneKey = joined.phoneKey;
    sessionStorage.setItem(keyName, phoneKey);
    signal('LINKED TO TV', 'live');
    if (info.kind === 'upload') setupUpload(joined.status);
    else setupCamera();
  } catch (e) {
    signal('NO LINK', 'alert');
    $('headline').textContent = 'This link is dead.';
    $('lede').textContent = `${e.message}. Open StudioX on the TV and scan a fresh code.`;
  }
}

// ---- upload ------------------------------------------------------------------

function fmtSize(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  return `${Math.max(1, Math.round(n / 1024 ** 2))} MB`;
}

function setupUpload(status) {
  $('upload').hidden = false;
  if (status === 'received') {
    say('THIS LINK HAS ALREADY DELIVERED A VIDEO.', 'live');
    return;
  }
  const input = $('file');
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    if (!f) return;
    $('file-title').textContent = f.name.toUpperCase();
    $('file-meta').textContent = `${fmtSize(f.size)} · ${f.type || 'video'}`;
    $('send').disabled = false;
    say('');
  });
  $('send').addEventListener('click', () => {
    const f = input.files && input.files[0];
    if (f) send(f);
  });
}

function send(file) {
  $('send').disabled = true;
  $('file').disabled = true;
  $('meter').hidden = false;
  say('TRANSMITTING… KEEP THIS PAGE OPEN.');
  const xhr = new XMLHttpRequest();
  xhr.open('PUT', `/api/phone/${encodeURIComponent(id)}/upload?name=${encodeURIComponent(file.name)}`);
  xhr.setRequestHeader('Content-Type', file.type && file.type.startsWith('video/') ? file.type : 'video/mp4');
  xhr.setRequestHeader('X-Phone-Key', phoneKey);
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) $('meter-fill').style.width = `${(e.loaded / e.total) * 100}%`;
  };
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      $('meter-fill').style.width = '100%';
      signal('DELIVERED', 'live');
      say('RECEIVED. LOOK AT YOUR TV.', 'live');
      return;
    }
    let msg = `HTTP ${xhr.status}`;
    try { msg = JSON.parse(xhr.responseText).error || msg; } catch (_) { /* keep status */ }
    retryable(msg);
  };
  xhr.onerror = () => retryable('Connection dropped');
  xhr.send(file);
}

function retryable(msg) {
  say(`${msg.toUpperCase()}. TRY AGAIN.`, 'alert');
  $('send').disabled = false;
  $('file').disabled = false;
  $('meter').hidden = true;
  $('meter-fill').style.width = '0';
}

// ---- camera ------------------------------------------------------------------

let stream = null;

function setupCamera() {
  $('camera').hidden = false;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    $('allow').disabled = true;
    $('lens-note').textContent = 'HTTPS REQUIRED';
    say('Phones only allow the camera on HTTPS pages. Run the companion behind an HTTPS tunnel (see companion/README.md).', 'alert');
    return;
  }
  $('allow').addEventListener('click', async () => {
    $('allow').disabled = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: 'user', width: {ideal: 640}, height: {ideal: 480}},
        audio: false,
      });
      const v = $('preview');
      v.srcObject = stream;
      await v.play();
      $('lens').classList.add('on');
      $('lens-note').textContent = 'TRACKING ON DEVICE';
      await api('/camera', {method: 'POST', body: JSON.stringify({state: 'ready'})});
      signal('CAMERA ONLINE', 'live');
      say('CAMERA ONLINE. GESTURE CONTROL ARRIVES IN THE NEXT BUILD.', 'live');
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      const detail = denied ? 'Camera permission denied on the phone' : String(e.message || e);
      api('/camera', {method: 'POST', body: JSON.stringify({state: denied ? 'denied' : 'error', detail})}).catch(() => {});
      say(detail.toUpperCase(), 'alert');
      $('allow').disabled = false;
    }
  });
}

window.addEventListener('pagehide', () => {
  if (stream) stream.getTracks().forEach((t) => t.stop());
});

start();
