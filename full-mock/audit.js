'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TASKS, SECTIONS, VERSION } = require('./blueprint');
const { RUBRICS, VERSION_EXPORTS } = require('./rubrics');
const { inspectMp3 } = require('../scripts/validate-writing-audio');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const words = value => String(value || '').trim().split(/\s+/u).filter(Boolean);
const text = value => typeof value === 'string' && !!value.trim();
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const taskByType = new Map(TASKS.map(task => [task.type, task]));

function readAsset(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw Error('Invalid asset path');
  const base = fs.realpathSync(root), resolved = fs.realpathSync(path.resolve(base, relative));
  if (path.relative(base, resolved).startsWith('..' + path.sep) || resolved === base) throw Error('Asset escapes repository');
  return fs.readFileSync(resolved);
}

function scoringSnapshot(root) {
  const files = {};
  const sources = [...Object.values(RUBRICS).flatMap(rubric => rubric.files), 'full-mock/blueprint.js', 'full-mock/rubrics.js', 'server.js'];
  for (const name of [...new Set(sources)].sort()) {
    const bytes = readAsset(root, name), source = bytes.toString('utf8');
    const key = VERSION_EXPORTS[name];
    const declaration = key ? source.match(new RegExp(`\\bconst\\s+${key}\\s*=\\s*([^;\\n]+)`))?.[1].trim() : null;
    if (key && !declaration) throw Error('Missing scoring version in ' + name);
    const version = declaration?.match(/^['"]([^'"]+)['"]$/)?.[1] || null;
    files[name] = { sha256: hash(bytes), version, ...(declaration && !version ? { versionExpression: declaration } : {}) };
  }
  return { schemaVersion: 1, blueprintVersion: VERSION, files };
}

// Hash all answer keys, references, instructions, timing and source descriptors.
// A review cannot silently survive a change to any of these fields or assets.
function candidateFingerprint(candidate) {
  const { id, question, audio = null, image = null, displayImage = null } = candidate;
  return hash(JSON.stringify({ id, question, audio, image, displayImage }));
}

function keyIssues(q) {
  const issues = [], fail = message => issues.push(message);
  const answers = q.answers;
  const choices = q.choices;
  if (['mcsa', 'lmcsa', 'hcs', 'smw'].includes(q.type)) {
    if (!Array.isArray(choices) || choices.length < 2 || !choices.every(text) || !Number.isInteger(q.answer) || q.answer < 0 || q.answer >= choices.length) fail('Invalid single-answer key or choices.');
  } else if (['mcma', 'lmcma', 'hiw'].includes(q.type)) {
    const limit = q.type === 'hiw' ? words(q.passage).length : choices?.length;
    if (q.type !== 'hiw' && (!Array.isArray(choices) || choices.length < 2 || !choices.every(text))) fail('Invalid multiple-answer choices.');
    if (!Array.isArray(answers) || !answers.length || new Set(answers).size !== answers.length || !answers.every(n => Number.isInteger(n) && n >= 0 && n < limit)) fail('Invalid multiple-answer key.');
    if (q.type === 'hiw') {
      const heard = words(q.text), shown = words(q.passage);
      const changed = shown.flatMap((word, i) => word !== heard[i] ? [i] : []);
      if (!heard.length || shown.length !== heard.length || !Array.isArray(answers) || !equal(changed, [...answers].sort((a, b) => a - b))) fail('HIW keys do not match changed transcript positions.');
    }
  } else if (['dropdown', 'wordbank', 'lfi'].includes(q.type)) {
    const markers = [...String(q.passage || '').matchAll(/\[\[(\d+)\]\]/g)].map(match => Number(match[1]));
    if (!Array.isArray(answers) || !answers.length || !answers.every(text) || !equal(markers, answers.map((_, i) => i + 1))) fail('Blank coordinates and answer keys do not match.');
    else if (q.type === 'dropdown' && (!Array.isArray(q.options) || q.options.length !== answers.length || !answers.every((answer, i) => Array.isArray(q.options[i]) && q.options[i].includes(answer)))) fail('Dropdown key is absent from its options.');
    else if (q.type === 'wordbank') {
      const available = Array.isArray(q.bank) ? [...q.bank] : [];
      for (const answer of answers) { const index = available.indexOf(answer); if (index < 0) { fail('Drag-and-drop key is absent from the word bank.'); break; } available.splice(index, 1); }
    } else if (q.type === 'lfi' && q.passage.replace(/\[\[(\d+)\]\]/g, (_, n) => answers[n - 1]) !== q.text) fail('Typed blanks do not reconstruct the recording transcript.');
  } else if (q.type === 'reorder') {
    const keys = Array.isArray(q.items) ? q.items.map(item => item?.key) : [];
    if (keys.length < 2 || keys.some(key => key == null) || new Set(keys).size !== keys.length || !q.items.every(item => text(item?.text)) || !Array.isArray(answers) || answers.length !== keys.length || new Set(answers).size !== answers.length || !answers.every(key => keys.includes(key))) fail('Reorder key is not a permutation of its text boxes.');
  } else if (q.type === 'asq') {
    if (!Array.isArray(q.acceptedAnswers) || !q.acceptedAnswers.length || !q.acceptedAnswers.every(text)) fail('ASQ requires an explicit accepted-answer list.');
  } else if (q.type === 'di') {
    if (!Array.isArray(q.facts) || !q.facts.length || !q.facts.every(text) || !text(q.sample)) fail('Describe Image requires verified facts and a reference response.');
  } else if (['swt', 'sst', 'essay', 'rl', 'sgd', 'rts'].includes(q.type)) {
    const points = q.keyPoints || q.facts;
    if (!Array.isArray(points) || !points.length || !points.every(text) || !text(q.sample)) fail('A rubric reference and reference response are required.');
  }
  return issues;
}

function checkAudio(candidate, task, root, fail) {
  if (!task.timing.audio) return null;
  const { question: q, audio } = candidate, entry = audio?.entry;
  if (q.audioMode === 'runtime-neural' || q.audioPrompt === false || !entry) {
    fail('audio-unfrozen', 'A fixed recording and transcript manifest are required.'); return null;
  }
  try {
    const bytes = readAsset(root, audio.path);
    if (hash(bytes) !== entry.audioSha256 || bytes.length !== entry.bytes || hash(q.text || '') !== entry.textSha256 || !inspectMp3(bytes).valid) {
      fail('audio-integrity', 'Recording bytes, MP3 frames or transcript hashes do not match.'); return null;
    }
    const bounds = task.timing.promptSeconds;
    if (!Number.isFinite(entry.seconds) || entry.seconds <= 0 || bounds && (entry.seconds < bounds[0] || entry.seconds > bounds[1])) fail('audio-duration', 'Recording duration is outside this task’s published prompt range.');
    if (task.speakers && (!Array.isArray(entry.voices) || new Set(entry.voices).size !== task.speakers)) fail('audio-speakers', 'SGD requires three distinct recorded voices.');
    return { sha256: entry.audioSha256, seconds: entry.seconds };
  } catch { fail('audio-missing', 'The bundled recording cannot be read safely.'); return null; }
}

function checkImage(descriptor, root, fail, code) {
  if (!descriptor?.sha256) { fail(code, 'A pinned image and source hash are required.'); return null; }
  try {
    const bytes = readAsset(root, descriptor.path);
    if (bytes.length < 24 || hash(bytes) !== descriptor.sha256) { fail(code, 'Image bytes do not match the reviewed source.'); return null; }
    // Source PNG dimensions are useful evidence; resolution alone does not
    // establish readable labels. That remains an explicit visual review.
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    return { sha256: descriptor.sha256, ...(png ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : {}) };
  } catch { fail(code, 'The image cannot be read safely.'); return null; }
}

function validStamp(value) {
  if (!text(value?.reviewer) || !text(value?.evidence) || !/^\d{4}-\d{2}-\d{2}$/.test(value?.date || '')) return false;
  const date = new Date(value.date + 'T00:00:00.000Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value.date;
}

function auditCandidate(candidate, { root, review } = {}) {
  const q = candidate.question || {}, task = taskByType.get(q.type), issues = [];
  const fail = (code, message) => issues.push({ code, message });
  const fingerprint = candidateFingerprint(candidate);
  if (!text(candidate.id) || !task) return { id: candidate.id, type: q.type, fingerprint, eligible: false, structurallyValid: false, issues: [{ code: 'unknown-task', message: 'A known task and namespaced candidate ID are required.' }] };
  if (!text(q.instruction || q.instructions || q.prompt)) fail('instruction-missing', 'Explicit full-mock task instructions are required.');
  if (q.type !== 'di' && q.type !== 'reorder' && !text(q.text || q.passage)) fail('prompt-missing', 'The prompt or transcript is missing.');
  keyIssues(q).forEach(message => fail('answer-key', message));
  const prompt = q.type === 'reorder' ? (Array.isArray(q.items) ? q.items : []).map(item => item?.text || '').join(' ') : q.passage || q.text;
  if (task.maxPromptWords && words(prompt).length > task.maxPromptWords) fail('prompt-length', 'The prompt exceeds the published word limit.');
  if (task.timing.preparationSeconds && (!Number.isFinite(q.preparation) || q.preparation < task.timing.preparationSeconds[0] || q.preparation > task.timing.preparationSeconds[1])) fail('preparation-timing', 'Preparation time does not match the task contract.');
  if (task.timing.mode === 'per-item') {
    const seconds = q.seconds ?? (Number.isFinite(q.minutes) ? q.minutes * 60 : null);
    if (task.timing.responseSeconds === null ? !Number.isFinite(seconds) || seconds <= 0 : seconds !== task.timing.responseSeconds) fail('response-timing', 'A valid task-specific response time is required.');
  }
  if (task.speakers && (!Array.isArray(q.turns) || q.turns.some(turn => !Array.isArray(turn) || !text(turn[0]) || !text(turn[1])) || new Set(q.turns.map(turn => turn[0])).size !== task.speakers)) fail('discussion-speakers', 'SGD requires exactly three speakers in its transcript.');
  const audio = checkAudio(candidate, task, root, fail);
  const image = task.image ? checkImage(candidate.image, root, fail, 'image-integrity') : null;
  const displayImage = candidate.displayImage ? checkImage(candidate.displayImage, root, fail, 'display-image-integrity') : null;
  const structurallyValid = issues.length === 0;
  if (review?.fingerprint !== fingerprint) fail('review-stale-or-missing', 'The review must match this candidate and its current asset hashes.');
  const current = review?.fingerprint === fingerprint ? review : {};
  if (!validStamp(current.rights) || !['original', 'licensed'].includes(current.rights.status)) fail('rights-review', 'Original authorship or a suitable licence needs recorded evidence.');
  if (!validStamp(current.answerKey)) fail('answer-key-review', 'The answer key or rubric reference needs an editorial review.');
  if (!validStamp(current.difficulty) || !['easy', 'medium', 'hard'].includes(current.difficulty.band) || !['editorial', 'empirical'].includes(current.difficulty.basis)) fail('difficulty-review', 'Record editorial difficulty or empirical evidence; neither adjusts scores.');
  if (!validStamp(current.instructions)) fail('instruction-review', 'Full-mock instructions need a recorded review.');
  if (task.timing.audio && !validStamp(current.audio)) fail('audio-review', 'The actual recording needs a listening review.');
  if (task.image && !validStamp(current.visual)) fail('visual-review', 'Chart labels, facts and displayed image need a visual review.');
  return { id: candidate.id, type: q.type, fingerprint, structurallyValid, eligible: !issues.length, audio, image, displayImage,
    difficulty: current.difficulty?.band || null, issues };
}

function stimulus(candidate) {
  const q = candidate.question;
  if (q.type === 'di') return candidate.image?.sha256 || '';
  if (q.type === 'reorder') return (q.answers || []).map(key => q.items?.find(item => item.key === key)?.text || '').join(' ');
  return q.text || String(q.passage || '').replace(/\[\[(\d+)\]\]/g, (_, n) => q.answers?.[n - 1] || '');
}
function duplicates(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const normalized = words(String(stimulus(candidate)).normalize('NFKC').toLowerCase()).join(' ');
    // A Read Aloud excerpt must also exclude its parent lecture from Listening,
    // even when its own shorter text has a different stimulus hash.
    const sourceIds = new Set([candidate.question.sourceId, candidate.question.audioId,
      candidate.audio?.path?.match(/^content\/writing-audio\/([^/]+)\.mp3$/)?.[1]].filter(Boolean));
    const keys = [normalized && 'stimulus:' + hash(normalized), candidate.audio?.path && 'audio:' + candidate.audio.path,
      ...[...sourceIds].map(id => 'source:' + id)].filter(Boolean);
    for (const key of keys) { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(candidate.id); }
  }
  return [...groups.entries()].filter(([, ids]) => new Set(ids).size > 1).map(([key, ids]) => ({ key, ids: [...new Set(ids)] }));
}

function validateSelection(candidates) {
  const issues = [];
  if (candidates.length !== 65) issues.push('A full mock requires exactly 65 scored questions.');
  if (new Set(candidates.map(candidate => candidate.id)).size !== candidates.length) issues.push('Duplicate candidate IDs.');
  let previous = -1;
  for (const candidate of candidates) {
    const index = TASKS.findIndex(task => task.type === candidate.question.type);
    if (index < 0 || index < previous) issues.push('Invalid task order.');
    previous = index;
  }
  for (const task of TASKS) if (candidates.filter(candidate => candidate.question.type === task.type).length !== task.count) issues.push('Incorrect question count: ' + task.type);
  if (duplicates(candidates).length) issues.push('Repeated passages, recording sources or images.');
  return [...new Set(issues)];
}

function auditInventory({ root, candidates, reviews = {}, lock }) {
  const snapshot = scoringSnapshot(root), scoringDrift = [];
  const expected = lock?.snapshot;
  if (expected?.schemaVersion !== snapshot.schemaVersion || expected?.blueprintVersion !== VERSION) scoringDrift.push('scoring-lock-version');
  for (const file of new Set([...Object.keys(snapshot.files), ...Object.keys(expected?.files || {})])) {
    if (!equal(snapshot.files[file], expected?.files?.[file])) scoringDrift.push(file);
  }
  const results = candidates.map(candidate => auditCandidate(candidate, { root, review: reviews[candidate.id] }));
  const tasks = TASKS.map(task => {
    const rows = results.filter(row => row.type === task.type), eligible = rows.filter(row => row.eligible);
    return { type: task.type, required: task.count, available: rows.length, structurallyValid: rows.filter(row => row.structurallyValid).length,
      reviewedEligible: eligible.length, shortfall: Math.max(0, task.count - eligible.length), skills: task.skills,
      rubricRule: RUBRICS[task.type].rule, scorer: RUBRICS[task.type].implementation || 'existing-task-service',
      difficultyBands: [...new Set(eligible.map(row => row.difficulty))].sort() };
  });
  return { schemaVersion: 1, blueprintVersion: VERSION, scope: 'existing-sectional-paper-candidates',
    sourceCommit: lock?.sourceCommit || null, auditBaseCommit: lock?.baseCommit || lock?.sourceCommit || null,
    sections: SECTIONS, scoredQuestions: 65, taskTypes: 22,
    scoringDependenciesPinned: !scoringDrift.length, scoringDrift, tasks,
    contentReady: tasks.every(task => !task.shortfall),
    difficultyCoverage: Object.fromEntries(SECTIONS.map(section => [section.id,
      [...new Set(results.filter(row => row.eligible && taskByType.get(row.type)?.section === section.id).map(row => row.difficulty))].sort()])),
    fullMockReady: false, // Player, scoring, reporting and calibration are later phases.
    unresolved: [
      RUBRICS.asq.implementation === 'missing' ? 'ASQ content, accepted-answer scoring and recording support belong to Phase 2.' : 'ASQ is available in Full Mock authoring; the legacy sectional inventory does not include it.',
      'This legacy inventory is not a paper. Validate the separate frozen Full Mock 1 selection with validate:full-mock-1.',
      'Verify the five weighting profiles before Phase 4. Published <1% values must not become invented exact percentages.',
      'The partners-report URL currently opens an Institution Score Guide; verify the weighting source before locking it.',
      'Do not use sectional /90 estimates or the holistic speaking-mock estimate as full-mock raw marks.',
      'Runtime model/provider settings must be captured per frozen attempt; the lock pins source code, not production configuration.'
    ],
    duplicateStimuli: duplicates(candidates), candidates: results };
}
module.exports = { hash, readAsset, scoringSnapshot, candidateFingerprint, keyIssues, auditCandidate, duplicates, validateSelection, auditInventory };
