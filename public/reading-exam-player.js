(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReadingExamPlayer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const titles = { dropdown: 'Fill in the Blanks (Dropdown)', wordbank: 'Fill in the Blanks (Drag and Drop)', reorder: 'Reorder Paragraphs', mcsa: 'Multiple Choice, Single Answer', mcma: 'Multiple Choice, Multiple Answers', swt: 'Summarize Written Text', hcs: 'Highlight Correct Summary', hiw: 'Highlight Incorrect Words' };
  function isExam(session) { return !!session && (['full','mock','sectional-1','sectional-2','diagnostic'].includes(session.mode) || /^(practice|sectional)-mock-[1-9]\d*$/.test(session.mode)); }
  function moveParagraph(q, answer = [], key, destination, position) {
    if (!q.items.some(item=>item.key===key) || !['source','target'].includes(destination)) return answer;
    const oldIndex=answer.indexOf(key), next=answer.filter(item=>item!==key);
    if (destination === 'target') {
      let at=Number.isInteger(position)?position:answer.length;
      if (oldIndex>=0 && oldIndex<at) at--;
      next.splice(Math.max(0,Math.min(next.length,at)),0,key);
    }
    return next;
  }
  function reorderHTML(q, answer, selected = {}) {
    const source=q.items.filter(item=>!answer.includes(item.key)), index=answer.indexOf(selected.key);
    const box=(key,panel)=>`<button type="button" class="reading-paragraph" draggable="true" data-paragraph="${escape(key)}" data-panel="${panel}" aria-pressed="${selected.key===key&&selected.panel===panel}">${escape(q.items.find(item=>item.key===key).text)}</button>`;
    return `<div class="reading-exam-reorder"><section><h3>Source</h3><div class="reading-paragraph-panel" data-reorder-zone="source" role="group" aria-label="Source paragraphs">${source.map(item=>box(item.key,'source')).join('')||'<p class="reading-panel-empty">All paragraphs have been moved.</p>'}</div></section><div class="reading-transfer-controls"><button type="button" data-transfer="target" aria-label="Move selected paragraph to your answer" ${selected.panel!=='source'?'disabled':''}>→</button><button type="button" data-transfer="source" aria-label="Return selected paragraph to source" ${selected.panel!=='target'?'disabled':''}>←</button></div><section><h3>Your answer</h3><div class="reading-paragraph-panel" data-reorder-zone="target" role="group" aria-label="Paragraphs in your chosen order">${answer.map(key=>box(key,'target')).join('')||'<p class="reading-panel-empty">Move paragraphs here in the correct order.</p>'}</div></section><div class="reading-transfer-controls"><button type="button" data-order-step="-1" aria-label="Move selected paragraph up" ${selected.panel!=='target'||index<1?'disabled':''}>↑</button><button type="button" data-order-step="1" aria-label="Move selected paragraph down" ${selected.panel!=='target'||index<0||index===answer.length-1?'disabled':''}>↓</button></div></div><p class="reading-exam-hint">Drag paragraphs between the panels, or select a paragraph and use the arrow buttons.</p>`;
  }
  function render({ session:s, question:q, content, audio, timer, saved, notice }) {
    const section=q.type==='swt'?'Writing':q.type==='hcs'||q.type==='hiw'?'Listening & Reading':'Reading';
    const stage=s.stages?.[s.stageIndex];
    const clockLabel=s.deadline==null?'Work at your own pace':stage?stage.name+' · '+(q.type==='swt'?'Question':'Section')+' time remaining':'Time remaining';
    return `<div class="reading-exam-player" data-exam-player>
      <header class="reading-exam-header"><div class="reading-exam-brand"><img src="assets/ipt-brisbane-logo.png" alt="IPT Brisbane"><div><strong>IPT Brisbane</strong><span>${escape(s.name)}</span></div></div><div class="reading-exam-clock"><span>${escape(clockLabel)}</span><strong data-timer>${escape(timer)}</strong><span>${stage?'Stage '+(s.stageIndex+1)+' of '+s.stages.length+' · ':''}Question ${s.index+1} of ${s.questions.length}</span></div></header>
      <div class="reading-exam-stage"><div class="reading-exam-section"><span>${section}</span><button type="button" data-action="exam-exit">Exit test</button></div>${s.stageNotice?`<p class="reading-stage-notice" role="status">${escape(s.stageNotice)}</p>`:''}<article class="reading-exam-question" aria-labelledby="readingExamTitle"><h2 id="readingExamTitle" data-exam-title tabindex="-1">${titles[q.type]}</h2><p class="reading-exam-instructions">${escape(q.instructions)}</p>${audio||''}<fieldset><legend class="sr-only">Your answer</legend>${content}</fieldset></article></div>
      <footer class="reading-exam-footer">${notice?`<section class="reading-exam-confirm" role="alert"><p>${escape(notice.message)}</p><div><button type="button" data-action="exam-stay">Keep working</button><button type="button" class="reading-exam-next" data-action="exam-confirm">${notice.action==='exit'?'Save and exit':notice.action==='submit'?'Submit test':'Continue to next question'}</button></div></section>`:''}<div class="reading-exam-footer-row"><div><span data-save-status role="status">${escape(saved)}</span><p>Next saves your answer. You cannot return to an earlier question.</p></div><button type="button" class="reading-exam-next" data-action="exam-next" ${notice?'disabled':''}>${s.index===s.questions.length-1?'Finish mock':'Next'} <span aria-hidden="true">→</span></button></div></footer>
    </div>`;
  }
  return { isExam, moveParagraph, reorderHTML, render };
});
