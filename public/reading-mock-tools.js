(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReadingMockTools = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const extraLabels = { swt: 'Summarise written text', hcs: 'Highlight Correct Summary', hiw: 'Highlight Incorrect Words' };
  function scoreExtra(q, answer = [], assessment) {
    const a = Array.isArray(answer) ? answer : [];
    if (q.type === 'hcs') return { earned: a.length && a[0] === q.answer ? 1 : 0, possible: 1 };
    if (q.type === 'hiw') return { earned: Math.max(0, [...new Set(a)].reduce((n, index) => n + (q.answers.includes(index) ? 1 : -1), 0)), possible: q.answers.length };
    if (q.type !== 'swt') return null;
    if (!String(a[0] || '').trim()) return { earned: 0, possible: 9 };
    const data = assessment?.result;
    const valid = data && !data.score_provisional && !data.ai_feedback_degraded &&
      Number.isFinite(data.raw_score) && data.raw_score >= 0 && data.raw_score <= 9 && data.max_raw_score === 9 &&
      ['content', 'form', 'grammar', 'vocabulary'].every(key => Number.isFinite(data.trait_scores?.[key]));
    return valid ? { earned: data.raw_score, possible: 9 } : { earned: 0, possible: 9, pending: true };
  }
  function isAudio(q) { return q.type === 'hcs' || q.type === 'hiw'; }
  // Pearson PTE Academic Test Taker Score Guide, p. 40; checked 10 September 2026.
  // These are format constraints only; scoring is intentionally independent.
  const readingFormat = {
    minutes: [23, 30],
    source: 'https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/pdfs/pte-academic-pdfs/PTE-Academic-Test-Taker-Score-Guide.pdf',
    tasks: [
      { type: 'dropdown', label: 'Dropdown blanks', min: 5, max: 6, words: 300 },
      { type: 'mcma', label: 'Multiple answers', min: 2, max: 3, words: 350 },
      { type: 'reorder', label: 'Reorder paragraphs', min: 2, max: 3, words: 150 },
      { type: 'wordbank', label: 'Drag-and-drop blanks', min: 4, max: 5, words: 80 },
      { type: 'mcsa', label: 'Single answer', min: 2, max: 3, words: 300 }
    ]
  };
  function validateReading(questions, minutes) {
    if (!Number.isFinite(minutes) || minutes < readingFormat.minutes[0] || minutes > readingFormat.minutes[1]) throw Error('This reading mock has an invalid section time.');
    if (new Set(questions.map(q => q.uid)).size !== questions.length) throw Error('This reading mock contains repeated questions.');
    const order = readingFormat.tasks.map(t => t.type);
    let last = -1;
    for (const q of questions) {
      const position = order.indexOf(q.type), task = readingFormat.tasks[position];
      if (position < 0 || position < last) throw Error('This reading mock has an invalid task order.');
      last = position;
      const text = q.type === 'reorder' ? q.items.map(item => item.text).join(' ') : q.passage;
      if (String(text || '').trim().split(/\s+/).filter(Boolean).length > task.words) throw Error('A reading passage exceeds the exam format’s word limit.');
    }
    for (const task of readingFormat.tasks) {
      const count = questions.filter(q => q.type === task.type).length;
      if (count < task.min || count > task.max) throw Error('This reading mock has an invalid number of ' + task.label.toLowerCase() + ' questions.');
    }
  }
  function compose(bank, mode, setId, swtPassage) {
    const sectional = bank.sectionalMocks.find(item => item.id === mode);
    const set = bank.sets.find(item => item.id === (sectional?.setId || setId));
    if (!set) throw Error('This question set is unavailable.');
    const reading = set.questions.map(q => ({ ...q, uid: set.id + ':' + q.id, reasoning: set.reasoning[q.id] || {} }));
    if (sectional) {
      const questions = sectional.questionRefs ? sectional.questionRefs.map(ref => {
        const source = bank.sets.find(item => item.id === ref.setId);
        const q = source?.questions.find(item => item.id === ref.questionId);
        if (!q) throw Error('A sectional reading question is unavailable.');
        return { ...q, uid: source.id + ':' + q.id, reasoning: source.reasoning[q.id] || {} };
      }) : reading;
      validateReading(questions, sectional.minutes);
      return { name: sectional.name, minutes: sectional.minutes, questions };
    }
    if (mode === 'mock') validateReading(reading, set.minutes);
    if (mode !== 'full') return { name: set.name, minutes: set.minutes, questions: reading };
    if (!swtPassage?.text || !swtPassage.keyElements) throw Error('The SWT passage could not load. Please try again.');
    const swt = { id: swtPassage.id, uid: 'mixed:swt:' + swtPassage.id, type: 'swt', title: swtPassage.title || 'Summarise written text', passageId: swtPassage.id, passage: swtPassage.text, keyPoints: swtPassage.keyElements, sampleResponse: swtPassage.sampleResponse || '', instructions: 'Read the passage and write a one-sentence summary of 5–75 words. Aim to spend 10 minutes on this question.' };
    return { name: bank.mixedMock.name, minutes: bank.mixedMock.minutes, questions: [swt, ...reading, ...bank.mixedMock.audioQuestions] };
  }
  // Audio is deliberately initiated by a click, as browser autoplay policies vary.
  // A completed utterance consumes one play; failed/interrupted audio can be retried.
  function createSpeaker(env, onState) {
    let active = null, timeout = null, serial = 0;
    function cancel() {
      serial++;
      if (timeout) env.clearTimeout(timeout);
      timeout = null;
      if (active) {
        const previous = active; active = null;
        env.speechSynthesis?.cancel();
        onState(previous, 'error', 'Playback was interrupted. Replay this question before submitting.');
      }
    }
    function play(key, text) {
      cancel();
      if (!env.speechSynthesis || !env.SpeechSynthesisUtterance) {
        onState(key, 'error', 'Audio is unavailable in this browser. Open the full mock in a browser with an English speech voice. This item will be excluded if audio cannot play.');
        return;
      }
      const ticket = serial;
      let started = false;
      let utterance, voices;
      try {
        utterance = new env.SpeechSynthesisUtterance(text);
        voices = env.speechSynthesis.getVoices().filter(v => /^en(?:-|_)/i.test(v.lang));
      } catch (_) {
        onState(key, 'error', 'The speech voice could not load. Check your browser audio settings and retry.');
        return;
      }
      utterance.voice = voices.find(v => /^en-(AU|GB)/i.test(v.lang)) || voices[0] || null;
      utterance.lang = utterance.voice?.lang || 'en-GB';
      utterance.rate = 1; utterance.pitch = 1;
      active = key;
      const finish = (status, message) => {
        if (ticket !== serial || active !== key) return;
        active = null;
        if (timeout) env.clearTimeout(timeout);
        timeout = null;
        serial++;
        if (status === 'error') env.speechSynthesis.cancel();
        onState(key, status, message);
      };
      utterance.onstart = () => { if (ticket === serial) { started = true; onState(key, 'playing', 'Playing. Follow the question on screen.'); } };
      utterance.onend = () => finish(started ? 'complete' : 'error', started ? 'Audio complete. Your answer is ready to submit.' : 'Audio did not start. Check your sound and try again.');
      utterance.onerror = () => finish('error', 'Audio could not finish. Check your sound and replay the question.');
      onState(key, 'loading', 'Starting audio…');
      timeout = env.setTimeout(() => finish('error', 'Audio timed out. Replay the question before submitting.'), 150000);
      try { env.speechSynthesis.speak(utterance); } catch (_) { finish('error', 'Audio could not start. Try another browser with an English voice.'); }
    }
    return { play, cancel };
  }
  return { extraLabels, scoreExtra, isAudio, compose, createSpeaker, readingFormat, validateReading };
});
