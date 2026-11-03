'use strict';
// Fixed, reviewed source selections. Reused recordings are copied by content hash;
// neither source banks nor historical frozen papers are changed.
const fs = require('node:fs');
const path = require('node:path');
const { digest, putImmutable } = require('./paper');
const { hash, readAsset, validateSelection, auditCandidate, scoringSnapshot } = require('./audit');
const { TASKS } = require('./blueprint');
const root = path.resolve(__dirname, '..');
const base = require('../content/full-mock/papers/full-mock-1.v2.json');
const writing = require('../content/writing-predictions-sep-2026');
const reading = require('../public/reading-predictions-sep-2026');
const readingBank = require('../public/reading-bank.json');
const speaking = require('../content/speaking-bank');
const essays = require('../content/writing-lab.json').predictionEssays;
const listening = require('../content/listening-mocks').mocks.flatMap(m => m.questions);
const speakingAudio = require('../content/speaking-audio-manifest')();
const writingAudio = require('../content/writing-audio/manifest.json');
const sourceFiles = ['full-mock/additional-papers.js', 'content/speaking-bank.js', 'content/user-sgd-oct30.json',
  'content/writing-predictions-sep-2026.js', 'content/writing-lab.json', 'public/reading-predictions-sep-2026.js',
  'public/reading-bank.json', 'content/listening-mocks.js'];
const clone = value => structuredClone(value);
const shuffle = (values, seed) => values.map((value, i) => ({ value, rank: hash(seed + ':' + i) })).sort((a, b) => a.rank.localeCompare(b.rank)).map(row => row.value);
const find = (rows, id) => { const q = rows.find(q => q.id === id); if (!q) throw Error('Missing source: ' + id); return clone(q); };
const seq = (prefix, start, count) => Array.from({ length: count }, (_, i) => prefix + String(start + i).padStart(2, '0'));
const selections = [
  { number: 2, ra: [...seq('pred26-user-swt-', 10, 5), 'pred26-swt-01'], rs: seq('pred26-wfd-', 15, 10),
    di: ['3000195', '3000589', '3000134', '3000586', '3000411'],
    rl: ['rl-user-wages-debt', 'rl-user-civilisation-ship'], sgd: seq('sgd-user-20261030-', 1, 2), rts: ['rts-3', 'rts-4'],
    swt: seq('pred26-user-swt-', 1, 2), essay: 2, dropdown: seq('pred26-rw-', 6, 5), wordbank: seq('pred26-r-', 5, 4), readingSet: 'v2',
    sst: 'pred26-sst-02', lmcma: ['listen-lmcma-sst-urban-trees', 'listen-lmcma-sst-community-museums'],
    hcs: ['listen-hcs-sst-sleep-memory', 'listen-hcs-sst-water-reuse'], wfd: ['pred26-wfd-26', 'pred26-wfd-27', 'pred26-wfd-28'] },
  { number: 3, ra: seq('pred26-swt-', 2, 6), rs: ['pred26-wfd-01', 'pred26-wfd-07', 'pred26-wfd-11', 'pred26-wfd-25', ...seq('pred26-wfd-', 29, 6)],
    di: ['3000561', '3000354', '3000349', '3000392', '3000375'],
    rl: ['rl-user-black-carbon', 'rl-user-morton-prince'], sgd: seq('sgd-user-20261030-', 3, 2), rts: ['rts-5', 'rts-user-tom-book'],
    swt: seq('pred26-user-swt-', 10, 2), essay: 3, dropdown: seq('pred26-rw-', 11, 5), wordbank: seq('pred26-r-', 9, 4), readingSet: 'v3',
    sst: 'pred26-sst-03', lmcma: ['listen-lmcma-sst-citizen-science', 'fm1-lmcma-02'],
    hcs: ['listen-hcs-sst-public-transport', 'listen-hcs-sst-digital-archives'], wfd: seq('pred26-wfd-', 2, 3) }
];
function excerpt(source) {
  let text = '';
  for (const sentence of source.text.split(/(?<=[.!?])\s+/u)) {
    const next = (text + ' ' + sentence).trim();
    if (next.split(/\s+/u).length > 60) break;
    text = next;
  }
  if (!text) throw Error('No complete RA excerpt: ' + source.id);
  return { ...source, text, sample: text };
}
function candidates(selection) {
  const rows = [];
  function add(type, source, file, { adaptation, original = source, audio, image } = {}) {
    const template = base.questions.find(c => c.question.type === type).question;
    const timing = Object.fromEntries(['instruction', 'difficulty', 'preparation', 'seconds', 'minutes', 'timeGroup', 'playbackDelaySeconds', 'playOnce', 'startCueMs', 'silenceTimeoutSeconds'].filter(k => template[k] !== undefined).map(k => [k, clone(template[k])]));
    const n = rows.filter(c => c.question.type === type).length + 1, id = `fm${selection.number}-${type}-${String(n).padStart(2, '0')}`;
    const content = clone(source);
    for (const key of ['preparation', 'seconds', 'minutes', 'timeGroup', 'playbackDelaySeconds', 'playOnce', 'startCueMs', 'silenceTimeoutSeconds']) delete content[key];
    const q = { ...content, ...timing, type, id, sourceId: original.id,
      contentOrigin: { kind: source.predictionSource ? 'prediction' : source.source?.kind === 'user-supplied-transcript' ? 'user-supplied' : 'repository-approved',
        source: file, sourceId: original.id, sourceFingerprint: digest(original), selectedAt: '2026-11-02', ...(adaptation ? { adaptation } : {}) } };
    delete q.audioSource; delete q.audioSeconds;
    if (type === 'dropdown') q.options = q.options.map((options, i) => shuffle(options, id + ':gap:' + i));
    if (Array.isArray(q.bank)) q.bank = shuffle(q.bank, id + ':bank');
    if (Array.isArray(q.choices)) {
      const order = shuffle(q.choices.map((_, i) => i), id + ':choices');
      q.choices = order.map(i => q.choices[i]);
      if (Number.isInteger(q.answer)) q.answer = order.indexOf(q.answer);
      if (Array.isArray(q.answers)) q.answers = q.answers.map(i => order.indexOf(i));
    }
    if (type === 'reorder') {
      const keys = Object.fromEntries(q.items.map(item => [item.key, hash(id + ':box:' + item.key).slice(0, 16)]));
      q.items = shuffle(q.items.map(item => ({ key: keys[item.key], text: item.text })), id + ':boxes');
      q.answers = q.answers.map(key => keys[key]);
    }
    // Essay bank rows use predictionNumber rather than an id.
    if (type === 'wfd') q.sample = q.text;
    if (type === 'rs' || type === 'ra') {
      q.sample = q.text;
      if (q.predictionSource) q.predictionSource = { ...q.predictionSource, task: type === 'ra' ? 'swt' : 'wfd', targetTask: type, contentStatus: 'adapted-for-full-mock', adaptation };
    }
    rows.push({ id: `full-mock-${selection.number}/${id}`, question: q, origins: [file, original.id], ...(audio ? { audio: clone(audio) } : {}), ...(image ? { image: clone(image) } : {}) });
  }
  function fromBase(type) {
    for (const c of base.questions.filter(c => c.question.type === type)) add(type, c.question, 'content/full-mock/papers/full-mock-1.v2.json', { audio: c.audio });
  }
  function spoken(type, id) {
    const q = find(speaking.questions, id), key = q.promptAudioKey || q.id;
    const entry = speakingAudio[key];
    if (!entry) throw Error('Missing fixed recording: ' + key);
    add(type, q, 'content/speaking-bank.js', { audio: { path: 'content/speaking-audio/' + key + '.mp3', entry } });
  }
  function writtenAudio(type, id) {
    const q = find(writing[type === 'rs' ? 'wfd' : type], id), entry = writingAudio[id];
    if (!entry) throw Error('Missing writing recording: ' + id);
    add(type, q, 'content/writing-predictions-sep-2026.js', { audio: { path: 'content/writing-audio/' + id + '.mp3', entry }, ...(type === 'rs' ? { adaptation: 'Existing WFD prediction sentence and unchanged recording used for Repeat Sentence.' } : {}) });
  }
  for (const id of selection.ra) { const q = find(writing.swt, id); add('ra', excerpt(q), 'content/writing-predictions-sep-2026.js', { original: q, adaptation: 'Complete opening sentences of a SWT source, used as a Read Aloud passage of at most 60 words.' }); }
  for (const id of selection.rs) writtenAudio('rs', id);
  for (const id of selection.di) {
    const q = find(speaking.questions, 'di-pred-' + id);
    if (!q.predictionSource?.suppliedFile || q.imageReference?.source?.kind !== 'image-sha256' || q.imageReference?.mapping?.category === 'photo') throw Error('Expected supplied DI chart: ' + id);
    add('di', q, 'content/di-user-predictions.json', { image: { path: 'public' + q.imageUrl, sha256: q.imageReference.source.sha256 } });
  }
  selection.rl.forEach(id => spoken('rl', id));
  fromBase('asq');
  selection.sgd.forEach(id => spoken('sgd', id));
  selection.rts.forEach(id => spoken('rts', id));
  selection.swt.forEach(id => add('swt', find(writing.swt, id), 'content/writing-predictions-sep-2026.js'));
  const essay = clone(essays[selection.essay - 1]); essay.id ||= 'writing-prediction-essay-' + selection.essay;
  add('essay', essay, 'content/writing-lab.json');
  for (const type of ['dropdown', 'mcma', 'reorder', 'wordbank', 'mcsa']) {
    const sources = ['dropdown', 'wordbank'].includes(type) ? selection[type].map(id => find(reading[type], id)) : find(readingBank.sets, selection.readingSet).questions.filter(q => q.type === type).slice(0, 2);
    for (const q of sources) add(type, q, ['dropdown', 'wordbank'].includes(type) ? 'public/reading-predictions-sep-2026.js' : 'public/reading-bank.json');
  }
  writtenAudio('sst', selection.sst);
  for (const type of ['lmcma', 'lfi', 'hcs', 'lmcsa', 'smw', 'hiw']) {
    if (!selection[type]) { fromBase(type); continue; }
    for (const id of selection[type]) {
      if (id.startsWith('fm1-')) { const c = base.questions.find(c => c.question.id === id); add(type, c.question, 'content/full-mock/papers/full-mock-1.v2.json', { audio: c.audio }); continue; }
      const q = find(listening, id), key = q.audioId || q.id;
      add(type, q, 'content/listening-mocks.js', { audio: { path: 'content/writing-audio/' + key + '.mp3', entry: writingAudio[key] } });
    }
  }
  selection.wfd.forEach(id => writtenAudio('wfd', id));
  return rows;
}
function manifest() {
  return selections.map(selection => ({ id: 'full-mock-' + selection.number, title: 'IPT Brisbane — Full Mock ' + selection.number, version: 1,
    audience: 'Same signed-in Full Mock audience as paper 1; existing access policy retained.', clockPolicy: base.clockPolicy,
    tasks: TASKS.map(t => ({ type: t.type, count: t.count })), selections: selection,
    media: '36 existing fixed recordings and five original supplied DI PNGs per paper; no runtime generation.',
    overlap: 'Reuses approved ASQ, LFI, LMCSA, SMW and HIW items from paper 1. Other sources explicitly selected above; cross-paper overlap allowed, intra-paper duplicates rejected.',
    catalogue: `content/full-mock/papers/full-mock-${selection.number}.v1.json` }));
}
function assemble(selection) {
  const questions = candidates(selection), issues = validateSelection(questions), assets = new Map();
  for (const c of questions) {
    const audit = auditCandidate(c, { root });
    if (!audit.structurallyValid) issues.push(c.id + ': ' + audit.issues.filter(i => !i.code.includes('review')).map(i => i.code).join(','));
  }
  if (issues.length) throw Error(issues.join('\n'));
  for (const c of questions) for (const field of ['audio', 'image']) {
    const d = c[field]; if (!d) continue;
    const bytes = readAsset(root, d.path), sha = hash(bytes), ext = field === 'audio' ? '.mp3' : '.png';
    const relative = 'content/full-mock/assets/' + sha + ext;
    putImmutable(root, relative, bytes); d.path = relative;
    if (field === 'audio') d.entry.path = relative;
    assets.set(relative, { path: relative, sha256: sha, bytes: bytes.length, mime: field === 'audio' ? 'audio/mpeg' : 'image/png' });
  }
  return { schemaVersion: 1, id: 'full-mock-' + selection.number, version: 1, title: 'IPT Brisbane — Full Mock ' + selection.number,
    status: 'frozen-draft', createdAt: '2026-11-02', baseCommit: '3a5f57485b4818f278b3ea6f915a697c2fa495ca', blueprintVersion: base.blueprintVersion,
    introduction: { ...clone(base.introduction), id: `fm${selection.number}-intro` }, clockPolicy: clone(base.clockPolicy),
    scoringSourcesAtFreeze: scoringSnapshot(root), sourceFiles: Object.fromEntries(sourceFiles.map(file => [file, hash(readAsset(root, file))])),
    editorial: { provenance: 'Fixed selections from approved portal banks and retained full mock sources; RA excerpts and RS adaptations are labeled. No claim that all questions are unseen or verbatim target-task predictions.',
      sourceKeyReview: 'Existing source keys, facts and samples retained; structural keys and duplicates checked.', difficultyBasis: 'Editorial only; no score adjustment.',
      visualReview: { status: 'assistant-reviewed', date: '2026-11-02', evidence: 'Original supplied chart images inspected against source facts; exact source bytes retained.' },
      humanListeningReview: 'pending', independentEditorialReview: 'pending', studentReleaseApproved: false },
    questions, assets: [...assets.values()].sort((a, b) => a.path.localeCompare(b.path)) };
}
module.exports = { selections, candidates, manifest, assemble };
