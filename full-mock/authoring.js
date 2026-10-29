'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TASKS } = require('./blueprint');
const { hash } = require('./audit');
const { items } = require('../content/full-mock/original-items');
const bank = require('../content/speaking-bank');
const root = path.resolve(__dirname, '..');
const shuffle = (values, seed) => values.map((value, index) => ({ value, rank: hash(seed + ':' + index) }))
  .sort((a, b) => a.rank.localeCompare(b.rank)).map(item => item.value);
const INSTRUCTIONS = {
  ra: 'Read the passage aloud after the start tone. Prepare for 35 seconds and finish within the recording time.',
  rs: 'Listen once. After the short start tone, repeat the sentence. You have 15 seconds to respond.',
  di: 'Study the visual for 25 seconds. After the tone, describe its main features and relationships within 40 seconds.',
  rl: 'Listen once, then use 10 seconds to prepare. After the tone, retell the lecture in your own words within 40 seconds.',
  asq: 'Listen once and answer in one word or a short phrase. Recording opens without a start tone. You have 10 seconds.',
  sgd: 'Listen to the three speakers once. Prepare for 10 seconds, then summarise their discussion within two minutes.',
  rts: 'Read and listen to the situation. Prepare for 10 seconds, then speak directly to the person named in the question within 40 seconds.',
  swt: 'Write one complete sentence summarising the passage in 5–75 words. You have 10 minutes.',
  essay: 'Write a 200–300 word essay addressing the prompt. You have 20 minutes.',
  dropdown: 'Choose the best option for each gap. This task uses the shared Reading section clock.',
  mcma: 'Select all correct responses. Each incorrect selection loses one point; the item score cannot fall below zero.',
  reorder: 'Put the text boxes in their logical order. Correct adjacent pairs receive credit.',
  wordbank: 'Place a word from the bank into each gap. Some words are not needed.',
  mcsa: 'Read the passage and select one response.',
  sst: 'Listen once and write a 50–70 word summary. Your 10 minutes include listening to the recording.',
  lmcma: 'Listen once and select all correct responses. Incorrect selections lose points, with a minimum item score of zero.',
  lfi: 'Listen once and type the missing words into the transcript. Check your spelling.',
  hcs: 'Listen once and select the summary that best represents the recording.',
  lmcsa: 'Listen once and select one response to the question.',
  smw: 'Listen once. A beep replaces the ending. Select the words that best complete the recording.',
  hiw: 'Follow the transcript while listening once. Select words that differ from the recording. Incorrect selections lose points, with a zero floor.',
  wfd: 'Listen once and type the sentence you hear. Check the words and their spelling.'
};
function readManifest(file) {
  return fs.existsSync(path.join(root, file)) ? JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) : {};
}
function definition() {
  const original = items.map(q => structuredClone(q));
  for (const [type, ids] of Object.entries({ ra: ['ra-1', 'ra-2', 'ra-3', 'ra-4', 'ra-5'], di: ['di-1', 'di-2', 'di-3', 'di-4', 'di-5'],
    rl: ['rl-3', 'rl-4'], sgd: ['sgd-1', 'sgd-2'], rts: ['rts-1', 'rts-2'] })) {
    ids.forEach((sourceId, index) => {
      const source = bank.questions.find(q => q.id === sourceId);
      if (!source) throw Error('Missing original teaching source: ' + sourceId);
      original.push({ ...structuredClone(source), id: `fm1-${type}-${String(index + 1).padStart(2, '0')}`, sourceId,
        contentOrigin: { kind: 'repository-original', source: 'content/speaking-bank.js', sourceId,
          sourceFingerprint: hash(JSON.stringify(source)), evidence: 'The speaking bank explicitly declares original teaching material; no user prediction item is selected.' } });
    });
  }
  return TASKS.flatMap(task => original.filter(q => q.type === task.type).sort((a, b) => a.id.localeCompare(b.id)).map(q => {
    const question = { ...q, instruction: INSTRUCTIONS[q.type] };
    const level = ['sgd', 'swt'].includes(q.type) || q.id === 'fm1-dropdown-05' ? 'hard'
      : ['ra', 'asq', 'wordbank'].includes(q.type) ? 'easy' : 'medium';
    question.difficulty = { band: level, basis: 'editorial', calibrated: false,
      rationale: level === 'hard' ? 'Requires connecting several ideas or speakers and preserving relationships.'
        : level === 'easy' ? 'A short direct prompt, simple visual or common grammatical relationship.'
          : 'Requires accurate detail, sentence structure or comparison of plausible alternatives.' };
    if (task.timing.preparationSeconds) question.preparation = q.type === 'ra' ? 35 : task.timing.preparationSeconds[0];
    if (task.timing.mode === 'per-item') question.seconds = task.timing.responseSeconds ?? 40;
    if (task.timing.audio) {
      question.playbackDelaySeconds = { lmcma: 7, lfi: 7, lmcsa: 5, hiw: 10 }[q.type] ?? 3;
      question.playOnce = true;
    }
    if (['ra', 'rs', 'di', 'rl', 'asq', 'sgd', 'rts'].includes(q.type)) question.startCueMs = q.type === 'asq' ? 0 : 300;
    if (['ra', 'rs', 'di', 'rl', 'asq'].includes(q.type)) question.silenceTimeoutSeconds = 3;
    if (task.section === 'reading') Object.assign(question, { minutes: 25, timeGroup: 'reading' });
    if (task.section === 'listening') Object.assign(question, { minutes: q.type === 'sst' ? 10 : 25, ...(q.type !== 'sst' ? { timeGroup: 'listening' } : {}) });
    if (q.type === 'dropdown') question.options = question.options.map((row, index) => shuffle(row, q.id + ':blank:' + index));
    if (Array.isArray(q.bank)) question.bank = shuffle(question.bank, q.id + ':bank');
    if (Array.isArray(q.choices)) {
      const order = shuffle(q.choices.map((_, index) => index), q.id + ':choices');
      question.choices = order.map(index => q.choices[index]);
      if (Number.isInteger(q.answer)) question.answer = order.indexOf(q.answer);
      if (Array.isArray(q.answers)) question.answers = q.answers.map(index => order.indexOf(index));
    }
    if (q.type === 'reorder') {
      const keys = Object.fromEntries(q.items.map(item => [item.key, hash(q.id + ':box:' + item.key).slice(0, 16)]));
      question.items = shuffle(q.items.map(item => ({ key: keys[item.key], text: item.text })), q.id + ':boxes');
      question.answers = q.answers.map(key => keys[key]);
    }
    return question;
  }));
}
function candidates() {
  const generated = readManifest('content/full-mock/audio-manifest.json');
  const visuals = readManifest('content/full-mock/visual-manifest.json');
  const speakingAudio = require('../content/speaking-audio-manifest')();
  return definition().map(question => {
    const candidate = { id: 'full-mock-1/' + question.id, question, origins: ['full-mock-1-v1-authoring'] };
    const task = TASKS.find(task => task.type === question.type);
    if (task.timing.audio) {
      const entry = generated[question.id];
      if (entry) candidate.audio = { path: entry.path, entry: structuredClone(entry) };
      else if (question.contentOrigin.kind === 'repository-original') {
        const key = question.promptAudioKey || question.sourceId;
        candidate.audio = { path: 'content/speaking-audio/' + key + '.mp3', entry: structuredClone(speakingAudio[key]) };
      }
    }
    if (visuals[question.id]) candidate.image = { path: visuals[question.id].path, sha256: visuals[question.id].sha256 };
    return candidate;
  });
}
module.exports = { INSTRUCTIONS, definition, candidates };
