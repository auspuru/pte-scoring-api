'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { loadPaper, digest } = require('../full-mock/paper');
const { TASKS } = require('../full-mock/blueprint');
const profiles = require('../full-mock/profiles');
const aggregation = require('../full-mock/aggregation');
const adapters = require('../full-mock/adapters');
const assessment = require('../full-mock/assessment');
const session = require('../full-mock/session');
const paper = loadPaper();
const q = type => paper.questions.find(value => value.question.type === type).question;
const response = (answer = []) => ({ sealed: true, token: randomUUID(), reason: 'submitted', answer, segments: [] });
const native = (question, fraction = 1) => adapters.result(question, Object.fromEntries(Object.entries(adapters.maxima(question)).map(([key, max]) => [key, Math.floor(max * fraction)])));
function complete(fraction = 1) {
  const state = session.create(randomUUID(), paper, 1000, { preview: true }); session.end(state, paper, 1000);
  state.assessment = assessment.stateFor(assessment.snapshot());
  paper.questions.forEach((candidate, index) => { state.assessment.items[candidate.id] = { status:'assessed', inputHash:aggregation.inputHash(state.responses[index + 1]), snapshotHash:state.assessment.snapshotHash, result:native(candidate.question, fraction) }; });
  state.assessment.status = 'complete'; return state;
}

test('The five independent profiles preserve the visually verified Pearson table and its inequalities', () => {
  assert(profiles.validate(profiles.PROFILES)); assert.equal(new Set(Object.values(profiles.PROFILES).map(value => value.version)).size, 5);
  assert.deepEqual(Object.entries(profiles.PROFILES.overall.weights).filter(([, value]) => value === '<1').map(([type]) => type), ['mcsa','hcs','lmcsa']);
  assert.equal(Object.values(profiles.PROFILES.speaking.weights).reduce((n, value) => n + value, 0), 101);
  assert.equal(Object.values(profiles.PROFILES.reading.weights).reduce((n, value) => n + value, 0), 101);
  assert.equal(profiles.PROFILES.writing.weights.swt, 28); assert.equal(profiles.PROFILES.reading.weights.swt, 23);
  assert.equal(profiles.PROFILES.listening.weights.asq, 4); assert.equal(profiles.PROFILES.speaking.weights.asq, undefined);
  assert.equal(profiles.PROFILES.reading.weights.ra, undefined); assert.equal(profiles.PROFILES.writing.weights.dropdown, undefined);
  assert.equal(profiles.PROFILES.writing.weights.lfi, undefined); assert.equal(profiles.PROFILES.listening.weights.wfd, 13);
  assert.equal(profiles.SOURCE.sha256, '0863ec05a098f7390a01206750a1220a3c3ecd6344fa211f66220007deda7f6e');
  assert.throws(() => { profiles.PROFILES.overall.weights.ra = 100; }, TypeError);
  const wrong = structuredClone(profiles.PROFILES); wrong.reading.weights.ra = 9; assert.throws(() => profiles.validate(wrong), /contribution/);
});
test('Native objective adapters reuse exact keys, partial blanks, adjacent pairs, penalties and dictation', async () => {
  const service = adapters.createAdapters(); let tested = 0;
  for (const candidate of paper.questions) {
    const question = candidate.question; if (adapters.SPOKEN.has(question.type) || ['swt','essay','sst'].includes(question.type)) continue;
    const answer = question.type === 'wfd' ? [question.text] : question.answers || [question.answer];
    const result = await service.assess(question, response(answer));
    assert.equal(result.total, result.maximum, question.type); assert(aggregation.nativeValid(result)); tested++;
  }
  assert.equal(tested, 29);
  for (const type of ['mcma','lmcma','hiw']) {
    const question = q(type), wrong = Array.from({ length: 100 }, (_, i) => i).filter(value => !question.answers.includes(value));
    assert.equal((await service.assess(question, response([...question.answers, ...wrong]))).total, 0, type);
  }
  const gaps = q('dropdown'), partial = [...gaps.answers]; partial[0] = '';
  assert.equal((await service.assess(gaps, response(partial))).total, gaps.answers.length - 1);
  const reorder = q('reorder'); assert.equal((await service.assess(reorder, response(reorder.answers.slice(0, 2)))).total, 1);
  assert.equal((await service.assess(q('mcsa'), response([q('mcsa').answer, 99]))).total, 0);
});
test('ASQ transcribes only the stored recording; empty or failed transcription never becomes a zero', async () => {
  const question = q('asq'), recording = { data:'recorded bytes', mime:'audio/wav' }; let calls = 0;
  const service = adapters.createAdapters({ transcribe: async (...args) => { calls++; assert.deepEqual(args, [recording]); return question.acceptedAnswers[0]; } });
  const correct = await service.assess(question, response(), { recording }); assert.equal(correct.total, 1); assert.deepEqual(correct.scores, { content:1 });
  assert.equal(calls, 1);
  assert.equal((await adapters.createAdapters({ transcribe:async () => '' }).assess(question, response(), { recording })).status, 'failed');
  assert.equal((await adapters.createAdapters({ transcribe:async () => { throw Error('Secret provider error'); } }).assess(question, response(), { recording })).total, undefined);
  assert.equal((await service.assess(question, { ...response(), reason:'skipped' })).total, 0);
  assert.equal((await service.assess(question, { ...response(), reason:'time-expired' })).status, 'pending');
});
test('A verified content gate awards zero without inventing delivery; malformed native traits stay unavailable', async () => {
  let delivery = 0;
  const service = adapters.createAdapters({ transcribe:async () => 'irrelevant words', gradeSpeaking:async () => ({ total:0, maximum:6, scoringMode:'ai', contentStatus:'assessed' }), assessDelivery:async () => { delivery++; } });
  const result = await service.assess(q('di'), response(), { recording:{} }); assert.equal(result.total, 0); assert.equal(delivery, 0); assert(result.gated);
  const wrong = native(q('essay')); wrong.maxima.grammar = 500;
  assert.throws(() => adapters.normalise(q('essay'), wrong), /maxima/);
  for (const missing of [null, { ...native(q('sst')), score_provisional:true }, { ...native(q('sst')), scoringMode:'local' }, { ...native(q('sst')), scores:{ content:4 } }]) assert.throws(() => adapters.normalise(q('sst'), missing));
});
test('Partial delivery retry preserves its verified companion and never repeats a failed call without explicit retry', async () => {
  const question = q('rs'), recording = {}; let transcriptions = 0, deliveries = 0;
  const service = adapters.createAdapters({ transcribe:async () => { transcriptions++; return question.text; },
    assessDelivery:async () => { deliveries++; return deliveries === 1 ? { pronunciation:{score:4}, fluency:{score:null} } : { pronunciation:{score:null}, fluency:{score:5} }; } });
  const first = await service.assess(question, response(), { recording, run:1 }); assert.equal(first.status, 'failed');
  const repeated = await service.assess(question, response(), { recording, previous:first.stages, run:1 }); assert.equal(repeated.status, 'failed'); assert.equal(deliveries, 1);
  const retry = await service.assess(question, response(), { recording, previous:first.stages, run:2 });
  assert.equal(retry.status, 'assessed'); assert.equal(retry.scores.pronunciation, 4); assert.equal(retry.scores.fluency, 5); assert.equal(transcriptions, 1); assert.equal(deliveries, 2);
});
test('Blank and invalid-form Writing responses use native zero gates without paid calls', async () => {
  let calls = 0; const fail = async () => { calls++; throw Error('Should not call'); };
  const service = adapters.createAdapters({ writingContentModel:fail, swtGrader:fail, essayGrader:{grade:fail} });
  for (const type of ['swt','essay','sst']) {
    assert.equal((await service.assess(q(type), response(['']))).total, 0);
    assert.equal((await service.assess(q(type), response(['one word']))).total, 0);
  }
  assert.equal(calls, 0);
});
test('SWT, Essay and SST consume the shared native graders and retain their individual traits', async () => {
  const fixture = require('./swt-meaning-fixtures.json')[1], question = { type:'swt', text:fixture.passage, keyPoints:['main idea'] };
  const summary = structuredClone(fixture.assessment); summary.synthesis = { quality:'effective', evidence:'', explanation:'Connected summary.' };
  const judged = { content_score:4, grammar_score:2, vocabulary_score:2, cohesion:'strong', summary_assessment:summary,
    grammar_annotations:[], vocabulary_annotations:[], consistency_reviewed:true, assessment_model:'claude-sonnet-4-6' };
  const service = adapters.createAdapters({ swtGrader:async (source, text) => { assert.equal(source, question); assert.equal(text, fixture.summary); return judged; },
    essayGrader:{ grade:async (prompt, text, mode, options) => { assert.equal(prompt, q('essay').text); assert.equal(text, q('essay').sample); assert.equal(mode, '9'); assert.equal(options.includeSample, false); assert.equal(options.totalTimeoutMs,240000); return { scores:{ content:5, form:2, grammar:2, vocabulary:2, spelling:2, linguistic:4, coherence:4, total:21 }, scoring_version:'shared-essay', scoreGate:{ status:'valid' } }; } },
    writingContentModel:async () => ({ scores:{ content:4, form:2, grammar:2, vocabulary:2, spelling:2 }, formInvalid:false, formReason:'',
      feedback:Object.fromEntries(['content','form','grammar','vocabulary','spelling'].map(key => [key, 'Clear and appropriate.'])), strengths:['Relevant summary'], improvements:[], errors:[] }) });
  assert.equal((await service.assess(question, response([fixture.summary]))).total, 9);
  assert.equal((await service.assess(q('essay'), response([q('essay').sample]))).total, 21);
  assert.equal((await service.assess(q('sst'), response([q('sst').sample]))).total, 12);
  judged.consistency_reviewed = false;
  assert.equal((await service.assess(question, response([fixture.summary]))).status, 'failed');
});
test('A persisted in-flight provider stage requires explicit retry after restart instead of a duplicate paid request', async () => {
  let calls = 0;
  const service = adapters.createAdapters({ transcribe:async () => { calls++; return q('asq').acceptedAnswers[0]; } });
  const prior = { transcription:{ status:'running', attemptedRun:1, uncertain:true } };
  const stopped = await service.assess(q('asq'), response(), { recording:{}, previous:prior, run:1 });
  assert.equal(stopped.status, 'failed'); assert.equal(calls, 0);
  const retried = await service.assess(q('asq'), response(), { recording:{}, previous:prior, run:2 });
  assert.equal(retried.status, 'assessed'); assert.equal(calls, 1);
});
test('Every task has finite native maxima; missing assessments block only profiles that require the task', () => {
  for (const task of TASKS) assert(Object.values(adapters.maxima(q(task.type))).every(value => Number.isFinite(value) && value > 0));
  const state = complete(), asqItem = paper.questions.find(value => value.question.type === 'asq');
  state.assessment.items[asqItem.id].status = 'failed';
  const report = aggregation.aggregate(paper, state);
  assert.equal(report.ready, false); assert.equal(report.assessedCount, 64);
  assert.equal(report.profiles.listening.status, 'pending'); assert.equal(report.profiles.overall.practiceIndex, null);
  assert.equal(report.profiles.speaking.practiceIndex, 90); assert.equal(report.profiles.writing.practiceIndex, 90); assert.equal(report.profiles.reading.practiceIndex, 90);
  assert(report.profiles.overall.missing.some(value => value.id === asqItem.id));
});
test('Overall is computed from task contributions once, never the four skills or a pooled sectional result', () => {
  const state = complete(0), essay = paper.questions.find(value => value.question.type === 'essay'); state.assessment.items[essay.id].result = native(essay.question);
  const report = aggregation.aggregate(paper, state);
  assert.equal(report.profiles.writing.practiceIndex, 35); assert.equal(report.profiles.overall.practiceIndex, null);
  assert.deepEqual(report.profiles.overall.practiceIndexRange, { low:15, high:16 });
  assert.equal(report.groups.rs.count, 10); assert.equal(report.groups.swt.count, 2); assert.equal(report.expectedCount, 65);
  assert.equal(report.profiles.overall.publishedNumericWeightSum, 98);
  assert.equal(report.profiles.listening.publishedNumericWeightSum, 101);
  assert.equal(report.official, false); assert.equal(report.calibrated, false);
});
test('The Overall interval encloses every admissible sub-one-percent weighting without a fabricated midpoint', () => {
  const profile = profiles.PROFILES.overall;
  const fractions = Object.fromEntries(TASKS.map(task => [task.type, 0.5])); fractions.mcsa = 1; fractions.hcs = 0; fractions.lmcsa = 1;
  const interval = aggregation.bounds(profile, fractions);
  for (const a of [.01,.25,.99]) for (const b of [.01,.75,.99]) for (const c of [.01,.5,.99]) {
    const n = 49 + a + c, d = 98 + a + b + c; assert(n / d >= interval.low && n / d <= interval.high);
  }
  assert.equal(profiles.PROFILES.overall.weights.mcsa, '<1');
});
test('Unsealed responses, stale input hashes, wrong trait maxima and mismatched versions cannot enter an aggregate', () => {
  for (const mutate of [
    state => { state.responses[1].sealed = false; }, state => { state.responses[1].answer = ['tampered']; },
    state => { const r = state.assessment.items[paper.questions[0].id].result; r.maxima.content++; r.maximum++; },
    state => { state.assessment.items[paper.questions[0].id].result.version = 'unrelated'; },
    state => { state.assessment.items[paper.questions[0].id].snapshotHash = 'unrelated'; }
  ]) { const state = complete(); mutate(state); assert.equal(aggregation.aggregate(paper, state).ready, false); }
  const active = complete(); active.status = 'active'; assert.throws(() => aggregation.aggregate(paper, active), /Submit/);
});
test('Provider snapshots contain only concrete safe metadata and freeze their own weighting/source versions', () => {
  const config = assessment.configuration({ ESSAY_SCORING_PROVIDER:'openai', ESSAY_OPENAI_MODEL:'gpt-6.1-sol' }), saved = assessment.snapshot(config);
  assert.equal(saved.configuration.essay.model, 'gpt-6.1-sol'); assert(saved.scoringSources.files['full-mock/adapters.js']);
  assert.equal(saved.weighting.profiles.overall.weights.mcsa, '<1');
  config.essay.model = 'changed'; assert.equal(saved.configuration.essay.model, 'gpt-6.1-sol');
  assert.throws(() => { saved.weighting.profiles.writing.weights.essay = 100; }, TypeError);
  const unsafe = assessment.configuration(); unsafe.essay.apiKey = 'secret'; assert.throws(() => assessment.snapshot(unsafe), /metadata/);
  const state = complete(); assert.equal(state.assessment.snapshotHash, digest(state.assessment.snapshot));
});


test('A short RS recording can receive independent delivery marks despite low reference coverage',async()=>{
 const question={...q('rs'),text:'The new library opens early on weekdays.'},transcript='The library opens each morning today.';
 const delivery=require('../speaking-delivery');
 assert.equal(delivery.deliveryEvidence(question,transcript,3).sufficient,false);
 const service=adapters.createAdapters({transcribe:async()=>transcript,assessDelivery:async(recording,options)=>{
  const evidence=delivery.deliveryEvidence(question,transcript,3,options);
  return {deliveryEvidence:evidence,pronunciation:{score:evidence.sufficient?3:null},fluency:{score:evidence.sufficient?4:null}};
 }});
 const r=await service.assess(question,{...response(),segments:[{}]},{recording:{}});
 assert.equal(r.status,'assessed');assert.equal(r.scores.pronunciation,3);assert.equal(r.scores.fluency,4);
 assert(r.scores.content>0&&r.scores.content<r.maxima.content);
});


test('An explicit retry of invalid DI evidence uses the configured review model once and keeps the Academy validator',async()=>{
 const question={id:'di-evidence',type:'di',title:'Campus travel',imageCategory:'line',facts:['Trips rose from 200 to 450, with a brief fall in 2021.']};
 const transcript='The image shows trips rising from 200 to 450, despite a brief fall.';let calls=0,transcriptions=0;
 const wire=()=>({judgment:{score:6,relevance:'image-specific',accuracy:'accurate',scoreImpact:null,requiredEvidence:{quote:'trips rising from 200 to 450',factIndices:[0],kind:'relationship'},otherEvidence:[]},reason:'The main trend and exception form a clear picture.',nextStep:'Keep the connected trend and exception.'});
 const service=adapters.createAdapters({transcribe:async()=>{transcriptions++;return transcript;},speakingContentModel:async(prompt,context)=>{
  calls++;const raw=wire();if(!context.recoveryReview)raw.judgment.accuracy='major-errors';return raw;
 },assessDelivery:async()=>({pronunciation:{score:4},fluency:{score:4}})});
 const saved={...response(),segments:[{}]},first=await service.assess(question,saved,{recording:{},run:1});
 assert.equal(first.status,'failed');assert.equal(calls,1);
 await service.assess(question,saved,{recording:{},previous:first.stages,run:1});assert.equal(calls,1);
 const repaired=await service.assess(question,saved,{recording:{},previous:first.stages,run:2});
 assert.equal(repaired.status,'assessed');assert.equal(repaired.scores.content,6);assert.equal(calls,2);assert.equal(transcriptions,1);
 await service.assess(question,saved,{recording:{},previous:repaired.stages,run:3});assert.equal(calls,2);
});
