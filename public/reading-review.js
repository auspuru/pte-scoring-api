(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReadingReview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const items = value => Array.isArray(value) ? value : [];
  const list = values => values.length ? '<ol>' + values.map(value => '<li>' + escape(value) + '</li>').join('') + '</ol>' : '<p class="reading-unanswered">Not answered</p>';
  const paragraph = text => '<p class="reading-review-text">' + escape(text) + '</p>';
  const table = (headings, rows) => '<div class="reading-table-wrap"><table><thead><tr>' + headings.map(h => '<th scope="col">' + escape(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(cell => '<td>' + escape(cell) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  function swtFeedback(q, answer, assessment, points) {
    const data = assessment?.result, traits = data?.trait_scores;
    const working = assessment?.status === 'working';
    let html = '<h3>' + (points.pending ? 'SWT assessment pending' : points.earned + '/9 SWT points') + '</h3>';
    if (points.pending) {
      html += paragraph(assessment?.message || 'Your summary is saved. A complete assessment is not available yet; the other answers are ready to review.')
        + '<button class="portal-button" data-action="retry-swt" data-review-uid="' + escape(q.uid) + '" ' + (working?'disabled':'') + '>' + (working?'IPT Brisbane AI is analysing…':'Retry SWT assessment') + '</button>';
    } else if (!String(answer[0] || '').trim()) html += paragraph('No summary was submitted.');
    else if (data) {
      if (traits) html += table(['Content', 'Form', 'Grammar', 'Vocabulary'], [[traits.content + '/4', traits.form + '/1', traits.grammar + '/2', traits.vocabulary + '/2']]);
      const semantic = data.content_details?.summary_assessment;
      html += paragraph(data.form_reason || semantic?.relationship_explanation || data.content_details?.notes || data.feedback || 'Your assessment is complete.');
      const strengths = data.feedback_card?.strengths;
      if (Array.isArray(strengths) && strengths.length) html += '<h4>What worked well</h4>' + list(strengths.map(item => typeof item === 'string' ? item : [item.label, item.detail].filter(Boolean).join(' — ')));
      const nextStep = semantic?.next_step;
      if (nextStep) html += '<h4>Next step</h4>' + paragraph(nextStep);
      if (semantic?.repair) html += '<h4>Suggested revision</h4>' + paragraph(semantic.repair);
      const improvements = data.feedback_card?.improvements;
      if (!nextStep && Array.isArray(improvements) && improvements.length) html += '<h4>Feedback</h4>' + list(improvements.map(item => typeof item === 'string' ? item : [item.action, item.detail].filter(Boolean).join(' — ')));
      const annotations = [...items(data.grammar_details?.grammar_annotations), ...items(data.vocabulary_details?.vocabulary_annotations)].filter(item=>item&&typeof item==='object');
      if (annotations.length) html += '<h4>Language feedback</h4>' + table(['Your wording', 'Suggested wording', 'Feedback'], annotations.map(item => [item.phrase, item.fix, (item.affects_score ? 'Meaning: ' : 'Optional refinement: ') + (item.meaning_effect || item.rationale || '')]));
      const spelling = items(data.spelling_details?.errors).filter(item=>item&&typeof item==='object');
      if (spelling.length) html += '<h4>Spelling feedback</h4>' + table(['Your spelling', 'Suggestion'], spelling.map(item => [item.misspelled, item.suggestion]));
    }
    if (q.sampleResponse) html += '<h4>Example summary</h4>' + paragraph(q.sampleResponse);
    return html;
  }
  function question(q, answer, assessment, audioState, points, index, total, label) {
    const a = Array.isArray(answer) ? answer : [];
    const excluded = ['hcs','hiw'].includes(q.type) && audioState?.status !== 'complete';
    let response = '', context = '', feedback = '';
    if (q.passage) context = '<h3>' + (q.type==='hiw'?'Written transcript':'Passage') + '</h3>' + paragraph(q.passage.replace(/\[\[(\d+)\]\]/g, ' [Blank $1] '));
    if (q.prompt) context += paragraph(q.prompt);
    if (q.type === 'swt') {
      response = '<h3>Your summary</h3>' + paragraph(a[0] || 'Not answered');
      feedback = swtFeedback(q, a, assessment, points);
    } else {
      if (['dropdown','wordbank'].includes(q.type)) response = table(['Blank', 'Your answer', 'Correct answer', 'Result'], q.answers.map((correct,i) => [i+1, a[i] || 'Not answered', correct, a[i]===correct?'Correct':a[i]?'Incorrect':'Unanswered']));
      else if (q.type === 'reorder') {
        const text = key => q.items.find(item=>item.key===key)?.text || 'Not answered';
        context = '<h3>Original paragraphs</h3>' + list(q.items.map(item=>item.text));
        response = '<div class="reading-answer-columns"><section><h3>Your order</h3>' + list(a.map(text)) + '</section><section><h3>Correct order</h3>' + list(q.answers.map(text)) + '</section></div>';
      } else if (q.type === 'hiw') {
        const words = q.passage.split(/\s+/);
        response = '<h3>Your selected words</h3>' + list(a.map(i=>'Word '+(i+1)+': '+words[i]))
          + '<h3>Correct highlights</h3>' + table(['Position', 'Written word', 'Spoken word', 'Your selection'], q.corrections.map(c => [c.index+1,c.written,c.spoken,a.includes(c.index)?'Selected correctly':'Missed']));
        const wrong = a.filter(i=>!q.answers.includes(i));
        if (wrong.length) response += '<h4>Incorrect selections</h4>' + list(wrong.map(i=>'Word '+(i+1)+': '+words[i]+' — this word matched the audio.'));
      } else {
        const correct = q.type==='mcma' ? q.answers : [q.answer];
        response = table(['Option', 'Answer option', 'Your selection', 'Correct answer'], q.choices.map((choice,i)=>[String.fromCharCode(65+i),choice,a.includes(i)?'Selected':'—',correct.includes(i)?'Correct':'—']));
        if (!a.length) response = '<p class="reading-unanswered">Not answered</p>' + response;
      }
      const info = q.reasoning || {};
      feedback = '<h3>Feedback</h3>' + paragraph(info.correct || 'Compare your response with the correct answer and the supporting passage above.');
      if (info.options) feedback += '<h4>Other options explained</h4>' + list(Object.entries(info.options).map(([option,reason])=>option+': '+reason));
    }
    const audio = q.audioText ? '<div class="reading-audio"><button class="portal-button" data-action="play" data-review-uid="' + escape(q.uid) + '">Replay for review</button><span data-review-audio-status="' + encodeURIComponent(q.uid) + '" role="status">Replay does not change your submitted result.</span></div><h3>Audio transcript</h3>' + paragraph(q.audioText) : '';
    const status = points.pending ? 'Assessment pending' : excluded ? 'Audio item excluded' : points.earned + '/' + points.possible + ' points';
    return '<article class="reading-card reading-review-question" data-review-question="' + encodeURIComponent(q.uid) + '"><div class="reading-review-heading"><div><p class="portal-eyebrow">Question ' + (index+1) + ' of ' + total + '</p><h2>' + escape(label) + '</h2></div><span class="reading-review-points">' + escape(status) + '</span></div>'
      + context + response + (excluded ? paragraph('Audio did not finish before you moved on. This item is excluded from the graded total; your saved selections appear below the transcript.') : '')
      + '<section class="reading-explanation">' + feedback + '</section>' + audio + '</article>';
  }
  return { question };
});
