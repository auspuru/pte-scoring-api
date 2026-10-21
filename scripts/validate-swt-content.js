'use strict';
const passages = require('../passages.json');
const writing = require('../content/writing-lab.json');
const predictions = require('../content/writing-predictions-sep-2026');
const userSwt = require('../content/user-swt-predictions');
const advanced = require('../content/swt-advanced.json');
const advancedRevisions = require('../content/swt-advanced-revisions.json');
const legacy = require('../content/swt-legacy.json');
const policy = require('../writing-lab-scoring');

const words = text => String(text || '').trim().split(/\s+/).filter(Boolean).length;
const within = (n, low, high) => n >= low && n <= high;

function writingLabSwt() {
  return (writing.mocks || []).flatMap(mock => (mock.questions || []).filter(q => q.type === 'swt'));
}
function sourceStatus(item) {
  if (!item || item.source == null) return true;
  return item.source && item.source.verified === true;
}
function validateSample(label, sample) {
  const form = policy.formFor('swt', sample || '');
  if (form.score !== 1 || policy.sentenceCount(sample || '') !== 1) {
    throw new Error(label + ' reference sample must be one complete SWT sentence of 5–75 words.');
  }
}
function validatePassage(label, item, text, sample, { preserved = false } = {}) {
  const count = words(text);
  const verbatim = item.editorialReview?.standard === 'swt-user-verbatim';
  if (!text || !count) throw new Error(label + ' has no source text.');
  if (!preserved && !within(count, verbatim ? 150 : 200, verbatim ? 360 : 300)) {
    throw new Error(label + (verbatim ? ' must contain 150–360 words of verbatim user source text; found ' : ' must contain 200–300 words; found ') + count + '.');
  }
  if (!sourceStatus(item)) throw new Error(label + ' has source metadata that is not explicitly verified.');
  if (!preserved && (!['swt-200-300','swt-user-verbatim'].includes(item.editorialReview?.standard) || item.editorialReview?.automatedValidation !== 'required'
    || !['pending','reviewed'].includes(item.editorialReview?.humanReview))) {
    throw new Error(label + ' is missing editorial review metadata.');
  }
  if (sample) validateSample(label, sample);
  return count;
}
function validateSwtContent() {
  const rows = [];
  for (const p of passages) rows.push({ bank:'standalone', id:String(p.id), words:validatePassage('Standalone SWT '+p.id, p, p.text, p.sampleResponse) });
  for (const p of userSwt.passages) rows.push({ bank:'standalone', id:String(p.id), words:validatePassage('User prediction SWT '+p.id, p, p.text, p.sampleResponse) });
  // Preserve existing sources rather than padding them to an authoring target.
  // Their source lengths are diagnostics; reference Form is still mandatory.
  for (const [bank, items] of [['advanced', [...advanced, ...advancedRevisions]], ['legacy', legacy]]) {
    for (const p of items) {
      if (!p.sampleResponse || !p.keyElements || !Object.keys(p.keyElements).length) throw new Error(bank + ' SWT ' + p.title + ' lacks a sample or key ideas.');
      rows.push({ bank, id:p.id || p.title, words:validatePassage(bank + ' SWT ' + p.title, p, p.text, p.sampleResponse, {preserved:true}) });
    }
  }
  for (const q of writingLabSwt()) rows.push({ bank:'writing-lab', id:q.id, words:validatePassage('Writing-lab SWT '+q.id, q, q.text, q.sample) });
  for (const q of predictions.swt) {
    const n = validatePassage('Prediction SWT '+q.id, q, q.text, q.sample);
    if (!q.predictionSource?.provider || !q.predictionSource?.week || !q.predictionSource?.sourceId) {
      throw new Error(q.id + ' is missing prediction source metadata.');
    }
    rows.push({ bank:'prediction', id:q.id, words:n });
  }
  return {
    total: rows.length,
    standalone: rows.filter(r=>r.bank==='standalone').length,
    writingLab: rows.filter(r=>r.bank==='writing-lab').length,
    prediction: rows.filter(r=>r.bank==='prediction').length,
    advanced: rows.filter(r=>r.bank==='advanced').length,
    legacy: rows.filter(r=>r.bank==='legacy').length,
    minimum: Math.min(...rows.map(r=>r.words)),
    maximum: Math.max(...rows.map(r=>r.words))
  };
}
if (require.main === module) {
  const r = validateSwtContent();
  console.log('Validated '+r.total+' SWT passages ('+r.standalone+' standalone, '+r.writingLab+' writing-lab, '+r.prediction+' prediction, '+r.advanced+' advanced versions, '+r.legacy+' preserved legacy); range '+r.minimum+'–'+r.maximum+' words.');
}
module.exports = { words, validateSwtContent };
