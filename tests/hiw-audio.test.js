'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../public/reading-mock-tools');
const bank = require('../public/reading-bank.json');

function harness({ voices = [{ lang: 'en-GB', name: 'British' }, { lang: 'en-US', name: 'American' }], suspended = false } = {}) {
  const utterances = [], events = [], nodes = [], contexts = [], timers = new Map(), listeners = new Set();
  let nextTimer = 0, gesture = false;
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = kind => {
    const value = { kind, started: false, stopped: false, disconnected: false, frequency: param(), gain: param(),
      connect() {}, disconnect() { this.disconnected = true; }, start() { this.started = true; }, stop() { this.stopped = true; } };
    nodes.push(value); return value;
  };
  const env = {
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: {
      getVoices: () => voices, speak: utterance => utterances.push(utterance), cancel() {},
      addEventListener: (event, fn) => listeners.add(fn), removeEventListener: (event, fn) => listeners.delete(fn)
    },
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    AudioContext: class {
      constructor() { this.state = suspended ? 'suspended' : 'running'; this.currentTime = 0; this.sampleRate = 1000; contexts.push(this); }
      resume() { if (gesture) this.state = 'running'; return Promise.resolve(); }
      createGain() { return node('gain'); }
      createOscillator() { return node('oscillator'); }
      createBufferSource() { return node('buffer'); }
      createBiquadFilter() { return node('filter'); }
      createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    }
  };
  return {
    env, utterances, events, nodes, timers, listeners, contexts,
    speaker: tools.createSpeaker(env, (...event) => events.push(event)),
    gesture(fn) { gesture = true; try { return fn(); } finally { gesture = false; } },
    setVoices(value) { voices = value; [...listeners].forEach(fn => fn()); },
    fire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms && timers.has(id)) { timers.delete(id); timer.fn(); } }
  };
}

test('Ambient audio waits for speech to start and stops with the utterance', () => {
  const h = harness();
  h.speaker.play('ambient', 'A complete practice passage.', { variant: 'ambient' });
  assert.equal(h.nodes.length, 0);
  h.utterances[0].onstart();
  assert(h.nodes.some(node => node.kind === 'buffer' && node.started));
  h.utterances[0].onend();
  assert(h.nodes.every(node => node.disconnected));
  assert(h.nodes.filter(node => node.kind === 'buffer').every(node => node.stopped));
  assert.equal(h.timers.size, 0);
  assert.equal(h.events.at(-1)[1], 'complete');
});

test('Chirps follow speech and cancellation removes both queued and sounding cues', () => {
  const h = harness();
  h.speaker.play('chirps', 'The voice can take time to load.', { variant: 'sound-cue' });
  h.fire(700); assert.equal(h.nodes.length, 0);
  h.utterances[0].onstart();
  const lateCue = [...h.timers.values()].find(timer => timer.ms === 6500).fn;
  h.fire(700);
  assert.equal(h.nodes.filter(node => node.kind === 'oscillator' && node.started).length, 3);
  h.speaker.cancel(); lateCue();
  assert.equal(h.nodes.filter(node => node.kind === 'oscillator').length, 3);
  assert(h.nodes.every(node => node.disconnected));
  assert.equal(h.timers.size, 0);
});

test('Unlock during a click enables Web Audio for later automatic playback', async () => {
  const h = harness({ suspended: true });
  assert.equal(await h.gesture(() => h.speaker.unlock()), true);
  h.speaker.play('ambient', 'This starts after the countdown.', { variant: 'ambient' });
  h.utterances[0].onstart();
  assert.equal(h.contexts.length, 1);
  assert(h.nodes.some(node => node.kind === 'buffer' && node.started));
  h.utterances[0].onend();
});

test('Blocked Web Audio reports speech-only playback without claiming a sound layer played', async () => {
  const h = harness({ suspended: true });
  h.speaker.play('blocked', 'The speech is still usable.', { variant: 'ambient' });
  h.utterances[0].onstart();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.nodes.length, 0);
  assert.match(h.events.at(-1)[2], /unavailable/);
  h.utterances[0].onend();
  assert.equal(h.events.at(-1)[1], 'complete');
  assert.match(h.events.at(-1)[2], /unavailable/);
});

test('Late-loading English voices are selected before two-speaker speech is queued', () => {
  const h = harness({ voices: [] });
  h.speaker.play('two', 'The first speaker has a claim. The second responds.', { variant: 'two-speakers' });
  assert.equal(h.utterances.length, 0); assert.equal(h.listeners.size, 1);
  h.setVoices([{ lang: 'en-GB', name: 'Alice' }, { lang: 'en-GB', name: 'Bob' }]);
  assert.equal(h.utterances.length, 1); assert.equal(h.listeners.size, 0);
  h.utterances[0].onstart(); h.utterances[0].onend();
  assert.equal(h.utterances[0].voice.name, 'Alice');
  assert.equal(h.utterances[1].voice.name, 'Bob');
  assert(!h.events.some(event => event[1] === 'complete'));
  h.utterances[1].onstart(); h.utterances[1].onend();
  assert.equal(h.events.at(-1)[1], 'complete');
});

test('Voice-loading timeout uses distinguishable fallback turns without losing words', () => {
  const h = harness({ voices: [] });
  const transcript = 'One long sentence still needs both speakers to take turns';
  h.speaker.play('fallback', transcript, { variant: 'two-speakers' });
  h.fire(1500);
  assert.equal(h.listeners.size, 0);
  h.utterances[0].onstart(); h.utterances[0].onend();
  assert.equal(h.utterances.length, 2);
  assert.notEqual(h.utterances[0].pitch, h.utterances[1].pitch);
  assert.equal(h.utterances.map(u => u.text).join(' '), transcript);
  h.utterances[1].onstart(); h.utterances[1].onend();
  assert.equal(h.events.at(-1)[1], 'complete');
});

test('Cancellation while voices are loading removes listeners and ignores late callbacks', () => {
  const h = harness({ voices: [] });
  h.speaker.play('old', 'This attempt is cancelled.', { variant: 'two-speakers' });
  const callback = [...h.listeners][0];
  h.speaker.cancel();
  h.setVoices([{ lang: 'en-US', name: 'English' }]); callback(); h.fire(1500);
  assert.equal(h.utterances.length, 0);
  assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.events.at(-1)[1], 'error');
});

test('Voice and speech errors do not leave ambient audio or timers running', () => {
  for (const method of ['getVoices', 'speak']) {
    const h = harness(); h.env.speechSynthesis[method] = () => { throw Error('unavailable'); };
    h.speaker.play(method, 'A practice recording.', { variant: 'ambient' });
    assert.equal(h.events.at(-1)[1], 'error');
    assert.equal(h.nodes.length, 0); assert.equal(h.timers.size, 0);
  }
});

test('A late audio-resume promise cannot start effects after cancellation', async () => {
  const h = harness({ suspended: true });
  let resolveResume;
  h.env.AudioContext.prototype.resume = function () { return new Promise(resolve => { resolveResume = () => { this.state = 'running'; resolve(); }; }); };
  h.speaker.play('old', 'An interrupted recording.', { variant: 'ambient' });
  h.utterances[0].onstart(); h.speaker.cancel();
  resolveResume(); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.nodes.length, 0);
  assert.equal(h.events.at(-1)[1], 'error');
});

test('Each speaker turn must start and finish before the question is complete', () => {
  const h = harness();
  h.speaker.play('two', 'First sentence. Second sentence.', { variant: 'two-speakers' });
  h.utterances[0].onstart(); h.utterances[0].onend();
  h.fire(8000);
  assert.equal(h.events.at(-1)[1], 'error');
  h.utterances[1].onend();
  assert(!h.events.some(event => event[1] === 'complete'));
});

test('Two-speaker segmentation preserves punctuation, quotes and every spoken word', () => {
  const h = harness();
  const transcript = 'She said, "Evidence matters." A value of 3.5 is plausible! Why? The final clause';
  h.speaker.play('quoted', transcript, { variant: 'two-speakers' });
  for (let i = 0; i < h.utterances.length; i++) { h.utterances[i].onstart(); h.utterances[i].onend(); }
  assert.equal(h.utterances.map(u => u.text).join(' '), transcript);
});

test('Every HIW question in practice, mocks and review keeps its complete transcript and answer key', () => {
  const questions = [];
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'hiw') questions.push(value);
    Object.values(value).forEach(walk);
  };
  walk(bank);
  assert(questions.length >= 10);
  const variants = new Set();
  for (const q of questions) {
    const h = harness(), before = JSON.stringify(q), profile = tools.audioPlayback(q);
    variants.add(profile.variant);
    h.speaker.play(q.uid || q.id, q.audioText, profile);
    for (let i = 0; i < h.utterances.length; i++) {
      h.utterances[i].onstart();
      h.fire(700);
      h.utterances[i].onend();
    }
    assert.equal(h.utterances.map(u => u.text).join(' ').replace(/\s+/g, ' ').trim(), q.audioText.replace(/\s+/g, ' ').trim());
    assert.equal(h.events.at(-1)[1], 'complete');
    assert.equal(JSON.stringify(q), before);
    assert.equal(tools.scoreExtra(q, q.answers).earned, q.answers.length);
    assert.equal(h.timers.size, 0);
    if (profile.variant === 'two-speakers') assert(h.utterances.length >= 2);
    if (profile.variant === 'ambient') assert(h.nodes.some(node => node.kind === 'buffer' && node.started));
    if (profile.variant === 'sound-cue') assert(h.nodes.some(node => node.kind === 'oscillator' && node.started));
  }
  assert.deepEqual([...variants].sort(), ['ambient', 'sound-cue', 'two-speakers']);
});

test('Opening a HIW practice question unlocks audio in the click before its countdown', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const h = harness({ suspended: true }), values = new Map(), intervals = [];
  let now = 100000;
  const host = { hidden: false, innerHTML: '', replaceChildren() { this.innerHTML = ''; }, querySelector() { return null; }, querySelectorAll() { return []; } };
  const ctx = { ...h.env, currentUserId: 'audio-student',
    document: { getElementById: () => host, hidden: false },
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) },
    fetch: async () => ({ ok: true, json: async () => bank }),
    AbortSignal: { timeout() {} },
    Date: class extends Date { static now() { return now; } },
    setInterval: fn => { intervals.push(fn); return intervals.length; }, clearInterval() {}, confirm: () => true };
  vm.createContext(ctx);
  for (const file of ['reading-mock-tools', 'reading-exam-player', 'reading-session-timing', 'reading-review', 'reading-practice']) {
    vm.runInContext(fs.readFileSync(require.resolve('../public/' + file), 'utf8'), ctx);
  }
  await ctx.ReadingPractice.open();
  const q = bank.practiceLibraries.find(l => l.id === 'hiw').questions.find(q => tools.audioPlayback(q).variant === 'ambient');
  await h.gesture(() => host.onclick({ target: { closest: () => ({ dataset: { practiceUid: q.uid }, disabled: false }) } }));
  assert.equal(h.contexts[0].state, 'running');
  assert.equal(h.utterances.length, 0);
  now += (bank.mixedMock.audioPreparationSeconds + 1) * 1000;
  intervals.forEach(fn => fn());
  assert.equal(h.utterances.length, 1);
  h.utterances[0].onstart();
  assert(h.nodes.some(node => node.kind === 'buffer' && node.started));
  h.utterances[0].onend();
  const saved = JSON.parse(values.get('ipt_reading_v1:audio-student'));
  assert.equal(saved.session.audioStates[q.uid].status, 'complete');
  ctx.ReadingPractice.leave();
});
