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
  function compose(bank, mode, setId, swtPassages) {
    const preset = bank.mockCatalogue?.find(item => item.id === mode);
    if (preset) {
      const set = bank.sets.find(item => item.id === preset.setId);
      if (!set) throw Error('This mock question set is unavailable.');
      const reading = set.questions.map(q => ({ ...q, uid: set.id + ':' + q.id, reasoning: set.reasoning[q.id] || {} }));
      validateReading(reading, set.minutes);
      const audio = preset.audioQuestionIds.map(id => bank.audioQuestionBank.find(q => q.id === id));
      if (audio.some(q => !q) || audio.filter(q => q.type === 'hcs').length !== 2 || audio.filter(q => q.type === 'hiw').length !== 2) throw Error('This mock audio set is incomplete.');
      return composeIntegrated(preset.name, reading, set.minutes, audio, bank.mixedMock.listeningMinutes, swtPassages, preset.timed, preset.minutes);
    }
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
    return composeIntegrated(bank.mixedMock.name, reading, set.minutes, bank.mixedMock.audioQuestions, bank.mixedMock.listeningMinutes, swtPassages, true);
  }
  function composeIntegrated(name, reading, readingMinutes, audio, listeningMinutes, swtPassages, timed, sharedMinutes) {
    if (!Array.isArray(swtPassages) || swtPassages.length !== 2 || swtPassages.some(p => p?.id == null || !p.text || !p.keyElements) || new Set(swtPassages.map(p => String(p.id))).size !== 2 || new Set(swtPassages.map(p => p.text.trim().replace(/\s+/g, ' ').toLowerCase())).size !== 2) throw Error('Two different SWT passages are required. Please try again.');
    const swt = swtPassages.map((p, i) => ({ id: p.id, uid: 'mixed:swt:' + p.id, type: 'swt', title: p.title || 'Summarise written text', passageId: p.id, passage: p.text, keyPoints: p.keyElements, sampleResponse: p.sampleResponse || '', instructions: 'Read the passage and write a one-sentence summary of 5–75 words. This is SWT ' + (i + 1) + ' of 2.' + (sharedMinutes ? ' All questions share the '+sharedMinutes+'-minute mock timer.' : timed ? ' You have 10 minutes for this question.' : ' Take your time in this untimed practice mock.') }));
    const questions = [...swt, ...reading, ...audio];
    if (new Set(questions.map(q => q.uid)).size !== questions.length) throw Error('This mock contains repeated questions.');
    const stages = [
      { id: 'swt-1', name: 'SWT 1 of 2', first: 0, last: 0, minutes: 10 },
      { id: 'swt-2', name: 'SWT 2 of 2', first: 1, last: 1, minutes: 10 },
      { id: 'reading', name: 'Reading', first: 2, last: reading.length + 1, minutes: readingMinutes },
      { id: 'listening', name: 'HCS & HIW', first: reading.length + 2, last: questions.length - 1, minutes: listeningMinutes }
    ];
    return { name, minutes: sharedMinutes || stages.reduce((n, stage) => n + stage.minutes, 0), questions, stages: timed && !sharedMinutes ? stages : undefined };
  }
  // Autoplay and manual recovery share the same playback lifecycle.
  function createSpeaker(env, onState) {
    let active = null, timeout = null, startTimeout = null, serial = 0;
    function cancel() {
      serial++;
      if (timeout) env.clearTimeout(timeout);
      if (startTimeout) env.clearTimeout(startTimeout);
      timeout = null;
      startTimeout = null;
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
        if (startTimeout) env.clearTimeout(startTimeout);
        timeout = null;
        startTimeout = null;
        serial++;
        if (status === 'error') env.speechSynthesis.cancel();
        onState(key, status, message);
      };
      utterance.onstart = () => { if (ticket === serial) { started = true; if (startTimeout) env.clearTimeout(startTimeout); startTimeout = null; onState(key, 'playing', 'Playing. Follow the question on screen.'); } };
      utterance.onend = () => finish(started ? 'complete' : 'error', started ? 'Audio complete. Your answer is ready to submit.' : 'Audio did not start. Check your sound and try again.');
      utterance.onerror = event => finish('error', event?.error === 'not-allowed' ? 'Your browser blocked autoplay. Select Play audio to start.' : 'Audio could not finish. Check your sound and select Play audio to retry.');
      onState(key, 'loading', 'Starting audio…');
      startTimeout = env.setTimeout(() => { if (!started) finish('error', 'Audio did not start. Select Play audio to enable playback in this browser.'); }, 8000);
      timeout = env.setTimeout(() => finish('error', 'Audio timed out. Replay the question before submitting.'), 150000);
      try { env.speechSynthesis.speak(utterance); } catch (_) { finish('error', 'Audio could not start. Try another browser with an English voice.'); }
    }
    return { play, cancel };
  }
  return { extraLabels, scoreExtra, isAudio, compose, createSpeaker, readingFormat, validateReading };
});
