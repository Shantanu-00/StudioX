// Run: node webapp/link/voice.test.mjs
import assert from 'node:assert/strict';
import { createVoice, VOICE, speakableText, speakAnswer, getRecognitionCtor, voiceUnavailableHint } from './voice.js';

class FakeRec {
  static last = null;
  constructor() { FakeRec.last = this; }
  start() { this.started = true; }
  stop() { setTimeout(() => this.onend && this.onend(), 0); }
  abort() { this.aborted = true; }
  emit(parts) { this.onresult({ results: parts.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) }); }
}
const tick = () => new Promise((r) => setTimeout(r, 5));

{
  let fin = null; const interims = [];
  const v = createVoice({ Ctor: FakeRec, lang: 'en-IN', silenceMs: 1000, onInterim: (t) => interims.push(t), onFinal: (t) => (fin = t) });
  assert.equal(v.start(), true);
  assert.equal(FakeRec.last.lang, 'en-IN');
  assert.equal(v.state, VOICE.LISTENING);
  FakeRec.last.emit([['what did he', false]]);
  FakeRec.last.emit([['what did he say about sleep', true]]);
  v.toggle(); await tick();
  assert.equal(fin, 'what did he say about sleep');
  assert.deepEqual(interims, ['what did he', 'what did he say about sleep']);
  assert.equal(v.state, VOICE.IDLE);
}
{
  let fin = null;
  const v = createVoice({ Ctor: FakeRec, silenceMs: 20, onFinal: (t) => (fin = t) });
  v.start(); FakeRec.last.emit([['hello', false]]);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(fin, 'hello'); assert.equal(v.state, VOICE.IDLE);
}
{
  let fin = null; let last;
  const v = createVoice({ Ctor: FakeRec, silenceMs: 15, onChange: (c) => (last = c), onFinal: (t) => (fin = t) });
  v.start(); await new Promise((r) => setTimeout(r, 50));
  assert.equal(fin, null); assert.equal(last.state, VOICE.ERROR); assert.equal(last.reason, 'nospeech');
}
for (const [code, reason] of [['not-allowed', 'denied'], ['no-speech', 'nospeech'], ['audio-capture', 'nomic'], ['network', 'network'], ['weird', 'error']]) {
  let last; const v = createVoice({ Ctor: FakeRec, onChange: (c) => (last = c) });
  v.start(); FakeRec.last.onerror({ error: code }); FakeRec.last.onend();
  assert.equal(last.reason, reason, code);
  assert.equal(v.state, VOICE.ERROR);
}
{
  const v = createVoice({ Ctor: FakeRec }); v.start(); v.cancel();
  assert.equal(FakeRec.last.aborted, true); assert.equal(v.state, VOICE.IDLE);
  const bad = createVoice({ Ctor: class { start() { throw new Error('x'); } } });
  assert.equal(bad.start(), false); assert.equal(bad.state, VOICE.ERROR);
  assert.equal(createVoice({ Ctor: null }).start(), false);
}
assert.equal(getRecognitionCtor({ isSecureContext: false, SpeechRecognition: FakeRec }), null);
assert.equal(getRecognitionCtor({ isSecureContext: true, webkitSpeechRecognition: FakeRec }), FakeRec);
assert.equal(getRecognitionCtor({ isSecureContext: true }), null);
assert.equal(voiceUnavailableHint({ isSecureContext: true, webkitSpeechRecognition: FakeRec }), '');
assert.match(voiceUnavailableHint({ isSecureContext: false, SpeechRecognition: FakeRec }), /https/);
assert.match(voiceUnavailableHint({ isSecureContext: true }), /Type your question/);
assert.equal(speakableText('He said [12:30] see https://x.co/a now **ok**'), 'He said see now ok');
{
  const spoken = []; let cancels = 0;
  const synth = { cancel: () => cancels++, speak: (u) => spoken.push(u.text) };
  class U { constructor(t) { this.text = t; } }
  assert.equal(speakAnswer({ kind: 'answer', from: { kind: 'ai' }, text: 'Hi [01:02]' }, synth, U, 'en-US'), true);
  assert.equal(speakAnswer({ kind: 'answer', from: { kind: 'tv' }, text: 'no' }, synth, U), false);
  assert.equal(speakAnswer({ kind: 'text', from: { kind: 'ai' }, text: 'no' }, synth, U), false);
  assert.deepEqual(spoken, ['Hi']); assert.equal(cancels, 1);
}
console.log('voice tests passed');
