(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReadingMockTools = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const extraLabels = { swt: 'Summarise written text', hcs: 'Highlight Correct Summary', hiw: 'Highlight Incorrect Words' };
  const AUDIO_VARIANTS = Object.freeze(['single', 'ambient', 'two-speakers', 'sound-cue']);
  function hash(value) {
    let n = 2166136261;
    for (const ch of String(value || '')) { n ^= ch.charCodeAt(0); n = Math.imul(n, 16777619); }
    return n >>> 0;
  }
  // Every HIW entry point shares the same practice variation; the transcript
  // and answer key are never changed by the audio layer.
  function audioVariant(q, challenge = true) {
    if (!q || q.type !== 'hiw' || !challenge) return 'single';
    if (q.audioVariant && q.audioVariant !== 'single' && AUDIO_VARIANTS.includes(q.audioVariant)) return q.audioVariant;
    return AUDIO_VARIANTS[hash(q.id || q.uid) % AUDIO_VARIANTS.length] === 'single' ? 'ambient' : AUDIO_VARIANTS[hash(q.id || q.uid) % AUDIO_VARIANTS.length];
  }
  function audioPlayback(q, challenge = true) {
    const variant = audioVariant(q, challenge);
    return {
      variant,
      label: variant === 'two-speakers' ? 'Two-speaker practice challenge' : variant === 'ambient' ? 'Light ambient practice challenge' : variant === 'sound-cue' ? 'Practice challenge with a brief woodpecker-style chirp cue' : 'Single-speaker audio',
      cue: variant === 'sound-cue' ? (q.soundCue || 'woodpecker-chirp') : null,
      transcript: q?.audioText || ''
    };
  }
  function seeded(seed) {
    let n = hash(seed) || 1;
    return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
  }
  function shuffle(items, seed) {
    const next = items.slice(), random = seeded(seed);
    for (let i = next.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [next[i], next[j]] = [next[j], next[i]]; }
    if (next.length > 1 && next.every((value, i) => value === items[i])) [next[0], next[1]] = [next[1], next[0]];
    return next;
  }
  // Keep answer keys in their original coordinate system. Only the rendered
  // order changes, and the same question receives the same order after reload.
  function prepareQuestion(question, seed = question?.uid || question?.id) {
    const q = JSON.parse(JSON.stringify(question || {}));
    if (q.optionOrderVersion === 1) return q;
    if (Array.isArray(q.options)) q.options = q.options.map((row, i) => shuffle(row, `${seed}:options:${i}`));
    if (Array.isArray(q.bank)) q.bank = shuffle(q.bank, `${seed}:bank`);
    if (Array.isArray(q.items)) q.items = shuffle(q.items, `${seed}:items`);
    if (Array.isArray(q.choices)) {
      const original = (q.originalChoices || q.choices).slice(), indices = shuffle(original.map((_, i) => i), `${seed}:choices`);
      q.originalChoices = original;
      q.choiceIndices = indices;
      q.choices = indices.map(i => original[i]);
    }
    q.optionOrderVersion = 1;
    return q;
  }
  function prepareQuestions(questions, seed = '') { return (Array.isArray(questions) ? questions : []).map((q, i) => prepareQuestion(q, `${seed}:${q.uid || q.id || i}`)); }
  function choiceText(q, originalIndex) {
    if (Array.isArray(q?.originalChoices)) return q.originalChoices[originalIndex];
    if (Array.isArray(q?.choiceIndices)) return q.choices[q.choiceIndices.indexOf(originalIndex)];
    return q?.choices?.[originalIndex];
  }
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
      const set = [...bank.sets,...(bank.importedSets||[])].find(item => item.id === preset.setId);
      if (!set) throw Error('This mock question set is unavailable.');
      if(preset.kind==='reading-blanks')return {name:preset.name,minutes:preset.minutes,questions:set.questions.map(q=>({...q}))};
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
  // Autoplay, manual playback and review share one audio lifecycle.
  function createSpeaker(env, onState) {
    let active = null, timeout = null, startTimeout = null, serial = 0;
    let audioContext = null, effects = null, voiceCleanup = null;
    function clearTimers() {
      if (timeout !== null) env.clearTimeout(timeout);
      if (startTimeout !== null) env.clearTimeout(startTimeout);
      timeout = startTimeout = null;
      voiceCleanup?.();
      voiceCleanup = null;
    }
    function stopEffects() {
      if (!effects) return;
      const previous = effects; effects = null;
      previous.timers.forEach(id => env.clearTimeout(id));
      previous.nodes.forEach(node => {
        try { node.stop?.(); } catch (_) {}
        try { node.disconnect?.(); } catch (_) {}
      });
    }
    // Call during the click that opens/resumes a question, before its countdown.
    // Unlocking only inside the later speech callback loses browser activation.
    function unlock() {
      try {
        const Context = env.AudioContext || env.webkitAudioContext;
        if (!Context) return Promise.resolve(false);
        if (!audioContext || audioContext.state === 'closed') audioContext = new Context();
        if (audioContext.state === 'running') return Promise.resolve(true);
        return Promise.resolve(audioContext.resume?.()).then(() => audioContext.state === 'running', () => false);
      } catch (_) { return Promise.resolve(false); }
    }
    function cancel() {
      serial++;
      clearTimers();
      stopEffects();
      if (active !== null) {
        const previous = active; active = null;
        env.speechSynthesis?.cancel();
        onState(previous, 'error', 'Playback was interrupted. Replay this question before submitting.');
      }
    }
    function startEffects(options, ticket, ready, unavailable) {
      if (!['ambient', 'sound-cue'].includes(options.variant)) return;
      const begin = enabled => {
        if (ticket !== serial || active === null) return;
        if (!enabled || audioContext?.state !== 'running') return unavailable();
        stopEffects();
        const layer = { nodes: [], timers: [] }; effects = layer;
        const track = node => { layer.nodes.push(node); return node; };
        try {
          if (options.variant === 'ambient') {
            // Quiet filtered air/room noise is audible behind speech without a
            // continuous musical tone competing with the spoken words.
            const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 2, audioContext.sampleRate);
            const samples = buffer.getChannelData(0);
            let previous = 0;
            for (let i = 0; i < samples.length; i++) {
              previous = (previous + 0.02 * (Math.random() * 2 - 1)) / 1.02;
              samples[i] = previous * 3.5;
            }
            const source = track(audioContext.createBufferSource());
            const filter = track(audioContext.createBiquadFilter());
            const gain = track(audioContext.createGain());
            source.buffer = buffer; source.loop = true;
            filter.type = 'lowpass'; filter.frequency.value = 1200;
            gain.gain.setValueAtTime(0, audioContext.currentTime);
            gain.gain.linearRampToValueAtTime(0.08, audioContext.currentTime + 0.15);
            source.connect(filter); filter.connect(gain); gain.connect(audioContext.destination);
            source.start();
          } else {
            const chirp = () => {
              if (ticket !== serial || effects !== layer || active === null) return;
              const now = audioContext.currentTime;
              for (let i = 0; i < 3; i++) {
                const at = now + i * 0.09;
                const oscillator = track(audioContext.createOscillator());
                const gain = track(audioContext.createGain());
                oscillator.type = 'triangle';
                oscillator.frequency.setValueAtTime(1700, at);
                oscillator.frequency.exponentialRampToValueAtTime(2700, at + 0.025);
                oscillator.frequency.exponentialRampToValueAtTime(1900, at + 0.065);
                gain.gain.setValueAtTime(0.0001, at);
                gain.gain.exponentialRampToValueAtTime(0.06, at + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
                oscillator.connect(gain); gain.connect(audioContext.destination);
                oscillator.onended = () => {
                  oscillator.disconnect(); gain.disconnect();
                  layer.nodes = layer.nodes.filter(node => node !== oscillator && node !== gain);
                };
                oscillator.start(at); oscillator.stop(at + 0.08);
              }
            };
            // Cues follow actual speech, even when a voice takes time to load.
            layer.timers.push(env.setTimeout(chirp, 700), env.setTimeout(chirp, 6500));
          }
        } catch (_) { stopEffects(); unavailable(); }
      };
      if (audioContext?.state === 'running') begin(true);
      else ready.then(begin);
    }
    function play(key, text, options = {}) {
      cancel();
      const effectsReady = unlock();
      if (!env.speechSynthesis || !env.SpeechSynthesisUtterance) {
        onState(key, 'error', 'Audio is unavailable in this browser. Open the practice in a browser with an English speech voice. This item will be excluded if audio cannot play.');
        return;
      }
      const ticket = serial, variant = options.variant || 'single';
      let started = false, effectsUnavailable = false, cursor = 0, utterances = [];
      active = key;
      const current = () => ticket === serial && active === key;
      const finish = (status, message) => {
        if (!current()) return;
        active = null; serial++;
        clearTimers(); stopEffects();
        if (status === 'error') env.speechSynthesis.cancel();
        onState(key, status, message);
      };
      const armStartTimeout = () => {
        if (startTimeout !== null) env.clearTimeout(startTimeout);
        startTimeout = env.setTimeout(() => finish('error', 'Audio did not start. Select Play audio to enable playback in this browser.'), 8000);
      };
      const playingMessage = () => effectsUnavailable ? 'Playing speech. Practice background sound is unavailable in this browser.' :
        variant === 'two-speakers' ? 'Playing. Follow both speakers.' :
        variant === 'sound-cue' ? 'Playing with brief woodpecker-style chirp cues.' :
        variant === 'ambient' ? 'Playing with light ambient practice sound.' : 'Playing. Follow the question on screen.';
      const playNext = () => {
        if (!current()) return;
        const utterance = utterances[cursor++];
        let partStarted = false;
        if (cursor > 1) armStartTimeout();
        utterance.onstart = () => {
          if (!current() || partStarted) return;
          partStarted = true;
          if (startTimeout !== null) env.clearTimeout(startTimeout);
          startTimeout = null;
          onState(key, 'playing', playingMessage());
          if (!started && current()) {
            started = true;
            startEffects(options, ticket, effectsReady, () => {
              effectsUnavailable = true;
              if (current()) onState(key, 'playing', playingMessage());
            });
          }
        };
        utterance.onend = () => {
          if (!current()) return;
          if (!partStarted) return finish('error', 'Audio did not start. Check your sound and try again.');
          if (cursor < utterances.length) return playNext();
          finish('complete', effectsUnavailable ? 'Audio complete. Practice background sound was unavailable in this browser.' : 'Audio complete. Your answer is ready to submit.');
        };
        utterance.onerror = event => finish('error', event?.error === 'not-allowed' ? 'Your browser blocked autoplay. Select Play audio to start.' : 'Audio could not finish. Check your sound and select Play audio to retry.');
        try { env.speechSynthesis.speak(utterance); } catch (_) { finish('error', 'Audio could not start. Try another browser with an English voice.'); }
      };
      const beginSpeech = voices => {
        if (!current()) return;
        voiceCleanup?.(); voiceCleanup = null;
        const transcript = String(text || '');
        let parts = [transcript];
        if (variant === 'two-speakers') {
          parts = transcript.match(/[\s\S]*?[.!?]+(?:["'”’)\]]+)?(?=\s|$)|[\s\S]+$/g)?.map(part => part.trim()).filter(Boolean) || [transcript];
          if (parts.length === 1) {
            const words = transcript.match(/\S+\s*/g) || [];
            if (words.length > 1) { const middle = Math.ceil(words.length / 2); parts = [words.slice(0, middle).join('').trim(), words.slice(middle).join('').trim()]; }
          }
        }
        const first = voices.find(v => /^en[-_](AU|GB)/i.test(v.lang)) || voices[0] || null;
        const identity = v => v && (v.voiceURI || v.name || v.lang);
        const others = voices.filter(v => identity(v) !== identity(first));
        const second = others.find(v => /^en[-_](US|CA)/i.test(v.lang)) || others[0] || first;
        const distinct = first && second && identity(first) !== identity(second);
        utterances = parts.map((part, i) => {
          const utterance = new env.SpeechSynthesisUtterance(part);
          utterance.voice = i % 2 ? second : first;
          utterance.lang = utterance.voice?.lang || (i % 2 ? 'en-US' : 'en-GB');
          utterance.rate = variant === 'two-speakers' ? (i % 2 ? 0.96 : 1.03) : 1;
          utterance.pitch = variant === 'two-speakers' ? (i % 2 ? (distinct ? 0.92 : 0.82) : (distinct ? 1.06 : 1.18)) : 1;
          return utterance;
        });
        playNext();
      };
      const readVoices = () => env.speechSynthesis.getVoices().filter(v => /^en(?:[-_]|$)/i.test(v.lang));
      onState(key, 'loading', 'Starting audio…');
      if (!current()) return;
      armStartTimeout();
      timeout = env.setTimeout(() => finish('error', 'Audio timed out. Replay the question before submitting.'), 150000);
      try {
        const voices = readVoices();
        if (voices.length || !env.speechSynthesis.addEventListener) return beginSpeech(voices);
        // Browsers often return [] until voiceschanged fires on first use.
        let voiceTimer = null;
        const voicesChanged = () => {
          if (!current()) return;
          try { const available = readVoices(); if (available.length) beginSpeech(available); }
          catch (_) { finish('error', 'The speech voice could not load. Check your browser audio settings and retry.'); }
        };
        voiceCleanup = () => {
          env.speechSynthesis.removeEventListener?.('voiceschanged', voicesChanged);
          if (voiceTimer !== null) env.clearTimeout(voiceTimer);
        };
        env.speechSynthesis.addEventListener('voiceschanged', voicesChanged);
        voiceTimer = env.setTimeout(() => { if (current()) { try { beginSpeech(readVoices()); } catch (_) { beginSpeech([]); } } }, 1500);
        voicesChanged();
      } catch (_) { finish('error', 'The speech voice could not load. Check your browser audio settings and retry.'); }
    }
    return { play, cancel, unlock };
  }
  return { extraLabels, scoreExtra, isAudio, compose, createSpeaker, readingFormat, validateReading, audioVariant, audioPlayback, shuffle, prepareQuestion, prepareQuestions, choiceText, AUDIO_VARIANTS };
});
