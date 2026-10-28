'use strict';

// Audit contracts describe existing marking, rather than replacing it or
// converting sectional /90 estimates into full-exam marks.
const speechFiles = ['speaking-scoring.js', 'delivery-rubric.js', 'gpt-speaking-delivery.js', 'speaking-delivery.js'];
const writingFiles = ['writing-lab-scoring.js', 'local-scoring-engine.js', 'public/writing-lab-report.js'];
const academyFiles = ['describe-image-academy.js', 'describe-image-academy/content.js', 'describe-image-academy/scoring-policy.js',
  'describe-image-academy/chart-readings.js', 'describe-image-academy/review-evidence.js', 'describe-image-academy/image-claims.js',
  'describe-image-academy/response-selection.js', 'describe-image-academy/score-impact.js'];
const RUBRICS = {
  ra: { rule: 'word-errors', traits: { content: 'prompt-word-count', pronunciation: 5, fluency: 5 }, gates: ['content'], files: speechFiles },
  rs: { rule: 'word-sequences', traits: { content: 3, pronunciation: 5, fluency: 5 }, gates: ['content'], files: speechFiles },
  di: { rule: 'rubric', traits: { content: 6, pronunciation: 5, fluency: 5 }, gates: ['content'],
    files: [...speechFiles, ...academyFiles, 'describe-image-feedback.js', 'describe-image-feedback/scoring-policy.js', 'di-reference.js'] },
  rl: { rule: 'rubric', traits: { content: 6, pronunciation: 5, fluency: 5 }, gates: ['content'], files: [...speechFiles, 'spoken-summary-policy.js'] },
  asq: { rule: 'accepted-short-answer', traits: { content: 1 }, gates: [], files: ['full-mock/asq-scoring.js', 'speaking-lab.js'], implementation: 'full-mock-asq' },
  sgd: { rule: 'rubric', traits: { content: 6, pronunciation: 5, fluency: 5 }, gates: ['content'], files: [...speechFiles, 'spoken-summary-policy.js'] },
  rts: { rule: 'rubric', traits: { content: 6, pronunciation: 5, fluency: 5 }, gates: ['content'], files: [...speechFiles, 'situation-content-policy.js'] },
  swt: { rule: 'rubric', traits: { content: 4, form: 1, grammar: 2, vocabulary: 2 }, gates: ['content', 'form'],
    files: [...writingFiles, 'swt-scoring-policy.js', 'swt-form-policy.js', 'swt-judgment-service.js', 'swt-judge-format.js', 'swt-reference.js'] },
  essay: { rule: 'rubric', traits: { content: 6, form: 2, grammar: 2, vocabulary: 2, spelling: 2, linguistic: 6, coherence: 6 }, gates: ['content', 'form'],
    files: [...writingFiles, 'public/essay-scoring.js', 'essay-assessment-service.js', 'essay-judge-format.js', 'essay-provider.js', 'essay-openai-format.js', 'essay-evidence.js'] },
  dropdown: { rule: 'one-per-blank', files: ['public/reading-practice.js', 'public/reading-mock-tools.js'] },
  mcma: { rule: 'correct-minus-incorrect-floor-zero', files: ['public/reading-practice.js'] },
  reorder: { rule: 'adjacent-correct-pairs', files: ['public/reading-practice.js'] },
  wordbank: { rule: 'one-per-blank', files: ['public/reading-practice.js', 'public/reading-mock-tools.js'] },
  mcsa: { rule: 'single-correct-answer', files: ['public/reading-practice.js'] },
  sst: { rule: 'rubric', traits: { content: 4, form: 2, grammar: 2, vocabulary: 2, spelling: 2 }, gates: ['content', 'form'], files: writingFiles },
  lmcma: { rule: 'correct-minus-incorrect-floor-zero', files: ['listening-scoring.js'] },
  lfi: { rule: 'one-per-correctly-spelled-blank', files: ['listening-scoring.js'] },
  hcs: { rule: 'single-correct-answer', files: ['listening-scoring.js'] },
  lmcsa: { rule: 'single-correct-answer', files: ['listening-scoring.js'] },
  smw: { rule: 'single-correct-answer', files: ['listening-scoring.js'] },
  hiw: { rule: 'correct-minus-incorrect-floor-zero', files: ['listening-scoring.js'] },
  wfd: { rule: 'spelled-words-in-sequence-practice-policy', files: writingFiles }
};
const VERSION_EXPORTS = {
  'speaking-scoring.js': 'VERSION', 'delivery-rubric.js': 'RUBRIC_VERSION',
  'gpt-speaking-delivery.js': 'VERSION', 'spoken-summary-policy.js': 'VERSION',
  'situation-content-policy.js': 'VERSION', 'writing-lab-scoring.js': 'VERSION',
  'swt-scoring-policy.js': 'POLICY_VERSION', 'public/essay-scoring.js': 'VERSION',
  'full-mock/asq-scoring.js': 'VERSION', 'full-mock/adapters.js': 'VERSION', 'full-mock/aggregation.js': 'VERSION',
  'full-mock/assessment.js': 'VERSION', 'full-mock/profiles.js': 'VERSION', 'full-mock/recording.js': 'VERSION', 'full-mock/session.js': 'VERSION'
};
module.exports = { RUBRICS, VERSION_EXPORTS };
