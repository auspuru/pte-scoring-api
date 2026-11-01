(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./mock-report-ui'));
  else root.FullMockReport = factory(root.MockReportUI);
})(typeof globalThis === 'undefined' ? this : globalThis, function (layout) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const sectionName = value => ({ 'speaking-writing':'Speaking & Writing', reading:'Reading', listening:'Listening', introduction:'Introduction' }[value] || value);
  const date = value => value ? new Date(value).toLocaleString(undefined, { dateStyle:'medium', timeStyle:'short' }) : '';
  const duration = value => { const minutes = Math.floor(value / 60), seconds = Math.round(value % 60); return minutes + 'm ' + seconds + 's'; };
  const list = values => values?.length ? '<ul>' + values.map(value => '<li>' + esc(value) + '</li>').join('') + '</ul>' : '';
  const feedbackText = value => String(value ?? '').replace(/\bnative marks\b/gi, 'marks');
  function indexLabel(profile) {
    if (profile?.status !== 'complete') return 'Pending';
    if (profile.practiceIndex != null) return String(profile.practiceIndex);
    const range = profile.practiceIndexRange;
    return range ? range.low === range.high ? String(range.low) : range.low + '–' + range.high : 'Pending';
  }
  function history(rows) {
    return rows.length ? '<div class="ipr-history-grid">'+rows.map(row=>layout.historyCard({title:row.title,at:row.submittedAt||row.createdAt,status:row.status==='active'?'In progress':row.ready?'Evaluated':'Assessing',score:row.status==='submitted'?indexLabel(row.profiles?.overall):null,detail:row.status==='active'?row.completedCount+'/'+row.expectedCount+' questions completed':duration(row.durationSeconds),actions:'<button type="button" class="portal-button" data-fm="resume" data-id="'+esc(row.id)+'" data-status="'+esc(row.status)+'">'+(row.status==='active'?'Continue':'Score report')+'</button>'+(row.status==='submitted'?'<button type="button" class="portal-button" data-fm="resume" data-id="'+esc(row.id)+'" data-status="submitted" data-mock-target="full-'+esc(row.id)+'" data-mock-open="answers">Answers</button>':'')})).join('')+'</div>' : '<p>No saved full-mock attempts yet.</p>';
  }
  function overview(report) {
    const value=profile=>profile?.status==='complete'?indexLabel(profile):null;
    return '<div class="fm-report-status" role="status">'+(report.ready?(report.excludedCount?'Report ready · '+report.assessedCount+' assessed · '+report.excludedCount+' excluded':'Report ready · All 65 responses assessed'):'Assessing responses · '+report.assessedCount+' of 65 complete')+'</div>'+layout.hero({title:report.title,at:report.submittedAt,duration:duration(report.durationSeconds),count:65,overall:value(report.profiles.overall),skills:['listening','reading','speaking','writing'].map(name=>({name:name[0].toUpperCase()+name.slice(1),value:value(report.profiles[name])})),status:report.ready?'Completed':'Assessing'});
  }
  function priorities(report) {
    return layout.impactFeedback(report.impactFeedback) + (report.priorities.length ? '<section class="fm-card"><h2>What to practise next</h2><div class="fm-priority-grid">' + report.priorities.map(row => '<article><h3>' + esc(row.label) + '</h3><p>' + esc(row.instruction) + '</p><a class="portal-button" href="' + esc(row.path) + '">Practise this task</a></article>').join('') + '</div></section>' : '<section class="fm-card"><h2>Your saved feedback</h2><p>Open an answer to review its feedback and sample response.</p><button type="button" class="portal-button" data-mock-tab="answers">Review answers</button></section>');
  }
  function breakdown(report) {
    return '<section class="fm-card fm-task-summary"><h2>Task summary</h2><div class="fm-table-wrap"><table class="fm-table"><thead><tr><th scope="col">Task</th><th scope="col">Completed</th><th scope="col">Marks</th></tr></thead><tbody>'
      + report.groups.map(row => '<tr><th scope="row"><button type="button" class="fm-text-button" data-fm="review-type" data-type="' + esc(row.type) + '">' + esc(row.label) + '</button></th><td>' + row.assessedCount + '/' + row.expected + (row.excludedCount ? ' · '+row.excludedCount+' excluded' : '') + '</td><td>' + (row.complete ? row.earned + '/' + row.possible : 'Pending') + '</td></tr>').join('') + '</tbody></table></div></section>';
  }
  function answerText(item, answer) {
    if (!Array.isArray(answer) || !answer.length) return 'No written answer submitted.';
    const q = item.question;
    if (q.type === 'reorder') return answer.map((key, index) => (index + 1) + '. ' + (q.items.find(row => row.key === key)?.text || key)).join('\n\n');
    if (q.type === 'hiw') { const words = q.passage.split(/\s+/u); return answer.map(index => (index + 1) + '. ' + (words[index] || '')).join('\n'); }
    if (q.choices) return answer.map(index => (index + 1) + '. ' + (q.choices[index] || '')).join('\n');
    return answer.map((value, index) => (['dropdown','wordbank','lfi'].includes(q.type) ? 'Blank ' + (index + 1) + ': ' : '') + (String(value).trim() || '(blank)')).join('\n');
  }
  function review(item) {
    const q = item.question, ref = item.reference, feedback = item.feedback;
    const audio = q.audio ? '<button type="button" class="portal-button" data-fm="review-media" data-kind="prompt" data-asset="' + esc(q.audio.id) + '">Load question audio</button><div id="fm-review-prompt"></div>' : '';
    const image = q.image ? '<button type="button" class="portal-button" data-fm="review-media" data-kind="image" data-asset="' + esc(q.image.id) + '">Load question image</button><div id="fm-review-image"></div>' : '';
    const recordings = item.recordings.map(row => '<div><button type="button" class="portal-button" data-fm="review-media" data-kind="recording" data-segment="' + esc(row.id) + '"' + (row.ready ? '' : ' disabled') + '>Load your recording ' + row.number + '</button>' + (row.reviewRequired ? '<p>Recording needs teacher review.</p>' : row.ready ? '' : '<p>Recording still uploading.</p>') + '<div id="fm-review-recording-' + esc(row.id) + '"></div></div>').join('');
    const source = q.text || q.passage || q.prompt;
    return '<article class="fm-review-item"><header><span class="fm-eyebrow">QUESTION ' + item.number + ' OF 65 · ' + esc(sectionName(item.section)) + '</span><h3 tabindex="-1" id="fm-review-title">' + esc(item.label) + (item.title && item.title !== item.label ? ' · ' + esc(item.title) : '') + '</h3><p><span class="fm-badge">' + esc(item.assessment.label) + '</span> ' + (item.status === 'assessed' ? item.total + '/' + item.maximum + ' marks' : item.status === 'excluded' ? 'Excluded from scoring' : 'Assessment pending') + '</p>'+layout.traits(Object.entries(item.maxima||{}).map(([key,maximum])=>({label:key,value:item.status==='assessed'?item.scores[key]:null,maximum})))+'</header>'
      + '<section><h4>Question</h4><p>' + esc(q.instruction) + '</p>' + (source ? '<div class="fm-review-text">' + esc(source) + '</div>' : '') + (q.choices ? list(q.choices.map((value, index) => (index + 1) + '. ' + value)) : '') + (q.items ? list(q.items.map(row => row.key + ': ' + row.text)) : '') + (q.bank ? '<p>Word bank: ' + esc(q.bank.join(' · ')) + '</p>' : '') + (q.options ? list(q.options.map((options, index) => 'Blank ' + (index + 1) + ': ' + options.join(' · '))) : '') + image + audio + '</section>'
      + '<section><h4>Your saved response</h4>' + (['ra','rs','di','rl','asq','sgd','rts'].includes(item.type) ? (recordings || '<p>No recording is available for this item.</p>') + (item.transcript ? '<h5>Automatic transcript</h5><p>Speech recognition can omit or replace words. Check this text against your recording.</p><div class="fm-review-text">' + esc(item.transcript) + '</div>' : '') : '<div class="fm-review-text">' + esc(answerText(item, item.answer)) + '</div>') + '</section>'
      + (item.recovered.length ? '<aside class="fm-recovery"><h4>Late recovered response · review required</h4><p>This evidence is saved separately. It has not replaced your timed answer or changed its marks.</p>' + item.recovered.map(row => '<div class="fm-review-text">' + esc(answerText(item, row.answer)) + '</div>').join('') + '</aside>' : '')
      + '<section><h4>Feedback</h4><p>' + esc(feedback.gated ? 'Review the task requirements and your response.' : feedbackText(feedback.overview)) + '</p>' + (feedback.criteria.length ? '<div class="fm-table-wrap"><table class="fm-table"><thead><tr><th scope="col">Criterion</th><th scope="col">Marks</th><th scope="col">Feedback</th></tr></thead><tbody>' + feedback.criteria.map(row => '<tr><th scope="row">' + esc(row.label) + '</th><td>' + row.earned + '/' + row.maximum + '</td><td>' + esc(feedback.gated ? 'Review the task requirements.' : feedbackText(row.feedback)) + list(row.evidence) + (row.practiceWords.length ? '<p>Words to practise: ' + esc(row.practiceWords.join(', ')) + '.</p>' : '') + '</td></tr>').join('') + '</tbody></table></div>' : '')
      + (feedback.strengths.length ? '<h5>Strengths</h5>' + list(feedback.strengths) : '') + (feedback.improvements.length ? '<h5>Improvement areas</h5>' + list(feedback.improvements) : '')
      + (feedback.coverage.length ? '<h5>Content feedback</h5>' + feedback.coverage.map(row => '<p><strong>' + esc(row.status) + ':</strong> ' + esc(row.point) + (row.evidence ? ' · “' + esc(row.evidence) + '”' : '') + '<br>' + esc(row.feedback) + '</p>').join('') : '')
      + (feedback.corrections.length ? '<h5>Corrections</h5>' + list(feedback.corrections.map(row => '“' + row.phrase + '” → “' + row.correction + '”. ' + row.explanation)) : '')
      + (feedback.issues.length ? '<h5>Evidence and next changes</h5>' + feedback.issues.map(row => '<article class="fm-feedback-issue"><p><strong>' + esc(row.priority) + ' · ' + esc(row.trait) + '</strong></p><blockquote>' + esc(row.evidence) + '</blockquote><p>' + esc(row.explanation) + '</p><p>' + esc(row.suggestedChange) + '</p>' + '</article>').join('') : '')
      + (feedback.changes.some(row => row.kind !== 'correct') ? '<h5>Transcript differences</h5>' + list(feedback.changes.filter(row => row.kind !== 'correct').map(row => row.kind + ': ' + (row.expected || '(no reference word)') + ' → ' + (row.actual || '(omitted)'))) : '') + '</section>'
      + '<details class="fm-reference"><summary>Reference, answer key and sample response</summary>' + (ref.answers.length ? '<h4>Answer key</h4><div class="fm-review-text">' + esc(answerText(item, ref.answers)) + '</div>' : '') + (ref.acceptedAnswers.length ? '<h4>Accepted short answers</h4>' + list(ref.acceptedAnswers) : '')
      + (ref.explanation ? '<p>' + esc(ref.explanation) + '</p>' : '') + (ref.turns.length ? '<h4>Discussion transcript</h4>' + ref.turns.map(row => '<p><strong>' + esc(row[0]) + ':</strong> ' + esc(row[1]) + '</p>').join('') : ref.text && ref.text !== q.text ? '<h4>Reference text / transcript</h4><div class="fm-review-text">' + esc(ref.text) + '</div>' : '')
      + (ref.facts.length ? '<h4>Reference ideas</h4>' + list(ref.facts) : '') + (ref.sample ? '<h4>Sample response</h4><div class="fm-review-text">' + esc(ref.sample) + '</div>' : '') + '</details>'
      + '<footer><p>' + esc(item.practice.instruction) + '</p><a class="portal-button" href="' + esc(item.practice.path) + '">Practise this task</a></footer></article>';
  }
  function selector(report, selected) {
    const selectedItem=report.items.find(item=>item.id===selected)||report.items[0];
    return layout.sectionTabs(layout.sectionFor(selectedItem.type,selectedItem.section))+'<div class="fm-review-navigation"><label for="fm-review-select">Review a question</label><select id="fm-review-select">' + report.items.map(item => '<option data-report-section="'+layout.sectionFor(item.type,item.section)+'" value="' + esc(item.id) + '"' + (item.id === selected ? ' selected' : '') + '>Q' + item.number + ' · ' + esc(item.label) + ' · ' + (item.status === 'assessed' ? item.total + '/' + item.maximum : esc(item.assessment.label)) + '</option>').join('') + '</select><div><button type="button" class="portal-button" data-fm="review-previous"' + (report.items[0].id === selected ? ' disabled' : '') + '>Previous</button><button type="button" class="portal-button" data-fm="review-next"' + (report.items.at(-1).id === selected ? ' disabled' : '') + '>Next</button></div></div>';
  }
  function page(report, selected) {
    const item=report.items.find(row=>row.id===selected)||report.items[0];
    const actions='<button type="button" class="portal-button" data-fm="reload">Saved attempts</button>';
    const saves='<section class="fm-report-actions"><p id="fm-report-media-status"'+(report.mediaPending?'':' hidden')+'>'+(report.mediaPending?'Saving '+report.mediaPending+' recording(s)… Keep this tab open.':'')+'</p><button type="button" class="portal-button" data-fm="retry"'+(report.mediaPending?'':' hidden')+'>Retry saves</button><button type="button" class="portal-button" data-fm="assessment-retry"'+(report.retryAvailable?'':' hidden')+'>Retry incomplete assessment</button><p id="fm-save-status" class="fm-sr" role="status"></p><p id="fm-notice" role="status"></p></section>';
    return layout.frame({key:'full-'+report.id,title:report.title,meta:'Submitted '+date(report.submittedAt)+' · '+duration(report.durationSeconds),actions,
      score:'<div id="fm-report-overview">'+overview(report)+'</div>',status:saves,
      answers:'<section class="fm-card"><h2>Question review</h2><div id="fm-review-navigation">'+selector(report,item.id)+'</div><div id="fm-review-detail">'+review(item)+'</div></section>',
      analysis:'<div id="fm-report-breakdown">'+breakdown(report)+'</div>',
      feedback:'<div id="fm-report-priorities">'+(priorities(report)||'<section class="fm-card"><h2>Your saved feedback</h2><p>Review a question to see your response, feedback and sample answer together.</p><button type="button" class="portal-button" data-mock-tab="answers">Review answers</button></section>')+'</div>'}).replace('class="ipr-heading"','class="ipr-heading fm-report-header"');
  }
  return { indexLabel, history, overview, priorities, breakdown, review, selector, page };
});
