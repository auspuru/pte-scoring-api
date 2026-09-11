'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { score } = require('../public/reading-practice');
const tools = require('../public/reading-mock-tools');
const bank = require('../public/reading-bank.json');

test('Reading answer choices are shuffled for display while answer coordinates and scoring remain unchanged', () => {
  let checked = 0;
  for (const set of bank.sets) for (const raw of set.questions) {
    const q = { ...raw, uid: `${set.id}:${raw.id}` }, prepared = tools.prepareQuestion(q, q.uid);
    const answers = raw.type === 'mcsa' ? [raw.answer] : raw.answers;
    assert.deepEqual(score(raw, answers), score(prepared, answers));
    if (raw.type === 'dropdown') {
      assert.equal(prepared.options.length, raw.options.length);
      raw.options.forEach((options, i) => { assert.deepEqual([...prepared.options[i]].sort(), [...options].sort()); assert(options.length < 2 || prepared.options[i].some((value, j) => value !== options[j])); checked++; });
    }
    if (raw.type === 'wordbank') { assert.deepEqual([...prepared.bank].sort(), [...raw.bank].sort()); assert(raw.bank.length < 2 || prepared.bank.some((value, i) => value !== raw.bank[i])); checked++; }
    if (raw.type === 'reorder') { assert.deepEqual(prepared.items.map(x => x.key).sort(), raw.items.map(x => x.key).sort()); assert(raw.items.length < 2 || prepared.items.some((item, i) => item.key !== raw.items[i].key)); checked++; }
    if (Array.isArray(raw.choices)) { assert.deepEqual(prepared.originalChoices, raw.choices); assert.deepEqual(prepared.choiceIndices.map(i => raw.choices[i]), prepared.choices); assert(raw.choices.length < 2 || prepared.choices.some((value, i) => value !== raw.choices[i])); checked++; }
  }
  assert(checked >= 40);
});

test('Choice feedback resolves the original answer after visible choices are shuffled', () => {
  for (const raw of bank.sets.flatMap(set => set.questions).filter(q => Array.isArray(q.choices))) {
    const prepared = tools.prepareQuestion({ ...raw, uid: raw.id }, raw.id);
    for (let i = 0; i < raw.choices.length; i++) assert.equal(tools.choiceText(prepared, i), raw.choices[i]);
  }
});

test('One-page review reports the original answer index after visible choices are shuffled', () => {
  const reviewSource = fs.readFileSync(require.resolve('../public/reading-review'), 'utf8');
  assert.match(reviewSource, /originalChoiceIndex/);
  const raw = bank.sets[0].questions.find(q => q.type === 'mcsa'), prepared = tools.prepareQuestion({ ...raw, uid: raw.id }, raw.id);
  const displayIndex = prepared.choiceIndices.indexOf(raw.answer);
  assert.equal(prepared.choices[displayIndex], raw.choices[raw.answer]);
  assert.notEqual(displayIndex, raw.answer);
});

test('HIW practice receives deterministic single, ambient, two-speaker and sound-cue variants', () => {
  const questions = bank.practiceLibraries.find(l => l.id === 'hiw').questions;
  const variants = questions.map(q => tools.audioVariant(q, true));
  assert(variants.includes('single')); assert(variants.includes('ambient')); assert(variants.includes('two-speakers')); assert(variants.includes('sound-cue'));
  assert.equal(tools.audioVariant(questions[0], true), tools.audioVariant(questions[0], true));
  assert.equal(tools.audioVariant({ type: 'hcs', id: 'hcs-test' }, true), 'single');
  assert.match(tools.audioPlayback({ ...questions.find(q => tools.audioVariant(q, true) === 'sound-cue') }, true).label, /woodpecker/i);
});

function speakerHarness() {
  const utterances = [], timeouts = [], events = [];
  const env = { SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: { getVoices: () => [{ lang: 'en-AU' }, { lang: 'en-US' }], speak: u => utterances.push(u), cancel() {} },
    setTimeout: fn => { timeouts.push(fn); return timeouts.length; }, clearTimeout() {} };
  return { env, utterances, timeouts, events, speaker: tools.createSpeaker(env, (...event) => events.push(event)) };
}

test('Two-speaker audio plays each sentence in sequence and completes only after both voices finish', () => {
  const h = speakerHarness(); h.speaker.play('hiw', 'First speaker explains the claim. Second speaker supplies the correction.', { variant: 'two-speakers' });
  assert.equal(h.utterances.length, 1); assert.equal(h.utterances[0].text, 'First speaker explains the claim.');
  h.utterances[0].onstart(); assert.equal(h.events.at(-1)[1], 'playing'); h.utterances[0].onend();
  assert.equal(h.utterances.length, 2); assert.equal(h.utterances[1].text, 'Second speaker supplies the correction.'); assert.equal(h.utterances[1].voice.lang, 'en-US');
  h.utterances[1].onstart(); h.utterances[1].onend(); assert.equal(h.events.at(-1)[1], 'complete');
});

test('Ambient and sound-cue layers degrade safely when Web Audio is blocked', () => {
  const h = speakerHarness(); h.env.AudioContext = class { constructor() { throw Error('blocked'); } };
  h.speaker.play('ambient', 'A short recording.', { variant: 'ambient' }); h.utterances[0].onstart(); h.utterances[0].onend();
  h.speaker.play('cue', 'A short recording.', { variant: 'sound-cue' }); h.utterances[1].onstart(); h.utterances[1].onend();
  assert.equal(h.events.filter(e => e[1] === 'complete').length, 2);
});

test('Every reading practice screen keeps a final Next question control after the answer area', () => {
  const source = fs.readFileSync(require.resolve('../public/reading-practice'), 'utf8');
  assert.match(source, /reading-next-action[^>]+data-move="1"/);
  const exam = fs.readFileSync(require.resolve('../public/reading-exam-player'), 'utf8');
  assert.match(exam, /reading-exam-next[^>]+data-action="exam-next"/);
});

 test('Saved questions migrate once without changing selected answer coordinates', () => {
 const raw = { uid: 'saved', type: 'mcsa', choices: ['a', 'b', 'c'], answer: 1 };
 const old = { ...raw, choices: ['c', 'a', 'b'], originalChoices: raw.choices, choiceIndices: [2,0,1] };
 const migrated = tools.prepareQuestion(old, 'saved-session');
 assert.equal(tools.choiceText(migrated, 1), 'b');
 assert.deepEqual(score(migrated, [1]), score(raw, [1]));
 assert.deepEqual(tools.prepareQuestion(migrated, 'another-device'), migrated);
 const words = { uid: 'saved-bank', bank: ['carries', 'contains', 'copy', 'observable', 'stores', 'encodes', 'version', 'heritable'] };
 const shuffled = tools.prepareQuestion(words, 'saved-session');
 assert.notDeepEqual(shuffled.bank, words.bank);
 assert.deepEqual(tools.prepareQuestion(shuffled, 'reload'), shuffled);
 });
