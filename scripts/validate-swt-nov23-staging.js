'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const readyPassages = require('../content/swt-nov23-practice.staged.json');
const review = require('../content/swt-nov23-report-frequency.review.json');
const { IMPORT_BATCH } = require('../swt-repeat-ranking');
const { formFor, sentenceCount } = require('../writing-lab-scoring');
const { words } = require('./validate-swt-content');

const hash = value => createHash('sha256').update(value).digest('hex');
const passageHash = text => hash((text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).join(' '));
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function repositoryPassages() {
  const writing = require('../content/writing-lab.json').mocks.flatMap(mock => mock.questions);
  const full = require('../full-mock/paper').registeredPapers().flatMap(paper => paper.questions.map(item => item.question));
  const current = [
    ...require('../passages.json'),
    ...require('../content/swt-advanced.json'),
    ...require('../content/swt-legacy.json'),
    ...require('../content/user-swt-predictions').passages,
    ...require('../content/writing-predictions-sep-2026').swt,
    ...[...writing, ...full].filter(question => question.type === 'swt')
  ];
  const revisions = require('../content/swt-advanced-revisions.json');
  return [...current, ...revisions, ...revisions.filter(row => row.previousText).map(row => ({ ...row, text: row.previousText }))];
}

function compareCatalogue(passages, existing) {
  assert(Array.isArray(existing) && existing.length && existing.every(row =>
    row && typeof row.text === 'string' && row.text.trim() && typeof row.title === 'string'), 'Expected a nonempty SWT catalogue with full passage text.');
  const ids = new Map(existing.filter(row => row.id != null).map(row => [String(row.id), row]));
  const texts = new Map(existing.map(row => [passageHash(row.text), row]));
  return passages.flatMap(passage => {
    const idMatch = ids.get(String(passage.id));
    const textMatch = texts.get(passageHash(passage.text));
    if (!idMatch && !textMatch) return [];
    const existingRow = idMatch || textMatch;
    const status = idMatch ? passageHash(idMatch.text) === passageHash(passage.text) ? 'already-present' : 'id-collision' : 'duplicate-passage';
    return [{ proposedId: passage.id, status, existingId: existingRow.id ?? null, existingTitle: existingRow.title }];
  });
}

function validateStagedPassages({ catalogue, screenshotDirectory } = {}) {
  assert.equal(review.batchId, IMPORT_BATCH);
  assert.equal(review.status, 'staged-only');
  assert.equal(review.rows.length, review.screenshotCount);
  assert.equal(review.screenshotCount, 43);
  const disposition = new Map(review.rows.map(row => [row.proposedId, row]));
  assert.equal(disposition.size, review.rows.length, 'Proposed IDs must be unique.');
  assert.equal(new Set(review.rows.map(row => row.sourceScreenshot)).size, review.rows.length, 'Each candidate needs a distinct screenshot.');
  const staged = review.rows.filter(row => row.status === 'staged');
  assert.equal(staged.length, readyPassages.length);
  for (const row of review.rows) {
    assert(Number.isSafeInteger(row.proposedId) && row.proposedId > 0);
    assert(Number.isSafeInteger(row.sourceOrder) && row.sourceOrder > 0);
    assert(Number.isSafeInteger(row.sourceQuestionNumber) && row.sourceQuestionNumber > 0);
    assert(/^Screenshot 2026-11-23 \d{6}\.png$/.test(row.sourceScreenshot));
    assert(isHash(row.screenshotSha256) && isHash(row.normalizedTextSha256));
    assert(Number.isSafeInteger(row.transcriptionWords) && row.transcriptionWords > 0);
    assert(row.screenshotReportBadge === null || Number.isSafeInteger(row.screenshotReportBadge) && row.screenshotReportBadge >= 0);
    assert.equal(row.status, row.flags.length ? 'withheld' : 'staged');
    assert(row.title.trim() && row.notes.trim());
    if (screenshotDirectory) {
      assert.equal(hash(readFileSync(path.join(screenshotDirectory, row.sourceScreenshot))), row.screenshotSha256, row.sourceScreenshot);
    }
  }
  const stagedIds = new Set();
  const stagedHashes = new Set();
  for (const passage of readyPassages) {
    const id = passage.id;
    const source = disposition.get(id);
    assert(source && source.status === 'staged', 'Unexpected staged passage ' + id);
    for (const field of ['title', 'sourceOrder', 'sourceQuestionNumber', 'sourceScreenshot']) {
      assert.equal(passage[field], source[field], id + ' ' + field);
    }
    assert.equal(passage.questionSet, IMPORT_BATCH);
    assert.equal(passage.editorialReview.standard, 'swt-user-verbatim');
    assert.equal(passage.editorialReview.automatedValidation, 'required');
    assert(!('repeatCount' in passage) && !('repeatEvidence' in passage), 'Source report badge figures are audit-only.');
    assert(passage.category.trim() && passage.category.length <= 100);
    assert.equal(passage.text, passage.text.trim());
    const length = words(passage.text);
    assert.equal(length, source.transcriptionWords);
    assert(length >= 150 && length <= 360, id + ' verbatim passage length');
    const fingerprint = passageHash(passage.text);
    assert.equal(fingerprint, source.normalizedTextSha256);
    assert(!stagedHashes.has(fingerprint) && !stagedIds.has(id), 'Duplicate within staged SWT data: ' + id);
    stagedHashes.add(fingerprint);
    stagedIds.add(id);
    assert.deepEqual(Object.keys(passage.keyElements).sort(), ['how', 'result', 'what', 'why']);
    assert(Object.values(passage.keyElements).every(value => typeof value === 'string' && value.trim()), id + ' key ideas');
    assert.equal(formFor('swt', passage.sampleResponse).score, 1, id + ' reference Form');
    assert.equal(sentenceCount(passage.sampleResponse), 1, id + ' one-sentence reference');
  }
  const repository = repositoryPassages();
  assert.deepEqual(compareCatalogue(readyPassages, repository), [], 'Ready passages must be new to the repository banks.');
  const liveConflicts = catalogue ? compareCatalogue(readyPassages, catalogue) : null;
  return { screenshots: review.screenshotCount, ready: readyPassages.length, withheld: review.rows.length - readyPassages.length, repositoryVersions: repository.length, liveConflicts };
}

if (require.main === module) {
  // Optional inputs are a read-only catalogue export and the original PNG directory.
  const [cataloguePath, screenshotDirectory] = process.argv.slice(2);
  const snapshot = cataloguePath ? JSON.parse(readFileSync(cataloguePath, 'utf8')) : null;
  const result = validateStagedPassages({ catalogue: snapshot?.passages ?? snapshot, screenshotDirectory });
  console.log(JSON.stringify(result, null, 2));
  if (result.liveConflicts?.length) process.exitCode = 1;
}

module.exports = { compareCatalogue, validateStagedPassages };
