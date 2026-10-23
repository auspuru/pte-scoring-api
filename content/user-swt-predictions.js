'use strict';

// SWT passages transcribed from the user's prediction screenshots supplied
// on 20 and 23 October 2026. Sequence is deliberate: the first two originals,
// then Olympics, Image of Africa and Geothermal Energy, then the other uploads.
// Source text is preserved verbatim; reference summaries are draft teaching aids.
const originalPassages = [
  ...require('./user-swt-predictions-part1'),
  ...require('./user-swt-predictions-part2')
].map((row, i) => ({ ...row, predictionId: 'pred26-user-swt-' + String(i + 1).padStart(2, '0') }));
const passages = Object.freeze([
  ...originalPassages.slice(0, 2),
  ...require('./user-swt-predictions-oct23'),
  ...originalPassages.slice(2)
].map(row => ({
  ...row,
  sampleNotes: 'Teacher-editable draft SWT reference; human review pending.',
  editorialReview: {
    standard: 'swt-user-verbatim',
    automatedValidation: 'required',
    humanReview: 'pending'
  }
})));

const source = Object.freeze({
  provider: 'User supplied SWT prediction screenshots',
  week: '20 October 2026',
  checkedAt: '2026-10-20',
  lastReviewed: '2026-10-20',
  contentStatus: 'verbatim-user-provided',
  task: 'swt'
});

const swt = Object.freeze(passages.map(row => ({
  id: row.predictionId,
  type: 'swt',
  title: row.title,
  minutes: 10,
  text: row.text,
  keyPoints: Object.values(row.keyElements),
  sample: row.sampleResponse,
  sampleReview: {
    authoring: 'manual-synthesis',
    automatedValidation: 'required',
    teacherEditable: true,
    humanReview: 'pending'
  },
  editorialReview: row.editorialReview,
  predictionSource: {
    ...source,
    ...(row.sourceDate ? { week: row.sourceWeek, checkedAt: row.sourceDate, lastReviewed: row.sourceDate } : {}),
    sourceId: String(row.sourceNumber),
    sourceTitle: row.sourceNumber === 108 ? 'Independent Work' : row.title
  }
})));

module.exports = { passages, swt, source };
