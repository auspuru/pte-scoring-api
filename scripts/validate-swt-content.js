'use strict';
const passages = require('../passages.json');
const writing = require('../content/writing-lab.json');
const predictions = require('../content/writing-predictions-sep-2026');
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
function validatePassage(label, item, text, sample) {
  const count = words(text);
  if (!within(count, 200, 300)) throw new Error(label + ' must contain 200–300 words; found ' + count + '.');
  if (!sourceStatus(item)) throw new Error(label + ' has source metadata that is not explicitly verified.');
  if (sample) validateSample(label, sample);
  return count;
}
function validateSwtContent() {
  const rows = [];
  for (const p of passages) rows.push({ bank:'standalone', id:String(p.id), words:validatePassage('Standalone SWT '+p.id, p, p.text, p.sampleResponse) });
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
    minimum: Math.min(...rows.map(r=>r.words)),
    maximum: Math.max(...rows.map(r=>r.words))
  };
}
if (require.main === module) {
  const r = validateSwtContent();
  console.log('Validated '+r.total+' SWT passages ('+r.standalone+' standalone, '+r.writingLab+' writing-lab, '+r.prediction+' prediction); range '+r.minimum+'–'+r.maximum+' words.');
}
module.exports = { words, validateSwtContent };
