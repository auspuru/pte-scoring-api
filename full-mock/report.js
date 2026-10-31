'use strict';
const { TASKS } = require('./blueprint');
const { aggregate, inputHash } = require('./aggregation');
const { questionForPlayer } = require('./paper');
const { fail, hash } = require('./store');
const impact = require('../public/mock-impact-feedback');
const VERSION = 'full-mock-report-2026-10-29.1';
const GUIDANCE = {
  ra: ['speaking-ra', 'Read a short passage aloud, then compare the recording with the text for omissions and replacements.'],
  rs: ['speaking-rs', 'Listen for meaningful phrases, repeat the exact wording, then check the recording against the reference.'],
  di: ['speaking-di', 'Describe the main pattern and a few accurate supporting details; connect the comparisons.'],
  rl: ['speaking-rl', 'Note the main message and supporting relationships, then retell them in a connected response.'],
  asq: ['practice', 'Practise short listening questions and concise vocabulary answers with your teacher.'],
  sgd: ['speaking-sgd', 'Track each speaker’s position and explain how the discussion develops or reaches agreement.'],
  rts: ['speaking-rts', 'Address the intended listener directly, explain the situation and make an appropriate request.'],
  swt: ['swt', 'Combine the central message and essential relationships into one complete sentence of 5–75 words.'],
  essay: ['essays', 'Plan a clear position, develop relevant reasons and examples, then check sentence structure and spelling.'],
  dropdown: ['reading-dropdown', 'Read around each gap and check both the grammatical structure and the meaning.'],
  wordbank: ['reading-wordbank', 'Identify the required word class, then check the phrase and the passage meaning.'],
  mcma: ['reading-mcma', 'Find evidence for each selection. Incorrect selections can subtract points, with a zero floor.'],
  mcsa: ['reading-mcsa', 'Identify the passage’s main claim and eliminate choices that change its meaning.'],
  reorder: ['reading-reorder', 'Find the opening paragraph, then link references, connectors and adjacent ideas.'],
  sst: ['spoken-text', 'Capture the main message and supporting connections in a clear 50–70-word summary.'],
  lmcma: ['listening-lmcma', 'Support each selected answer with what you heard; incorrect selections can subtract points.'],
  lfi: ['listening-lfi', 'Use the surrounding sentence to anticipate the word, then check its exact spelling.'],
  hcs: ['listening-hcs', 'Compare the main message and supporting relationships, rather than matching isolated words.'],
  lmcsa: ['listening-lmcsa', 'Listen for the answer to the question and check the speaker’s intended meaning.'],
  smw: ['listening-smw', 'Use the sentence structure and the speaker’s argument to predict the missing ending.'],
  hiw: ['listening-hiw', 'Follow the transcript while listening and select only words that differ from the recording.'],
  wfd: ['dictation', 'Rebuild the sentence in order, then check every word, ending and spelling.']
};
const LABELS = { content:'Content', form:'Form', grammar:'Grammar', vocabulary:'Vocabulary', spelling:'Spelling', pronunciation:'Pronunciation', fluency:'Oral fluency', coherence:'Development, structure and coherence', structure:'Development, structure and coherence', linguistic:'General linguistic range', general_linguistic_range:'General linguistic range', development_structure_coherence:'Development, structure and coherence', vocabulary_range:'Vocabulary range' };
const clean = (value, maximum = 3000) => typeof value === 'string' ? value.trim().slice(0, maximum) : '';
const texts = value => Array.isArray(value) ? value.filter(x => typeof x === 'string').slice(0, 6).map(x => clean(x)).filter(Boolean) : [];
const pendingMedia = state => state.responses.reduce((n, response) => n + response.segments.filter(segment => !segment.cancelled && !segment.finished).length, 0);
function reasonFor(job, trusted, recovering = false) {
  if (!trusted) return { code:'not-assessed', label:'Assessment pending', action:'Your saved response has not received a verified assessment.' };
  const code = job.result?.reason || job.reason || 'not-assessed';
  if (['late-recording','interrupted-recording','recording-integrity','recording-decode','recording-duration'].includes(code)) return { code, label:'Recording needs recovery', action:'Keep the original recording device online so pending audio can finish uploading. A score needs a usable recording; the saved evidence is retained.' };
  if (['recording-not-ready','missing-recording'].includes(code)) return { code, label:'Recording pending', action:'Keep the recording device online and retry pending saves. Missing audio is not scored as zero.' };
  if(job.status!=='assessed'&&Object.values(job.stages||{}).some(stage=>stage.uncertain))return{code:'assessment-confirmation-pending',label:'Assessment confirmation pending',action:'Your response is saved. The earlier assessment request must be confirmed before it can be repeated.'};
  if (job.status === 'failed' && recovering) return {code:'assessment-pending',label:'Assessment pending',action:'Your response is saved. Feedback is being prepared automatically.'};
  if (job.status === 'failed') return { code:'assessment-unavailable', label:'Assessment interrupted', action:'Retry assessment to request the incomplete stages again. Completed stages are retained.' };
  return { code:'not-assessed', label:'Assessment pending', action:'This item is waiting for a verified assessment.' };
}
function feedbackFor(q, response, job, marks, trusted, recovering) {
  if (marks.status !== 'assessed') return { overview:reasonFor(job, trusted, recovering).action, criteria:[], strengths:[], improvements:[], coverage:[], corrections:[], issues:[], changes:[] };
  const result = job.result, content = job.stages?.content?.status === 'complete' ? job.stages.content.value : {};
  const native = result.native || {};
  const gated = result.gated === true;
  const overview = gated ? clean(result.reason) + '. All native marks are zero under this task gate.' : clean(content.overview || native.overallVerdict || native.overview);
  const criteria = Object.entries(marks.maxima).map(([key, maximum]) => {
    const delivery = job.stages?.delivery?.status === 'complete' ? job.stages.delivery.traits?.[key] : null;
    return { key, label:LABELS[key] || key.replace(/_/g, ' '), earned:marks.scores[key], maximum,
      feedback:gated ? 'The task gate applies; this trait was not independently awarded.' : clean(native.feedback?.[key] || native.rationale?.[key] || (key === 'content' ? content.overview : '')) ||
        [clean(delivery?.descriptor), clean(delivery?.coaching)].filter(Boolean).join(' ') || (marks.scores[key] === maximum ? 'Full native marks awarded for this criterion.' : 'Review this criterion alongside the saved response and reference material.'),
      evidence:gated ? [] : texts(delivery?.evidence), practiceWords:gated || !Array.isArray(delivery?.words) ? [] : delivery.words.slice(0, 20).map(row => clean(row.word, 200)).filter(Boolean) };
  });
  const improvements = gated ? [GUIDANCE[q.type][1]] : [...texts(native.improvements), ...texts(content.improvements)];
  if (!improvements.length && result.total < result.maximum) improvements.push(GUIDANCE[q.type][1]);
  // Only selected student-facing fields leave the server. Provider payloads,
  // dispatch metadata, prompts, credentials and arbitrary nested fields do not.
  return { overview:overview || (result.total === result.maximum ? 'Full native marks awarded.' : 'Compare your response with the reference and the criterion marks below.'),
    gated, criteria, strengths:[...new Set([...texts(native.strengths), ...texts(content.strengths)])], improvements:[...new Set(improvements)],
    coverage:(Array.isArray(content.coverage) ? content.coverage : []).slice(0, 30).map(row => ({ point:clean(row.point), status:clean(row.status, 40), evidence:clean(row.evidence), feedback:clean(row.feedback) })),
    corrections:(Array.isArray(native.errors) ? native.errors : []).slice(0, 30).map(row => ({ phrase:clean(row.phrase), correction:clean(row.correction), explanation:clean(row.explanation) })),
    issues:(Array.isArray(native.feedbackIssues) ? native.feedbackIssues : []).slice(0, 20).map(row => ({ trait:clean(row.trait, 80), priority:clean(row.priority, 40), affectsScore:row.affectsScore === true, evidence:clean(row.evidence?.essayQuote || row.evidence?.promptQuote), explanation:clean(row.explanation), suggestedChange:clean(row.suggestedChange), scoreRationale:clean(row.scoreRationale) })),
    changes:(Array.isArray(content.changes) ? content.changes : []).slice(0, 400).map(row => ({ kind:clean(row.kind, 40), expected:clean(row.expected, 200), actual:clean(row.actual, 200) })) };
}
function metadata(paper, state, at) {
  return { id:state.id, title:state.title, paperId:state.paperId, paperVersion:state.paperVersion, status:state.status, preview:!!state.preview,
    createdAt:state.createdAt, submittedAt:state.submittedAt || null, durationSeconds:Math.max(0, Math.round(((state.submittedAt || at) - state.createdAt) / 1000)),
    completedCount:state.responses.slice(1).filter(row => row.sealed).length, expectedCount:paper.questions.length, mediaPending:pendingMedia(state) };
}
function statusFor(state, result) {
  return state.assessment?.displayStatus || (state.assessment?.status === 'needs-attention' && state.assessment.recovery?.status === 'scheduled' ? 'processing' : null) || (result.ready ? 'complete' : state.assessment?.status === 'complete' ? 'needs-attention' : state.assessment?.status) || 'not-requested';
}
function summary(paper, state, at = Date.now()) {
  const common = metadata(paper, state, at);
  if (state.status !== 'submitted') return { ...common, section:TASKS.find(task => task.type === state.responses[state.index]?.type)?.section || 'introduction' };
  const result = aggregate(paper, state);
  return { ...common, ready:result.ready, assessmentStatus:statusFor(state, result), assessedCount:result.assessedCount,
    calibrated:false, official:false, profiles:Object.fromEntries(Object.entries(result.profiles).map(([key, profile]) => [key, { status:profile.status, practiceIndex:profile.practiceIndex, practiceIndexRange:profile.practiceIndexRange }])) };
}
function buildReport(paper, state, at = Date.now()) {
  const result = aggregate(paper, state); // Enforces submission, paper and snapshot integrity.
  const items = result.items.map((marks, index) => {
    const candidate = paper.questions[index], q = candidate.question, response = state.responses[index + 1], job = state.assessment?.items?.[candidate.id];
    const trusted = !!job && job.inputHash === inputHash(response) && job.snapshotHash === state.assessment?.snapshotHash;
    const task = TASKS.find(value => value.type === q.type), question = questionForPlayer(candidate);
    // WFD and listening reference transcripts are deliberately submitted-only.
    const reference = { text:clean(q.text, 20000), sample:clean(q.sample, 12000), explanation:clean(q.explanation), facts:texts(q.facts || q.keyPoints), acceptedAnswers:texts(q.acceptedAnswers),
      answers:Array.isArray(q.answers) ? structuredClone(q.answers) : Number.isInteger(q.answer) ? [q.answer] : [],
      turns:Array.isArray(q.turns) ? q.turns.slice(0, 20).map(row => [clean(row[0], 100), clean(row[1], 5000)]) : [] };
    const recordings = response.segments.filter(segment => !segment.cancelled).map((segment, position) => ({ id:segment.id, number:position + 1,
      ready:segment.finished && segment.chunkCount > 0 && Object.keys(segment.chunks).length === segment.chunkCount && Object.values(segment.chunks).every(chunk => chunk.stored),
      reviewRequired:!!segment.lateActivation || response.segments.filter(value => !value.cancelled && value.chunkCount !== 0).length > 1 }));
    const transcription = trusted && job.stages?.transcription?.status === 'complete' ? clean(job.stages.transcription.value, 20000) : '';
    return { ...marks, number:index + 1, label:task.label, section:task.section, skills:[...task.skills], title:clean(q.title), question, reference,
      answer:structuredClone(response.answer), responseReason:clean(response.reason, 80), transcript:transcription, recordings,
      recovered:state.recoveries.filter(row => row.itemToken === response.token).map(row => ({ answer:structuredClone(row.answer), receivedAt:row.receivedAt, status:'needs-review' })),
      assessment:marks.status === 'assessed' ? { code:'assessed', label:'Assessed' } : reasonFor(job, trusted, state.assessment?.recovery?.status === 'scheduled'),
      feedback:feedbackFor(q, response, job, marks, trusted, state.assessment?.recovery?.status === 'scheduled'), practice:{ path:'#/' + GUIDANCE[q.type][0], instruction:GUIDANCE[q.type][1] } };
  });
  const groups = TASKS.map(task => ({ type:task.type, label:task.label, section:task.section, skills:[...task.skills], ...result.groups[task.type],
    assessedCount:items.filter(item => item.type === task.type && item.status === 'assessed').length }));
  const sourceProfiles = state.assessment?.snapshot?.weighting?.profiles || require('./profiles').PROFILES;
  const impactFeedback = impact.build({ groups, profiles:sourceProfiles, items:items.map(item => {
    const responseText = item.transcript || (Array.isArray(item.answer) ? item.answer.join(' ') : '');
    const issue = item.feedback.issues.find(issue => issue.affectsScore && issue.evidence && responseText.includes(issue.evidence));
    const criterion=item.feedback.gated?null:item.feedback.criteria.filter(row=>row.earned<row.maximum && row.feedback && !/^Review this criterion/.test(row.feedback)).sort((a,b)=>a.earned/a.maximum-b.earned/b.maximum)[0];
    return { type:item.type, number:item.number, status:item.status, total:item.total, maximum:item.maximum,
      advice:issue?.suggestedChange || criterion?.feedback || item.feedback.improvements[0], strength:item.feedback.strengths[0], quote:issue?.evidence };
  }) });
  const priorities = impactFeedback.priorities.map(point => ({ ...point, earned:result.groups[point.type].earned,
    possible:result.groups[point.type].possible, path:'#/' + GUIDANCE[point.type][0] }));
  const assessmentStatus = statusFor(state, result);
  return { ...result, ...metadata(paper, state, at), version:VERSION, aggregationVersion:result.version, assessmentStatus,
    retryAvailable:!Object.values(state.assessment?.items||{}).some(job=>job.status!=='assessed'&&Object.values(job.stages||{}).some(stage=>stage.uncertain)) && !result.ready && assessmentStatus !== 'processing' && assessmentStatus !== 'version-mismatch' && items.some(item => item.status !== 'assessed' && item.assessment.label !== 'Recording needs recovery'),
    recoveredEvidenceCount:state.recoveries.length, groups, items, priorities, impactFeedback,
    interpretation:{ label:'Provisional', calibration:'Not yet calibrated', description:'These are IPT practice indices out of 90. They are not official Pearson scores or predictions of an exam result.',
      overall:'Overall is calculated directly from task contributions, independently of the four skill indices. Its range preserves three weights published as <1%; it is not an exam-score confidence interval.',
      incomplete:'The report is complete only when all 65 scored responses have verified assessments. Required missing assessments keep the affected indices pending.' } };
}
function reviewItem(paper, state, questionId) {
  if (state.status !== 'submitted') throw fail('Submit the test before reviewing its media.');
  const index = paper.questions.findIndex(candidate => candidate.question.id === questionId);
  if (index < 0) throw fail('Review item not found.', 404);
  return { candidate:paper.questions[index], response:state.responses[index + 1] };
}
async function recordingBytes(uid, id, response, segmentId, getChunk) {
  const segment = response.segments.find(value => value.id === segmentId && !value.cancelled);
  if (!segment) throw fail('Recording not found.', 404);
  if (!['audio/webm','audio/mp4','audio/ogg','audio/wav','audio/mpeg'].includes(segment.mime)) throw fail('Recording format could not be verified.', 503);
  if (!segment.finished || !Number.isInteger(segment.chunkCount) || segment.chunkCount < 1 || segment.chunkCount > 256 || Object.keys(segment.chunks).length !== segment.chunkCount) throw fail('This recording is still uploading.');
  const pieces = []; let length = 0;
  for (let sequence = 0; sequence < segment.chunkCount; sequence++) {
    const expected = segment.chunks[sequence];
    if (!expected?.stored) throw fail('This recording is still uploading.');
    const chunk = await getChunk(uid, id, segment.id, sequence);
    if (!chunk || chunk.mime !== segment.mime || chunk.sha256 !== expected.sha256 || chunk.bytes.length !== expected.bytes || hash(chunk.bytes) !== expected.sha256) throw fail('Recording integrity could not be verified.', 503);
    length += chunk.bytes.length; if (length > 12 * 1024 * 1024) throw fail('Recording is too large.', 413);
    pieces.push(chunk.bytes);
  }
  return { mime:segment.mime, bytes:Buffer.concat(pieces) };
}
module.exports = { VERSION, GUIDANCE, summary, buildReport, reviewItem, recordingBytes };
