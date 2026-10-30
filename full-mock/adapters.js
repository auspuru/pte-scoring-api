'use strict';
const speech = require('../speaking-scoring');
const writing = require('../writing-lab-scoring');
const listening = require('../listening-scoring');
const reading = require('../public/reading-practice');
const { RUBRICS } = require('./rubrics');
const asq = require('./asq-scoring');
const { nativeValid } = require('./aggregation');
const VERSION = 'full-mock-adapters-2026-10-29.2';
const SPOKEN = new Set(['ra','rs','di','rl','asq','sgd','rts']);
function maxima(q) {
  if (q.type === 'ra') return { content: speech.tokens(q.text).length, pronunciation: 5, fluency: 5 };
  if (SPOKEN.has(q.type)) return q.type === 'asq' ? { content: 1 } : { content: q.type === 'rs' ? 3 : 6, pronunciation: 5, fluency: 5 };
  if (RUBRICS[q.type]?.traits) return { ...RUBRICS[q.type].traits };
  if (q.type === 'wfd') return { content: require('../public/writing-lab-report').tokens(q.text).length };
  return { content: ['mcsa','lmcsa','hcs','smw'].includes(q.type) ? 1 : q.type === 'reorder' ? q.answers.length - 1 : q.answers.length };
}
function result(q, scores, extra = {}) {
  const limits = maxima(q);
  const value = { ...extra, version: VERSION, status: 'assessed', scores, maxima: limits,
    total: Object.values(scores).reduce((sum, score) => sum + score, 0), maximum: Object.values(limits).reduce((sum, score) => sum + score, 0) };
  if (Object.keys(scores).length !== Object.keys(limits).length || !nativeValid(value)) throw Error('Incomplete native assessment.');
  return value;
}
function zero(q, reason) { return result(q, Object.fromEntries(Object.keys(maxima(q)).map(key => [key, 0])), { reason, gated: true }); }
function normalise(q, raw) {
  if (!raw || raw.score_provisional || raw.needs_semantic_review || ['local','unavailable'].includes(raw.scoringMode)) throw Error('The native assessment is not confirmed.');
  const limits = maxima(q);
  if (!raw.maxima || Object.entries(limits).some(([key, max]) => raw.maxima[key] !== max)) throw Error('Native trait maxima changed.');
  const scores = Object.fromEntries(Object.keys(limits).map(key => [key, raw.scores?.[key]]));
  const value = result(q, scores, { nativeVersion: raw.version || raw.scoring_version, native: raw });
  if (RUBRICS[q.type]?.gates?.some(key => scores[key] === 0)) return zero(q, 'Native Content/Form gate');
  if (value.total !== raw.total || value.maximum !== raw.maximum) throw Error('Native total does not match its traits.');
  return value;
}
function objective(q, answer) {
  if (q.type === 'wfd') return normalise(q, writing.gradeDictation(q, answer[0] || ''));
  if (listening.TYPES.has(q.type)) return normalise(q, listening.grade(q, JSON.stringify(answer)));
  if (['dropdown','wordbank','mcma','mcsa','reorder'].includes(q.type)) {
    const values = q.type === 'mcsa' && answer.length !== 1 ? [] : answer;
    const points = reading.score(q, values);
    return result(q, { content: points.earned }, { nativeVersion: 'portal-reading-native', native: points });
  }
  return null;
}
function createAdapters({ transcribe = require('../speaking-lab').transcribeRecording,
  gradeSpeaking = (q, text, call) => speech.grade(q, text, call, { academyDescribeImage: true }),
  assessDelivery = require('../speaking-delivery').assessRecording,
  speakingContentModel, writingContentModel, swtGrader, essayGrader } = {}) {
  async function assess(q, response, { recording, previous = {}, run = 1, checkpoint = async () => {} } = {}) {
    const stages = structuredClone(previous);
    const failed = reason => ({ status: 'failed', version: VERSION, reason, stages });
    async function stage(name, call, verify = value => value != null) {
      if (stages[name]?.status === 'complete') return stages[name].value;
      // An interrupted process may resume an unfinished request, but never
      // silently repeat a known failed/uncertain provider call in the same run.
      if (stages[name]?.attemptedRun === run) return null;
      stages[name] = { status: 'running', attemptedRun: run, uncertain: true };
      await checkpoint(stages);
      let value, error;
      try { value = await call(); if (!verify(value)) throw Error('Unverified provider output'); }
      catch (caught) { error = caught; }
      stages[name] = error ? { status: 'failed', attemptedRun: run, uncertain: !!error.uncertain } : { status: 'complete', attemptedRun: run, value };
      await checkpoint(stages);
      return error ? null : value;
    }
    if (!response?.sealed) return failed('response-not-sealed');
    if (SPOKEN.has(q.type)) {
      const segments = response.segments.filter(value => !value.cancelled && value.chunkCount !== 0);
      if (!segments.length && ['skipped','finished-early'].includes(response.reason)) return { ...zero(q, 'Explicitly unanswered'), stages };
      if (!recording) return { status: 'pending', version: VERSION, reason: 'recording-not-ready', stages };
      const transcript = await stage('transcription', () => transcribe(recording), value => typeof value === 'string' && !!value.trim());
      if (!transcript) return failed('transcription-unavailable');
      if (q.type === 'asq') {
        const marked = asq.scoreTranscript(q, transcript);
        return { ...result(q, marked.scores, { nativeVersion: marked.version }), stages };
      }
      const contentModel = q.type === 'di' && stages.content?.status === 'failed' && typeof speakingContentModel === 'function'
        ? (prompt, context) => speakingContentModel(prompt, { ...context, recoveryReview: true }) : speakingContentModel;
      const content = await stage('content', () => gradeSpeaking(q, transcript, contentModel), value => value && Number.isInteger(value.total) && value.total >= 0 && value.total <= maxima(q).content
        && value.maximum === maxima(q).content && !value.score_provisional && !value.needs_semantic_review
        && (['ra','rs'].includes(q.type) || value.scoringMode === 'ai' && value.contentStatus === 'assessed'));
      if (!content) return failed('content-unavailable');
      if (content.total === 0) return { ...zero(q, 'Native Content gate'), stages };
      if (stages.delivery?.status !== 'complete' && stages.delivery?.attemptedRun !== run) {
        const traits = { ...(stages.delivery?.traits || {}) }; let raw, error;
        stages.delivery = { status: 'running', attemptedRun: run, traits, uncertain: true };
        await checkpoint(stages);
        try { raw = await assessDelivery(recording, { question: q, transcript, transcribe: async () => transcript, contentIndependent: true }); }
        catch (caught) { error = caught; }
        for (const key of ['pronunciation','fluency']) {
          const trait = raw?.[key];
          if (traits[key] == null && raw?.deliveryEvidence?.sufficient !== false && !['unassessed','unavailable'].includes(trait?.status)
            && Number.isFinite(trait?.score) && trait.score >= 0 && trait.score <= 5) traits[key] = { score: trait.score, evidence: trait.evidence || [], version: raw.deliveryVersion, provider: raw.deliveryProvider,
              descriptor:typeof trait.descriptor === 'string' ? trait.descriptor.slice(0, 2000) : '', coaching:typeof trait.coaching === 'string' ? trait.coaching.slice(0, 3000) : '',
              words:Array.isArray(trait.words) ? trait.words.filter(word => word && typeof word.word === 'string').slice(0, 20).map(word => ({ word:word.word.slice(0, 200), errorType:String(word.errorType || '').slice(0, 80) })) : [] };
        }
        stages.delivery = { status: Object.keys(traits).length === 2 ? 'complete' : 'partial', attemptedRun: run, traits, uncertain: !!error?.uncertain };
        await checkpoint(stages);
      }
      if (stages.delivery?.status !== 'complete') return failed('delivery-unavailable');
      return { ...result(q, { content: content.total, pronunciation: stages.delivery.traits.pronunciation.score, fluency: stages.delivery.traits.fluency.score }, { nativeVersion: content.version }), stages };
    }
    const answer = Array.isArray(response.answer) ? response.answer : [];
    const marked = objective(q, answer); if (marked) return { ...marked, stages };
    const text = String(answer[0] || '');
    if (!text.trim()) return { ...zero(q, 'Explicitly unanswered'), stages };
    if (writing.formFor(q.type, text).score === 0) return { ...zero(q, 'Native Form gate'), stages };
    const raw = await stage('writing', async () => {
      let value;
      if (q.type === 'swt') value = await writing.gradeUnifiedSwt(q, text, swtGrader);
      else if (q.type === 'essay') {
        if (!essayGrader) throw Error('Essay assessment unavailable');
        const assessed = await essayGrader.grade(q.text, text, '9', { feedbackV3: true, includeSample: false, totalTimeoutMs: 240000 });
        value = { ...assessed, version: assessed.scoring_version, maxima: maxima(q), total: assessed.scores?.total, maximum: Object.values(maxima(q)).reduce((sum, max) => sum + max, 0) };
      } else value = await writing.grade(q, text, writingContentModel);
      return normalise(q, value);
    });
    return raw ? { ...raw, stages } : failed('writing-unavailable');
  }
  return { assess };
}
module.exports = { VERSION, SPOKEN, maxima, result, zero, normalise, objective, createAdapters };
