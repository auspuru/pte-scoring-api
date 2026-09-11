'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../public/reading-mock-tools');
const bank = require('../public/reading-bank.json');

function harness({ voices = [{ lang: 'en-GB', name: 'British' }, { lang: 'en-US', name: 'American' }], suspended = false } = {}) {
  const utterances = [], events = [], nodes = [], contexts = [], timers = new Map(), listeners = new Set();
  let nextTimer = 0, gesture = false;
  const param = () => ({ value: 0, values: [], setValueAtTime(value) { this.value = value; this.values.push(value); }, linearRampToValueAtTime(value) { this.value = value; this.values.push(value); }, exponentialRampToValueAtTime(value) { this.value = value; this.values.push(value); } });
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
      createBuffer(channels, length) { const samples = new Float32Array(length); return { getChannelData: () => samples }; }
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
  h.fire(700);
  const lateCue = [...h.timers.values()].find(timer => timer.ms === 18000).fn;
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

test('Every HIW combines two voices, both cues and a varied background without changing its answers', () => {
  const questions = [];
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'hiw') questions.push(value);
    Object.values(value).forEach(walk);
  };
  walk(bank);
  assert(questions.length >= 10);
  const backgrounds = new Set();
  for (const q of questions) {
    const h = harness(), before = JSON.stringify(q), profile = tools.audioPlayback(q);
    assert.equal(profile.variant, 'mixed'); assert.equal(profile.speakers, 2);
    assert.deepEqual(profile.cues, ['woodpecker-chirp', 'phone-ring']);
    backgrounds.add(profile.background);
    h.speaker.play(q.uid || q.id, q.audioText, profile);
    for (let i = 0; i < h.utterances.length; i++) {
      h.utterances[i].onstart(); h.fire(700); h.fire(4500); h.utterances[i].onend();
    }
    assert.equal(h.utterances.map(u => u.text).join(' ').replace(/\s+/g, ' ').trim(), q.audioText.replace(/\s+/g, ' ').trim());
    assert.equal(h.events.at(-1)[1], 'complete');
    assert.equal(JSON.stringify(q), before);
    assert.equal(tools.scoreExtra(q, q.answers).earned, q.answers.length);
    assert.equal(h.timers.size, 0);
    assert(h.utterances.length >= 2);
    assert.notEqual(h.utterances[0].voice.name, h.utterances[1].voice.name);
    assert(h.nodes.some(node => node.kind === 'buffer' && node.started));
    assert(h.nodes.some(node => node.kind === 'oscillator' && node.frequency.values.includes(1700)));
    assert(h.nodes.some(node => node.kind === 'oscillator' && node.frequency.values.includes(660)));
  }
  assert.deepEqual([...backgrounds].sort(), ['office', 'rain', 'traffic', 'wind']);
});

test('The four backgrounds remain varied while both cue sounds recur at a fixed level', () => {
  const questions = bank.practiceLibraries.find(l => l.id === 'hiw').questions, textures = [];
  for (const background of tools.AUDIO_BACKGROUNDS) {
    const q = questions.find(item => tools.audioPlayback(item).background === background.id);
    const h = harness(), profile = tools.audioPlayback(q);
    h.speaker.play(q.uid, q.audioText, profile); h.utterances[0].onstart();
    const samples = h.nodes.find(node => node.kind === 'buffer').buffer.getChannelData(0);
    assert(samples.some(value => Math.abs(value) > 0.05));
    textures.push(Array.from(samples.slice(0, 100)));
    h.fire(700); h.fire(4500);
    assert.equal(h.nodes.filter(node => node.kind === 'oscillator').length, 7);
    h.fire(18000); h.fire(21000);
    assert.equal(h.nodes.filter(node => node.kind === 'oscillator').length, 14);
    assert.equal(h.nodes.find(node => node.kind === 'gain').gain.value, 0.55);
    h.speaker.cancel();
    assert(h.nodes.every(node => node.disconnected));
    assert.equal(h.timers.size, 0);
  }
  for (let i = 0; i < textures.length; i++) for (let j = i + 1; j < textures.length; j++) assert.notDeepEqual(textures[i], textures[j]);
});


test('HIW distraction volume and background are fixed and ignore obsolete options', () => {
  const h = harness(), q = bank.practiceLibraries.find(l => l.id === 'hiw').questions[0], expected = tools.audioPlayback(q);
  const other = tools.AUDIO_BACKGROUNDS.find(item => item.id !== expected.background).id;
  assert.deepEqual(tools.audioPlayback(q, true, { background: other, distractionLevel: 0 }), expected);
  h.speaker.play(q.uid, q.audioText, { ...expected, distractionLevel: 0 });
  h.utterances[0].onstart();
  assert.equal(h.nodes.find(node => node.kind === 'gain').gain.value, 0.55);
  assert.equal(h.speaker.updateDistractions, undefined);
  h.speaker.cancel();
});

async function readingClient() {
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
  return { ...h, ctx, host, values,
    click: dataset => h.gesture(() => host.onclick({ target: { closest: () => ({ dataset, disabled: false, setAttribute() {} }) } })),
    countdown() { now += (bank.mixedMock.audioPreparationSeconds + 1) * 1000; intervals.forEach(fn => fn()); },
    snapshot: () => JSON.parse(values.get('ipt_reading_v1:audio-student'))
  };
}

async function readingClient() {
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
  return { ...h, ctx, host, values,
    click: dataset => h.gesture(() => host.onclick({ target: { closest: () => ({ dataset, disabled: false, setAttribute() {} }) } })),
    countdown() { now += (bank.mixedMock.audioPreparationSeconds + 1) * 1000; intervals.forEach(fn => fn()); },
    snapshot: () => JSON.parse(values.get('ipt_reading_v1:audio-student'))
  };
}

test('HIW practice has no sound controls and uses automatic fixed distraction audio', async () => {
  const h = await readingClient(), q = bank.practiceLibraries.find(l => l.id === 'hiw').questions[0];
  await h.click({ practiceUid: q.uid });
  assert.equal(h.contexts[0].state, 'running');
  assert.doesNotMatch(h.host.innerHTML, /data-audio-background|data-audio-level|Distraction volume/);
  const profile = tools.audioPlayback(q);
  assert.equal(profile.cues.length, 2);
  assert(profile.cues.includes('woodpecker-chirp') && profile.cues.includes('phone-ring'));
  assert.equal(h.utterances.length, 0);
  h.countdown();
  assert.equal(h.utterances.length, 1);
  for (let i = 0; i < h.utterances.length; i++) { h.utterances[i].onstart(); h.fire(700); h.fire(4500); h.utterances[i].onend(); }
  assert.equal(h.snapshot().session.audioStates[q.uid].status, 'complete');
  assert(h.nodes.some(node => node.kind === 'buffer' && node.started));
  assert(h.nodes.some(node => node.kind === 'oscillator' && node.frequency.values.includes(660)));
  h.ctx.ReadingPractice.leave();
});

test('Infrastructure practice warns before incomplete submission and grades six correct selections after listening finishes', async () => {
  const h = await readingClient(), q = bank.practiceLibraries.find(l => l.id === 'hiw').questions.find(q => q.id === 'hiw-c2-07');
  await h.click({ practiceUid: q.uid });
  for (const index of q.answers) h.click({ hiwWord: String(index) });
  let warning;
  h.ctx.confirm = message => { warning = message; return false; };
  h.click({ action: 'submit' });
  assert.match(warning, /unassessed/); assert.equal(h.snapshot().session.done, false);
  h.countdown();
  for (let i = 0; i < h.utterances.length; i++) { h.utterances[i].onstart(); h.fire(700); h.fire(4500); h.utterances[i].onend(); }
  h.ctx.confirm = () => true; h.click({ action: 'submit' });
  const saved = h.snapshot();
  assert.equal(saved.history[0].earned, 6); assert.equal(saved.history[0].possible, 6);
  assert.equal(saved.history[0].excluded, 0);
  assert.doesNotMatch(h.host.innerHTML, /data-audio-background|data-audio-level|Distraction volume/);
  const count = h.utterances.length;
  h.click({ action: 'play', reviewUid: q.uid });
  h.utterances[count].onstart(); h.fire(700); h.fire(4500);
  assert.equal(h.snapshot().history[0].earned, 6);
  h.ctx.ReadingPractice.leave();
});

test('Review explains the saved audio failure without converting an incomplete attempt into a graded one', async () => {
  const h = await readingClient(), q = bank.practiceLibraries.find(l => l.id === 'hiw').questions[0];
  await h.click({ practiceUid: q.uid }); h.countdown();
  h.utterances[0].onerror({ error: 'not-allowed' });
  h.click({ action: 'submit' });
  assert.match(h.host.innerHTML, /Playback status:/);
  assert.match(h.host.innerHTML, /blocked autoplay/);
  assert.equal(h.snapshot().history[0].excluded, 1);
  h.ctx.ReadingPractice.leave();
});
