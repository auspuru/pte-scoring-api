'use strict';

const VERSION = 'full-mock-asq-2026-10-28.1';
function normalize(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[’‘]/gu, "'")
    .replace(/[.,!?;:]/gu, '').replace(/\s+/gu, ' ').trim()
    .replace(/^(?:the answer is|i think it is|it is|it's)\s+/u, '')
    .replace(/^(?:a|an|the)\s+/u, '').trim();
}
function validateQuestion(question) {
  if (question?.type !== 'asq' || !Array.isArray(question.acceptedAnswers) ||
      !question.acceptedAnswers.length || question.acceptedAnswers.some(value => typeof value !== 'string' || !normalize(value))) {
    throw Error('ASQ requires a verified accepted-answer list.');
  }
}
function pending(reason) {
  return { version: VERSION, status: 'unassessed', total: null, maximum: 1,
    scores: { content: null }, maxima: { content: 1 }, skills: ['listening'],
    needsReview: true, reason };
}
function scoreTranscript(question, transcript) {
  validateQuestion(question);
  if (typeof transcript !== 'string') return pending('A verified transcript is required.');
  // Match a complete short answer, never a substring of a list, negation or
  // contradictory answer. No pronunciation/fluency marks belong to this task.
  const answer = normalize(transcript);
  const total = question.acceptedAnswers.some(value => normalize(value) === answer) ? 1 : 0;
  return { version: VERSION, status: 'assessed', total, maximum: 1,
    scores: { content: total }, maxima: { content: 1 }, skills: ['listening'],
    needsReview: false, assessmentType: 'Accepted-answer practice assessment' };
}
async function assess(question, response = {}, { transcribe } = {}) {
  validateQuestion(question);
  if (response.skipped === true) {
    if (response.recording) return pending('Conflicting submission state needs review.');
    return { ...scoreTranscript(question, ''), reason: 'Explicitly unanswered.' };
  }
  if (!response.recording) return pending('The recording is missing.');
  if (typeof transcribe !== 'function') return pending('Transcription is unavailable.');
  try {
    // Inject the portal's existing transcriber. Do not send the question, key or
    // accepted variants to it, and do not trust a student-supplied transcript.
    const transcript = await transcribe(response.recording);
    if (typeof transcript !== 'string' || !transcript.trim()) return pending('No reliable transcript was returned.');
    return { ...scoreTranscript(question, transcript), transcript };
  } catch { return pending('Transcription could not be completed; preserve the recording for retry.'); }
}
module.exports = { VERSION, normalize, scoreTranscript, assess };
