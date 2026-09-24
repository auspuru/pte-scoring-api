'use strict';
const reading = require('../public/reading-predictions-sep-2026');
const patterns = require('../public/reading-fib-pattern-bank');
const writing = require('../content/writing-predictions-sep-2026');

const date = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
function checkSource(label, source, status) {
  if (!source || typeof source !== 'object') throw Error(label + ': missing source metadata.');
  if (source.contentStatus !== status) throw Error(label + ': expected contentStatus ' + status + '.');
  if (!date(source.lastReviewed)) throw Error(label + ': missing lastReviewed date.');
  if (!date(source.checkedAt)) throw Error(label + ': missing checkedAt date.');
}
function checkPrediction(label, q) {
  const src=q?.predictionSource;
  if (!src?.provider || !src?.week || !src?.sourceId || !src?.sourceTitle) throw Error(label + ': incomplete prediction source metadata.');
  checkSource(label, src, 'adapted');
}
function validateContentMetadata() {
  checkSource('Reading prediction bank', reading.source, 'adapted');
  checkSource('Writing prediction bank', writing.source, 'adapted');
  checkSource('Reading pattern bank', patterns.source, 'original');

  const readingRows=[...(reading.dropdown||[]),...(reading.wordbank||[])];
  const writingRows=[...(writing.swt||[]),...(writing.sst||[]),...(writing.wfd||[])];
  for (const q of readingRows) checkPrediction('Reading '+q.id,q);
  for (const q of writingRows) checkPrediction('Writing '+q.id,q);

  for (const type of ['dropdown','wordbank']) for (const q of patterns[type]||[]) {
    if (q.patternSource?.kind !== 'original-pattern-derived') throw Error(q.id + ': missing pattern-derived source status.');
    checkSource('Pattern '+q.id,q.patternSource,'original');
  }

  const unique = rows => new Set(rows.map(q=>q.id)).size;
  const stats={
    readingPrediction:{dropdown:unique(reading.dropdown||[]),wordbank:unique(reading.wordbank||[])},
    writingPrediction:{swt:unique(writing.swt||[]),sst:unique(writing.sst||[]),wfd:unique(writing.wfd||[])},
    patternOriginal:{dropdown:unique(patterns.dropdown||[]),wordbank:unique(patterns.wordbank||[])}
  };
  if (stats.readingPrediction.dropdown < 30 || stats.readingPrediction.wordbank < 30) throw Error('Reading prediction bank shrank unexpectedly.');
  if (stats.writingPrediction.swt < 18 || stats.writingPrediction.sst < 17 || stats.writingPrediction.wfd < 36) throw Error('Writing prediction bank shrank unexpectedly.');
  return stats;
}
if (require.main === module) {
  const r=validateContentMetadata();
  console.log('Validated content provenance/freshness. Unique Writing prediction items: '+r.writingPrediction.swt+' SWT, '+r.writingPrediction.sst+' SST, '+r.writingPrediction.wfd+' WFD; Reading prediction FIB: '+r.readingPrediction.dropdown+' dropdown, '+r.readingPrediction.wordbank+' drag-and-drop.');
}
module.exports={validateContentMetadata};
