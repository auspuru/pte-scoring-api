(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FullMock = api.createController(root, { getUserId: () => typeof currentUserId === 'undefined' ? '' : currentUserId });
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const speech = type => ['intro', 'ra', 'rs', 'di', 'rl', 'asq', 'sgd', 'rts'].includes(type);
  const clock = value => { const n = Math.max(0, Math.ceil(value / 1000)); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0'); };
  const words = text => String(text || '').trim().split(/\s+/u).filter(Boolean).length;
  const reports = typeof module === 'object' && module.exports ? require('./full-mock-report') : globalThis.FullMockReport;
  function renderQuestion(q, answer = []) {
    const values = Array.isArray(answer) ? answer : [];
    if (speech(q.type)) return (q.text ? '<p class="fm-passage">' + esc(q.text) + '</p>' : '') + (q.image ? '<img id="fm-image" class="fm-image" width="730" height="500" alt="Visual for this Describe Image question">' : '')
      + '<div class="fm-record-status" id="fm-record-status" role="status" aria-live="polite">Preparing</div><meter id="fm-level" min="0" max="1" value="0" aria-label="Microphone input level"></meter>';
    if (['swt', 'essay', 'sst', 'wfd'].includes(q.type)) return (q.text ? '<div class="fm-passage">' + esc(q.text).replace(/\n/g, '<br>') + '</div>' : '')
      + '<label class="fm-editor-label" for="fm-text">Your response</label><textarea id="fm-text" data-fm-text maxlength="12000" spellcheck="false" autocomplete="off" rows="10">' + esc(values[0] || '') + '</textarea><p id="fm-word-count">' + words(values[0]) + ' words</p>';
    if (q.type === 'reorder') {
      const order = values.length ? values : q.items.map(item => item.key);
      return '<p>Move the paragraphs into order. You can drag them or use the arrow buttons.</p><ol class="fm-reorder">' + order.map((key, index) => {
        const box = q.items.find(item => item.key === key); if (!box) return '';
        return '<li draggable="true" data-fm-box="' + esc(key) + '"><p>' + esc(box.text) + '</p><div><button type="button" data-fm="up" data-index="' + index + '" aria-label="Move paragraph ' + (index + 1) + ' up"' + (!index ? ' disabled' : '') + '>↑</button><button type="button" data-fm="down" data-index="' + index + '" aria-label="Move paragraph ' + (index + 1) + ' down"' + (index === order.length - 1 ? ' disabled' : '') + '>↓</button></div></li>';
      }).join('') + '</ol>';
    }
    if (['dropdown', 'wordbank', 'lfi'].includes(q.type)) {
      const passage = q.passage.split(/(\[\[\d+\]\])/g).map(part => {
        const marker = part.match(/^\[\[(\d+)\]\]$/); if (!marker) return esc(part);
        const index = Number(marker[1]) - 1;
        if (q.type === 'lfi') return '<label class="fm-gap"><span class="fm-sr">Blank ' + (index + 1) + '</span><input data-fm-answer="' + index + '" value="' + esc(values[index] || '') + '" maxlength="500" autocomplete="off" spellcheck="false"></label>';
        return '<label class="fm-gap" data-fm-gap="' + index + '"><span class="fm-sr">Blank ' + (index + 1) + '</span><select data-fm-answer="' + index + '"><option value="">Select…</option>' + (q.options?.[index] || q.bank).map(word => '<option value="' + esc(word) + '"' + (values[index] === word ? ' selected' : '') + '>' + esc(word) + '</option>').join('') + '</select></label>';
      }).join('');
      return '<div class="fm-passage fm-cloze">' + passage + '</div>' + (q.bank ? '<div class="fm-word-bank" aria-label="Word bank">' + q.bank.map(word => '<span draggable="true" data-fm-word="' + esc(word) + '">' + esc(word) + '</span>').join('') + '</div>' : '');
    }
    if (q.type === 'hiw') return '<div class="fm-hiw" aria-label="Transcript">' + q.passage.split(/\s+/u).map((word, index) => '<button type="button" data-fm="highlight" data-index="' + index + '" aria-pressed="' + values.includes(index) + '">' + esc(word) + '</button>').join(' ') + '</div>';
    const multiple = ['mcma', 'lmcma'].includes(q.type);
    return (q.passage ? '<p class="fm-passage">' + esc(q.passage) + '</p>' : '') + '<fieldset class="fm-choices"><legend>' + esc(q.prompt || 'Select the best response.') + '</legend>'
      + (q.choices || []).map((choice, index) => '<label><input type="' + (multiple ? 'checkbox' : 'radio') + '" name="fm-choice" data-fm-choice="' + index + '"' + (values.includes(index) ? ' checked' : '') + '><span>' + esc(choice) + '</span></label>').join('') + '</fieldset>';
  }
  function createPendingStore(env) {
    let opened;
    function database() {
      if (!opened) opened = new Promise((resolve, reject) => {
        if (!env.indexedDB) { reject(Error('Website storage is required to keep your test responses safe.')); return; }
        const request = env.indexedDB.open('ipt-full-mock-v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('pending', { keyPath: 'key' });
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || Error('Website storage could not open.'));
      }).catch(error => { opened = null; throw error; });
      return opened;
    }
    async function write(method, key, value) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('pending', 'readwrite');
        const store = tx.objectStore('pending'); if (method === 'delete') store.delete(key); else store.put({ key, value });
        tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error || Error('Your device could not save this response.'));
      });
    }
    async function list(prefix) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('pending', 'readonly'), result = [], request = tx.objectStore('pending').openCursor();
        request.onsuccess = () => { const cursor = request.result; if (!cursor) { resolve(result); return; } if (cursor.key.startsWith(prefix)) result.push(cursor.value); cursor.continue(); };
        request.onerror = () => reject(request.error);
      });
    }
    return { put: (key, value) => write('put', key, value), delete: key => write('delete', key), list };
  }
  function createController(env, { getUserId = () => env.currentUserId || '', pending = createPendingStore(env) } = {}) {
    const doc = env.document, OWNER = 'full-mock';
    let host, owner = '', generation = 0, attempt = null, claim = null, stream = null, context = null, analyser = null,
      timer = null, poller = null, flushing = false, loadingState = false, advancing = false, capture = null,
      output = null, outputUrl = null, imageUrl = null, played = '', rendering = '', draft = [], sequence = -1,
      sample = null, sampleUrl = null, sampleRecorder = null, micDetected = false, equipmentReady = false, setupPaper = '',
      anchor = 0, anchorAt = 0, lastClock = 0, saveTimer = null, readingLevel = 0, lastPhase = '', preparingSegment = false, cued = '',
      report = null, reviewId = '', reportLoading = false, reportRequest = 0, assessmentRetrying = false;
    const volatile = new Map(), segmentCounts = new Map();
    const reviewUrls = new Map();
    const uid = () => String(getUserId() || '').trim().toLowerCase();
    const valid = ticket => ticket === generation && uid() === owner;
    const monotonic = () => env.performance?.now?.() ?? Date.now();
    const serverNow = () => anchor + monotonic() - anchorAt;
    const prefix = () => owner + ':full-mock:';
    const random = () => env.crypto.randomUUID();
    function sessionToken() {
      try { return env.sessionStorage.getItem('pte_impersonate_token') || env.sessionStorage.getItem('pte_session_token') || env.localStorage.getItem('pte_session_token') || ''; } catch { return ''; }
    }
    function notice(message, error = false) { const node = doc.getElementById('fm-notice'); if (node) { node.textContent = message + ([...volatile.keys()].some(key => key.startsWith(prefix())) && !message.includes('Keep this tab open') ? ' Keep this tab open until responses upload; device storage is unavailable.' : ''); node.setAttribute('role', error ? 'alert' : 'status'); } }
    async function queuePut(key, value) {
      try { await pending.put(key, value); if ((volatile.get(key)?.value.sequence ?? -1) <= (value.sequence ?? -1)) volatile.delete(key); }
      catch (error) {
        volatile.set(key, { key, value });
        if (key.startsWith(prefix()) && owner === uid()) { notice('Device storage is full or unavailable. Keep this tab open while responses upload.', true); logEvent('local-storage-failure'); }
      }
    }
    async function queueList(key) {
      let records = [];
      try { records = await pending.list(key); } catch { notice('Device storage is unavailable. Keep this tab open while responses upload.', true); }
      return [...new Map([...records, ...[...volatile.values()].filter(row => row.key.startsWith(key))].map(row => [row.key, row])).values()];
    }
    async function queueDelete(key) { volatile.delete(key); await pending.delete(key); }
    async function api(route, body, options = {}) {
      if (uid() !== owner) throw Error('Your account changed.');
      const expectedOwner = owner;
      const headers = { 'x-session-token': sessionToken(), ...(claim ? { 'x-full-mock-control': claim.controlToken } : {}), ...options.headers };
      if (body !== undefined) headers['Content-Type'] = options.raw ? options.mime : 'application/json';
      let reply;
      try { reply = await env.fetch('/api/full-mocks' + route, { method: options.method || (body === undefined ? 'GET' : 'POST'), headers,
        body: body === undefined ? undefined : options.raw ? body : JSON.stringify(body), cache: 'no-store', signal: env.AbortSignal?.timeout?.(20000) }); }
      catch { throw Object.assign(Error(attempt?.status === 'submitted' ? 'Connection interrupted. Your submitted answers are saved. Retry when connected.' : 'Connection interrupted. Responses on this device will retry when connected; the exam clock continues.'), { network: true }); }
      const data = await reply.json(); if (uid() !== expectedOwner || owner !== expectedOwner) throw Error('Your account changed.');
      if (!reply.ok) throw Object.assign(Error(data.error || 'This action could not finish.'), { status: reply.status });
      return data;
    }
    function accept(value) {
      if (!value?.id || attempt && (value.id !== attempt.id || value.index < attempt.index)) return;
      // A slow heartbeat must not rewind the displayed clock when its response
      // arrives after newer local ticks or another request's acknowledgement.
      if (!lastClock || value.serverNow > lastClock) { anchor = Math.max(value.serverNow, lastClock ? serverNow() : value.serverNow); anchorAt = monotonic(); lastClock = value.serverNow; }
      const changed = attempt?.current?.token !== value.current?.token || attempt?.status !== value.status;
      attempt = value;
      if (changed) render();
    }
    function shell(html) { host.innerHTML = '<div class="fm-shell">' + html + '</div>'; host.onclick = click; host.oninput = input; host.onchange = input; host.ondragstart = dragStart; host.ondragover = event => event.preventDefault(); host.ondrop = drop; }
    async function open(options = {}) {
      reset(); owner = uid(); if (!owner) return;
      host = doc.getElementById('fullMockPane'); const ticket = ++generation;
      shell('<p role="status">Loading Full Mock…</p>');
      try {
        const [catalog, history] = await Promise.all([api('/catalog'), api('/attempts')]); if (!valid(ticket)) return;
        if (options.attemptId) {
          if (history.some(row => row.id === options.attemptId && row.status === 'submitted')) { await resume(options.attemptId, 'submitted'); return; }
          shell('<h1>Continue your full mock</h1><p>Your saved timer continues while you reconnect.</p><button class="portal-button primary" data-fm="resume" data-id="' + esc(options.attemptId) + '">Continue</button><p id="fm-notice" role="status"></p>'); return;
        }
        shell('<header class="fm-hub-header"><span class="fm-eyebrow">IPT BRISBANE · FULL MOCK</span><h1>Full Mock 1</h1><p>A continuous test covering Speaking, Writing, Reading and Listening.</p></header>'
          + (catalog.available ? catalog.papers.map(paper => '<article class="fm-card"><span class="fm-badge">Full Mock</span><h2>' + esc(paper.title) + '</h2><p>65 scored questions · 22 task types · unscored introduction</p><p>Use headphones and a working microphone. Audio plays once, answers save as you work, and you cannot return to earlier questions.</p><button type="button" class="portal-button primary" data-fm="setup" data-paper="' + esc(paper.id) + '">Check equipment</button></article>').join('') : '<p>Full mocks are being prepared. Your sectional mocks remain available.</p>')
          + '<h2>Saved attempts</h2>' + reports.history(history) + '<p id="fm-notice" role="status"></p>');
      } catch (error) { if (valid(ticket)) { shell('<h1>Full Mock</h1><p id="fm-notice" role="alert"></p><button class="portal-button" data-fm="reload">Retry</button>'); notice(error.message, true); } }
    }
    async function microphone() {
      if (stream?.getAudioTracks().some(track => track.readyState !== 'ended')) return;
      stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); stream = null;
      const ticket = generation;
      if (!env.MediaRecorder || !env.navigator?.mediaDevices?.getUserMedia) throw Error('Use a browser with microphone recording support over a secure connection.');
      const obtained = await env.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!valid(ticket)) { obtained.getTracks().forEach(track => track.stop()); throw Error('Your account changed.'); }
      stream = obtained;
      const Context = env.AudioContext || env.webkitAudioContext;
      if (Context) { context ||= new Context(); await context.resume(); analyser = context.createAnalyser(); analyser.fftSize = 512; context.createMediaStreamSource(stream).connect(analyser); }
      stream.getAudioTracks().forEach(track => { track.onended = () => { logEvent('microphone-interrupted'); stopCapture(); notice('Microphone interrupted. Reconnect your microphone; the exam clock continues.', true); const button = doc.getElementById('fm-mic-resume'); if (button) button.hidden = false; }; });
    }
    function mime() { return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => env.MediaRecorder.isTypeSupported?.(type)) || ''; }
    function recorder() { const type = mime(); return new env.MediaRecorder(stream, type ? { mimeType: type } : undefined); }
    function meter() {
      if (!analyser) return 0;
      const values = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(values);
      const rms = Math.sqrt(values.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / values.length);
      readingLevel = Math.min(1, rms * 5); if (rms > 0.012) micDetected = true; return rms;
    }
    function setup(paperId) {
      setupPaper = paperId; sample = null; equipmentReady = false; micDetected = false;
      shell('<span class="fm-eyebrow">BEFORE YOU BEGIN</span><h1>Check your microphone and headphones</h1><p>Record a few words, play the sample, then confirm you can hear it clearly. The sample stays on your device.</p><label class="fm-meter">Microphone level<meter id="fm-level" min="0" max="1" value="0"></meter></label><button type="button" class="portal-button" data-fm="sample" id="fm-sample-button">Record a 3-second sample</button><div id="fm-sample"></div><label class="fm-check"><input id="fm-heard" type="checkbox"> I can hear my recorded voice clearly.</label><p id="fm-notice" role="status"></p><button type="button" class="portal-button primary" data-fm="begin" id="fm-begin" disabled>Begin full mock</button>');
      env.clearInterval(timer); timer = env.setInterval(() => { meter(); const node = doc.getElementById('fm-level'); if (node) node.value = readingLevel; }, 100);
    }
    async function sampleAudio() {
      const button = doc.getElementById('fm-sample-button'); button.disabled = true;
      const ticket = generation;
      try {
        await pending.put(prefix() + 'storage-check', { kind: 'check' }); await pending.delete(prefix() + 'storage-check');
        await microphone(); if (!valid(ticket)) return; const chunks = [], active = recorder(); sampleRecorder = active;
        active.ondataavailable = value => { if (value.data.size) chunks.push(value.data); };
        active.onstop = () => {
          if (!valid(ticket)) return;
          sample = new env.Blob(chunks, { type: active.mimeType || mime() });
          if (sampleUrl) env.URL.revokeObjectURL(sampleUrl); sampleUrl = env.URL.createObjectURL(sample);
          const node = doc.getElementById('fm-sample'); if (node) node.innerHTML = '<audio controls src="' + sampleUrl + '" aria-label="Your microphone sample"></audio>';
          button.disabled = false; notice(micDetected ? 'Sample recorded. Play it and confirm the sound.' : 'No clear sound detected. Check your microphone and record again.', !micDetected);
        };
        active.start(300); env.setTimeout(() => { if (active.state === 'recording') active.stop(); }, 3000); notice('Say a few words now…');
      } catch (error) { if (valid(ticket)) { button.disabled = false; notice(error.message || 'Microphone access was not granted.', true); } }
    }
    async function unlockAudio() {
      output ||= new env.Audio(); output.preload = 'auto';
      const bytes = new Uint8Array(524), view = new DataView(bytes.buffer);
      for (const [offset, value] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) [...value].forEach((letter, index) => { bytes[offset + index] = letter.charCodeAt(0); });
      view.setUint32(4, 516, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, 480, true);
      const url = env.URL.createObjectURL(new env.Blob([bytes], { type: 'audio/wav' })); output.src = url;
      try { await output.play(); output.pause(); } finally { env.URL.revokeObjectURL(url); }
      if (context?.state === 'suspended') await context.resume();
    }
    async function establishClaim() {
      const key = prefix() + attempt.id + ':control'; let previous;
      try { previous = JSON.parse(env.sessionStorage.getItem(key) || 'null'); } catch {}
      claim = { pageId: random(), controlToken: random(), recoveryToken: random(), previousRecoveryToken: previous?.recoveryToken };
      // Retain the recovery secret even if the server's acknowledgement is lost.
      env.sessionStorage.setItem(key, JSON.stringify(claim));
      try { const value = await api('/attempts/' + attempt.id + '/claim', claim); accept(value); }
      catch (error) { if (error.status === 409) { if (previous) env.sessionStorage.setItem(key, JSON.stringify(previous)); else env.sessionStorage.removeItem(key); } throw error; }
    }
    async function begin() {
      if (!equipmentReady || !sample?.size || !micDetected || !doc.getElementById('fm-heard')?.checked) return;
      const ticket = generation;
      const button = doc.getElementById('fm-begin'); button.disabled = true;
      try {
        if (!env.PortalExamMode?.prepare) throw Error('Reload the portal to start this full mock in fullscreen.');
        const ready = await env.PortalExamMode.prepare(OWNER, host, { immediate:true });
        if (!ready || !valid(ticket)) { button.disabled = false; return; }
        await unlockAudio(); if (!valid(ticket)) return; let id;
        const key = prefix() + 'starting'; id = env.sessionStorage.getItem(key) || random(); env.sessionStorage.setItem(key, id);
        const value = await api('/attempts', { id, paperId: setupPaper, checks: { microphone: true, playback: true } });
        if (!valid(ticket)) return; env.sessionStorage.removeItem(key); attempt = value; await establishClaim(); if (valid(ticket)) startPlayer();
      } catch (error) { if (valid(ticket)) { env.PortalExamMode?.set(OWNER, false, host); button.disabled = false; notice(error.message, true); } }
    }
    async function resume(id, knownStatus = 'active') {
      const ticket = generation;
      // Unlock while the Continue click still has user activation. A submitted
      // report never requires browser audio or microphone support.
      const unlocking = knownStatus === 'submitted' ? null : unlockAudio().then(() => null, error => error);
      try {
        if (knownStatus !== 'submitted') {
          if (!env.PortalExamMode?.prepare) throw Error('Reload the portal to continue this full mock in fullscreen.');
          const ready = await env.PortalExamMode.prepare(OWNER, host, { immediate:true });
          if (!ready || !valid(ticket)) return;
        }
        const value = await api('/attempts/' + id); if (!valid(ticket)) return; attempt = value;
        if (value.status === 'active') { if (unlocking) { const error = await unlocking; if (error) throw error; } else await unlockAudio(); if (!valid(ticket)) return; if (speech(value.question.type)) await microphone(); if (!valid(ticket)) return; await establishClaim(); if (valid(ticket)) startPlayer(); }
        else { accept(value); render(); await flush(); await syncReport(); }
      } catch (error) { if (valid(ticket)) { env.PortalExamMode?.set(OWNER, false, host); notice(error.message, true); } }
    }
    function startPlayer() {
      if (attempt?.status !== 'active') { render(); return; }
      render(); env.PortalExamMode?.set(OWNER, true, host, {
        onEvent:event => logEvent(event.reason),
        onLock:() => { stopCapture(); output?.pause(); },
        onResume:() => { played = ''; tick(); }
      });
      env.clearInterval(timer); env.clearInterval(poller);
      timer = env.setInterval(tick, 100); poller = env.setInterval(() => { sync(); flush(); }, 1200); tick(); flush();
    }
    async function sync() {
      if (!attempt || loadingState || !claim) return; loadingState = true; const ticket = generation;
      try { const value = await api('/attempts/' + attempt.id + '/pulse', {}); if (valid(ticket)) { accept(value); if (value.status === 'submitted') render(); } }
      catch (error) {
        if (valid(ticket) && error.status === 409) {
          stopCapture(); stopPrompt(); env.clearInterval(timer); env.clearInterval(poller); claim = null; rendering = '';
          env.PortalExamMode?.set(OWNER, false, host);
          shell('<h1>This player connection was replaced</h1><p>The exam clock continues and saved responses are retained. Use the current tab, or reconnect here after its connection closes.</p><button class="portal-button" data-fm="resume" data-id="' + esc(attempt.id) + '">Reconnect</button><p id="fm-notice" role="alert"></p>');
        }
        if (valid(ticket)) notice(error.message, true);
      }
      finally { loadingState = false; }
    }
    function clearReviewMedia() {
      host?.querySelectorAll('#fm-review-detail audio').forEach(node => { node.pause?.(); node.removeAttribute('src'); node.load?.(); });
      for (const url of reviewUrls.values()) env.URL.revokeObjectURL(url);
      reviewUrls.clear(); reportRequest++;
    }
    async function syncReport(force = false) {
      if (attempt?.status !== 'submitted' || reportLoading || !force && report?.ready && !report.mediaPending) return;
      reportLoading = true; const ticket = generation, id = attempt.id;
      try {
        const next = await api('/attempts/' + id + '/report');
        if (!valid(ticket) || attempt?.id !== id || attempt.status !== 'submitted') return;
        if (!report) {
          report = next; reviewId = next.items.find(row => row.status !== 'assessed')?.id || next.items[0].id;
          shell(reports.page(report, reviewId));
        } else if (JSON.stringify(report) !== JSON.stringify(next)) {
          const previousItem = report.items.find(row => row.id === reviewId); report = next;
          doc.getElementById('fm-report-overview').innerHTML = reports.overview(report);
          doc.getElementById('fm-report-priorities').innerHTML = reports.priorities(report);
          doc.getElementById('fm-report-breakdown').innerHTML = reports.breakdown(report);
          doc.getElementById('fm-review-navigation').innerHTML = reports.selector(report, reviewId);
          const currentItem = report.items.find(row => row.id === reviewId);
          if (JSON.stringify(previousItem) !== JSON.stringify(currentItem)) { clearReviewMedia(); doc.getElementById('fm-review-detail').innerHTML = reports.review(currentItem); }
          doc.getElementById('fm-report-media-status').textContent = report.mediaPending + ' recording segment(s) still uploading.' + (report.mediaPending ? ' Keep this tab open until pending recordings finish uploading.' : '') + (report.recoveredEvidenceCount ? ' Recovered late evidence is retained separately for review.' : '');
          doc.querySelector('[data-fm="assessment-retry"]').hidden = !report.retryAvailable;
        }
      } catch (error) { if (valid(ticket)) notice(error.message, true); }
      finally { if (valid(ticket)) reportLoading = false; }
    }
    function selectReview(id) {
      const item = report?.items.find(row => row.id === id); if (!item) return;
      clearReviewMedia(); reviewId = item.id;
      doc.getElementById('fm-review-navigation').innerHTML = reports.selector(report, reviewId);
      doc.getElementById('fm-review-detail').innerHTML = reports.review(item);
      doc.getElementById('fm-review-title')?.focus?.({ preventScroll:true });
    }
    async function loadReviewMedia(button) {
      const item = report?.items.find(row => row.id === reviewId); if (!item) return;
      const kind = button.dataset.kind, segment = button.dataset.segment, asset = button.dataset.asset;
      if (kind === 'recording' ? !item.recordings.some(row => row.id === segment && row.ready) : !['prompt','image'].includes(kind) || (kind === 'prompt' ? item.question.audio?.id : item.question.image?.id) !== asset) return;
      const ticket = generation, request = reportRequest, selected = reviewId, id = attempt.id;
      const targetId = kind === 'recording' ? 'fm-review-recording-' + segment : 'fm-review-' + kind;
      const target = doc.getElementById(targetId); if (!target || reviewUrls.has(targetId)) return;
      button.disabled = true;
      try {
        const route = '/api/full-mocks/attempts/' + encodeURIComponent(id) + '/review/' + encodeURIComponent(item.question.id) + (kind === 'recording' ? '/recordings/' + encodeURIComponent(segment) : '/media/' + encodeURIComponent(asset));
        const reply = await env.fetch(route, { headers:{ 'x-session-token':sessionToken() }, cache:'no-store', signal:env.AbortSignal?.timeout?.(20000) });
        if (!reply.ok) throw Error('Review media could not load. Retry when connected.');
        const blob = await reply.blob();
        if (!valid(ticket) || request !== reportRequest || selected !== reviewId || attempt?.id !== id) return;
        const url = env.URL.createObjectURL(blob); reviewUrls.set(targetId, url);
        const node = doc.createElement(kind === 'image' ? 'img' : 'audio'); node.src = url;
        if (kind === 'image') { node.className = 'fm-image'; node.alt = 'Question visual'; }
        else { node.controls = true; node.preload = 'metadata'; node.setAttribute('aria-label', kind === 'recording' ? 'Your saved recording' : 'Question audio'); }
        target.replaceChildren(node); button.textContent = kind === 'image' ? 'Question image loaded' : 'Audio ready below';
      } catch (error) { if (valid(ticket) && selected === reviewId) { button.disabled = false; notice(error.message, true); } }
    }
    async function retryAssessment(button) {
      if (assessmentRetrying || !report?.retryAvailable) return;
      assessmentRetrying = true; button.disabled = true; const ticket = generation;
      try { await api('/attempts/' + attempt.id + '/assessment', { retry:true }); if (valid(ticket)) { notice('Incomplete assessment requested. Saved successful stages are retained.'); await syncReport(true); } }
      catch (error) { if (valid(ticket)) notice(error.message, true); }
      finally { if (valid(ticket)) { assessmentRetrying = false; button.disabled = false; } }
    }
    function render() {
      if (!attempt) return;
      if (attempt.status === 'submitted') {
        stopCapture(); stopPrompt(); env.clearInterval(timer); env.clearInterval(poller); poller = env.setInterval(() => { flush(); syncReport(); }, 5000); env.PortalExamMode?.set(OWNER, false, host);
        stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); stream = null;
        if (!report) shell('<h1>Test submitted</h1><p role="status">Loading your saved report…</p><p>Keep this tab open until pending recordings finish uploading.</p><p id="fm-save-status" role="status"></p><p id="fm-notice" role="status"></p><button class="portal-button" data-fm="retry">Retry pending saves and report</button><button class="portal-button" data-fm="reload">Saved attempts</button>');
        syncReport(); return;
      }
      if (rendering === attempt.current.token) return;
      stopCapture(); stopPrompt(); rendering = attempt.current.token; played = ''; cued = ''; lastPhase = ''; sequence = attempt.draftSequence; draft = structuredClone(attempt.draft || []);
      const q = attempt.question;
      shell((attempt.preview ? '<div class="fm-preview-tools"><button type="button" class="fm-text-button" data-fm="end">Finish test early</button></div>' : '') + '<header class="fm-exam-header"><div><span class="fm-eyebrow">IPT BRISBANE · FULL MOCK</span><strong>' + esc(q.type === 'intro' ? 'Personal Introduction · Not scored' : q.name) + '</strong></div><div class="fm-exam-meta"><span class="fm-badge">Full Mock</span><span>' + (attempt.index === 0 ? 'Introduction' : 'Question ' + attempt.index + ' of 65') + '</span><strong id="fm-time" aria-label="Time remaining"></strong></div></header><main class="fm-exam-body"><p class="fm-instruction">' + esc(q.instruction) + '</p>'
        + (q.audio ? '<section class="fm-prompt"><span id="fm-audio-status" role="status">Audio will play automatically.</span><label>Volume <input type="range" id="fm-volume" min="0" max="1" step="0.1" value="1" aria-label="Prompt volume"></label><button type="button" class="portal-button" data-fm="audio" id="fm-audio-resume" hidden>Resume remaining audio</button></section>' : '')
        + '<div id="fm-question">' + renderQuestion(q, draft) + '</div>' + (speech(q.type) ? '<button class="portal-button" data-fm="mic" id="fm-mic-resume" hidden>Reconnect microphone</button>' : '') + '<p id="fm-save-status" class="fm-save-status" role="status">Responses save automatically.</p><p id="fm-notice" role="status"></p></main><footer class="fm-exam-footer"><div>' + (speech(q.type) ? '<button class="fm-text-button" data-fm="skip">Skip this item</button>' : '') + '</div><button class="portal-button primary" id="fm-next" data-fm="next">' + (attempt.index === 65 ? 'Submit test' : 'Next') + ' →</button></footer>');
      recoverDraft(rendering).catch(error => notice(error.message, true)); loadMedia(rendering); if (speech(q.type)) prepareSegment(rendering);
      doc.getElementById('fm-question')?.querySelector('textarea,input,select,button')?.focus({ preventScroll: true });
      host.scrollTop = 0; env.scrollTo?.({ top:0, left:0, behavior:'auto' });
    }
    async function recoverDraft(token) {
      const records = await queueList(prefix() + attempt.id + ':draft:');
      const saved = records.find(row => row.value.itemToken === token)?.value;
      if (saved && saved.sequence > sequence && rendering === token) { draft = saved.answer; sequence = saved.sequence; doc.getElementById('fm-question').innerHTML = renderQuestion(attempt.question, draft); }
    }
    function stopPrompt() { if (output) { output.pause(); output.removeAttribute?.('src'); output.load?.(); } if (outputUrl) env.URL.revokeObjectURL(outputUrl); outputUrl = null; if (imageUrl) env.URL.revokeObjectURL(imageUrl); imageUrl = null; }
    async function mediaBlob(asset, token) {
      const reply = await env.fetch('/api/full-mocks/attempts/' + attempt.id + '/media/' + asset, { headers: { 'x-session-token': sessionToken() }, cache: 'no-store' });
      if (!reply.ok) throw Error('Question media could not load. Your clock continues; the interruption is recorded for review.');
      const blob = await reply.blob(); if (rendering !== token) return null; return blob;
    }
    async function loadMedia(token) {
      try {
        const q = attempt.question;
        if (q.image) { const blob = await mediaBlob(q.image.id, token); if (blob) { imageUrl = env.URL.createObjectURL(blob); doc.getElementById('fm-image').src = imageUrl; } }
        if (q.audio && serverNow() < attempt.current.promptEndsAt) {
          const blob = await mediaBlob(q.audio.id, token); if (blob) { output ||= new env.Audio(); outputUrl = env.URL.createObjectURL(blob); output.src = outputUrl; output.preload = 'auto'; output.onended = () => { if (rendering === token) { played = token; updateAudioStatus('Audio completed.'); } }; output.onerror = () => audioFailure(); }
        }
      } catch (error) { if (rendering === token) { logEvent('media-failure'); notice(error.message, true); } }
    }
    function updateAudioStatus(message) { const node = doc.getElementById('fm-audio-status'); if (node) node.textContent = message; }
    function audioFailure() { logEvent('media-failure'); updateAudioStatus('Audio interrupted.'); const node = doc.getElementById('fm-audio-resume'); if (node) node.hidden = false; }
    async function playPrompt() {
      if (!attempt?.question.audio || !outputUrl || !output || played === rendering || env.PortalExamMode?.isLocked?.(OWNER)) return;
      const token = rendering, audio = output, url = outputUrl;
      if (serverNow() >= attempt.current.promptEndsAt) { played = rendering; updateAudioStatus('Audio completed.'); return; }
      played = rendering;
      try {
        if (audio.readyState < 1) await new Promise((resolve, reject) => { const timeout = env.setTimeout(() => reject(Error('Audio load timed out.')), 10000); audio.onloadedmetadata = () => { env.clearTimeout(timeout); resolve(); }; audio.onerror = () => { env.clearTimeout(timeout); reject(Error('Audio interrupted.')); }; });
        if (rendering !== token || outputUrl !== url || !attempt?.current || env.PortalExamMode?.isLocked?.(OWNER)) return;
        if (serverNow() >= attempt.current.promptEndsAt) { updateAudioStatus('Audio completed.'); return; }
        audio.currentTime = Math.max(0, (serverNow() - attempt.current.promptAt) / 1000); await audio.play();
        if (rendering === token) { updateAudioStatus('Playing — listen once.'); doc.getElementById('fm-audio-resume').hidden = true; }
      } catch { if (rendering === token) { played = token; audioFailure(); } }
    }
    async function prepareSegment(token) {
      if (advancing || preparingSegment || capture || !stream || attempt?.status !== 'active' || attempt.current?.token !== token || env.PortalExamMode?.isLocked?.(OWNER)) return;
      preparingSegment = true;
      try {
        const used = attempt.recordingSegments?.length || segmentCounts.get(token);
        const permit = used ? { id: random(), token: random() } : attempt.recordingPermit;
        const preparedRecorder = recorder(), selectedMime = (preparedRecorder.mimeType || mime() || 'audio/webm').split(';')[0];
        const value = { kind: 'segment', id: attempt.id, itemToken: token, segmentId: permit.id, segmentToken: permit.token, mime: selectedMime, count: 0 };
        const ownerPrefix = prefix(), ticket = generation, key = ownerPrefix + value.id + ':segment:' + value.segmentId;
        await queuePut(key, value); segmentCounts.set(token, (segmentCounts.get(token) || 0) + 1);
        if (advancing || rendering !== token || !valid(ticket) || env.PortalExamMode?.isLocked?.(OWNER)) { await finishCapture(value, ownerPrefix); return; }
        capture = { ...value, key, ownerPrefix, ticket, preparedRecorder, recorder: null, persisted: [], lastSoundAt: null, stopped: false };
        flush();
      } catch (error) { notice(error.message, true); logEvent('local-storage-failure'); }
      finally { preparingSegment = false; }
    }
    function record() {
      if (advancing || !capture || capture.recorder || capture.stopped || !stream || env.PortalExamMode?.isLocked?.(OWNER)) return;
      const current = capture, media = current.preparedRecorder || recorder(); current.recorder = media; current.lastSoundAt = serverNow();
      media.ondataavailable = event => {
        if (!event.data.size) return;
        for (let offset = 0; offset < event.data.size; offset += 256 * 1024) {
          const index = current.count++, blob = event.data.slice(offset, offset + 256 * 1024, current.mime);
          const key = current.ownerPrefix + current.id + ':chunk:' + current.segmentId + ':' + String(index).padStart(4, '0');
          current.persisted.push(queuePut(key, { kind: 'chunk', id: current.id, itemToken: current.itemToken, segmentId: current.segmentId, segmentToken: current.segmentToken, mime: current.mime, sequence: index, blob }));
        }
        flush();
      };
      media.onstop = async () => {
        try { await Promise.all(current.persisted); await finishCapture(current, current.ownerPrefix); }
        catch (error) { if (valid(current.ticket)) { notice(error.message, true); logEvent('local-storage-failure'); } }
      };
      media.onerror = () => { if (valid(current.ticket) && capture === current) { logEvent('microphone-interrupted'); stopCapture(); notice('Recording interrupted. Saved audio will retry; reconnect to continue.', true); const button = doc.getElementById('fm-mic-resume'); if (button) button.hidden = false; } };
      media.start(1000);
    }
    function beep() { try { if (!context) return; const tone = context.createOscillator(), gain = context.createGain(); tone.frequency.value = 1000; gain.gain.value = 0.07; tone.connect(gain); gain.connect(context.destination); tone.start(); tone.stop(context.currentTime + 0.12); } catch {} }
    async function finishCapture(current, ownerPrefix) {
      await queuePut(ownerPrefix + current.id + ':finish:' + current.segmentId, { kind: 'finish', id: current.id, itemToken: current.itemToken, segmentId: current.segmentId, segmentToken: current.segmentToken, chunks: current.count }); await flush();
    }
    function stopCapture() { if (!capture) return; capture.stopped = true; if (capture.recorder?.state === 'recording') capture.recorder.stop(); else if (!capture.recorder) finishCapture(capture, capture.ownerPrefix).catch(() => {}); capture = null; }
    function tick() {
      if (!attempt || attempt.status !== 'active') return;
      const now = serverNow(), current = attempt.current, q = attempt.question;
      const phase = now < (current.promptAt ?? 0) ? 'instructions' : q.audio && now < current.promptEndsAt ? 'listening' : now < current.responseAt ? 'preparing' : speech(q.type) ? 'recording' : 'answering';
      const time = doc.getElementById('fm-time'); if (time) time.textContent = clock(phase === 'preparing' ? current.responseAt - now : current.endsAt - now);
      meter(); const level = doc.getElementById('fm-level'); if (level) level.value = readingLevel;
      if (phase !== lastPhase) { lastPhase = phase; const label = doc.getElementById('fm-record-status'); if (label) label.textContent = { instructions: 'Audio begins shortly', listening: 'Listening', preparing: 'Preparing', recording: 'Recording' }[phase] || phase; }
      if (env.PortalExamMode?.isLocked?.(OWNER)) {
        stopCapture(); output?.pause(); if (now >= current.endsAt) sync(); return;
      }
      if (q.audio && now >= current.promptAt && now < current.promptEndsAt && outputUrl && played !== rendering) playPrompt();
      if (!advancing && speech(q.type) && !capture && now < current.endsAt) prepareSegment(rendering);
      if (q.startCueMs && cued !== rendering && now >= current.responseAt - q.startCueMs && now < current.responseAt) { cued = rendering; beep(); }
      if (!advancing && speech(q.type) && phase === 'recording' && now < current.endsAt) {
        record();
        if (capture?.recorder?.state === 'recording') {
          if (readingLevel > 0.06) capture.lastSoundAt = now;
          if (q.silenceTimeoutSeconds && now - capture.lastSoundAt > q.silenceTimeoutSeconds * 1000) advance(false, true);
        }
      }
      const next = doc.getElementById('fm-next'); if (next) next.disabled = advancing || speech(q.type) && now < current.responseAt;
      const skip = host.querySelector('[data-fm="skip"]'); if (skip) skip.hidden = now >= current.responseAt;
      if (now >= current.endsAt) { stopCapture(); sync(); }
    }
    async function persistDraft() {
      if (!attempt?.current) return;
      const value = { kind: 'draft', id: attempt.id, itemToken: rendering, answer: structuredClone(draft), sequence: ++sequence };
      await queuePut(prefix() + value.id + ':draft:' + value.itemToken, value);
      const label = doc.getElementById('fm-save-status'); if (label) label.textContent = volatile.has(prefix() + value.id + ':draft:' + value.itemToken) ? 'Waiting to upload · keep this tab open.' : 'Saved on this device · uploading…';
      env.clearTimeout(saveTimer); saveTimer = env.setTimeout(flush, 350);
      return value;
    }
    async function flush() {
      if (flushing || !owner || uid() !== owner) return; flushing = true;
      const expectedOwner = owner; let saved = false;
      try {
        const records = await queueList(prefix());
        const rank = { segment: 0, chunk: 1, draft: 2, finish: 3 };
        records.sort((a, b) => rank[a.value.kind] - rank[b.value.kind] || a.key.localeCompare(b.key));
        let failed = false;
        for (const row of records) {
          if (uid() !== expectedOwner || owner !== expectedOwner) break;
          const value = row.value, base = '/attempts/' + value.id;
          try {
          if (value.kind === 'segment') await api(base + '/segments', value);
          else if (value.kind === 'chunk') await api(base + '/segments/' + value.segmentId + '/' + value.sequence, value.blob, { method: 'PUT', raw: true, mime: value.mime, headers: { 'x-full-mock-item': value.itemToken, 'x-full-mock-segment': value.segmentToken } });
          else if (value.kind === 'finish') await api(base + '/segments/' + value.segmentId + '/finish', value);
          else if (value.kind === 'draft') {
            try { await api(base + '/draft', value); }
            catch (error) { if (error.status !== 409) throw error; await api(base + '/recover', value); }
          } else continue;
          saved = true;
          const current = (await queueList(row.key)).find(entry => entry.key === row.key);
          if (current && current.value.sequence === value.sequence && current.value.chunks === value.chunks) await queueDelete(row.key);
          } catch (error) { failed = true; notice(error.message, true); if (!error.status || [401, 429, 503].includes(error.status)) break; }
        }
        const label = doc.getElementById('fm-save-status'); if (label) label.textContent = failed ? 'Some responses are still pending. Keep this tab open to retry.' : (await queueList(prefix())).length ? 'Responses are uploading…' : 'All pending responses saved.';
      } catch (error) { notice(error.message, true); }
      finally { flushing = false; if (saved && owner === expectedOwner && attempt?.status === 'submitted') syncReport(true); }
    }
    async function commitDraft() {
      if (!attempt?.current || speech(attempt.question.type)) return;
      const packet = await persistDraft(), key = prefix() + attempt.id + ':draft:' + attempt.current.token;
      await api('/attempts/' + attempt.id + '/draft', packet);
      const queued = (await queueList(key)).find(row => row.key === key);
      if (queued?.value.sequence === packet.sequence) await queueDelete(key);
    }
    async function advance(skip = false, automatic = false) {
      if (advancing || !attempt?.current || env.PortalExamMode?.isLocked?.(OWNER)) return;
      advancing = true; const id = attempt.id, token = attempt.current.token, ticket = generation;
      const next = doc.getElementById('fm-next'); if (next) { next.disabled = true; next.textContent = 'Saving…'; }
      const editor = doc.getElementById('fm-question'); if (editor) editor.inert = true;
      try {
        stopCapture(); await flush();
        if (!valid(ticket)) return; await commitDraft(); if (!valid(ticket)) return;
        const value = await api('/attempts/' + id + '/next', { itemToken: token, skip }); accept(value);
      } catch (error) { notice(error.message, true); }
      finally {
        advancing = false; const current = doc.getElementById('fm-question'); if (current) current.inert = false;
        const next = doc.getElementById('fm-next'); if (next) next.textContent = (attempt?.index === 65 ? 'Submit test' : 'Next') + ' →';
        if (valid(ticket)) tick();
      }
    }
    async function finishPreview() {
      if (advancing || attempt?.status !== 'active' || !env.confirm('Finish this full mock now? Unanswered questions will be submitted without an answer.')) return;
      advancing = true; const id = attempt.id, ticket = generation;
      const editor = doc.getElementById('fm-question'); if (editor) editor.inert = true;
      try { stopCapture(); await commitDraft(); if (!valid(ticket)) return; await flush(); if (valid(ticket)) accept(await api('/attempts/' + id + '/end', { confirm:true })); }
      finally { advancing = false; const current = doc.getElementById('fm-question'); if (current) current.inert = false; }
    }
    function input(event) {
      const element = event.target;
      if (element.id === 'fm-review-select') { selectReview(element.value); return; }
      if (element.id === 'fm-heard') { equipmentReady = element.checked; doc.getElementById('fm-begin').disabled = !equipmentReady || !sample?.size || !micDetected; return; }
      if (element.id === 'fm-volume') { if (output) output.volume = Number(element.value); return; }
      if (!attempt?.current) return;
      if (element.matches('[data-fm-text]')) { draft = [element.value]; const label = doc.getElementById('fm-word-count'); if (label) label.textContent = words(element.value) + ' words'; }
      else if (element.matches('[data-fm-answer]')) draft[Number(element.dataset.fmAnswer)] = element.value;
      else if (element.matches('[data-fm-choice]')) draft = [...host.querySelectorAll('[data-fm-choice]:checked')].map(node => Number(node.dataset.fmChoice));
      else return;
      persistDraft().catch(error => { notice(error.message, true); logEvent('local-storage-failure'); });
    }
    function reorder(from, to) {
      const values = draft.length ? [...draft] : attempt.question.items.map(item => item.key);
      if (from < 0 || to < 0 || from >= values.length || to >= values.length) return;
      values.splice(to, 0, values.splice(from, 1)[0]); draft = values; doc.getElementById('fm-question').innerHTML = renderQuestion(attempt.question, draft); persistDraft().catch(error => notice(error.message, true));
    }
    function dragStart(event) {
      const word = event.target.closest('[data-fm-word]'), box = event.target.closest('[data-fm-box]');
      if (word) event.dataTransfer.setData('application/x-ipt-full-mock', JSON.stringify({ word: word.dataset.fmWord }));
      if (box) event.dataTransfer.setData('application/x-ipt-full-mock', JSON.stringify({ box: box.dataset.fmBox }));
    }
    function drop(event) {
      event.preventDefault(); let value; try { value = JSON.parse(event.dataTransfer.getData('application/x-ipt-full-mock')); } catch { return; }
      const gap = event.target.closest('[data-fm-gap]'), box = event.target.closest('[data-fm-box]');
      if (gap && attempt.question.bank?.includes(value.word)) { const select = gap.querySelector('select'); select.value = value.word; input({ target: select }); }
      if (box && value.box) { const values = draft.length ? draft : attempt.question.items.map(item => item.key); reorder(values.indexOf(value.box), values.indexOf(box.dataset.fmBox)); }
    }
    async function click(event) {
      const button = event.target.closest('[data-fm]'); if (!button || button.disabled) return;
      try {
        switch (button.dataset.fm) {
          case 'setup': setup(button.dataset.paper); break;
          case 'sample': await sampleAudio(); break;
          case 'mic': await microphone(); button.hidden = true; logEvent('recording-resumed'); break;
          case 'begin': await begin(); break;
          case 'resume': await resume(button.dataset.id, button.dataset.status || 'active'); break;
          case 'next': await advance(); break;
          case 'skip': await advance(true); break;
          case 'audio': played = ''; await playPrompt(); break;
          case 'retry': await flush(); if (attempt?.status === 'submitted') await syncReport(true); else if (attempt) { const value = await api('/attempts/' + attempt.id); accept(value); render(); } break;
          case 'assessment-retry': await retryAssessment(button); break;
          case 'review-media': await loadReviewMedia(button); break;
          case 'review-type': selectReview(report?.items.find(row => row.type === button.dataset.type)?.id); break;
          case 'review-previous': case 'review-next': { const index = report?.items.findIndex(row => row.id === reviewId), delta = button.dataset.fm === 'review-next' ? 1 : -1; if (index != null) selectReview(report.items[index + delta]?.id); break; }
          case 'reload': await open(); break;
          case 'up': reorder(Number(button.dataset.index), Number(button.dataset.index) - 1); break;
          case 'down': reorder(Number(button.dataset.index), Number(button.dataset.index) + 1); break;
          case 'highlight': { const index = Number(button.dataset.index); draft = draft.includes(index) ? draft.filter(value => value !== index) : [...draft, index]; button.setAttribute('aria-pressed', String(draft.includes(index))); await persistDraft(); break; }
          case 'end': await finishPreview(); break;
        }
      } catch (error) { notice(error.message, true); }
    }
    function logEvent(reason) { if (attempt && owner === uid()) api('/attempts/' + attempt.id + '/events', { reason }).catch(() => {}); }
    function reset() {
      generation++; clearReviewMedia(); stopCapture(); stopPrompt(); env.clearInterval(timer); env.clearInterval(poller); env.clearTimeout(saveTimer);
      if (sampleRecorder?.state === 'recording') sampleRecorder.stop(); sampleRecorder = null;
      stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); stream = null;
      context?.close?.().catch?.(() => {}); context = null; analyser = null;
      if (sampleUrl) env.URL.revokeObjectURL(sampleUrl); sampleUrl = null; sample = null;
      env.PortalExamMode?.set(OWNER, false, host); attempt = null; claim = null; rendering = ''; anchor = 0; lastClock = 0; loadingState = false; advancing = false;
      report = null; reviewId = ''; reportLoading = false; assessmentRetrying = false;
      host?.replaceChildren();
    }
    env.addEventListener?.('online', () => { flush(); sync(); });
    env.addEventListener?.('beforeunload', event => { if (attempt?.status === 'active') { stopCapture(); event.preventDefault(); event.returnValue = ''; } });
    doc.addEventListener?.('visibilitychange', () => { if (attempt?.status === 'active' && doc.hidden) logEvent('tab-hidden'); });
    env.addEventListener?.('blur', () => { if (attempt?.status === 'active') logEvent('window-blur'); });
    return { open, reset, leave: reset, flush };
  }
  return { createController, createPendingStore, renderQuestion, clock, words };
});
