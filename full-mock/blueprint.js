'use strict';

// Server-side authoring contract. This is not a student-facing question bank.
const VERSION = 'full-mock-blueprint-2026-10-28.1';
const SOURCES = {
  checkedAt: '2026-10-28',
  scoreGuide: 'https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/resources/PTE-Academic-Test-Taker-Score-Guide.pdf',
  speaking: 'https://www.pearsonpte.com/pte-academic/test-format/speaking-writing/',
  reading: 'https://www.pearsonpte.com/pte-academic/test-format/reading/',
  listening: 'https://www.pearsonpte.com/pte-academic/test-format/listening/'
};
const SECTIONS = [
  { id: 'speaking-writing', count: 35, publishedMinutes: [76, 84], clock: 'per-item' },
  { id: 'reading', count: 15, publishedMinutes: [23, 30], clock: 'shared-section' },
  { id: 'listening', count: 15, publishedMinutes: [31, 39], clock: 'sst-then-shared-section' }
];
const INTRODUCTION = { type: 'intro', scored: false, preparationSeconds: 25, responseSeconds: 30 };
// null means an item-specific value must be supplied, never an unlimited timer.
const speech = (preparation, response, audio = false, promptSeconds = null) => ({
  mode: 'per-item', preparationSeconds: preparation, responseSeconds: response,
  audio, promptSeconds, playOnce: audio
});
const reading = { mode: 'shared-section', audio: false };
const listening = (promptSeconds) => ({ mode: 'shared-section', audio: true, playOnce: true, promptSeconds });
const TASKS = [
  { type: 'ra', label: 'Read Aloud', section: 'speaking-writing', count: 6, skills: ['speaking'],
    timing: speech([30, 40], null), maxPromptWords: 60 },
  { type: 'rs', label: 'Repeat Sentence', section: 'speaking-writing', count: 10, skills: ['listening', 'speaking'],
    timing: speech([0, 0], 15, true, [3, 9]) },
  { type: 'di', label: 'Describe Image', section: 'speaking-writing', count: 5, skills: ['speaking'],
    timing: speech([25, 25], 40), image: true },
  { type: 'rl', label: 'Retell Lecture', section: 'speaking-writing', count: 2, skills: ['listening', 'speaking'],
    timing: speech([10, 10], 40, true, [0, 90]) },
  { type: 'asq', label: 'Answer Short Question', section: 'speaking-writing', count: 5, skills: ['listening'],
    timing: speech([0, 0], 10, true, [3, 9]) },
  { type: 'sgd', label: 'Summarize Group Discussion', section: 'speaking-writing', count: 2, skills: ['listening', 'speaking'],
    timing: speech([10, 10], 120, true, [0, 180]), speakers: 3 },
  { type: 'rts', label: 'Respond to a Situation', section: 'speaking-writing', count: 2, skills: ['speaking'],
    timing: speech([10, 10], 40, true), maxPromptWords: 60 },
  { type: 'swt', label: 'Summarize Written Text', section: 'speaking-writing', count: 2, skills: ['reading', 'writing'],
    timing: { mode: 'per-item', responseSeconds: 600, audio: false }, maxPromptWords: 300 },
  { type: 'essay', label: 'Write Essay', section: 'speaking-writing', count: 1, skills: ['writing'],
    timing: { mode: 'per-item', responseSeconds: 1200, audio: false } },
  { type: 'dropdown', label: 'Fill in the Blanks — Dropdown', section: 'reading', count: 5, skills: ['reading'],
    timing: reading, maxPromptWords: 300 },
  { type: 'mcma', label: 'Multiple Choice — Multiple Answers', section: 'reading', count: 2, skills: ['reading'],
    timing: reading, maxPromptWords: 350 },
  { type: 'reorder', label: 'Reorder Paragraphs', section: 'reading', count: 2, skills: ['reading'],
    timing: reading, maxPromptWords: 150 },
  { type: 'wordbank', label: 'Fill in the Blanks — Drag and Drop', section: 'reading', count: 4, skills: ['reading'],
    timing: reading, maxPromptWords: 80 },
  { type: 'mcsa', label: 'Multiple Choice — Single Answer', section: 'reading', count: 2, skills: ['reading'],
    timing: reading, maxPromptWords: 300 },
  { type: 'sst', label: 'Summarize Spoken Text', section: 'listening', count: 1, skills: ['listening', 'writing'],
    timing: { mode: 'per-item', responseSeconds: 600, includesPromptPlayback: true, audio: true, playOnce: true, promptSeconds: [60, 90] } },
  { type: 'lmcma', label: 'Multiple Choice — Multiple Answers', section: 'listening', count: 2, skills: ['listening'], timing: listening([80, 120]) },
  { type: 'lfi', label: 'Fill in the Blanks — Type In', section: 'listening', count: 2, skills: ['listening'], timing: listening([30, 60]) },
  { type: 'hcs', label: 'Highlight Correct Summary', section: 'listening', count: 2, skills: ['listening', 'reading'], timing: listening([30, 90]) },
  { type: 'lmcsa', label: 'Multiple Choice — Single Answer', section: 'listening', count: 2, skills: ['listening'], timing: listening([30, 60]) },
  { type: 'smw', label: 'Select Missing Word', section: 'listening', count: 1, skills: ['listening'], timing: listening([20, 70]) },
  { type: 'hiw', label: 'Highlight Incorrect Words', section: 'listening', count: 2, skills: ['listening', 'reading'], timing: listening([15, 50]) },
  { type: 'wfd', label: 'Write from Dictation', section: 'listening', count: 3, skills: ['listening', 'writing'], timing: listening([3, 5]) }
];
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
module.exports = freeze({ VERSION, SOURCES, SECTIONS, INTRODUCTION, TASKS });
