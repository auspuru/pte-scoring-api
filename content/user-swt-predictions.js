'use strict';

// SWT passages transcribed from the user's prediction screenshots supplied
// on 20 October 2026. Sequence is deliberate: Origin of Species first,
// Working Nine to Five / Independent Work second, then the remaining uploads.
// Source text is preserved verbatim; reference summaries are draft teaching aids.
const passages = Object.freeze([
  ...require('./user-swt-predictions-part1'),
  ...require('./user-swt-predictions-part2')
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

const swt = Object.freeze(passages.map((row, i) => ({
  id: 'pred26-user-swt-' + String(i + 1).padStart(2, '0'),
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
    sourceId: String(row.sourceNumber),
    sourceTitle: row.sourceNumber === 108 ? 'Independent Work' : row.title
  }
})));

module.exports = { passages, swt, source };
