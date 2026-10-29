'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TASKS, INTRODUCTION, VERSION: blueprintVersion } = require('./blueprint');
const { hash, readAsset, auditCandidate, validateSelection, scoringSnapshot } = require('./audit');
const ROOT = path.resolve(__dirname, '..');
const DIRECTORY = 'content/full-mock/papers';
function canonical(value) {
  const sorted = input => Array.isArray(input) ? input.map(sorted) : input && typeof input === 'object'
    ? Object.fromEntries(Object.keys(input).sort().filter(key => input[key] !== undefined).map(key => [key, sorted(input[key])])) : input;
  return JSON.stringify(sorted(value));
}
const digest = value => hash(canonical(value));
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
function putImmutable(root, relative, bytes) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    if (!fs.readFileSync(target).equals(Buffer.from(bytes))) throw Error('Frozen file differs; create a new version: ' + relative);
    return;
  }
  // linkSync is atomic and refuses to replace an existing target.
  const temporary = target + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, bytes, { flag: 'wx' });
  try { fs.linkSync(temporary, target); } finally { fs.rmSync(temporary, { force: true }); }
}
function metadata(paper, sha256) {
  return { id: paper.id, version: paper.version, sha256, title: paper.title, status: paper.status,
    available: false, scoredQuestionCount: paper.questions.length, taskTypeCount: TASKS.length };
}
function validatePaper(paper, { root = ROOT } = {}) {
  const issues = [];
  if (paper.schemaVersion !== 1 || paper.blueprintVersion !== blueprintVersion || paper.id !== 'full-mock-1' || paper.version !== 1 || paper.status !== 'frozen-draft') issues.push('Unsupported frozen paper contract.');
  if (!Array.isArray(paper.questions)) return ['Missing paper questions.'];
  issues.push(...validateSelection(paper.questions));
  if (paper.introduction?.scored !== false || paper.introduction?.type !== 'intro' || paper.introduction?.preparationSeconds !== 25 || paper.introduction?.responseSeconds !== 30) issues.push('Invalid unscored introduction.');
  if (paper.clockPolicy?.readingSeconds !== 1500 || paper.clockPolicy?.listeningAfterSstSeconds !== 1500 || paper.clockPolicy?.sstSeconds !== 600 || paper.clockPolicy?.overallCountdown !== false) issues.push('Invalid section clock policy.');
  if (!paper.scoringSourcesAtFreeze?.files?.['full-mock/asq-scoring.js']) issues.push('The ASQ scorer source is not pinned.');
  const assetMap = new Map((paper.assets || []).map(asset => [asset.path, asset]));
  if (assetMap.size !== paper.assets?.length) issues.push('Duplicate asset descriptors.');
  const referenced = new Set();
  for (const candidate of paper.questions) {
    const audit = auditCandidate(candidate, { root });
    if (!audit.structurallyValid) issues.push(...audit.issues.filter(issue => !issue.code.includes('review')).map(issue => candidate.id + ': ' + issue.code));
    for (const descriptor of [candidate.audio, candidate.image].filter(Boolean)) {
      referenced.add(descriptor.path);
      const asset = assetMap.get(descriptor.path);
      const sha256 = descriptor.sha256 || descriptor.entry?.audioSha256;
      if (!asset || asset.sha256 !== sha256 || !descriptor.path.startsWith('content/full-mock/assets/' + sha256 + '.')) issues.push('Unpinned asset: ' + candidate.id);
    }
  }
  for (const asset of paper.assets || []) {
    if (!referenced.has(asset.path)) issues.push('Unreferenced paper asset: ' + asset.path);
    try {
      const bytes = readAsset(root, asset.path);
      if (hash(bytes) !== asset.sha256 || bytes.length !== asset.bytes) issues.push('Asset drift: ' + asset.path);
    } catch { issues.push('Missing paper asset: ' + asset.path); }
  }
  return [...new Set(issues)];
}
function freezePaper({ root = ROOT, candidates, lock, sourceCommit }) {
  const selectionIssues = validateSelection(candidates);
  for (const candidate of candidates) if (!auditCandidate(candidate, { root }).structurallyValid) selectionIssues.push('Technical checks failed: ' + candidate.id);
  if (canonical(scoringSnapshot(root)) !== canonical(lock.snapshot)) selectionIssues.push('Scoring source lock has drifted.');
  if (selectionIssues.length) throw Error(selectionIssues.join('\n'));
  const assets = new Map();
  const questions = candidates.map(source => {
    const candidate = structuredClone(source);
    for (const field of ['audio', 'image']) {
      const descriptor = candidate[field]; if (!descriptor) continue;
      const bytes = readAsset(root, descriptor.path), sha256 = hash(bytes), extension = field === 'audio' ? 'mp3' : 'svg';
      const relative = 'content/full-mock/assets/' + sha256 + '.' + extension;
      putImmutable(root, relative, bytes);
      descriptor.path = relative;
      if (field === 'audio') descriptor.entry.path = relative;
      assets.set(relative, { path: relative, sha256, bytes: bytes.length, mime: field === 'audio' ? 'audio/mpeg' : 'image/svg+xml' });
    }
    return candidate;
  });
  const sourceFiles = ['content/full-mock/original-items.js', 'full-mock/authoring.js', 'scripts/generate-full-mock-audio.py',
    'scripts/generate-full-mock-visuals.js', 'speaking-visuals.js', 'content/speaking-bank.js', 'content/full-mock/voice-model-source.json'];
  const paper = { schemaVersion: 1, id: 'full-mock-1', version: 1, title: 'IPT Brisbane — Full Mock 1', status: 'frozen-draft',
    createdAt: '2026-10-29', baseCommit: sourceCommit, blueprintVersion,
    introduction: { ...INTRODUCTION, id: 'fm1-intro', instruction: 'Introduce yourself after the preparation period. This familiarisation recording is not scored.' },
    clockPolicy: { overallCountdown: false, speakingWriting: 'per-item', readingSeconds: 1500, sstSeconds: 600,
      sstIncludesPlayback: true, listeningAfterSstSeconds: 1500, sharedListeningClockContinuesBetweenItems: true },
    scoringSourcesAtFreeze: structuredClone(lock.snapshot), sourceFiles: Object.fromEntries(sourceFiles.map(file => [file, hash(readAsset(root, file))])),
    editorial: { provenance: `${questions.filter(candidate => candidate.question.contentOrigin.kind === 'original').length} newly authored items and ${questions.filter(candidate => candidate.question.contentOrigin.kind === 'repository-original').length} repository-declared original speaking items; no recalled/prediction items.`,
      sourceKeyReview: 'AI-assisted authoring and source review; objective key explanations are retained with each item.',
      difficultyBasis: 'editorial labels only; not empirical calibration and never a score adjustment',
      visualReview: { status: 'assistant-reviewed', date: '2026-10-29', evidence: 'All five vectors rendered at 730×500; labels, quantities and reference facts inspected. Independent editorial review remains pending.' },
      humanListeningReview: 'pending', independentEditorialReview: 'pending', studentReleaseApproved: false },
    questions, assets: [...assets.values()].sort((a, b) => a.path.localeCompare(b.path)) };
  const issues = validatePaper(paper, { root });
  if (issues.length) throw Error(issues.join('\n'));
  const sha256 = digest(paper), relative = DIRECTORY + '/full-mock-1.v1.json';
  putImmutable(root, relative, JSON.stringify(paper, null, 2) + '\n');
  const catalogue = { schemaVersion: 1, papers: [{ ...metadata(paper, sha256), file: relative }] };
  putImmutable(root, DIRECTORY + '/catalogue.json', JSON.stringify(catalogue, null, 2) + '\n');
  return { ...metadata(paper, sha256), assetCount: paper.assets.length };
}
function catalogue({ root = ROOT } = {}) {
  const index = JSON.parse(readAsset(root, DIRECTORY + '/catalogue.json'));
  if (index.schemaVersion !== 1 || !Array.isArray(index.papers)) throw Error('Invalid frozen paper catalogue.');
  return index.papers.map(({ id, version, sha256, title, status, scoredQuestionCount, taskTypeCount }) =>
    ({ id, version, sha256, title, status, scoredQuestionCount, taskTypeCount, available: false }));
}
function loadPaper(id = 'full-mock-1', version = 1, { root = ROOT } = {}) {
  if (id !== 'full-mock-1' || version !== 1) throw Error('Unknown frozen paper.');
  const index = JSON.parse(readAsset(root, DIRECTORY + '/catalogue.json'));
  const entry = index.papers?.find(item => item.id === id && item.version === version);
  if (!entry || entry.file !== DIRECTORY + '/full-mock-1.v1.json') throw Error('Unknown frozen paper.');
  const paper = JSON.parse(readAsset(root, entry.file));
  if (digest(paper) !== entry.sha256) throw Error('Frozen paper digest mismatch.');
  const issues = validatePaper(paper, { root });
  if (issues.length) throw Error(issues.join('\n'));
  return deepFreeze(paper);
}
function assertReleased(paper) {
  if (paper.editorial?.studentReleaseApproved !== true || paper.status !== 'released') throw Error('This frozen draft is not available for student attempts.');
}
function snapshotForAttempt(paper, configuration, { root = ROOT, draftPreview = false } = {}) {
  if (!draftPreview) assertReleased(paper);
  const fields = ['transcriptionModel', 'contentModel', 'deliveryProvider', 'deliveryModel'];
  if (!configuration || Object.keys(configuration).some(key => !fields.includes(key)) || fields.some(key => typeof configuration[key] !== 'string' || !configuration[key].trim())) throw Error('Concrete model/provider names are required; credentials must not be stored in attempts.');
  return deepFreeze({ mode: draftPreview ? 'development-preview' : 'student', paperHash: digest(paper), paper: structuredClone(paper),
    scoringSourcesForAttempt: scoringSnapshot(root), configuration: structuredClone(configuration) });
}
function questionForPlayer(candidate) {
  const q = candidate.question, task = TASKS.find(task => task.type === q.type);
  if (!task) throw Error('Unsupported task.');
  const result = { id: q.id, type: q.type, name: task.label, instruction: q.instruction,
    ...(q.preparation != null ? { preparation: q.preparation } : {}), ...(q.seconds != null ? { seconds: q.seconds } : {}),
    ...(q.minutes != null ? { minutes: q.minutes } : {}), ...(q.timeGroup ? { timeGroup: q.timeGroup } : {}),
    ...(q.startCueMs != null ? { startCueMs: q.startCueMs } : {}), ...(q.silenceTimeoutSeconds ? { silenceTimeoutSeconds: q.silenceTimeoutSeconds } : {}) };
  if (['ra', 'rts', 'swt', 'essay'].includes(q.type)) result.text = q.text;
  if (['dropdown', 'wordbank', 'mcma', 'mcsa', 'lfi', 'hiw'].includes(q.type)) result.passage = q.passage;
  for (const key of ['options', 'bank', 'choices', 'prompt']) if (q[key] != null) result[key] = structuredClone(q[key]);
  if (Array.isArray(q.items)) result.items = q.items.map(({ key, text }) => ({ key, text }));
  if (candidate.audio) result.audio = { id: candidate.audio.entry.audioSha256, seconds: candidate.audio.entry.seconds,
    playOnce: true, playbackDelaySeconds: q.playbackDelaySeconds };
  if (candidate.image) result.image = { id: candidate.image.sha256, width: 730, height: 500 };
  return result;
}
module.exports = { canonical, digest, deepFreeze, putImmutable, validatePaper, freezePaper, catalogue, loadPaper, assertReleased, snapshotForAttempt, questionForPlayer };
