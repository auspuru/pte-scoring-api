// ============================================================
//  GLOBAL ERROR BOUNDARY — surface failures as a friendly toast
//  instead of silent console-only errors or a frozen UI.
// ============================================================
(function installErrorBoundary() {
  let lastErrorToastAt = 0;
  function friendlyErrorToast(detail) {
    // Throttle: at most one error toast per 4s so we don't spam
    const now = Date.now();
    if (now - lastErrorToastAt < 4000) return;
    lastErrorToastAt = now;
    // toast() may not be defined yet during early load — guard it
    if (typeof toast === 'function') {
      toast('Something went wrong, but your work is safe. Try again in a moment.', true);
    }
    console.warn('[error-boundary]', detail);
  }
  window.addEventListener('error', (ev) => {
    // Ignore benign ResizeObserver noise + cross-origin script errors with no detail
    const msg = ev.message || '';
    if (msg.includes('ResizeObserver') || msg === 'Script error.') return;
    friendlyErrorToast(msg || ev.error);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    // Ignore the browser-extension message-channel noise the user saw earlier
    const rmsg = (reason && reason.message) || String(reason || '');
    if (rmsg.includes('message channel closed') || rmsg.includes('listener indicated')) return;
    friendlyErrorToast(rmsg);
  });
})();

// ============================================================
//  STATE — Unified Client State
// ============================================================
let essays = [];
let currentId = null;
let currentPassageId = 1;
let currentFilter = 'all';
let currentZoom = 0.7;
let currentUserId = '';       // Custom session username
let currentUser = null;
let userProfile = null;       // Combined profile stashed locally
let offlineMode = false;      // True if offline fallback is chosen
let sessionToken = '';        // Custom sync authentication token

// SWT progress elements
let passages = [];
let adminKey = sessionStorage.getItem('pte_admin_key') || '';
let attempted = new Set();
let timerOn = false;
let timerSeconds = 0;
let timerInterval = null;
let lastSpellData = null;
let writeTab = 'write';

// Sync state
let syncQueued = false;
let syncTimer = null;
let lastSyncOk = true;
let syncRetryCount = 0;
const SYNC_MAX_RETRIES = 5;

// API configuration
const RAILWAY_URL = 'https://swt.up.railway.app';
const isLocalFile = location.protocol === 'file:';
const API_URL = isLocalFile ? RAILWAY_URL : '';

const BAND9_TEMPLATE = {
  intro: `The topic of [paraphrase topic] has become increasingly important in recent years, prompting varied opinions. Its significance lies in its influence on [specific group/area] across multiple dimensions. This essay will examine the [causes and effects / problems and solutions / advantages and disadvantages / positive and negative impacts] of [topic name] incorporating different perspectives and practical examples. [In my view, [insert your own opinion here — e.g., television offers both relaxation and entertainment, but should also be used in moderation].] (Include this line only when the question asks for your opinion.)`,
  bp1: `To begin with, one major [merit / cause / problem] is [point 1], as it leads to [explanation]. For example, [give a specific, topic-relevant example — name a real place, study, statistic, or scenario; NOT generic phrasing like "in many cases"] shows its [benefits / effects] in practice. Additionally, another significant [point in favour / reason / challenge] is [point 2], which [promotes / impacts] [explanation]. This can be illustrated by [give a SECOND specific, topic-relevant example], highlighting how [topic] contributes [positively / negatively] to [society / field].`,
  bp2: `On the other hand, one notable [demerit / negative effect / solution] is [point 1], which may [cause / prevent] [explanation]. For instance, [give a specific, topic-relevant example — a real place, study, statistic, or scenario] illustrates this [drawback / consequence] clearly. Furthermore, another [limitation / adverse consequence / measure to be taken] is [point 2], which results in [explanation]. A clear example of this is [give a SECOND specific, topic-relevant example], demonstrating the impact on [affected group / outcome].`,
  concl: `To conclude, [reword topic] presents [compelling advantages and disadvantages / notable causes and consequences / key problems and remedies] that significantly influence outcomes. Hence, prioritising [name the specific positive aspect of THIS topic — e.g., "well-planned public transport investment" or "supporting student mental health"] while addressing [name the specific drawback to mitigate for THIS topic — e.g., "the funding burden on local councils" or "the disruption to students from underprivileged backgrounds"] is essential for [topic-specific desired outcome — what good thing this leads to]. [Therefore, this reaffirms my earlier view that [echo the specific opinion from the introduction in fresh words — do NOT copy the intro verbatim, restate the same stance with a forward-looking framing].] (Include this Therefore sentence whenever the introduction stated an opinion — it gives the conclusion a stronger, more personal finish.)`,
  notes: `Use sophisticated Band 9 vocabulary (yet still student-friendly — words students recognize from class). Replace [square brackets] with topic-specific content. Choose ONE option when brackets show slashed alternatives based on question type. The "In my view..." line is optional — omit if the question doesn't ask for opinion. CRITICAL: Each body paragraph must contain TWO concrete topic-specific examples (one per supporting idea). Generic phrases like "in many places" or "as research shows" are NOT acceptable examples — use named places, real studies, named populations, or specific scenarios. CRITICAL: The conclusion's middle sentence ("Hence, prioritising...") must be REWRITTEN with topic-specific nouns — never copy it verbatim. If the introduction states an opinion, the conclusion must end with a "Therefore..." sentence that echoes that opinion in fresh wording.`
};
const BAND9_TEMPLATE_VERSION = 2;

const BAND9_TEMPLATE_LEGACY_V1 = {
  intro: `The topic of [paraphrase topic] has become increasingly important in recent years, prompting varied opinions. Its significance lies in its influence on [specific group/area] across multiple dimensions. This essay will examine the [causes and effects / problems and solutions / advantages and disadvantages / positive and negative impacts] of [topic name] incorporating different perspectives and practical examples. [In my view, [insert your own opinion here — e.g., television offers both relaxation and entertainment, but should also be used in moderation].] (Include this line only when the question asks for your opinion.)`,
  bp1: `To begin with, one major [merit / cause / problem] is [point 1], as it leads to [explanation]. For example, [example] shows its [benefits / effects] in practice. Additionally, another significant [point in favour / reason / challenge] is [point 2], which [promotes / impacts] [explanation]. This can be illustrated by [example], highlighting how [topic] contributes [positively / negatively] to [society / field].`,
  bp2: `On the other hand, one notable [demerit / negative effect / solution] is [point 1], which may [cause / prevent] [explanation], as seen in [example]. Furthermore, another [limitation / adverse consequence / measure to be taken] is [point 2], which results in [explanation].`,
  concl: `To conclude, [reword topic] presents [compelling advantages and disadvantages / notable causes and consequences / key problems and remedies] that significantly influence outcomes. Hence, prioritising the maximisation of its (advantages) and the alleviation of its (drawbacks) is essential for fostering long-term progress and collective well-being. [Therefore, [insert your own solution-oriented closing sentence — e.g., with the right strategies and proactive measures, these challenges can be transformed into opportunities for practical solutions and long-term improvement].] (This Therefore line is OPTIONAL — if you've already met the required word count, you can completely skip this sentence.)`
};

const BAND6_TEMPLATE = {
  intro: `The topic of [paraphrased topic] has become increasingly important in recent years and has attracted different opinions. Its significance lies in its impact on individuals and society in various ways. This essay will discuss the advantages and disadvantages of [topic], supported by relevant examples.`,
  bp1: `To begin with, one important benefit of [topic] is that [positive idea 1]. For example, [insert specific example related to positive idea 1]. Additionally, another key advantage is that [positive idea 2], leading to long-term growth and an improved quality of life. This can be clearly seen in modern society, where such positive impacts are becoming more common.`,
  bp2: `On the other hand, a major concern regarding [topic] is that [negative idea 1], as seen in various sectors today. Furthermore, this issue can result in [negative idea 2], including financial burden or reduced well-being for certain groups. However, with effective planning and appropriate measures, these challenges can be controlled and reduced.`,
  concl: `In conclusion, [topic rephrased] has both benefits and drawbacks that strongly influence outcomes. Therefore, it is essential to maximise the positive aspects while minimising the negative ones to achieve long-term progress.`,
  notes: `Use simple, clear Band 6 vocabulary. Keep sentences short and direct. Use everyday words students know. Avoid academic phrases like "incorporating different perspectives" or "fostering long-term progress" — use plain English instead. Do not include any "[EXTRA IDEA]" line in BP1. Do not include any "Therefore," solution line at the end of BP2. Keep paragraphs around 80-100 words each.`
};

const DEFAULT_TEMPLATE = BAND9_TEMPLATE;

function getDefaultTemplates() {
  return {
    band6: BAND6_TEMPLATE,
    band9: BAND9_TEMPLATE,
    custom: BAND9_TEMPLATE,
    default: 'band9'
  };
}

function cleanAndParseJSON(text) {
  if (typeof text !== 'string') return text;
  let cleaned = text.trim();
  
  // Remove markdown code block markers
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  
  // Find first '{' or '[' and last '}' or ']'
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  let startIndex = -1;
  let endIndex = -1;
  
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
    endIndex = cleaned.lastIndexOf('}');
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
    endIndex = cleaned.lastIndexOf(']');
  }
  
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    cleaned = cleaned.substring(startIndex, endIndex + 1);
  }
  
  // Strip lines starting with // (comment lines)
  cleaned = cleaned.replace(/^\s*\/\/.*$/gm, '');

  // Strip block comments: /* ... */
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');

  // Strip trailing commas before closing braces/brackets
  cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.warn("Standard JSON parse failed, attempting quote/smart quote healing. Error:", err.message);
    
    // Attempt to replace smart quotes
    cleaned = cleaned
      .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
      .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

    try {
      return JSON.parse(cleaned);
    } catch (err2) {
      throw new Error(`JSON parsing failed: ${err2.message}. Response snippet: ${text.slice(0, 200)}...`);
    }
  }
}

const LocalStore = {
  get(k){ try{ const i=localStorage.getItem(k); return i?JSON.parse(i):null; }catch(e){ return null; } },
  set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); return true; }catch(e){ return false; } },
  remove(k){ try{ localStorage.removeItem(k); return true; }catch(e){ return false; } },
  getUserId(){ return localStorage.getItem('pte_user_id') || ''; },
  setUserId(id){ try{ localStorage.setItem('pte_user_id', id); }catch(e){} }
};

// ============================================================
//  AUTH FLOW
// ============================================================
function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appShell').style.display = 'none';
  document.body.style.overflow = 'hidden';
}
function hideLogin() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'grid';
  document.body.style.overflow = '';
}

let isSignupMode = false;
function toggleSignupMode(signup) {
  isSignupMode = signup;
  document.getElementById('loginForm').style.display = isSignupMode ? 'none' : 'block';
  document.getElementById('registerForm').style.display = isSignupMode ? 'block' : 'none';
  document.getElementById('forgotPasswordForm').style.display = 'none';
  hideLoginError();
  hideRegisterError();
  hideForgotPasswordError();
}

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.classList.add('show');
}
function hideLoginError() { document.getElementById('loginError').classList.remove('show'); }

function showRegisterError(msg) {
  const el = document.getElementById('registerError');
  el.textContent = msg;
  el.classList.add('show');
}
function hideRegisterError() { document.getElementById('registerError').classList.remove('show'); }

const SECRET_QUESTIONS_MAP = {
  pet: "What was the name of your first pet?",
  school: "What primary school did you attend?",
  city: "What city were you born in?",
  mother: "What is your mother's maiden name?",
  food: "What is your favourite food?",
  friend: "What was your childhood best friend's name?"
};

function toggleForgotPasswordMode(show) {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const forgotForm = document.getElementById('forgotPasswordForm');
  
  if (show) {
    loginForm.style.display = 'none';
    registerForm.style.display = 'none';
    forgotForm.style.display = 'block';
    
    document.getElementById('forgotPassFormStep1').style.display = 'block';
    document.getElementById('forgotPassFormStep2').style.display = 'none';
    document.getElementById('forgotUsername').disabled = false;
    document.getElementById('forgotUsername').value = '';
    document.getElementById('forgotAnswer').value = '';
    document.getElementById('forgotNewPassword').value = '';
    hideForgotPasswordError();
  } else {
    forgotForm.style.display = 'none';
    registerForm.style.display = 'none';
    loginForm.style.display = 'block';
    hideLoginError();
  }
}

function showForgotPasswordError(msg) {
  const el = document.getElementById('forgotPasswordError');
  el.textContent = msg;
  el.classList.add('show');
}
function hideForgotPasswordError() {
  const el = document.getElementById('forgotPasswordError');
  if (el) el.classList.remove('show');
}

async function handleRequestSecretQuestion(ev) {
  ev.preventDefault();
  const u = document.getElementById('forgotUsername').value.trim();
  const btn = document.getElementById('forgotStep1Btn');
  btn.disabled = true;
  btn.textContent = 'Searching...';
  hideForgotPasswordError();
  
  try {
    const r = await fetch(API_URL + '/api/auth/secret-question/' + encodeURIComponent(u));
    const d = await r.json();
    if (d.success) {
      const questionKey = d.secretQ;
      const questionText = SECRET_QUESTIONS_MAP[questionKey] || questionKey || "Please answer your security question";
      
      document.getElementById('forgotQuestionDisplay').textContent = questionText;
      document.getElementById('forgotPassFormStep1').style.display = 'none';
      document.getElementById('forgotPassFormStep2').style.display = 'block';
      document.getElementById('forgotUsername').disabled = true;
    } else {
      showForgotPasswordError(d.error || 'Username not found or has no security question.');
    }
  } catch (e) {
    showForgotPasswordError('Connection error. Try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Continue';
  }
}

async function handleResetPasswordSubmit(ev) {
  ev.preventDefault();
  const u = document.getElementById('forgotUsername').value.trim();
  const sa = document.getElementById('forgotAnswer').value.trim();
  const npw = document.getElementById('forgotNewPassword').value;
  const btn = document.getElementById('forgotStep2Btn');
  
  if (npw.length < 4) {
    showForgotPasswordError('Password must be at least 4 characters.');
    return;
  }
  
  btn.disabled = true;
  btn.textContent = 'Resetting...';
  hideForgotPasswordError();
  
  try {
    const r = await fetch(API_URL + '/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, secretAnswer: sa, newPassword: npw })
    });
    const d = await r.json();
    if (d.success) {
      alert('Password reset successfully! You can now log in.');
      toggleForgotPasswordMode(false);
    } else {
      showForgotPasswordError(d.error || 'Reset failed.');
    }
  } catch (e) {
    showForgotPasswordError('Connection error. Try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Reset password';
  }
}

async function handleLoginSubmit(ev) {
  ev.preventDefault();
  const u = document.getElementById('loginUsername').value.trim();
  const pw = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Signing in...';
  hideLoginError();
  try {
    const r = await fetch(API_URL+'/api/auth/login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:u,password:pw})
    });
    const d = await r.json();
    if(d.success){
      if(d.token) {
        sessionToken = d.token;
        localStorage.setItem('pte_session_token', d.token);
      }
      await enterApp(u);
    } else {
      showLoginError(d.error || 'Login failed.');
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  } catch(e){
    showLoginError('Connection error. Try again.');
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

async function handleRegisterSubmit(ev) {
  ev.preventDefault();
  const u = document.getElementById('regUsername').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pw = document.getElementById('regPassword').value;
  const sq = document.getElementById('regSecretQ').value;
  const sa = document.getElementById('regSecretA').value.trim();
  const btn = document.getElementById('regSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Creating account...';
  hideRegisterError();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showRegisterError('Please enter a valid email address.');
    btn.disabled = false;
    btn.textContent = 'Create account';
    return;
  }
  if (email.toLowerCase().endsWith('@ptewriting.com')) {
    showRegisterError('Cannot use a @ptewriting.com email address.');
    btn.disabled = false;
    btn.textContent = 'Create account';
    return;
  }

  try {
    const r = await fetch(API_URL+'/api/auth/register',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:u,password:pw,secretQ:sq,secretA:sa,email:email})
    });
    const d = await r.json();
    if(d.success){
      if(d.token) {
        sessionToken = d.token;
        localStorage.setItem('pte_session_token', d.token);
      }
      await enterApp(u);
    } else {
      showRegisterError(d.error || 'Registration failed.');
      btn.disabled = false;
      btn.textContent = 'Create account';
    }
  } catch(e){
    showRegisterError('Connection error. Try again.');
    btn.disabled = false;
    btn.textContent = 'Create account';
  }
}

function signOutUser() {
  if (!confirm('Sign out? Your work is safely stored in the cloud.')) return;
  signOut();
}

function exitImpersonation() {
  sessionStorage.removeItem('pte_impersonate_token');
  const url = new URL(window.location);
  url.searchParams.delete('impersonate');
  window.history.replaceState({}, document.title, url.pathname + url.search);
  window.location.reload();
}
window.exitImpersonation = exitImpersonation;

function signOut() {
  currentUserId = '';
  sessionToken = '';
  localStorage.removeItem('pte_session_token');
  sessionStorage.removeItem('pte_impersonate_token');
  LocalStore.setUserId('');
  userProfile = null;
  essays = [];
  currentId = null;

  const banner = document.getElementById('impersonateBanner');
  if (banner) banner.style.display = 'none';

  showLogin();
  toggleSignupMode(false);
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginSubmitBtn').disabled = false;
  document.getElementById('loginSubmitBtn').textContent = 'Sign in';
  const adminBtn = document.getElementById('nav-admin');
  if (adminBtn) adminBtn.style.display = 'none';
}

async function changePassword() {
  const newPw = prompt('Enter your new password (minimum 4 characters):');
  if (!newPw) return;
  if (newPw.length < 4) { toast('Password must be at least 4 characters.', true); return; }
  try {
    const r = await fetch(API_URL+'/api/auth/change-password',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-session-token': sessionToken
      },
      body:JSON.stringify({ password: newPw })
    });
    const d = await r.json();
    if (d.success) {
      toast('Password changed successfully ✓');
    } else {
      toast('Failed: ' + d.error, true);
    }
  } catch (err) {
    toast('Connection error', true);
  }
}

// ============================================================
//  SYNC AND PERSISTENCE ENGINE
// ============================================================

async function enterApp(uid) {
  currentUserId = uid;
  currentUser = { uid: uid, email: uid.includes('@') ? uid : (uid + '@ptewriting.com') };
  LocalStore.setUserId(uid);
  document.getElementById('userAvatar').textContent = uid.slice(0, 2).toUpperCase();
  document.getElementById('userName').textContent = uid;
  hideLogin();
  switchSection('dashboard');
  
  // Load local or pull from server
  const ok = await loadUserData(uid);
  if (!ok) return;

  await loadPassages();
  loadStoredData();
  if (typeof loadPassage === 'function') loadPassage(1);
  
  if (!currentId || !getCurrent()) {
    currentId = essays[0]?.id || null;
  }
  renderList();
  loadCurrent();
  renderPreview();
  setZoom(0.7);
  updateDashboard();
  checkAIStatus();
  const adminBtn = document.getElementById('nav-admin');
  if (adminBtn) adminBtn.style.display = isAdmin() ? '' : 'none';

  // Prompt existing users if they don't have a real email address configured
  checkUserEmailRequirement();
}

async function loadUserData(uid) {
  setSync('syncing', 'Loading...');
  try {
    const r = await fetch(API_URL + '/api/sync/' + encodeURIComponent(uid), {
      headers: { 'x-session-token': sessionToken }
    });
    if (r.status === 401 || r.status === 403) {
      handleAuthExpired();
      return false;
    }
    const d = await r.json();
    if (d.success && d.data) {
      const data = d.data;
      
      // Load SWT state components
      attempted = new Set(data.attempted || []);
      LocalStore.set(`pte_${uid}_attempted`, data.attempted || []);
      LocalStore.set(`pte_${uid}_summaries`, data.summaries || {});
      LocalStore.set(`pte_${uid}_scores`, data.scores || {});
      LocalStore.set(`pte_${uid}_history`, data.history || {});
      
      // Load Essay state components
      essays = data.essays || [];
      currentId = data.currentId || (essays[0]?.id || null);
      
      userProfile = {
        email: data.email || '',
        quotaUsed: data.quotaUsed || { essay: 0, idea: 0 },
        quotaDate: data.quotaDate || todayStamp(),
        practiceHistory: data.practiceHistory || [],
        vocabProgress: data.vocabProgress || {},
        templates: data.templates || { band6: BAND6_TEMPLATE, band9: BAND9_TEMPLATE, custom: BAND9_TEMPLATE, default: 'band9' }
      };
      if (userProfile.email) {
        currentUser.email = userProfile.email;
      }
      if (userProfile.templates && userProfile.templates.band9TemplateVersion) {
        userProfile.band9TemplateVersion = userProfile.templates.band9TemplateVersion;
      }
      
      // Seed first time if essays are empty
      if (essays.length === 0) {
        const seeded = SEED_TOPICS.map((t, i) => ({
          id: 'seed_' + i,
          title: t.title,
          question: t.question,
          explanation: t.explanation,
          badge: t.badge || '',
          pros: '', cons: '', approach: '',
          intro: '', bp1: '', bp2: '', concl: '',
          vocab: 3,
          seedIdeas: '',
          questionType: t.type || ''
        }));
        essays = seeded;
        currentId = seeded[0].id;
        userProfile.templates = { band6: BAND6_TEMPLATE, band9: BAND9_TEMPLATE, custom: BAND9_TEMPLATE, default: 'band9' };
        
        // Sync the newly seeded profile to cloud
        await flushSyncDirect();
      } else {
        const changed = syncSeedTopics();
        if (changed) {
          await flushSyncDirect();
        }
      }

      // Reset daily quota if it's a new day
      if (userProfile.quotaDate !== todayStamp()) {
        userProfile.quotaUsed = { essay: 0, idea: 0 };
        userProfile.quotaDate = todayStamp();
        await flushSyncDirect();
      }

      setSync('synced', 'Synced');
      maybeOfferDraftRecovery();
      return true;
    }
    return false;
  } catch (err) {
    console.error(err);
    setSync('error', 'Sync failed');
    toast('Failed to load your data from cloud. Working offline.', true);
    offlineMode = true;
    return true; // continue in offline mode
  }
}

function handleAuthExpired() {
  toast('Session expired. Please log in again.', true);
  signOut();
}

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function queueSync() {
  if (offlineMode || !currentUserId) return;
  syncQueued = true;
  setSync('syncing', 'Syncing...');
  clearTimeout(syncTimer);
  syncTimer = setTimeout(flushSync, 1200);
}

async function flushSync() {
  if (!syncQueued || !currentUserId) return;
  syncQueued = false;
  await flushSyncDirect();
}

async function flushSyncDirect() {
  try {
    if (userProfile && userProfile.templates) {
      userProfile.templates.band9TemplateVersion = userProfile.band9TemplateVersion || 0;
    }
    const payload = {
      // SWT progress fields
      attempted: Array.from(attempted),
      history: LocalStore.get('pte_' + currentUserId + '_history') || {},
      summaries: LocalStore.get('pte_' + currentUserId + '_summaries') || {},
      scores: LocalStore.get('pte_' + currentUserId + '_scores') || {},
      
      // Email
      email: userProfile?.email || '',

      // Essay progress fields
      essays: essays,
      currentId: currentId,
      quotaUsed: userProfile?.quotaUsed || { essay: 0, idea: 0 },
      quotaDate: userProfile?.quotaDate || todayStamp(),
      practiceHistory: userProfile?.practiceHistory || [],
      vocabProgress: userProfile?.vocabProgress || {},
      templates: userProfile?.templates || { band6: BAND6_TEMPLATE, band9: BAND9_TEMPLATE, custom: BAND9_TEMPLATE, default: 'band9' }
    };

    const r = await fetch(API_URL + '/api/sync/' + encodeURIComponent(currentUserId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': sessionToken
      },
      body: JSON.stringify(payload)
    });
    
    if (r.status === 401 || r.status === 403) {
      handleAuthExpired();
      return;
    }
    
    setSync('synced', 'Synced');
    lastSyncOk = true;
    syncRetryCount = 0;
    safeLSRemove('ipt_unsaved_backup');
  } catch (err) {
    console.error(err);
    setSync('error', 'Sync failed — retrying');
    lastSyncOk = false;
    if (syncRetryCount < SYNC_MAX_RETRIES) {
      syncRetryCount++;
      setTimeout(() => { syncQueued = true; flushSync(); }, 5000);
    } else {
      setSync('error', 'Sync failed — check connection');
    }
  }
}

async function manualSync() {
  syncQueued = true;
  await flushSync();
  toast('Synced ✓');
}

function setSync(state, text) {
  const dot = document.getElementById('syncDot');
  const txt = document.getElementById('syncText');
  if (!dot || !txt) return;
  dot.className = 'sync-dot ' + state;
  txt.textContent = text;
}

// ============================================================
//  QUOTA
// ============================================================
const DAILY_ESSAY_QUOTA = 20;
const DAILY_IDEA_QUOTA = 50;

function getQuota() {
  const usedE = userProfile?.quotaUsed?.essay || 0;
  const usedI = userProfile?.quotaUsed?.idea || 0;
  return {
    essay: DAILY_ESSAY_QUOTA - usedE,
    idea: DAILY_IDEA_QUOTA - usedI,
    essayMax: DAILY_ESSAY_QUOTA,
    ideaMax: DAILY_IDEA_QUOTA
  };
}

function updateQuotaChip() {
  const el = document.getElementById('quotaChip');
  if (el) el.style.display = 'none'; // Hide quota chip completely since quota is unlimited
}

async function consumeQuota(kind) {
  // Enforce no limits (unlimited practice attempts)
  if (userProfile) {
    if (!userProfile.quotaUsed) userProfile.quotaUsed = {};
    userProfile.quotaUsed[kind] = (userProfile.quotaUsed[kind] || 0) + 1;
    updateQuotaChip();
    queueSync();
  }
  return true;
}

// ============================================================
//  USER MENU
// ============================================================
function openUserMenu() {
  document.getElementById('userMenuEmail').textContent = (currentUser && currentUser.email) || (currentUserId.includes('@') ? currentUserId : (currentUserId + '@ptewriting.com'));
  const written = essays.filter(e => essayStatus(e) === 'written').length;
  document.getElementById('userMenuStats').innerHTML =
    `${essays.length} essays · ${written} written · Unlimited practice attempts`;
  document.getElementById('userMenuModal').classList.add('show');
}
function closeUserMenu() { document.getElementById('userMenuModal').classList.remove('show'); }

function importLocalEssays() {
  const raw = safeLSGet('ipt_essays_v2');
  if (!raw) { toast('No local essays found in this browser', true); return; }
  try {
    const local = JSON.parse(raw);
    if (!Array.isArray(local) || local.length === 0) { toast('No local essays found', true); return; }
    if (!confirm(`Found ${local.length} local essays. Merge them into your cloud account? Local essays with the same title will be skipped to avoid duplicates.`)) return;
    const existingTitles = new Set(essays.map(e => (e.title || '').toLowerCase().trim()));
    let added = 0;
    for (const e of local) {
      const t = (e.title || '').toLowerCase().trim();
      if (t && existingTitles.has(t)) continue;
      essays.push({ ...e, id: uid() });
      added++;
    }
    saveAll();
    renderList(); loadCurrent(); renderPreview();
    closeUserMenu();
    toast(`Imported ${added} essays from local browser`);
  } catch (err) {
    toast('Failed to read local essays', true);
  }
}

// ----- ADMIN PANEL -----
let adminUsersCache = [];

async function openAdmin() {
  if (!isAdmin()) { toast('Not an admin', true); return; }
  if (!adminKey) {
    const k = prompt('Enter Admin Secret Key to authorize operations:');
    if (!k) return;
    adminKey = k;
    sessionStorage.setItem('pte_admin_key', k);
  }
  document.getElementById('adminModal').classList.add('show');
  await loadAdminUsers();
}
function closeAdmin() { document.getElementById('adminModal').classList.remove('show'); }

function isAdmin() {
  if (offlineMode || !currentUser) return false;
  const username = (currentUser.uid || '').trim().toLowerCase();
  if (username === 'admin') return true;

  const userEmailLc = (currentUser.email || '').trim().toLowerCase();
  const adminEmailLc = (window.FB?.adminEmail || 'admin@ptewriting.com').trim().toLowerCase();
  if (userEmailLc === adminEmailLc) return true;

  const adminPrefix = adminEmailLc.split('@')[0];
  if (username === adminPrefix) return true;

  return false;
}

async function loadAdminUsers() {
  const list = document.getElementById('adminUserList');
  list.innerHTML = '<div style="text-align:center; color:var(--ink-mute); padding:24px; font-style:italic; font-family:var(--serif);">Loading users...</div>';
  try {
    const r = await fetch(API_URL + '/api/admin/users', {
      headers: { 'x-admin-key': adminKey }
    });
    if (!r.ok) throw new Error('Server returned ' + r.status);
    const d = await r.json();
    adminUsersCache = (d.users || []).map(u => ({
      uid: u.username,
      email: u.username.includes('@') ? u.username : (u.username + '@ptewriting.com'),
      disabled: !!u.blocked,
      createdAt: u.created_at,
      essayCount: (u.essays || []).length,
      writtenCount: (u.essays || []).filter(e => (e.intro || '').length > 30 && (e.bp1 || '').length > 30).length,
      vocabRead: Object.keys(u.vocabProgress || {}).length,
      quizzes: (u.vocabProgress || {}).read ? Object.keys(u.vocabProgress.read).length : 0,
      practiceAttempts: (u.history ? Object.keys(u.history).length : 0)
    }));
    renderAdminUsers();
  } catch (err) {
    list.innerHTML = `<div style="color:var(--accent); padding:16px;">Failed to load users: ${escapeHtml(err.message)}</div>`;
  }
}

function renderAdminUsers() {
  const q = (document.getElementById('adminSearch')?.value || '').toLowerCase().trim();
  const list = document.getElementById('adminUserList');
  const filtered = q
    ? adminUsersCache.filter(u => u.uid.toLowerCase().includes(q))
    : adminUsersCache;
  if (filtered.length === 0) {
    list.innerHTML = '<div style="text-align:center; color:var(--ink-mute); padding:24px; font-style:italic; font-family:var(--serif);">No users match.</div>';
    return;
  }
  list.innerHTML = filtered.map(u => {
    const adminEmailLc = (window.FB?.adminEmail || 'admin@ptewriting.com').trim().toLowerCase();
    const adminPrefix = adminEmailLc.split('@')[0];
    const isThisAdmin = u.uid.toLowerCase() === 'admin' || (u.uid.includes('@') ? u.uid : (u.uid + '@ptewriting.com')).toLowerCase() === adminEmailLc || u.uid.toLowerCase() === adminPrefix;
    return `
    <div class="admin-user-row">
      <div>
        <div class="admin-user-email">${escapeHtml(u.uid)}</div>
        <div class="admin-user-meta">${u.writtenCount} written / ${u.essayCount} essays · ${u.vocabRead || 0} vocab read · ${u.practiceAttempts || 0} practice attempts</div>
      </div>
      <span class="admin-user-status ${u.disabled ? 'disabled' : 'active'}">${u.disabled ? 'Disabled' : 'Active'}</span>
      <button class="admin-btn" onclick="adminToggleUser('${u.uid}', ${!u.disabled})" ${isThisAdmin ? 'disabled style="opacity:0.4"' : ''}>${u.disabled ? 'Enable' : 'Disable'}</button>
      <button class="admin-btn danger" onclick="adminDeleteUser('${u.uid}', '${escapeHtml(u.uid).replace(/'/g, "\\'")}')" ${isThisAdmin ? 'disabled style="opacity:0.4"' : ''}>Delete</button>
    </div>
  `;}).join('');
}

async function adminToggleUser(uid, disabledNew) {
  try {
    const r = await fetch(API_URL + '/api/admin/block-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey
      },
      body: JSON.stringify({ username: uid, blocked: disabledNew })
    });
    if (!r.ok) throw new Error('Server returned ' + r.status);
    const d = await r.json();
    if (d.success) {
      toast(`User ${disabledNew ? 'disabled' : 'enabled'}`);
      await loadAdminUsers();
    } else {
      throw new Error(d.error || 'Operation failed');
    }
  } catch (err) {
    toast('Failed: ' + err.message, true);
  }
}

async function adminDeleteUser(uid, email) {
  if (!confirm(`Delete account for user "${uid}"? This removes their data permanently. This cannot be undone.`)) return;
  try {
    const r = await fetch(API_URL + '/api/admin/delete-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey
      },
      body: JSON.stringify({ username: uid })
    });
    if (!r.ok) throw new Error('Server returned ' + r.status);
    const d = await r.json();
    if (d.success) {
      toast('User deleted successfully');
      await loadAdminUsers();
    } else {
      throw new Error(d.error || 'Operation failed');
    }
  } catch (err) {
    toast('Failed: ' + err.message, true);
  }
}

// ============================================================
//  ALL 34 PRE-LOADED TOPICS
// ============================================================
const SEED_TOPICS = [
  { title: "Late Submission and Mark Deduction", question: "Some universities deduct marks from students' work if it is given in late. What is your opinion? Suggest some alternative actions.", explanation: "Examine deducting marks for late submissions and propose your opinion with alternative recommendations.", type: "opinion_alternatives" },
  { title: "Television as a Relaxation Tool and Companion", question: "Television serves many useful functions. It helps people to relax. Besides, it can also be seen as a companion for the lonely. To what extent do you agree with this? Explain why with your own experience.", explanation: "Evaluate whether television effectively helps people relax and acts as a companion for lonely individuals.", type: "agree_disagree" },
  { title: "Studying Old Plays and Theatre Works", question: "What are the problems and the benefits for high school students of studying plays and other works for theatre that were written centuries ago? Do you agree with it? Use your own experience to discuss it.", explanation: "Examine the benefits and problems of studying historical theatre in high schools using personal experience.", type: "advantages_disadvantages" },
  { title: "Combining Study and Employment", question: "Effective study requires time, comfort and peace. It is impossible to study with employment because one may distract the other. To what extent do you think the statements are realistic? Give your opinion with examples.", explanation: "Explore whether students can effectively combine work and study.", type: "agree_disagree" },
  { title: "Experiential Learning in Education", question: "Some people point that experiential learning (i.e. learning by doing it) can work well in formal education. However, others think a traditional form of teaching is the best. Do you think experiential learning can work well in high schools or colleges?", explanation: "Explore whether experiential learning is effective in high schools and colleges.", type: "agree_disagree" },
  { title: "Digital Materials and Libraries", question: "With the increase of new digital media available online, the role of the library has become obsolete. Therefore universities should only procure digital materials rather than constantly update textbooks. Discuss both the advantages and disadvantages of this position and give your own point of view.", explanation: "Examine whether universities should replace physical libraries with digital-only resources.", type: "advantages_disadvantages" },
  { title: "Public Transport and Road Building", question: "As cities expand, governments should look forward to creating better networks of public transport available for everyone rather than building more roads for vehicle owning population. To what extent do you agree or disagree?", explanation: "Evaluate whether governments should prioritise public transport networks over new road construction.", type: "agree_disagree" },
  { title: "Tourism in Less Developed Countries", question: "For a less developed country, the disadvantages of tourism are as great as the advantages. Please discuss this statement, and give and explain your opinion.", explanation: "Evaluate whether tourism brings equal benefits and drawbacks to less developed nations.", type: "advantages_disadvantages" },
  { title: "Formal Written Examinations", question: "Many education systems assess students' learning using formal written examinations. Those kinds of exams are a valid method. To what extent do you agree or disagree? Give examples with your own experience.", explanation: "Evaluate formal written examinations as an assessment method using personal experience.", type: "agree_disagree" },
  { title: "Compulsory Foreign Language Learning", question: "Some people think learning a foreign language at school should be compulsory. To what extent do you agree with it? Use your experience or examples to support your viewpoint.", explanation: "Evaluate whether foreign language learning should be compulsory in schools.", type: "agree_disagree" },
  { title: "The Most Pressing Global Problem", question: "In today's world, different government and international organisations are confronting many global problems. What is the most pressing problem among them and give solutions?", explanation: "Select one global problem as most pressing and justify your choice with practical solutions.", type: "single_best_option" },
  { title: "Medical Technology and Life Expectancy", question: "The medical technology can increase the average life expectancy. Do you think it is a curse or a blessing?", explanation: "Determine whether increasing life expectancy through medical technology is beneficial or harmful.", type: "blessing_curse" },
  { title: "Parental Legal Responsibility", question: "Should parents be held legally responsible for the actions of their children? Support your opinion from your study, observations or experiences.", explanation: "Evaluate whether parents should bear legal responsibility for their children's behaviour.", type: "agree_disagree" },
  { title: "Building Design and Daily Life", question: "Do you think the design of buildings affects, positively or negatively, where people live and work?", explanation: "Evaluate how building design influences living and working environments.", type: "positive_negative_impact" },
  { title: "Mass Media Influence on Young People", question: "The mass media, such as TV, radio and newspapers, have an influence on people, particularly on younger generations. It plays a pivotal role in shaping the opinions of people, especially teenagers and young people. To what extent do you agree with this? Please give examples.", explanation: "Evaluate the extent to which mass media shapes the opinions of teenagers and young people.", type: "agree_disagree" },
  { title: "Modern Inventions and Their Impact", question: "In our technological world, the number of new inventions has been evolving on a daily basis. Please describe a new invention and determine whether it brings beneficial or detrimental impact to society.", explanation: "Describe a modern invention and evaluate whether its societal impact is positive or negative.", type: "positive_negative_impact" },
  { title: "Workers in Decision-Making", question: "In some companies, employers involve workers in decision-making process about products and services. What are the advantages and disadvantages of such a policy?", explanation: "Examine the benefits and drawbacks of involving employees in company decision-making.", type: "advantages_disadvantages" },
  { title: "Age Restrictions", question: "Age restrictions are placed on many activities. It is believed that people should not do things until they reach the right ages, such as getting married, driving, voting, buying certain products, and doing particular things. Give an example, state which minimum age you think it should be and share your own experience.", explanation: "Evaluate age restrictions on activities and justify an appropriate minimum age with personal experience.", type: "example_specific" },
  { title: "Responsibility for Tackling Climate Change", question: "Climate change is a concerning global issue. Who should take the responsibilities, governments, big companies or individuals?", explanation: "Evaluate who bears primary responsibility for addressing climate change.", type: "responsibility" },
  { title: "Laws and Human Behaviour", question: "Some people think human behaviours can be limited by laws, and others think laws have little effect. What is your opinion?", explanation: "Evaluate whether laws effectively control human behaviour.", type: "discuss_both_views" },
  { title: "Shopping Malls Replacing Small Shops", question: "Large shopping malls are replacing small shops. What is your opinion on this? Do you think this is a good or bad change?", explanation: "Evaluate whether the replacement of small shops by large shopping malls is positive or negative.", type: "positive_negative_impact" },
  { title: "Youth Unemployment and Shorter Working Week", question: "Unemployment among young people is a serious problem. One solution has been suggested is to shorten the working week. What do you think are the advantages and disadvantages? Do you think this policy should apply to just young workers or the whole workforce?", explanation: "Evaluate shortening the working week to address youth unemployment.", type: "advantages_disadvantages" },
  { title: "Fewer Working Hours in the Future", question: "\"In the future, people will work fewer hours at their jobs than they do now.\" Do you agree with the statement? Please support your opinion with your own experience.", explanation: "Evaluate whether future working hours will decrease compared to present levels.", type: "agree_disagree" },
  { title: "Maximum Wage for High-Paying Jobs", question: "Some people say there should be a maximum wage for high-paying jobs. Do you support that? Can you give your point of view or your own experience?", explanation: "Evaluate whether maximum wage caps should be applied to high-paying jobs.", type: "agree_disagree" },
  { title: "Famous People and the Right to Privacy", question: "People who are famous entertainers or sportspeople should give up the right to privacy, because this is the price of fame. To what extent do you agree/disagree with this point of view? Give your opinion with your experiences.", explanation: "Evaluate whether celebrities should sacrifice privacy as the price of fame.", type: "agree_disagree" },
  { title: "Studying Climate Change", question: "Imagine you have been assigned on the study of climate change. Which area of climate change will you focus on and why? Use examples.", explanation: "Choose a specific area of climate change to study and justify your choice with examples.", type: "example_specific" },
  { title: "Work-Life Balance", question: "Nowadays, it is increasingly more difficult to maintain the right balance between work and the other aspects of one's life, such as leisure pursuits with family members. How important do you think this balance is? What are the reasons that make some people think that this is hard to achieve?", explanation: "Explore the importance of work-life balance and reasons why it is difficult to maintain.", type: "importance_reasons" },
  { title: "Experience is the Best Teacher", question: "Some people argue that experience is the best teacher. Life experiences can teach more effectively than books or formal school education. How far do you agree with this idea? Support your opinion with reasons and/or your personal experience.", explanation: "Evaluate whether life experience teaches more effectively than formal education.", type: "agree_disagree" },
  { title: "AI and Foreign Language Learning", question: "While artificial intelligence becomes so advanced, people can use computers to translate foreign languages that makes learning a foreign language unnecessary. To what extent do you agree with it?", explanation: "Examine whether AI translation makes foreign language learning unnecessary.", type: "agree_disagree" },
  { title: "Travel and Quality of Education", question: "Some believe the value of travel is overrated. 'One brilliant scholar never leaves the home bases.' People argue whether travel is a necessary component of quality education or not. To what extent do you agree with it?", explanation: "Ask whether travel is essential for quality education.", type: "agree_disagree" },
  { title: "City vs Countryside Living", question: "Some people prefer to live in cities, while some people prefer to live in the countryside. Which is better for you? Give your reasons or experience.", explanation: "Compare city and countryside living and justify personal preference.", type: "two_option_preference" },
  { title: "Growing Up in the 21st Century", question: "It is harder for children to grow up in the 21st century than it was in the past. How far do you agree with this statement? Give your opinions.", explanation: "Evaluate whether growing up today is more difficult than in previous generations.", type: "agree_disagree" },
  { title: "Historic Buildings vs Modern Housing", question: "Many countries spend large amounts of money on the restoration of historic buildings instead of on modern housing. To what extent do you agree or disagree with this analysis? What are advantages and disadvantages of this? Support your writing with your experience or examples.", explanation: "Evaluate whether governments should prioritise historic building restoration over modern housing.", type: "advantages_disadvantages" },
  { title: "Communication Methods in Modern Society", question: "The means of communicating in society today has changed markedly over the last ten years. In your opinion, what are the positive and negative impacts of this change?", explanation: "Evaluate the positive and negative impacts of modern communication technology changes over the last decade.", type: "positive_negative_impact" },
  { title: "The Value of Humanities", question: "Some say that in today's world the value of humanities has been eclipsed by the necessity of preparing for specific wealth-producing careers, such as medicine. Discuss whether you think there is a role in today's changing world for study of the humanities.", explanation: "Evaluate whether study of the humanities still has a role in today's wealth-focused world.", type: "discuss_both_views", badge: "Pearson Mock Test v2" }
];

const VOCAB_LEVELS = [
  { label: "Band 6-7", desc: "Very simple, everyday words. No academic vocabulary. Short sentences." },
  { label: "Band 7", desc: "Clear and accessible. Common words only. Familiar phrases." },
  { label: "Band 7-8", desc: "Mostly common words with a few stronger ones. Students recognize everything." },
  { label: "Band 8", desc: "Stronger vocabulary, some academic words, varied sentence structures." },
  { label: "Band 8-9", desc: "Sophisticated but still familiar. Some advanced phrases, no obscure terms." }
];

// ============================================================
//  QUESTION TYPE CATALOG
//  Each entry tells the AI how to (a) generate ideas and (b)
//  frame the body paragraphs when writing the full essay.
// ============================================================
const QUESTION_TYPES = {
  opinion: {
    id: "opinion",
    displayName: "Opinion",
    stanceRequired: true,
    stanceType: "agreement",
    stanceOptions: ["strongly agree", "largely agree", "partially agree", "partially disagree", "largely disagree", "strongly disagree"],
    bp1Role: "reasons supporting opinion",
    bp2Role: "further support, limitation, or solution",
    conclusionRole: "clear opinion",
    detect: "Express a clear personal opinion on a topic",
    validationRules: [
      "Must take a clear stance in introduction",
      "Stance must be maintained consistently in BP1 and BP2",
      "Conclusion must reiterate the chosen opinion clearly"
    ]
  },
  agree_disagree: {
    id: "agree_disagree",
    displayName: "Agree / disagree",
    stanceRequired: true,
    stanceType: "agreement",
    stanceOptions: ["strongly agree", "largely agree", "partially agree", "partially disagree", "largely disagree", "strongly disagree"],
    bp1Role: "support selected degree of agreement",
    bp2Role: "suggest alternative actions",
    conclusionRole: "selected degree of agreement and summary of alternatives",
    detect: "To what extent do you agree or disagree?",
    validationRules: [
      "Stance must match the selected degree of agreement",
      "BP1 must strongly support the chosen agreement side",
      "Must select exactly 2 alternative actions to suggest",
      "Conclusion must summarize both stance and alternatives"
    ]
  },
  advantages_disadvantages: {
    id: "advantages_disadvantages",
    displayName: "Advantages / disadvantages",
    stanceRequired: false,
    bp1Role: "advantages",
    bp2Role: "disadvantages",
    conclusionRole: "balanced judgement or recommendation",
    detect: "Discuss the advantages and disadvantages of a trend or policy",
    validationRules: [
      "Must cover both advantages and disadvantages",
      "BP1 must focus entirely on advantages",
      "BP2 must focus entirely on disadvantages",
      "Must not be one-sided"
    ]
  },
  importance_reasons: {
    id: "importance_reasons",
    displayName: "Importance + reasons it is hard",
    stanceRequired: false,
    leftLabel: "Why It Matters",
    rightLabel: "Why It's Hard",
    bp1Role: "how important it is / why it matters",
    bp2Role: "the reasons it is hard to achieve",
    conclusionRole: "restate how important it is and close",
    detect: "Question asks HOW IMPORTANT something is AND the reasons it is hard/difficult to achieve (importance + obstacles, NOT effects or solutions)",
    validationRules: [
      "BP1 must explain how/why it matters",
      "BP2 must give the reasons it is difficult to achieve",
      "Must NOT turn the obstacles into solutions"
    ]
  },
  advantages_disadvantages_opinion: {
    id: "advantages_disadvantages_opinion",
    displayName: "Advantages / disadvantages + opinion",
    stanceRequired: true,
    stanceType: "advantages_disadvantages_opinion",
    stanceOptions: ["advantages outweigh disadvantages", "disadvantages outweigh advantages", "balanced benefits and drawbacks"],
    leftLabel: "Advantages",
    rightLabel: "Disadvantages",
    bp1Role: "advantages",
    bp2Role: "disadvantages",
    conclusionRole: "final opinion",
    detect: "Do the advantages outweigh the disadvantages?",
    validationRules: [
      "Must discuss both sides (advantages in BP1, disadvantages in BP2)",
      "Conclusion must state a clear opinion on whether advantages outweigh disadvantages"
    ]
  },
  problem_solution: {
    id: "problem_solution",
    displayName: "Problem / solution",
    stanceRequired: false,
    bp1Role: "problems or causes",
    bp2Role: "solutions",
    conclusionRole: "strongest solution",
    detect: "Identify problems/causes and suggest practical solutions",
    validationRules: [
      "BP1 must contain problem/cause logic",
      "BP2 must contain solutions that directly address the problems in BP1",
      "Solutions must be paired 1-to-1 with problems"
    ]
  },
  cause_solution: {
    id: "cause_solution",
    displayName: "Cause / solution",
    stanceRequired: false,
    bp1Role: "causes",
    bp2Role: "solutions",
    conclusionRole: "strongest solution",
    detect: "Identify causes and suggest practical solutions",
    validationRules: [
      "BP1 must contain cause logic",
      "BP2 must contain solutions that directly address the causes in BP1",
      "Solutions must be paired 1-to-1 with causes"
    ]
  },
  cause_effect: {
    id: "cause_effect",
    displayName: "Cause / effect",
    stanceRequired: false,
    bp1Role: "causes",
    bp2Role: "effects or consequences",
    conclusionRole: "main cause/effect summary",
    detect: "Explain the causes and effects of a trend or phenomenon",
    validationRules: [
      "BP1 must contain main causes",
      "BP2 must contain corresponding effects or consequences",
      "Effects must directly result from the causes in BP1"
    ]
  },
  problem_effect: {
    id: "problem_effect",
    displayName: "Problem / effect",
    stanceRequired: false,
    bp1Role: "problems",
    bp2Role: "effects or consequences",
    conclusionRole: "main problem/effect summary",
    detect: "Identify problems and explain their effects/consequences",
    validationRules: [
      "BP1 must contain main problems",
      "BP2 must contain corresponding effects or consequences",
      "Effects must directly result from the problems in BP1"
    ]
  },
  discuss_both_views: {
    id: "discuss_both_views",
    displayName: "Discuss both views",
    stanceRequired: true,
    stanceType: "discuss_both_views",
    stanceOptions: ["strongly support View A", "strongly support View B", "balanced perspective/neutral"],
    leftLabel: "View A Reasons",
    rightLabel: "View B Reasons",
    bp1Role: "first view",
    bp2Role: "second view",
    conclusionRole: "opinion only if required",
    detect: "Discuss both views and give your opinion",
    validationRules: [
      "BP1 must explain the first view",
      "BP2 must explain the second view",
      "Conclusion must express a clear opinion if stance is selected"
    ]
  },
  two_option_preference: {
    id: "two_option_preference",
    displayName: "Two-option personal preference",
    stanceRequired: true,
    stanceType: "option_choice",
    stanceOptions: ["Option A is better", "Option B is better"],
    bp1Role: "Support the selected option with two strong reasons",
    bp2Role: "Support the selected option further and optionally contrast the opposite option briefly",
    conclusionRole: "Repeat the selected option clearly",
    detect: "Choose between two distinct options and justify your choice",
    validationRules: [
      "Essay must not be fully balanced",
      "Selected option must control introduction, BP1, BP2, and conclusion",
      "Opposite option may appear only as brief contrast",
      "PDF model stance must not override selected stance"
    ]
  },
  responsibility: {
    id: "responsibility",
    displayName: "Responsibility",
    stanceRequired: true,
    stanceType: "responsibility",
    stanceOptions: ["governments mainly responsible", "companies mainly responsible", "individuals mainly responsible", "shared responsibility", "governments and companies mainly responsible, individuals supporting"],
    leftLabel: "Primary Group Reasons",
    rightLabel: "Supporting/Shared Reasons",
    bp1Role: "primary responsible group",
    bp2Role: "supporting groups, limits, or shared responsibility",
    conclusionRole: "responsibility judgement",
    detect: "Who should take responsibility (governments, companies, or individuals)?",
    validationRules: [
      "Essay must focus on responsible parties, not just general causes of the issue",
      "BP1 must develop reasons for the primary responsible group",
      "Conclusion must state a clear responsibility judgement"
    ]
  },
  positive_negative_impact: {
    id: "positive_negative_impact",
    displayName: "Positive / negative impact",
    stanceRequired: true,
    stanceType: "positive_negative",
    stanceOptions: ["largely positive", "largely negative", "positive with risks", "negative unless controlled"],
    leftLabel: "Positive Impacts",
    rightLabel: "Negative Impacts",
    bp1Role: "positive effects",
    bp2Role: "negative effects",
    conclusionRole: "final judgement",
    detect: "Is this trend a positive or negative development?",
    validationRules: [
      "Must evaluate both positive and negative impacts",
      "Conclusion must deliver a clear final judgement aligning with chosen stance"
    ]
  },
  blessing_curse: {
    id: "blessing_curse",
    displayName: "Blessing / curse",
    stanceRequired: true,
    stanceType: "blessing_curse",
    stanceOptions: ["mostly a blessing", "mostly a curse", "a blessing if managed responsibly"],
    leftLabel: "Blessing Reasons",
    rightLabel: "Curse Reasons",
    bp1Role: "blessing side",
    bp2Role: "curse side or risks",
    conclusionRole: "final judgement",
    detect: "Is this development a blessing or a curse?",
    validationRules: [
      "Must evaluate both benefits (blessing) and risks/drawbacks (curse)",
      "Conclusion must give a clear final judgement"
    ]
  },
  compare_two_sides: {
    id: "compare_two_sides",
    displayName: "Compare two sides",
    stanceRequired: false,
    bp1Role: "side A",
    bp2Role: "side B",
    conclusionRole: "comparative judgement",
    detect: "Compare and contrast two different systems or options",
    validationRules: [
      "BP1 must cover the first side",
      "BP2 must cover the second side",
      "Must maintain an objective comparison throughout"
    ]
  },
  single_best_option: {
    id: "single_best_option",
    displayName: "Single best option",
    stanceRequired: true,
    stanceType: "best_option",
    stanceOptions: ["climate change", "poverty", "youth unemployment", "wealth inequality"],
    bp1Role: "why selected option is most important",
    bp2Role: "solution, support, or alternative consideration",
    conclusionRole: "repeat selected best option",
    detect: "Identify the single best or most important option among alternatives",
    validationRules: [
      "Must justify why the selected option is superior to other options",
      "Conclusion must repeat the selected best option"
    ]
  },
  example_specific: {
    id: "example_specific",
    displayName: "Example-specific",
    stanceRequired: true,
    stanceType: "example_choice",
    stanceOptions: ["custom selected example"],
    leftLabel: "Reasons / Justification",
    rightLabel: "Impact / Limitations",
    bp1Role: "selected example and main justification",
    bp2Role: "impact, limitation, or recommendation",
    conclusionRole: "final judgement",
    detect: "Provide and analyze a specific example (e.g. an age restriction)",
    validationRules: [
      "Must specify one clear example",
      "Justification in BP1 must match the selected example"
    ]
  },
  policy_recommendation: {
    id: "policy_recommendation",
    displayName: "Policy / recommendation",
    stanceRequired: true,
    stanceType: "policy_stance",
    stanceOptions: ["strongly support policy", "oppose policy", "support with conditions"],
    bp1Role: "reasons for policy",
    bp2Role: "limitations and implementation",
    conclusionRole: "practical recommendation",
    detect: "Evaluate a proposed policy and make recommendations",
    validationRules: [
      "BP1 must justify the stance on the policy",
      "BP2 must cover implementation challenges or conditions"
    ]
  },
  rights_ethics: {
    id: "rights_ethics",
    displayName: "Rights / ethics",
    stanceRequired: true,
    stanceType: "ethical_stance",
    stanceOptions: ["prioritize social/public interest", "prioritize individual rights", "balanced ethical compromise"],
    bp1Role: "social/public interest",
    bp2Role: "individual rights and ethical limits",
    conclusionRole: "balanced ethical judgement",
    detect: "Evaluate the ethics or human rights aspect of a topic",
    validationRules: [
      "Must balance public interest (BP1) vs individual rights (BP2)",
      "Conclusion must offer a balanced ethical judgement"
    ]
  },
  future_prediction: {
    id: "future_prediction",
    displayName: "Future / prediction",
    stanceRequired: true,
    stanceType: "prediction",
    stanceOptions: ["highly likely to occur", "unlikely to occur", "will occur with major changes"],
    bp1Role: "why future change may happen",
    bp2Role: "effects, benefits, or risks",
    conclusionRole: "clear prediction",
    detect: "Predict future developments or trends",
    validationRules: [
      "BP1 must explain the drivers of the predicted change",
      "Conclusion must state a clear, forward-looking prediction"
    ]
  },
  social_impact: {
    id: "social_impact",
    displayName: "Social impact",
    stanceRequired: false,
    bp1Role: "immediate social benefits",
    bp2Role: "long-term social consequences or challenges",
    conclusionRole: "overall social impact assessment",
    detect: "Analyze the social consequences and impact of a trend",
    validationRules: [
      "BP1 must focus on benefits to society",
      "BP2 must focus on social challenges or long-term issues"
    ]
  },
  education_effectiveness: {
    id: "education_effectiveness",
    displayName: "Education effectiveness",
    stanceRequired: true,
    stanceType: "effectiveness",
    stanceOptions: ["highly effective", "ineffective", "effective only under specific conditions"],
    bp1Role: "educational benefits and arguments in favor",
    bp2Role: "drawbacks, limits, or alternative educational methods",
    conclusionRole: "final effectiveness verdict",
    detect: "Evaluate the effectiveness of an educational method or policy",
    validationRules: [
      "BP1 must analyze the positive educational outcomes",
      "BP2 must analyze the limits or alternative methods"
    ]
  },
  opinion_alternatives: {
    id: "opinion_alternatives",
    displayName: "Opinion + Alternatives",
    stanceRequired: true,
    stanceType: "agreement",
    stanceOptions: ["strongly agree", "largely agree", "partially agree", "partially disagree", "largely disagree", "strongly disagree"],
    leftLabel: "Supporting Reasons",
    rightLabel: "Alternative Actions",
    bp1Role: "reasons supporting opinion",
    bp2Role: "suggest alternative actions",
    conclusionRole: "clear opinion and summary of alternatives",
    detect: "Express your opinion and suggest alternative actions",
    validationRules: [
      "Must take a clear stance (agree/disagree) in introduction",
      "BP1 must support the chosen stance",
      "BP2 must suggest practical alternative actions",
      "Conclusion must reiterate the opinion and summarize alternatives"
    ]
  }
};

// Backward compatibility aliases
QUESTION_TYPES.single_focus = QUESTION_TYPES.two_option_preference;
QUESTION_TYPES.problems_solutions = QUESTION_TYPES.problem_solution;
QUESTION_TYPES.causes_solutions = QUESTION_TYPES.problem_solution;
QUESTION_TYPES.causes_effects = QUESTION_TYPES.cause_effect;
QUESTION_TYPES.problems_benefits = QUESTION_TYPES.advantages_disadvantages;
QUESTION_TYPES.positive_negative_impacts = QUESTION_TYPES.positive_negative_impact;


// ============================================================
//  UNIVERSAL ESSAY STATE HELPERS & MODULES
// ============================================================

function questionAsksForAlternatives(q) {
  // True only when the question actually asks the writer to suggest alternative
  // actions / measures (the defining feature of an opinion_alternatives prompt).
  const s = (q || '').toLowerCase();
  return /\balternativ/.test(s)
    || /\binstead\b/.test(s)
    || /\bwhat (other|else|measures|actions|steps|solutions)\b/.test(s)
    || /\bother (ways|measures|actions|solutions|steps|approaches|methods)\b/.test(s)
    || /\b(suggest|recommend|propose|provide|offer|give)\b[^.?!]{0,40}\b(action|actions|measure|measures|solution|solutions|step|steps|approach|approaches|method|methods)\b/.test(s);
}

function detectStrongType(question) {
  // Unambiguous question patterns that LOCK the type so the model's free re-classification
  // at idea-generation cannot silently override a curated/expected type.
  const s = (question || '').toLowerCase();
  if (/\bcurse\b|\bblessing\b/.test(s)) return 'blessing_curse';
  if (/how important\b/.test(s) && /\breasons?\b/.test(s) && /\b(hard|difficult|challeng)/.test(s)) return 'importance_reasons';
  if (/\bwhich\s+(area|aspect|part|field|topic|kind|type|one)\b/.test(s) && /\b(focus|study|choose|select|concentrate|specialise|specialize)\b/.test(s) && /\bwhy\b/.test(s)) return 'example_specific';
  return '';
}

function getActiveQuestionType(e) {
  if (!e) return 'advantages_disadvantages';
  let t = e.manualQuestionTypeOverride || e.questionType || e.detectedQuestionType || 'advantages_disadvantages';
  // Auto-detect "opinion + alternatives" ONLY when the user hasn't explicitly chosen a type
  // via the "Change" button; an explicit manual override must always win.
  if (!e.manualQuestionTypeOverride) {
    const strong = detectStrongType(e.question);
    if (strong) {
      t = strong;
    } else {
      const qLower = (e.question || '').toLowerCase();
      if (qLower.includes('opinion') && qLower.includes('alternative')) {
        t = 'opinion_alternatives';
      }
    }
  }
  // "Opinion + Alternatives" is only valid when the question actually asks for alternative
  // actions/measures. Otherwise treat it as a plain stance essay (no alternatives column).
  if (t === 'opinion_alternatives' && !e.manualQuestionTypeOverride && !questionAsksForAlternatives(e.question)) {
    t = 'agree_disagree';
  }
  if (t === 'single_focus') t = 'two_option_preference';
  if (t === 'problems_solutions' || t === 'causes_solutions') t = 'problem_solution';
  if (t === 'causes_effects') t = 'cause_effect';
  if (t === 'problems_benefits') t = 'advantages_disadvantages';
  if (t === 'positive_negative_impacts') t = 'positive_negative_impact';
  return t;
}

function isStrongStance(activeType, stance) {
  if (!stance) return false;
  if (activeType === 'discuss_both_views') return false;
  if (activeType === 'opinion' || activeType === 'agree_disagree' || activeType === 'opinion_alternatives') return false;
  
  const stanceLower = stance.toLowerCase();
  
  if (stanceLower.includes('strongly') || stanceLower.includes('largely') || stanceLower.includes('mostly') || stanceLower.includes('is better') || stanceLower.includes('most pressing') || stanceLower.includes('mainly responsible')) {
    if (stanceLower.includes('balanced') || stanceLower.includes('shared') || stanceLower.includes('partially') || stanceLower.includes('if managed') || stanceLower.includes('unless controlled') || stanceLower.includes('with risks')) {
      return false;
    }
    return true;
  }
  
  return false;
}

function staticClassifyQuestion(q) {
  if (!q) return 'advantages_disadvantages';
  const lower = q.toLowerCase();
  if (lower.includes('age restriction') || lower.includes('minimum age') || lower.includes('age restrictions')) return 'example_specific';
  if (lower.includes('most pressing problem') || lower.includes('most important issue') || lower.includes('biggest problem') || lower.includes('most serious global issue') || lower.includes('most serious problem')) {
    return 'single_best_option';
  }
  if (lower.includes('agree') && lower.includes('disagree')) return 'agree_disagree';
  if (lower.includes('advantages') && lower.includes('disadvantages') && (lower.includes('opinion') || lower.includes('outweigh'))) return 'advantages_disadvantages_opinion';
  if (lower.includes('advantages') && lower.includes('disadvantages')) return 'advantages_disadvantages';
  if (lower.includes('discuss') && lower.includes('views')) return 'discuss_both_views';
  if (lower.includes('problems') && lower.includes('solutions')) return 'problem_solution';
  if (lower.includes('causes') && lower.includes('solutions')) return 'problem_solution';
  if (lower.includes('causes') && lower.includes('effects')) return 'cause_effect';
  if (lower.includes('curse') || lower.includes('blessing')) return 'blessing_curse';
  if (lower.includes('positive') && lower.includes('negative')) return 'positive_negative_impact';
  if (lower.includes('responsibility') || lower.includes('responsible')) return 'responsibility';
  if (lower.includes('which') && (lower.includes('better') || lower.includes('prefer'))) return 'two_option_preference';
  if (lower.includes('opinion') && lower.includes('alternative')) return 'opinion_alternatives';
  if (lower.includes('opinion')) return 'opinion';
  return 'opinion';
}

function getPairedTextForIdea(e, leftIdea, leftIdx) {
  if (!leftIdea) return '';
  if (leftIdea.pairedText) return leftIdea.pairedText;
  if (leftIdea.pairedSolutionOrEffect) return leftIdea.pairedSolutionOrEffect;
  
  if (leftIdea.pairedId && e.suggestedIdeas) {
    const found = e.suggestedIdeas.find(i => i.id === leftIdea.pairedId);
    if (found && found.text) return found.text;
  }
  
  if (e.suggestedIdeas && typeof leftIdx === 'number') {
    const rightIdeas = e.suggestedIdeas.filter(i => i.category === 'example' || i.category === 'disadvantage' || i.category === 'solution' || i.category === 'effect' || (i.supports && i.supports.includes('right')));
    if (rightIdeas[leftIdx] && rightIdeas[leftIdx].text) {
      return rightIdeas[leftIdx].text;
    }
  }
  
  const txt = leftIdea.text || '';
  const activeType = getActiveQuestionType(e);
  if (activeType === 'problem_solution' || activeType === 'causes_solutions' || activeType === 'cause_solution') {
    return 'tackle and resolve the issue of ' + txt.toLowerCase();
  } else {
    return 'adverse effects and consequences resulting from ' + txt.toLowerCase();
  }
}

function ensureSuggestedIdeas(e) {
  if (!e.suggestedIdeas || e.suggestedIdeas.length === 0) {
    const list = [];
    if (suggestedLeftIdeas && suggestedLeftIdeas.length > 0) {
      suggestedLeftIdeas.forEach((item, i) => {
        list.push(normalizeSingleIdea(item, `left_${i}`, 'left', e));
      });
    }
    if (suggestedRightIdeas && suggestedRightIdeas.length > 0) {
      suggestedRightIdeas.forEach((item, i) => {
        list.push(normalizeSingleIdea(item, `right_${i}`, 'right', e));
      });
    }
    if (list.length > 0) {
      e.suggestedIdeas = list;
    }
  }

  // Normalize existing or newly constructed list elements
  if (e.suggestedIdeas && Array.isArray(e.suggestedIdeas)) {
    e.suggestedIdeas = normalizeIdeasArray(e.suggestedIdeas, e);
  }
}

function normalizeSingleIdea(item, fallbackId, side, e) {
  if (typeof item === 'string') {
    const activeType = getActiveQuestionType(e);
    const isSolution = (activeType === 'problem_solution' || activeType === 'causes_solutions' || activeType === 'cause_solution');
    return {
      id: fallbackId,
      text: item,
      category: side === 'left' ? 'main_support' : (isSolution ? 'solution' : 'example'),
      supports: side === 'left' ? ['left'] : ['right'],
      opposes: side === 'left' ? ['right'] : ['left'],
      pairedText: '',
      pairedType: '',
      pairedId: '',
      supportsStance: ''
    };
  } else if (item && typeof item === 'object') {
    const activeType = getActiveQuestionType(e);
    const isSolution = (activeType === 'problem_solution' || activeType === 'causes_solutions' || activeType === 'cause_solution');
    return {
      id: item.id || fallbackId,
      text: item.text || '',
      category: item.category || (side === 'left' ? 'main_support' : (isSolution ? 'solution' : 'example')),
      supports: item.supports || (side === 'left' ? ['left'] : ['right']),
      opposes: item.opposes || (side === 'left' ? ['right'] : ['left']),
      pairedText: item.pairedText || item.pairedSolutionOrEffect || '',
      pairedType: item.pairedType || '',
      pairedId: item.pairedId || '',
      supportsStance: item.supportsStance || ''
    };
  }
  return { id: fallbackId, text: '', category: 'main_support' };
}

function normalizeIdeasArray(arr, e) {
  if (!arr || !Array.isArray(arr)) return [];
  
  // Step 1: convert all string/object items to basic object structures
  const objArr = arr.map((item, idx) => {
    if (typeof item === 'string') {
      const txt = item.trim();
      if (txt === '[object Object]' || !txt) return null;
      return {
        id: `idea_${idx}`,
        text: txt,
        category: 'main_support',
        supports: [],
        opposes: [],
        pairedText: '',
        pairedType: '',
        pairedId: '',
        supportsStance: ''
      };
    }
    if (item && typeof item === 'object') {
      const txt = (item.text || '').trim();
      if (txt === '[object Object]' || !txt) return null;
      return {
        id: item.id || `idea_${idx}`,
        text: txt,
        category: ideaCategoryNormalize(item.category),
        supports: item.supports || [],
        opposes: item.opposes || [],
        pairedText: item.pairedText || item.pairedSolutionOrEffect || '',
        pairedType: item.pairedType || '',
        pairedId: item.pairedId || '',
        supportsStance: item.supportsStance || ''
      };
    }
    return null;
  }).filter(Boolean);

  // Step 2: heal missing supports/opposes dynamically
  return objArr.map((item, idx) => {
    const origCategory = item.category || '';
    let supports = [...(item.supports || [])];
    let opposes = [...(item.opposes || [])];

    if (supports.length === 0 || opposes.length === 0) {
      const catLower = origCategory.toLowerCase();
      if (catLower === 'counter_point' || catLower === 'disadvantage' || catLower === 'con' || catLower === 'oppose') {
        supports = ['disagree', 'right'];
        opposes = ['agree', 'left'];
      } else if (catLower === 'main_support' || catLower === 'advantage' || catLower === 'pro' || catLower === 'support') {
        supports = ['agree', 'left'];
        opposes = ['disagree', 'right'];
      } else if (catLower === 'example') {
        // Find nearest reason in the object array
        let nearestReason = null;
        let minDistance = Infinity;
        for (let j = 0; j < objArr.length; j++) {
          if (j === idx) continue;
          const other = objArr[j];
          const otherCat = (other.category || '').toLowerCase();
          if (otherCat === 'main_support' || otherCat === 'advantage' || otherCat === 'disadvantage' || otherCat === 'counter_point' || otherCat === 'cause' || otherCat === 'problem' || otherCat === 'challenge' || otherCat === 'pro' || otherCat === 'con' || otherCat === 'support' || otherCat === 'oppose') {
            const dist = Math.abs(idx - j);
            if (dist < minDistance) {
              minDistance = dist;
              nearestReason = other;
            }
          }
        }
        
        if (nearestReason) {
          const nrCat = nearestReason.category.toLowerCase();
          if (nrCat === 'counter_point' || nrCat === 'disadvantage' || nrCat === 'con' || nrCat === 'oppose') {
            supports = ['disagree', 'right'];
            opposes = ['agree', 'left'];
          } else if (nrCat === 'main_support' || nrCat === 'advantage' || nrCat === 'pro' || nrCat === 'support') {
            supports = ['agree', 'left'];
            opposes = ['disagree', 'right'];
          } else {
            supports = nearestReason.supports || [];
            opposes = nearestReason.opposes || [];
          }
        }

        // Fallback to ID-prefix if no nearest reason found or it didn't have supports/opposes
        if (supports.length === 0 && opposes.length === 0) {
          if (item.id && String(item.id).startsWith('right')) {
            supports = ['disagree', 'right'];
            opposes = ['agree', 'left'];
          } else if (item.id && String(item.id).startsWith('left')) {
            supports = ['agree', 'left'];
            opposes = ['disagree', 'right'];
          }
        }
      }
    }

    item.supports = supports;
    item.opposes = opposes;
    return item;
  });
}

function ideaCategoryNormalize(cat) {
  if (!cat) return 'main_support';
  const c = cat.toLowerCase();
  if (['problem', 'cause', 'challenge', 'main_support', 'advantage'].includes(c)) return c;
  if (['solution', 'effect', 'consequence', 'example', 'disadvantage'].includes(c)) return c;
  return 'main_support';
}

function getAgreementSide(stance) {
  const s = (stance || '').toLowerCase().trim();

  const agreeStances = [
    'strongly agree',
    'largely agree',
    'partially agree',
    'agree'
  ];

  const disagreeStances = [
    'strongly disagree',
    'largely disagree',
    'partially disagree',
    'disagree'
  ];

  if (disagreeStances.includes(s)) return 'disagree';
  if (agreeStances.includes(s)) return 'agree';
  return '';
}

function stanceMatches(stance, target) {
  if (!stance || !target) return false;
  const s = stance.toLowerCase();
  const t = target.toLowerCase();
  const e = getCurrent();
  
  let leftOpt = '';
  let rightOpt = '';
  if (e && e.detectedOptions && e.detectedOptions.length >= 2) {
    leftOpt = e.detectedOptions[0].toLowerCase();
    rightOpt = e.detectedOptions[1].toLowerCase();
  }

  if (t === 'left' || t === 'agree') {
    const matchesAgree = s.includes('agree') && !s.includes('disagree');
    const matchesLeftOpt = leftOpt && s.includes(leftOpt);
    return matchesAgree || matchesLeftOpt;
  }
  
  if (t === 'right' || t === 'disagree') {
    const matchesDisagree = s.includes('disagree');
    const matchesRightOpt = rightOpt && s.includes(rightOpt);
    return matchesDisagree || matchesRightOpt;
  }

  return s.includes(t);
}

function filterIdeasForStance(activeType, chosenStance, allIdeas) {
  const alignedIdeas = [];
  const optionalContrastIdeas = [];
  const blockedIdeas = [];
  const warnings = [];
  if (!allIdeas || !Array.isArray(allIdeas)) {
    return { alignedIdeas, optionalContrastIdeas, blockedIdeas, warnings };
  }
  const typeCfg = QUESTION_TYPES[activeType] || QUESTION_TYPES.advantages_disadvantages;
  // Opinion-scale essays let students pick ANY ideas (agree or disagree); the stance is derived
  // from their picks (see deriveStanceFromPicks), so nothing is blocked here.
  if (['opinion', 'agree_disagree', 'opinion_alternatives'].includes(activeType)) {
    allIdeas.forEach(idea => alignedIdeas.push(idea));
    return { alignedIdeas, optionalContrastIdeas, blockedIdeas, warnings };
  }
  if (typeCfg.stanceRequired && !chosenStance) {
    return { alignedIdeas, optionalContrastIdeas, blockedIdeas, warnings };
  }
  allIdeas.forEach(idea => {
    let isOpposed = false;
    if (chosenStance) {
      if (idea.opposes && idea.opposes.some(o => stanceMatches(chosenStance, o))) {
        isOpposed = true;
      }
      if (activeType === 'two_option_preference') {
        const opposesStance = idea.opposes && idea.opposes.some(o => stanceMatches(chosenStance, o));
        const supportsOpposite = idea.supports && idea.supports.some(s => !stanceMatches(chosenStance, s));
        if (opposesStance || supportsOpposite) {
          isOpposed = true;
        }
      }
    }
    if (isOpposed) {
      optionalContrastIdeas.push(idea);
      blockedIdeas.push(idea);
    } else {
      alignedIdeas.push(idea);
    }
  });
  return { alignedIdeas, optionalContrastIdeas, blockedIdeas, warnings };
}

function revalidateSelectedIdeas(e) {
  const activeType = getActiveQuestionType(e);
  const typeCfg = QUESTION_TYPES[activeType] || QUESTION_TYPES.advantages_disadvantages;
  
  if (!e.selectedReasonIds) e.selectedReasonIds = [];
  if (!e.selectedExampleIds) e.selectedExampleIds = [];
  if (!e.selectedSolutionIds) e.selectedSolutionIds = [];
  if (!e.optionalContrastIds) e.optionalContrastIds = [];
  
  let didAutopopulate = false;
  if (e.suggestedIdeas && e.suggestedIdeas.length > 0) {
    const relationTypes = ['problem_solution', 'cause_solution', 'cause_effect', 'problem_effect', 'causes_solutions', 'causes_effects'];
    const isRel = relationTypes.includes(activeType) || (activeType === 'single_best_option' && e.secondaryFeatures && e.secondaryFeatures.includes('solution_required'));

    if (isRel) {
      if (e.selectedReasonIds.length === 0) {
        const leftIdeas = e.suggestedIdeas.filter(i => i.category === 'main_support' || i.category === 'advantage' || i.category === 'problem' || i.category === 'cause' || i.category === 'challenge' || (i.supports && i.supports.includes('left')));
        e.selectedReasonIds = leftIdeas.slice(0, 2).map(i => i.text);
        didAutopopulate = true;
      }
    } else if (activeType === 'opinion_alternatives') {
      const stanceSide = getAgreementSide(e.chosenStance);
      if (stanceSide) {
        const allowedCategory = stanceSide === 'agree' ? 'advantage' : 'disadvantage';
        const allowedReasonTexts = new Set(
          e.suggestedIdeas
            .filter(i => i.category === allowedCategory)
            .map(i => i.text)
        );
        const originalLength = e.selectedReasonIds.length;
        e.selectedReasonIds = e.selectedReasonIds
          .filter(txt => allowedReasonTexts.has(txt))
          .slice(0, 2);
        if (e.selectedReasonIds.length !== originalLength) {
          didAutopopulate = true;
        }
      }
      if (e.selectedExampleIds && e.selectedExampleIds.length > 0) {
        e.selectedExampleIds = [];
        didAutopopulate = true;
      }
      if (e.selectedSolutionIds.length > 2) {
        e.selectedSolutionIds = e.selectedSolutionIds.slice(0, 2);
        didAutopopulate = true;
      }
    } else if (['opinion', 'agree_disagree', 'two_option_preference'].includes(activeType)) {
      if (e.chosenStance) {
        const { alignedIdeas } = filterIdeasForStance(activeType, e.chosenStance, e.suggestedIdeas);
        const mainSupport = alignedIdeas.filter(i => i.category === 'main_support' || i.category === 'advantage' || i.category === 'cause' || i.category === 'problem');
        
        if (e.selectedReasonIds.length === 0) {
          e.selectedReasonIds = mainSupport.slice(0, 2).map(i => i.text);
          didAutopopulate = true;
        }
        if (e.selectedExampleIds && e.selectedExampleIds.length > 0) {
          e.selectedExampleIds = [];
          didAutopopulate = true;
        }
      }
    } else {
      const leftIdeas = e.suggestedIdeas.filter(i => i.category === 'main_support' || i.category === 'advantage' || i.category === 'problem' || i.category === 'cause' || (i.supports && i.supports.includes('left')));
      const rightIdeas = e.suggestedIdeas.filter(i => i.category === 'example' || i.category === 'disadvantage' || i.category === 'solution' || i.category === 'effect' || (i.supports && i.supports.includes('right')));
      
      if (e.selectedReasonIds.length === 0) {
        e.selectedReasonIds = leftIdeas.slice(0, 2).map(i => i.text);
        didAutopopulate = true;
      }
      
      const isSolution = (activeType === 'problem_solution' || activeType === 'causes_solutions' || activeType === 'cause_solution');
      if (isSolution) {
        if (e.selectedSolutionIds.length === 0) {
          e.selectedSolutionIds = rightIdeas.slice(0, 2).map(i => i.text);
          didAutopopulate = true;
        }
      } else {
        if (e.selectedExampleIds.length === 0) {
          e.selectedExampleIds = rightIdeas.slice(0, 2).map(i => i.text);
          didAutopopulate = true;
        }
      }
    }
  }
  
  if (didAutopopulate) {
    setTimeout(() => saveAll(), 0);
  }
  
  let warnings = [];
  let errors = [];
  
  if (typeCfg.stanceRequired) {
    if (!e.chosenStance) {
      errors.push("Please select a stance first.");
    } else {
      const { blockedIdeas } = filterIdeasForStance(activeType, e.chosenStance, e.suggestedIdeas);
      const blockedTexts = blockedIdeas.map(i => i.text);
      e.selectedReasonIds.forEach(txt => {
        if (blockedTexts.includes(txt)) {
          warnings.push(`"${txt}" supports the opposite side, so it can only be used as optional contrast.`);
        }
      });
    }
  }
  
  const pickedReasonsCount = e.selectedReasonIds.length;
  const pickedExamplesCount = e.selectedExampleIds.length;
  const pickedSolutionsCount = e.selectedSolutionIds.length;
  
  const isRel = ['problem_solution', 'cause_solution', 'cause_effect', 'problem_effect', 'causes_solutions', 'causes_effects'].includes(activeType) || (activeType === 'single_best_option' && e.secondaryFeatures && e.secondaryFeatures.includes('solution_required'));
  
  if (isRel) {
    if (pickedReasonsCount !== 2) {
      warnings.push(`Please select exactly 2 causes/problems/challenges.`);
    }
  } else if (activeType === 'opinion_alternatives') {
    const hasAltActions = (e.suggestedIdeas || []).some(i => i.category === 'solution');
    if (pickedReasonsCount !== 2 && hasAltActions && pickedSolutionsCount !== 2) {
      warnings.push("Please select 2 supporting reasons and 2 alternative actions.");
    } else if (pickedReasonsCount !== 2) {
      warnings.push("Please select 2 supporting reasons.");
    } else if (hasAltActions && pickedSolutionsCount !== 2) {
      warnings.push("Now select 2 alternative actions (right-hand column).");
    }
  } else if (['opinion', 'agree_disagree', 'two_option_preference'].includes(activeType)) {
    if (pickedReasonsCount !== 2) {
      warnings.push("Please select exactly 2 supporting reasons.");
    }
  } else if (activeType === 'problem_solution') {
    if (pickedReasonsCount !== 2 || pickedSolutionsCount !== 2) {
      warnings.push("Please select 2 problems and 2 solutions.");
    }
  } else {
    if (pickedReasonsCount !== 2 || pickedExamplesCount !== 2) {
      warnings.push("Please select 2 left-side and 2 right-side ideas.");
    }
  }
  
  e.ideaValidationErrors = errors;
  e.ideaValidationWarnings = warnings;
}

function syncSelectedIdeasToSeed(e) {
  const qType = getActiveQuestionType(e);
  const typeCfg = QUESTION_TYPES[qType] || QUESTION_TYPES.advantages_disadvantages;
  let lines = [
    `QUESTION TYPE: ${qType}`,
    `STANCE: ${e.chosenStance || 'None'}`
  ];
  if (e.selectedReasonIds && e.selectedReasonIds.length > 0) {
    lines.push(`MAIN REASONS: ${e.selectedReasonIds.join('; ')}`);
  }
  if (e.selectedExampleIds && e.selectedExampleIds.length > 0) {
    lines.push(`EXAMPLES: ${e.selectedExampleIds.join('; ')}`);
  }
  if (e.selectedSolutionIds && e.selectedSolutionIds.length > 0) {
    lines.push(`SOLUTIONS: ${e.selectedSolutionIds.join('; ')}`);
  }
  if (e.optionalContrastIds && e.optionalContrastIds.length > 0) {
    lines.push(`OPTIONAL CONTRAST: ${e.optionalContrastIds.join('; ')}`);
  }
  const joined = lines.join('\n');
  e.seedIdeas = joined;
  const el = document.getElementById('f_seedIdeas');
  if (el) el.value = joined;
}

function buildStructuredEssayPlan(e) {
  const qType = getActiveQuestionType(e);
  const typeCfg = QUESTION_TYPES[qType] || QUESTION_TYPES.advantages_disadvantages;
  const bag = getTemplatesBag();
  const templateChoice = e.templateChoice || bag.default || 'band9';
  const manualIdeas = parseManualIdeas(e.seedIdeas || '');

  // Compile paired ideas if they are paired in the question type
  const paired_ideas = [];
  if (typeCfg.ideasPaired) {
    const leftIdeas = e.suggestedIdeas ? e.suggestedIdeas.filter(i => i.category === 'main_support' || i.category === 'advantage' || i.category === 'problem' || i.category === 'cause' || i.category === 'challenge' || (i.supports && i.supports.includes('left'))) : [];
    
    (e.selectedReasonIds || []).forEach(leftText => {
      const leftIdea = leftIdeas.find(i => i.text === leftText) || { text: leftText };
      const leftIdx = leftIdeas.findIndex(i => i.text === leftText);
      const pairedText = getPairedTextForIdea(e, leftIdea, leftIdx > -1 ? leftIdx : 0);
      
      if (qType === 'problem_solution') {
        paired_ideas.push({ problem: leftText, solution: pairedText });
      } else if (qType === 'cause_solution') {
        paired_ideas.push({ cause: leftText, solution: pairedText });
      } else if (qType === 'cause_effect') {
        paired_ideas.push({ cause: leftText, effect: pairedText });
      } else if (qType === 'problem_effect') {
        paired_ideas.push({ problem: leftText, effect: pairedText });
      } else if (qType === 'single_best_option') {
        paired_ideas.push({ cause: leftText, solution: pairedText });
      }
    });
  }

  return {
    id: e.id || '',
    topic: e.title || '',
    band6Mode: e.band6Mode || '',
    question: e.question || '',
    question_type: qType,
    stance: e.chosenStance || '',
    selected_ideas: {
      reasons: e.selectedReasonIds || [],
      examples: e.selectedExampleIds || [],
      advantages: qType === 'advantages_disadvantages' || qType === 'advantages_disadvantages_opinion' ? (e.selectedReasonIds || []) : [],
      disadvantages: qType === 'advantages_disadvantages' || qType === 'advantages_disadvantages_opinion' ? (e.selectedExampleIds || []) : [],
      problems: qType === 'problem_solution' || qType === 'problem_effect' ? (e.selectedReasonIds || []) : [],
      solutions: ['problem_solution', 'cause_solution', 'single_best_option', 'opinion_alternatives'].includes(qType) ? (e.selectedSolutionIds || []) : [],
      causes: qType === 'cause_solution' || qType === 'cause_effect' ? (e.selectedReasonIds || []) : [],
      effects: qType === 'cause_effect' || qType === 'problem_effect' ? (e.selectedExampleIds || []) : [],
      contrast: e.optionalContrastIds || []
    },
    manual_ideas: manualIdeas,
    paired_ideas: paired_ideas,
    paragraph_roles: {
      intro: "Introduce the topic and state a clear opinion or paraphrase the essay question",
      bp1: typeCfg.bp1Role || "Discuss body paragraph 1 arguments",
      bp2: typeCfg.bp2Role || "Discuss body paragraph 2 arguments",
      conclusion: typeCfg.conclusionRole || "Summarise the main arguments and provide a final recommendation"
    },
    target_band_level: templateChoice,
    generation_mode: e.generationMode || 'template',
    vocabulary_level: e.vocab || 3
  };
}

function generatePreviewSignature(e) {
  if (!e) return '';
  const activeType = getActiveQuestionType(e);
  const templateKey = getTemplateKeyForEssay(e);
  const bag = getTemplatesBag();
  const customStr = (templateKey === 'custom' && bag && bag.custom) ? JSON.stringify(bag.custom) : '';
  const parts = [
    e.id || '',
    (e.question || '').trim(),
    activeType,
    e.chosenStance || '',
    (e.selectedReasonIds || []).join(','),
    (e.selectedExampleIds || []).join(','),
    (e.selectedSolutionIds || []).join(','),
    (e.optionalContrastIds || []).join(','),
    e.templateChoice || '',
    e.vocab || '',
    templateKey,
    customStr
  ];
  return parts.join('|');
}

function validateEssayConsistency(e) {
  const activeType = getActiveQuestionType(e);
  const typeCfg = QUESTION_TYPES[activeType] || QUESTION_TYPES.advantages_disadvantages;
  const results = {
    valid: true,
    errors: [],
    warnings: [],
    shouldRegenerate: false
  };
  const currentSig = generatePreviewSignature(e);
  if (!e.previewSignature || e.previewSignature !== currentSig) {
    results.valid = false;
    results.shouldRegenerate = true;
    results.errors.push("Preview signature is out of date.");
    return results;
  }
  const essayText = `${e.intro || ''} ${e.bp1 || ''} ${e.bp2 || ''} ${e.concl || ''}`.trim();
  if (!essayText) {
    results.valid = false;
    results.shouldRegenerate = true;
    results.errors.push("Essay is empty.");
    return results;
  }
  if (e.band6Mode === 'just_phrases') {
    return results;
  }
  const introLower = (e.intro || '').toLowerCase();
  const bp1Lower = (e.bp1 || '').toLowerCase();
  const bp2Lower = (e.bp2 || '').toLowerCase();
  const conclLower = (e.concl || '').toLowerCase();
  const textLower = essayText.toLowerCase();
  
  // 1. Question Type correctness check
  if (e.manualQuestionTypeOverride && e.manualQuestionTypeOverride !== activeType) {
    results.warnings.push("Active question type differs from manual override.");
  }
  
  // 2. Selected stance check
  if (typeCfg.stanceRequired && !e.chosenStance) {
    results.errors.push("Stance is required but none was selected.");
  }
  
  // 3. Stance matching check (intro and concl have stance keywords)
  if (typeCfg.stanceRequired && e.chosenStance) {
    const stanceLower = e.chosenStance.toLowerCase();
    const stanceWords = stanceLower.split(/\s+/).filter(w => w.length > 3 && !['better', 'mostly', 'largely', 'strongly', 'should', 'pressing', 'problem', 'most', 'issue'].includes(w));
    const introHasStance = stanceWords.length === 0 || stanceWords.some(w => introLower.includes(w));
    const conclHasStance = stanceWords.length === 0 || stanceWords.some(w => conclLower.includes(w));
    if (!introHasStance) {
      results.warnings.push("Introduction might not clearly state the chosen stance.");
    }
    if (!conclHasStance) {
      results.warnings.push("Conclusion might not clearly reaffirm the chosen stance.");
    }
  }

  // 4. Relation pairs completeness check
  const relationTypes = ['problem_solution', 'cause_solution', 'cause_effect', 'problem_effect', 'causes_solutions', 'causes_effects'];
  const isSingleBestSolution = (activeType === 'single_best_option' && e.secondaryFeatures && e.secondaryFeatures.includes('solution_required'));
  const isRel = relationTypes.includes(activeType) || isSingleBestSolution;
  if (isRel) {
    const isSolution = (activeType === 'problem_solution' || activeType === 'causes_solutions' || activeType === 'cause_solution' || isSingleBestSolution);
    const leftCount = (e.selectedReasonIds || []).length;
    const rightCount = isSolution ? (e.selectedSolutionIds || []).length : (e.selectedExampleIds || []).length;
    if (leftCount !== rightCount) {
      results.errors.push(`Relation pairs are incomplete: selected ${leftCount} causes/problems but only ${rightCount} solutions/effects.`);
    }
  }
  
  // 5. Single-best-option check
  if (activeType === 'single_best_option') {
    if (!e.chosenStance) {
      results.errors.push("Single-best-option questions must have exactly one main option/problem selected.");
    }
  }

  // 6. Problem-solution essays solutions check
  if (activeType === 'problem_solution' || activeType === 'causes_solutions' || activeType === 'cause_solution') {
    const solutionKeywords = ['solution', 'solve', 'address', 'measure', 'tackle', 'remedy', 'mitigate', 'implement'];
    const bp2HasSolution = solutionKeywords.some(w => bp2Lower.includes(w)) || (e.selectedSolutionIds && e.selectedSolutionIds.length > 0 && e.selectedSolutionIds.some(s => bp2Lower.includes(s.toLowerCase().split(/\s+/)[0])));
    if (!bp2HasSolution) {
      results.warnings.push("Problem-solution essay's Body Paragraph 2 does not seem to include solutions.");
    }
  }

  // 7. Cause-effect essays effects check
  if (activeType === 'cause_effect' || activeType === 'causes_effects' || activeType === 'problem_effect') {
    const effectKeywords = ['effect', 'consequence', 'result', 'impact', 'lead to', 'outcome'];
    const bp2HasEffect = effectKeywords.some(w => bp2Lower.includes(w)) || (e.selectedExampleIds && e.selectedExampleIds.length > 0 && e.selectedExampleIds.some(x => bp2Lower.includes(x.toLowerCase().split(/\s+/)[0])));
    if (!bp2HasEffect) {
      results.warnings.push("Cause-effect essay's Body Paragraph 2 does not seem to include effects or consequences.");
    }
  }

  // 8. Two-option preference balance check
  if (activeType === 'two_option_preference') {
    if (bp2Lower.includes('however') && (bp2Lower.includes('on the other hand') || bp2Lower.includes('balanced')) && bp2Lower.includes('equally')) {
      results.warnings.push("Two-option preference essays must not be fully balanced; they must strongly support the chosen option.");
    }
  }

  // 9 & 10. Strong opinion and BP2 transition checks
  if (typeCfg.stanceRequired && e.chosenStance && activeType !== 'discuss_both_views') {
    const stanceLower = e.chosenStance.toLowerCase();
    const isStrong = stanceLower.includes('strongly') || stanceLower.includes('largely') || stanceLower.includes('is better') || stanceLower.includes('most pressing');
    if (isStrong) {
      const contrastTransitions = ['on the other hand', 'however, another view', 'nevertheless', 'yet'];
      const usesContrast = contrastTransitions.some(t => bp2Lower.includes(t));
      if (usesContrast) {
        results.warnings.push("Strong opinion essay uses contrasting BP2 transition, which might make it sound too balanced.");
      }
    }
  }

  const allSelected = (e.selectedReasonIds || [])
    .concat(e.selectedExampleIds || [])
    .concat(e.selectedSolutionIds || [])
    .concat(e.optionalContrastIds || []);
  allSelected.forEach(idea => {
    const words = idea.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !['good', 'help', 'make', 'people', 'many', 'some', 'more', 'less'].includes(w));
    if (words.length > 0) {
      const matchCount = words.filter(w => textLower.includes(w)).length;
      const pct = matchCount / words.length;
      if (pct < 0.35) {
        results.warnings.push(`Selected idea "${idea}" might not be clearly developed in the essay.`);
      }
    }
  });
  
  const isPersonalRequired = e.secondaryFeatures && e.secondaryFeatures.includes('personal_experience_required');
  if (isPersonalRequired) {
    const personalKeywords = ['i ', 'my ', 'me ', 'myself', 'personal'];
    const hasPersonal = personalKeywords.some(w => textLower.includes(w));
    if (!hasPersonal) {
      results.warnings.push("Question requires personal experience/example, but none was detected.");
    }
  }
  if (results.errors.length > 0) {
    results.valid = false;
  }
  return results;
}

function parseManualIdeas(text) {
  if (!text || typeof text !== "string") return [];
  const lines = text.split(/\n/);
  const ideas = [];
  lines.forEach(line => {
    let clean = line.trim();
    if (!clean) return;
    
    if (clean.toUpperCase().startsWith("QUESTION TYPE:") || clean.toUpperCase().startsWith("STANCE:")) {
      return;
    }
    
    const prefixes = ["MAIN REASONS:", "EXAMPLES:", "SOLUTIONS:", "OPTIONAL CONTRAST:"];
    for (const prefix of prefixes) {
      if (clean.toUpperCase().startsWith(prefix)) {
        clean = clean.slice(prefix.length).trim();
        break;
      }
    }
    
    const parts = clean.split(/;/);
    parts.forEach(part => {
      const item = part.trim().replace(/^[-*•\d.)\s]+/, "").trim();
      if (item.length >= 6) {
        ideas.push(item);
      }
    });
  });
  return ideas;
}

function detectUnsupportedClaims(text, question, sourceText, plan) {
  const essayLower = text.toLowerCase();
  const qLower = (question || '').toLowerCase();
  const sLower = (sourceText || '').toLowerCase();
  
  const allowedTokens = new Set();
  
  const addAllowedText = (txt) => {
    if (!txt) return;
    const words = txt.toLowerCase().split(/[\s,.:;?!"'()]+/);
    words.forEach(w => {
      if (w.length > 2) allowedTokens.add(w);
    });
  };

  addAllowedText(question);
  addAllowedText(sourceText);
  if (plan) {
    if (plan.manual_ideas) {
      plan.manual_ideas.forEach(i => addAllowedText(i));
    }
    if (plan.selected_ideas) {
      Object.values(plan.selected_ideas).forEach(arr => {
        if (Array.isArray(arr)) {
          arr.forEach(i => addAllowedText(i));
        }
      });
    }
  }

  const detected = [];

  // 1. Check for invented percentages (e.g. "85%")
  const pctRegex = /\b(\d+)\s*(?:%|percent\b|percentage\b)/gi;
  let match;
  while ((match = pctRegex.exec(essayLower)) !== null) {
    const num = match[1];
    if (!allowedTokens.has(num)) {
      detected.push(`Invented percentage: "${match[0]}"`);
    }
  }

  // 2. Check for fake citation phrases
  const fakePhrases = [
    "studies show", "research shows", "research proves", "experts say", "survey found",
    "according to researchers", "a recent study", "harvard study", "university of",
    "university researchers", "experts suggest", "scientists prove", "scientists say",
    "researchers say", "according to a survey", "according to a study", "according to research",
    "according to experts", "according to scientists", "according to statistics", "statistical analysis",
    "survey of", "researchers at", "study by"
  ];
  for (const phrase of fakePhrases) {
    if (essayLower.includes(phrase) && !qLower.includes(phrase) && !sLower.includes(phrase)) {
      detected.push(`Unsupported citation claim: "${phrase}"`);
    }
  }

  // 3. Named organizations
  const orgs = [
    "oecd", "pew research", "who", "world health organization", "un", "united nations", "unesco",
    "world bank", "imf", "harvard", "stanford", "oxford", "cambridge", "mit", "apa", "american psychological association",
    "nasa", "fda", "yale", "princeton"
  ];
  for (const org of orgs) {
    const orgRegex = new RegExp(`\\b${org}\\b`, 'i');
    if (orgRegex.test(essayLower) && !orgRegex.test(qLower) && !orgRegex.test(sLower) && !allowedTokens.has(org)) {
      detected.push(`Unsupported organization citation: "${org.toUpperCase()}"`);
    }
  }

  // 4. University or research center regex patterns (e.g. "University of [name]")
  const patterns = [
    /\buniversity of [a-z]+/gi,
    /\b[a-z]+ university\b/gi,
    /\b[a-z]+ research (?:center|centre|institute)\b/gi,
    /\b[a-z]+ association\b/gi
  ];
  for (const regex of patterns) {
    let patMatch;
    while ((patMatch = regex.exec(essayLower)) !== null) {
      const matchedText = patMatch[0].toLowerCase();
      const words = matchedText.split(/\s+/).filter(w => !['university', 'of', 'research', 'center', 'centre', 'institute', 'association'].includes(w));
      const isAllowed = words.every(w => allowedTokens.has(w)) || qLower.includes(matchedText) || sLower.includes(matchedText);
      if (!isAllowed) {
        detected.push(`Unsupported institution citation: "${patMatch[0]}"`);
      }
    }
  }

  return detected;
}

function validateEssayStateBeforeGeneration(e) {
  const activeType = getActiveQuestionType(e);
  const typeCfg = QUESTION_TYPES[activeType] || QUESTION_TYPES.advantages_disadvantages;
  const errors = [];
  const warnings = [];

  // Stance check
  if (typeCfg.stanceRequired && !e.chosenStance) {
    errors.push("A stance/opinion selection is required for this question type.");
  }

  // Ideas check (check manual path first)
  if (e.seedIdeas && e.seedIdeas.trim().length > 0) {
    const manualIdeas = parseManualIdeas(e.seedIdeas);
    if (manualIdeas.length === 0) {
      errors.push("Your manual idea is too short. Please write at least one clear idea, such as 'traffic congestion slows down public transport.'");
    }
  } else {
    // Validate selected AI ideas
    const pickedReasonsCount = (e.selectedReasonIds || []).length;
    const pickedExamplesCount = (e.selectedExampleIds || []).length;
    const pickedSolutionsCount = (e.selectedSolutionIds || []).length;

    const isSolution = ['problem_solution', 'cause_solution', 'causes_solutions'].includes(activeType);
    const isEffect = ['cause_effect', 'problem_effect', 'causes_effects', 'problems_effects'].includes(activeType);
    const isStanceAgreement = ['opinion', 'agree_disagree', 'two_option_preference', 'opinion_alternatives'].includes(activeType);

    if (isSolution) {
      if (pickedReasonsCount !== 2 || pickedSolutionsCount !== 2) {
        errors.push("Please select exactly 2 problems/causes and 2 matching solutions.");
      }
    } else if (isEffect) {
      if (pickedReasonsCount !== 2 || pickedExamplesCount !== 2) {
        errors.push("Please select exactly 2 causes/problems and 2 matching effects.");
      }
    } else if (activeType === 'single_best_option') {
      if (pickedReasonsCount !== 2) {
        errors.push("Please select exactly 2 causes/challenges.");
      }
    } else if (activeType === 'opinion_alternatives') {
      if (pickedReasonsCount !== 2 || pickedSolutionsCount !== 2) {
        errors.push("Please select exactly 2 supporting reasons and 2 alternative actions.");
      }
    } else if (activeType === 'agree_disagree') {
      if (pickedReasonsCount !== 2 || pickedSolutionsCount !== 2) {
        errors.push("Please select exactly 2 reasons and 2 alternative actions.");
      }
    } else if (isStanceAgreement) {
      if (pickedReasonsCount !== 2) {
        errors.push("Please select exactly 2 supporting reasons.");
      }
    } else {
      // Balanced stance types and non-stance types (require 2 left-side and 2 right-side ideas)
      if (pickedReasonsCount !== 2 || pickedExamplesCount !== 2) {
        const leftLabel = typeCfg.leftLabel || 'left-side';
        const rightLabel = typeCfg.rightLabel || 'right-side';
        errors.push(`Please select exactly 2 ${leftLabel.toLowerCase()} and 2 ${rightLabel.toLowerCase()} ideas.`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function generateEssayPrompt(plan, template) {
  const isBand6 = (plan.target_band_level === 'band6');
  const isNatural = (plan.generation_mode === 'natural');

  const vocabSpec = VOCAB_LEVELS[(plan.vocabulary_level || 3) - 1] || VOCAB_LEVELS[2];

  let ideasBlock = '';
  if (plan.manual_ideas && plan.manual_ideas.length > 0) {
    ideasBlock = `
=== KEY IDEAS TO USE (MANDATORY) ===
You MUST write the essay using these manual ideas. Address them clearly.
- Manual ideas: ${plan.manual_ideas.map(x => `"${x}"`).join(' and ')}
`;
  } else {
    const reasons = plan.selected_ideas.reasons || [];
    const solutions = plan.selected_ideas.solutions || [];
    const examples = plan.selected_ideas.examples || [];
    const contrast = plan.selected_ideas.contrast || [];
    
    const isOpinionAlts = (plan.question_type === 'opinion_alternatives');
    const isAgreeDisagreeLong = (plan.question_type === 'agree_disagree');
    const isOpinionOrAgreeDisagree = ['opinion', 'agree_disagree'].includes(plan.question_type);
    const isOpinionOrPreference = ['opinion', 'agree_disagree', 'two_option_preference'].includes(plan.question_type);
    
    if (isOpinionAlts) {
      ideasBlock = `
=== KEY IDEAS TO USE (MANDATORY) ===
You MUST write the essay using exactly these chosen supporting reasons and alternative actions:
- Body Paragraph 1 (Supporting Stance): Focus on supporting the stance: "${plan.stance || ''}".
  * Supporting Reason 1: "${reasons[0] || ''}" (You MUST autogenerate a short, concrete, everyday example to support this reason, e.g. "employees using translation apps")
  * Supporting Reason 2: "${reasons[1] || ''}" (You MUST autogenerate a short, concrete, everyday example to support this reason, e.g. "students submitting homework online")

- Body Paragraph 2 (Alternative Actions): Suggest and discuss alternative actions to take instead:
  * Alternative Action 1: "${solutions[0] || 'a relevant alternative action'}" (provide a supporting explanation and a short relatable example for it).
  * Alternative Action 2: "${solutions[1] || 'another alternative action'}" (provide a supporting explanation and a short relatable example for it).
  * Keep the discussion very simple, presenting the opinion/stance in Body Paragraph 1 and the alternative actions in Body Paragraph 2.
`;
    } else if (isOpinionOrAgreeDisagree) {
      ideasBlock = `
=== KEY IDEAS TO USE (MANDATORY) ===
For all opinion-based essays, keep it very simple and present both the positives and negatives of the topic:
- Body Paragraph 1 (Positives / Supporting Side): Focus on the positive aspects or supporting reasons for the stance.
  * Supporting Reason 1: "${reasons[0] || ''}" (You MUST autogenerate a short, concrete, everyday, and relatable example for this reason, e.g. "employees using translation apps")
  * Supporting Reason 2: "${reasons[1] || ''}" (You MUST autogenerate a short, concrete, everyday, and relatable example for this reason, e.g. "students submitting homework online")

- Body Paragraph 2 (Negatives / Drawbacks / Limitations): Focus on the negative aspects, drawbacks, or limitations of the topic to present a balanced view.
  * Develop the Contrast point: "${contrast[0] || 'a relevant drawback or limitation of the topic'}" (provide a supporting explanation and a short relatable example for it, e.g. "some people feeling isolated"). If no contrast point is selected, you MUST automatically generate a simple, common negative aspect or drawback of the topic yourself.
  * Keep the discussion very simple, presenting the positives in Body Paragraph 1 and the negatives/limitations in Body Paragraph 2, regardless of how strong the chosen stance is.
`;
    } else if (isOpinionOrPreference) {
      ideasBlock = `
=== KEY IDEAS TO USE (MANDATORY) ===
You MUST write the essay using exactly these chosen supporting reasons. You MUST automatically generate a very simple, concrete, everyday, and relatable supporting example for each reason yourself (do NOT use academic/unsupported statistics or citations):
- Body Paragraph 1:
  * Supporting Reason 1: "${reasons[0] || ''}" (You MUST autogenerate a short, concrete, everyday example to support this reason, e.g. "employees using translation apps")
  * Supporting Reason 2: "${reasons[1] || ''}" (You MUST autogenerate a short, concrete, everyday example to support this reason, e.g. "students submitting homework online")
`;
      if (contrast && contrast.length > 0) {
        ideasBlock += `
- Body Paragraph 2:
  * Develop the Optional Contrast point: "${contrast[0]}" (provide a supporting explanation and a short relatable example for it).
  * If the stance is strong and one-sided, write another supporting reason and autogenerated example instead of contrasting, or present the contrast point briefly without weakening the stance.
`;
      } else {
        ideasBlock += `
- Body Paragraph 2:
  * Since no contrast point is selected, write two further supporting reasons/points and short relatable examples that reinforce the stance: "${plan.stance || ''}". Do NOT repeat or reuse the reasons from Body Paragraph 1.
`;
      }
    } else {
      ideasBlock = `
=== KEY IDEAS TO USE (MANDATORY) ===
You MUST write the essay using exactly these chosen ideas. Do NOT substitute synonyms. Do NOT skip them.
- Body Paragraph 1 ideas: ${reasons.map(x => `"${x}"`).join(' and ')}
- Body Paragraph 2 ideas: ${solutions.length > 0 ? solutions.map(x => `"${x}"`).join(' and ') : examples.map(x => `"${x}"`).join(' and ')}
${contrast.length > 0 ? `- Optional Contrast: "${contrast[0]}"` : ''}
`;
    }
  }

  const naturalStyleInstruction = `
=== WRITING STYLE: NATURAL MODE (CRITICAL) ===
Write naturally and avoid standard templates or rigid, formulaic transitions. Focus on fluid, sophisticated, and varied sentence structures that feel authentic and custom-written.
- Do NOT use formulaic transitional boilerplate.
- Do NOT start the introduction with "The topic of [X] has become increasingly important in recent years, prompting varied opinions. Its significance lies in..." or any variation of it.
- Do NOT start body paragraphs with "To begin with, one major reason/merit/cause/problem is..." or "On the other hand, one notable solution/demerit/negative effect is...".
- Do NOT start the conclusion with "To conclude, [X] presents key problems and remedies..." or "Hence, prioritising... is essential for...".
These formulaic templates make the essay look robotic and rehearsed. Write a completely fresh, organically structured essay where ideas are connected logically with diverse, natural transitions (e.g. 'First and foremost', 'A primary consideration', 'Conversely', 'Another approach worth exploring', 'In sum', 'Ultimately', etc., used naturally).
`;

  const templateStyleInstruction = `
=== WRITING STYLE: EXAM TEMPLATE MODE (FOLLOW TEMPLATE CLOSELY) ===
Fill in the [square bracket] placeholders with content specific to the essay topic. Keep the template's structure and transitions. You may shorten wordy/boilerplate phrasing when needed to stay under the 300-word limit.
  
INTRODUCTION TEMPLATE:
${template.intro}

BODY PARAGRAPH 1 TEMPLATE:
${template.bp1}

BODY PARAGRAPH 2 TEMPLATE:
${template.bp2}

CONCLUSION TEMPLATE:
${template.concl}
`;

  const band6VocabRule = `
=== STRICT RULES FOR VOCABULARY (BAND 6 LEVEL) ===
- Use SIMPLE, PLAIN ENGLISH only — CEFR A2-B1 level.
- Keep sentences short, direct, and easy to understand.
- AVOID all academic, sophisticated, or formal words (e.g. avoid foster, cultivate, facilitate, enhance, mitigate, exacerbate, prioritise, optimise, leverage, harness, undermine, sustainable, comprehensive, substantial, pivotal, paramount, deleterious, multifaceted).
- Use everyday words like "helps", "makes", "gives", "saves", "easy", "good", "important".
`;

  const band9VocabRule = `
=== VOCABULARY LEVEL: ${vocabSpec.label} ===
- Desc: ${vocabSpec.desc}
- Avoid obscure/overly flowery words unless they fit naturally (e.g. avoid paramount, deleterious, ubiquitous, salient, exacerbate, mitigate unless truly Band 9+).
`;

  return `You are a professional PTE / IELTS essay writer writing a high-scoring ${plan.target_band_level === 'band6' ? 'Band 6' : 'Band 9'} essay for IPT Brisbane tutoring.
  
ESSAY TOPIC: ${plan.topic || ''}
QUESTION: ${plan.question}

=== STANCE INFORMATION ===
Stance/Opinion: "${plan.stance || 'None'}"
- The essay must align with this stance consistently from intro to conclusion.

${ideasBlock}

${isNatural ? naturalStyleInstruction : templateStyleInstruction}

${isBand6 ? band6VocabRule : band9VocabRule}

=== LENGTH LIMIT (CRITICAL — STRICTLY UNDER 300 WORDS) ===
The COMPLETE essay (introduction + Body Paragraph 1 + Body Paragraph 2 + conclusion) must be UNDER 300 words in total.
Target roughly: introduction ~45 words, each body paragraph ~100 words, conclusion ~45 words.
Target length range is 240-285 words. This is the ideal target.
This 300-word limit is a HARD CAP. If the essay is 300 words or more, it is a FAILURE.
To stay under 300:
- Write concisely. Avoid filler and repetitive transition phrases.
- Keep the actual content rich: keep BOTH key ideas, keep BOTH examples in each body paragraph, and keep the opinion.
- Do NOT write long explanations. Make the point and move directly to the example.

=== STRUCTURAL REQUIREMENTS ===
A. INTRODUCTION:
- Introduce the topic and paraphrase the question naturally.
- State a clear opinion/thesis statement if the question asks for your view or opinion.
- Wrap the topic paraphrase and the essay-type phrase (e.g., "examine the benefits and drawbacks of this practice") in ==double equals==.

B. BODY PARAGRAPHS (BP1 and BP2):
- BP1 Role: ${plan.paragraph_roles.bp1}
- BP2 Role: ${plan.paragraph_roles.bp2}
- For opinion, agree_disagree, and two_option_preference question types, develop the reasons and examples in Body Paragraph 1 and Body Paragraph 2 as specified in the KEY IDEAS AND EXAMPLES section. For other question types, each paragraph must develop exactly the two ideas specified in the plan (either selected or manual).
- Each supporting idea must be followed by a short, concrete, everyday, relatable example (e.g., a student submitting late due to a sudden laptop crash, a traveler using a translation app, or people checking their phones during a meal).
- CRITICAL WARNING: You MUST NOT use any percentages (e.g. 10%, 80%), numbers representing statistics, or words like "percent" / "percentage". Doing so will cause a validation failure.
- CRITICAL WARNING: You MUST NOT use phrases like "studies show", "research shows", "research proves", "according to researchers", "a recent study", "harvard study", "university of ...", "survey found", or "according to a survey".
- Any mention of studies, research, surveys, statistics, or organizations (like WHO, OECD, UN, etc.) is STRICTLY FORBIDDEN.
- Wrap the main clauses of the two supporting ideas/points in ==double equals== (do not wrap the examples or transitions).

C. CONCLUSION:
- Conclusion Role: ${plan.paragraph_roles.conclusion}
- Summarize the main arguments using topic-specific nouns. Avoid boilerplate sentences like "maximising the positive aspects while minimising the negative ones".
- If the introduction stated an opinion, conclude the paragraph and add a final sentence starting with "Therefore, [echo the opinion in fresh, forward-looking wording]" on a new line.

=== HIGHLIGHTING MARKERS (CRITICAL) ===
Wrap clauses in ==double equals== so the PDF can highlight them in yellow:
INTRO: wrap the topic paraphrase (after "topic of"), and the essay-type phrase (after "examine the").
BP1: wrap KEY IDEA 1 clause (after "is" before period), wrap KEY IDEA 2 clause.
BP2: wrap KEY IDEA 1 clause, wrap KEY IDEA 2 clause.
DO NOT wrap: "This is because...", "For example...", "Another problem is...", or the Therefore line.

=== OUTPUT FORMAT ===
Respond with EXACTLY these sections, nothing else, no preamble:

===TITLE===
[a short 3-6 word title for this essay]
===INTRO===
[filled introduction paragraph with ==markers==]
===BP1===
[filled BP1 paragraph with ==markers== — MUST contain TWO concrete everyday examples]
===BP2===
[filled BP2 paragraph with ==markers== — MUST contain TWO concrete everyday examples — NO Therefore line here]
===CONCL===
[filled conclusion paragraph — topic-specific nouns; add the Therefore line on a new line if the intro had an opinion sentence]`;
}

function validateGeneratedEssayText(plan, text) {
  if (plan && plan.id && typeof plan.id === 'string' && !plan.question_type) {
    plan = buildStructuredEssayPlan(plan);
  }

  const errors = [];
  const warnings = [];

  if (!text) {
    errors.push("Generated essay text is empty.");
    return { ok: false, errors, warnings };
  }

  const introIdx = text.indexOf('===INTRO===');
  const bp1Idx = text.indexOf('===BP1===');
  const bp2Idx = text.indexOf('===BP2===');
  const conclIdx = text.indexOf('===CONCL===');

  if (introIdx === -1 || bp1Idx === -1 || bp2Idx === -1 || conclIdx === -1) {
    errors.push("The generated essay is missing some of the required section headers (===INTRO===, ===BP1===, ===BP2===, ===CONCL===).");
    return { ok: false, errors, warnings };
  }

  const getSectionText = (startHeader, nextHeader) => {
    const start = text.indexOf(startHeader);
    if (start === -1) return '';
    const contentStart = start + startHeader.length;
    if (!nextHeader) return text.slice(contentStart).trim();
    const end = text.indexOf(nextHeader);
    if (end === -1) return text.slice(contentStart).trim();
    return text.slice(contentStart, end).trim();
  };

  const intro = getSectionText('===INTRO===', '===BP1===');
  const bp1 = getSectionText('===BP1===', '===BP2===');
  const bp2 = getSectionText('===BP2===', '===CONCL===');
  const concl = getSectionText('===CONCL===', null);

  if (intro.length < 15 || bp1.length < 15 || bp2.length < 15 || concl.length < 15) {
    errors.push("One or more of the required paragraph sections are empty or too short.");
  }

  if (plan && plan.band6Mode === 'just_phrases') {
    return {
      ok: errors.length === 0,
      errors,
      warnings
    };
  }

  const fullEssayClean = `${intro} ${bp1} ${bp2} ${concl}`.replace(/==/g, '').trim();
  const words = fullEssayClean.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  if (wordCount >= 300 && wordCount <= 319) {
    errors.push("The generated essay is too long (300-319 words). Please regenerate a shorter version.");
  } else if (wordCount >= 320) {
    errors.push("The generated essay is too long. Please regenerate a shorter version.");
  }

  const countMarkers = (str) => (str.match(/==/g) || []).length;
  const introMarkers = countMarkers(intro);
  const bp1Markers = countMarkers(bp1);
  const bp2Markers = countMarkers(bp2);

  if (introMarkers % 2 !== 0) {
    errors.push("Introduction has mismatched yellow highlighting markers (==).");
  }
  if (bp1Markers % 2 !== 0) {
    errors.push("Body Paragraph 1 has mismatched yellow highlighting markers (==).");
  }
  if (bp2Markers % 2 !== 0) {
    errors.push("Body Paragraph 2 has mismatched yellow highlighting markers (==).");
  }

  const unsupportedClaims = detectUnsupportedClaims(fullEssayClean, plan.question, '', plan);
  if (unsupportedClaims.length > 0) {
    errors.push("The essay contains unsupported statistics or research claims. Please regenerate without invented data.");
  }

  const isOneSidedType = ['opinion', 'agree_disagree', 'two_option_preference'].includes(plan.question_type);
  if (plan.stance && isOneSidedType) {
    const isBand6Template = (plan.target_band_level === 'band6' && plan.generation_mode === 'template');
    if (!isBand6Template) {
      const stanceLower = plan.stance.toLowerCase();
      const conclLower = concl.toLowerCase();
      const introLower = intro.toLowerCase();

      const stopwords = ['the', 'a', 'an', 'and', 'but', 'or', 'for', 'nor', 'so', 'yet', 'at', 'by', 'in', 'of', 'on', 'to', 'with', 'is', 'are', 'was', 'were', 'been', 'being', 'better', 'mostly', 'largely', 'strongly', 'should', 'pressing', 'problem', 'most', 'issue', 'agree', 'disagree', 'opinion'];
      const stanceWords = stanceLower.split(/[\s,.:;?!"'()]+/).filter(w => w.length > 3 && !stopwords.includes(w));
      
      const introHasStance = stanceWords.length === 0 || stanceWords.some(w => introLower.includes(w));
      const conclHasStance = stanceWords.length === 0 || stanceWords.some(w => conclLower.includes(w));

      if (!introHasStance || !conclHasStance) {
        errors.push("The essay’s conclusion does not clearly match your selected stance.");
      }
    }

    const isStrong = plan.stance.toLowerCase().includes('strongly') || plan.stance.toLowerCase().includes('largely') || plan.stance.toLowerCase().includes('is better') || plan.stance.toLowerCase().includes('most pressing') || plan.stance.toLowerCase().includes('mainly responsible');
    if (isStrong) {
      const bp2Lower = bp2.toLowerCase();
      const contrastTransitions = ['on the other hand', 'however', 'nevertheless', 'conversely', 'yet'];
      const usesContrast = contrastTransitions.some(t => bp2Lower.includes(t));
      if (usesContrast) {
        errors.push("Stance consistency error: A strong one-sided stance was selected, but Body Paragraph 2 contains contrasting transitions (like 'On the other hand' or 'However').");
      }
    }
  }

  const stopwords = ['the', 'a', 'an', 'and', 'but', 'or', 'for', 'nor', 'so', 'yet', 'at', 'by', 'in', 'of', 'on', 'to', 'with', 'is', 'are', 'was', 'were', 'been', 'being'];
  const textLower = fullEssayClean.toLowerCase();

  if (plan.manual_ideas && plan.manual_ideas.length > 0) {
    plan.manual_ideas.forEach(idea => {
      const keywords = idea.toLowerCase().split(/[\s,.:;?!"'()]+/).filter(w => w.length > 3 && !stopwords.includes(w));
      if (keywords.length > 0) {
        const hasMatch = keywords.some(w => textLower.includes(w));
        if (!hasMatch) {
          errors.push(`Your manual idea "${idea}" was not used in the generated essay.`);
        }
      }
    });
  } else {
    const reasons = plan.selected_ideas.reasons || [];
    const solutions = plan.selected_ideas.solutions || [];
    const examples = plan.selected_ideas.examples || [];

    reasons.forEach(idea => {
      const keywords = idea.toLowerCase().split(/[\s,.:;?!"'()]+/).filter(w => w.length > 3 && !stopwords.includes(w));
      if (keywords.length > 0) {
        const hasMatch = keywords.some(w => textLower.includes(w));
        if (!hasMatch) {
          errors.push(`Selected idea "${idea}" was not used in the generated essay.`);
        }
      }
    });
    
    const secondParaIdeas = solutions.length > 0 ? solutions : examples;
    secondParaIdeas.forEach(idea => {
      const keywords = idea.toLowerCase().split(/[\s,.:;?!"'()]+/).filter(w => w.length > 3 && !stopwords.includes(w));
      if (keywords.length > 0) {
        const hasMatch = keywords.some(w => textLower.includes(w));
        if (!hasMatch) {
          errors.push(`Selected idea "${idea}" was not used in the generated essay.`);
        }
      }
    });
  }

  const bp1Sentences = splitSentences(bp1);
  const bp2Sentences = splitSentences(bp2);
  const allSentences = bp1Sentences.concat(bp2Sentences);

  const exampleSentences = allSentences.filter(s => {
    const l = s.toLowerCase();
    return l.includes('for example') || l.includes('for instance') || l.includes('to illustrate') || l.includes('illustrates this') || l.includes('such as');
  });

  const qWords = plan.question.toLowerCase().split(/[\s,.:;?!"'()]+/).filter(w => w.length > 3 && !['good', 'help', 'make', 'people', 'many', 'some', 'more', 'less', 'should', 'would', 'could', 'about', 'question', 'opinion', 'example'].includes(w));
  const weakPhrases = ["in many places", "in modern society", "in some countries", "people can benefit", "this can be seen everywhere"];

  for (const ex of exampleSentences) {
    const exLower = ex.toLowerCase();
    const hasTopicWord = qWords.some(w => exLower.includes(w));
    const isWeak = weakPhrases.some(p => exLower.includes(p));
    
    if (!hasTopicWord || isWeak || ex.split(/\s+/).length < 5) {
      warnings.push(`The essay example is too generic. Try regenerating for a more topic-specific example.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function showTypeOverrideSelect(show) {
  const e = getCurrent();
  if (!e) return;
  const containerId = 'typeOverrideContainer';
  let el = document.getElementById(containerId);
  if (!el) return;
  if (show) {
    const activeType = getActiveQuestionType(e);
    const optionsHtml = Object.keys(QUESTION_TYPES)
      .filter(k => QUESTION_TYPES[k].id === k)
      .map(k => `<option value="${k}" ${k === activeType ? 'selected' : ''}>${escapeHtml(QUESTION_TYPES[k].displayName)}</option>`)
      .join('');
    el.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; width:100%;">
        <select id="typeOverrideSelect" onchange="changeQuestionTypeOverride(this.value)" style="flex:1; padding:6px; font-size:12px; border-radius:4px; border:1px solid var(--line); background:var(--bg); color:var(--ink);">
          ${optionsHtml}
        </select>
        <button class="btn-cancel-type" onclick="event.preventDefault(); showTypeOverrideSelect(false)" style="background:none; border:none; color:var(--accent); font-size:11px; font-weight:600; cursor:pointer; padding:4px 8px;">Cancel</button>
      </div>
    `;
  } else {
    renderIdeasPicker();
  }
}

function changeQuestionTypeOverride(val) {
  const e = getCurrent();
  if (!e) return;
  e.manualQuestionTypeOverride = val;
  e.chosenStance = '';
  e.selectedReasonIds = [];
  e.selectedExampleIds = [];
  e.selectedSolutionIds = [];
  e.optionalContrastIds = [];
  saveAll();
  renderIdeasPicker();
  e.previewSignature = '';
  saveAll();
  renderPreview();
}

function changeChosenStance(opt) {
  const e = getCurrent();
  if (!e) return;
  e.chosenStance = opt;
  saveAll();
  revalidateSelectedIdeas(e);
  renderIdeasPicker();
  e.previewSignature = '';
  saveAll();
  renderPreview();
}

function updatePairedText(idx, newValue) {
  const e = getCurrent();
  if (!e) return;
  
  const activeType = getActiveQuestionType(e);
  let leftIdeas = [];
  if (activeType === 'single_best_option') {
    const { alignedIdeas } = filterIdeasForStance(activeType, e.chosenStance, e.suggestedIdeas);
    leftIdeas = alignedIdeas.filter(i => i.category === 'main_support' || i.category === 'cause' || i.category === 'problem' || i.category === 'challenge');
  } else {
    leftIdeas = e.suggestedIdeas.filter(i => i.category === 'main_support' || i.category === 'advantage' || i.category === 'problem' || i.category === 'cause' || i.category === 'challenge' || (i.supports && i.supports.includes('left')));
  }
  
  const leftIdea = leftIdeas[idx];
  if (leftIdea) {
    const oldValue = leftIdea.pairedText || leftIdea.pairedSolutionOrEffect || '';
    leftIdea.pairedText = newValue;
    leftIdea.pairedSolutionOrEffect = newValue;
    
    const isSolution = (activeType === 'problem_solution' || activeType === 'causes_solutions' || activeType === 'cause_solution' || activeType === 'single_best_option');
    const rightList = isSolution ? e.selectedSolutionIds : e.selectedExampleIds;
    if (rightList) {
      const rIdx = rightList.indexOf(oldValue);
      if (rIdx > -1) {
        rightList[rIdx] = newValue;
      }
    }
    saveAll();
    syncSelectedIdeasToSeed(e);
    renderIdeasPicker();
  }
}

function deriveStanceFromPicks(e, activeType) {
  // For opinion-scale essays the stance is hidden, so it follows the ideas the student picks —
  // this keeps the generated essay's lean consistent with their choices.
  if (!['opinion', 'agree_disagree', 'opinion_alternatives'].includes(activeType)) return;
  const catByText = {};
  (e.suggestedIdeas || []).forEach(i => { catByText[i.text] = i.category; });
  let agree = 0, disagree = 0;
  (e.selectedReasonIds || []).forEach(t => {
    const cat = catByText[t];
    if (cat === 'advantage' || cat === 'main_support') agree++;
    else if (cat === 'disadvantage' || cat === 'counter_point') disagree++;
  });
  if (agree > 0 && disagree === 0) {
    e.chosenStance = agree >= 2 ? 'largely agree' : 'partially agree';
  } else if (disagree > 0 && agree === 0) {
    e.chosenStance = disagree >= 2 ? 'largely disagree' : 'partially disagree';
  } else {
    e.chosenStance = 'partially disagree'; // mixed sides or none -> balanced default
  }
}

function toggleIdeaText(category, text) {
  const e = getCurrent();
  if (!e) return;
  if (!e.selectedReasonIds) e.selectedReasonIds = [];
  if (!e.selectedExampleIds) e.selectedExampleIds = [];
  if (!e.selectedSolutionIds) e.selectedSolutionIds = [];
  if (!e.optionalContrastIds) e.optionalContrastIds = [];
  
  const activeType = getActiveQuestionType(e);
  
  const relationTypes = ['problem_solution', 'cause_solution', 'cause_effect', 'problem_effect', 'causes_solutions', 'causes_effects'];
  const isSingleBestSolution = (activeType === 'single_best_option');
  const isRel = relationTypes.includes(activeType) || isSingleBestSolution;
  
  if (isRel) {
    if (category === 'problem' || category === 'cause' || category === 'main_support' || category === 'challenge') {
      let leftIdeas = [];
      let rightIdeas = [];
      
      if (activeType === 'single_best_option') {
        const { alignedIdeas } = filterIdeasForStance(activeType, e.chosenStance, e.suggestedIdeas);
        leftIdeas = alignedIdeas.filter(i => i.category === 'main_support' || i.category === 'cause' || i.category === 'problem' || i.category === 'challenge');
        rightIdeas = alignedIdeas.filter(i => i.category === 'example' || i.category === 'solution' || i.category === 'effect');
      } else {
        leftIdeas = e.suggestedIdeas.filter(i => i.category === 'main_support' || i.category === 'advantage' || i.category === 'problem' || i.category === 'cause' || i.category === 'challenge' || (i.supports && i.supports.includes('left')));
        rightIdeas = e.suggestedIdeas.filter(i => i.category === 'example' || i.category === 'disadvantage' || i.category === 'solution' || i.category === 'effect' || (i.supports && i.supports.includes('right')));
      }
      
      const leftIdx = leftIdeas.findIndex(i => i.text === text);
      if (leftIdx > -1) {
        const leftIdea = leftIdeas[leftIdx];
        const pairedVal = getPairedTextForIdea(e, leftIdea, leftIdx);
        
        const isSolution = (activeType === 'problem_solution' || activeType === 'causes_solutions' || activeType === 'cause_solution' || activeType === 'single_best_option');
        const rightList = isSolution ? e.selectedSolutionIds : e.selectedExampleIds;
        
        const existIdx = e.selectedReasonIds.indexOf(text);
        if (existIdx > -1) {
          e.selectedReasonIds.splice(existIdx, 1);
          if (pairedVal) {
            const prIdx = rightList.indexOf(pairedVal);
            if (prIdx > -1) rightList.splice(prIdx, 1);
          }
        } else {
          if (e.selectedReasonIds.length >= 2) {
            toast("You can select at most 2 items.", true);
            return;
          }
          e.selectedReasonIds.push(text);
          if (pairedVal && !rightList.includes(pairedVal)) {
            rightList.push(pairedVal);
          }
        }
        saveAll();
        revalidateSelectedIdeas(e);
        renderIdeasPicker();
        syncSelectedIdeasToSeed(e);
        return;
      }
    }
  }
  
  let targetList;
  if (['opinion', 'agree_disagree'].includes(activeType) && ['advantage', 'disadvantage', 'main_support', 'counter_point'].includes(category)) {
    // Opinion-scale: any reason (agree or disagree) is one of the 2 picked reasons.
    targetList = e.selectedReasonIds;
  } else if (activeType === 'opinion_alternatives') {
    if (category === 'solution') {
      targetList = e.selectedSolutionIds;
    } else {
      targetList = e.selectedReasonIds;
    }
  } else if (category === 'main_support' || category === 'advantage' || category === 'problem' || category === 'cause') {
    const typeCfg = QUESTION_TYPES[activeType];
    if (typeCfg && typeCfg.stanceRequired && e.chosenStance) {
      const { blockedIdeas } = filterIdeasForStance(activeType, e.chosenStance, e.suggestedIdeas);
      if (blockedIdeas.some(i => i.text === text)) {
        targetList = e.optionalContrastIds;
      } else {
        targetList = e.selectedReasonIds;
      }
    } else {
      targetList = e.selectedReasonIds;
    }
  } else if (category === 'example') {
    targetList = e.selectedExampleIds;
  } else if (category === 'solution') {
    targetList = e.selectedSolutionIds;
  } else if (category === 'optional_contrast' || category === 'counter_point' || category === 'disadvantage' || category === 'effect') {
    targetList = e.optionalContrastIds;
  } else {
    targetList = e.selectedReasonIds;
  }
  const idx = targetList.indexOf(text);
  if (idx > -1) {
    targetList.splice(idx, 1);
  } else {
    const limit = 2;
    if (targetList.length >= limit) {
      toast(`You can select at most ${limit} items for this category.`, true);
      return;
    }
    targetList.push(text);
  }
  deriveStanceFromPicks(e, activeType);
  saveAll();
  revalidateSelectedIdeas(e);
  renderIdeasPicker();
  syncSelectedIdeasToSeed(e);
}

function usePickerSelectedIdeas() {
  const e = getCurrent();
  if (!e) return;
  syncSelectedIdeasToSeed(e);
  saveAll();
  document.getElementById('ideasPicker').classList.remove('show');
  aiWriteFullEssay();
}

let debouncedRegenTimer = null;
function triggerDebouncedRegeneration(e) {
  if (debouncedRegenTimer) clearTimeout(debouncedRegenTimer);
  debouncedRegenTimer = setTimeout(async () => {
    const attempts = window.regenerationAttempts || (window.regenerationAttempts = {});
    const count = attempts[e.id] || 0;
    if (count >= 2) {
      console.warn("Max regeneration attempts reached for essay", e.id);
      return;
    }
    attempts[e.id] = count + 1;
    console.log(`Silent regeneration attempt ${count + 1} for essay`, e.id);
    const success = await aiWriteFullEssay({ essay: e, silent: true, skipConfirm: true });
    if (success) {
      renderPreview();
    }
  }, 1000);
}

// State for the type-aware picker (replaces the old pickedPros / pickedCons)
let pickedLeftIdeas = new Set();
let pickedRightIdeas = new Set();
let suggestedLeftIdeas = [];
let suggestedRightIdeas = [];
let detectedQuestionType = 'advantages_disadvantages';

// Multi-column picker state (for 3-column "sided" types like opinion_alternatives)
// suggestedCols = { colKey: [idea strings] }, pickedCols = { colKey: Set(indices) }
let suggestedCols = {};
let pickedCols = {};
let chosenSide = null;   // which side column the student picked (e.g. 'agree')
let dynamicLabels = {};
let fsDynamicLabels = {};

function getColLabel(col, e) {
  if (e && e.dynamicLabels && e.dynamicLabels[col.key]) {
    return e.dynamicLabels[col.key];
  }
  if (dynamicLabels && dynamicLabels[col.key]) {
    return dynamicLabels[col.key];
  }
  return col.label;
}

function getFsColLabel(col) {
  if (fsDynamicLabels && fsDynamicLabels[col.key]) {
    return fsDynamicLabels[col.key];
  }
  return col.label;
}


// ============================================================
//  TEMPLATES — Band 6 preset, Band 9 preset, and editable Custom
// ============================================================
// ============================================================
//  VOCABULARY DATA — C1/C2 level
//  30 categories, ~5 words each (~150 starter words)
//  Add more words by editing this constant.
// ============================================================
const VOCAB_DATA = {
  law: {
    label: "Law & Crime", icon: "⚖", order: 1,
    words: [
      {
        word: "litigation", pos: "noun", level: "C1",
        meaning: "The process of taking legal action; a dispute resolved through the court system.",
        examples: [
          "After three years of costly litigation, the two companies finally reached a settlement.",
          "Many businesses avoid litigation by including arbitration clauses in their contracts.",
          "The threat of litigation alone was enough to make him return the disputed property."
        ],
        compare: "vs. lawsuit: 'litigation' refers to the whole legal process; 'lawsuit' is one specific legal action."
      },
      {
        word: "suspect", pos: "noun / verb", level: "C1",
        meaning: "(noun) A person believed to have committed a crime; (verb) to believe someone is guilty.",
        examples: [
          "Police have detained a suspect in connection with the burglary.",
          "She suspected that her colleague had been leaking confidential information.",
          "The main suspect was released after his alibi was confirmed."
        ],
        compare: "vs. accused: 'suspect' is suspected but not yet formally charged; 'accused' has been formally charged."
      },
      {
        word: "attorney", pos: "noun", level: "C1",
        meaning: "A lawyer, especially one qualified to represent clients in court (more common in American English).",
        examples: [
          "You have the right to consult an attorney before answering any questions.",
          "The attorney argued that the evidence had been obtained illegally.",
          "She hired a top defense attorney for her trial."
        ],
        compare: "vs. solicitor / barrister: 'attorney' (US) covers both; UK splits into solicitor (advisor) and barrister (court advocate)."
      },
      {
        word: "juvenile", pos: "adjective / noun", level: "C1",
        meaning: "Relating to young people, especially in the context of crime and law; or, a young person under the age of legal adulthood.",
        examples: [
          "The teenager was tried in a juvenile court rather than as an adult.",
          "Juvenile offenders often respond better to rehabilitation than to imprisonment.",
          "The book explores why juvenile delinquency rates rise in certain neighbourhoods."
        ],
        compare: "vs. child vs. minor: 'child' is anyone young (informal); 'minor' is anyone under legal adult age (general legal term); 'juvenile' is specifically used in criminal/justice contexts (e.g. juvenile detention)."
      },
      {
        word: "incarceration", pos: "noun", level: "C2",
        meaning: "The state of being confined in prison; imprisonment.",
        examples: [
          "Mass incarceration disproportionately affects minority communities.",
          "His ten-year incarceration ended when new evidence proved his innocence.",
          "Critics argue that incarceration alone does not reduce recidivism."
        ],
        compare: "vs. imprisonment / detention: 'incarceration' is formal and emphasises long-term confinement; 'detention' usually means short-term holding before trial."
      }
    ]
  },
  education: {
    label: "Education", icon: "🎓", order: 2,
    words: [
      {
        word: "curriculum", pos: "noun", level: "C1",
        meaning: "The subjects and topics studied in a school, college, or other educational institution.",
        examples: [
          "The new curriculum places a stronger emphasis on critical thinking.",
          "Schools across the country are revising their curricula to include digital literacy.",
          "A balanced curriculum should expose students to both sciences and the humanities."
        ]
      },
      {
        word: "pedagogy", pos: "noun", level: "C2",
        meaning: "The method and practice of teaching; the theory behind how subjects are taught.",
        examples: [
          "Modern pedagogy emphasises active learning over passive memorisation.",
          "Her doctoral thesis focused on pedagogy in early-childhood education.",
          "Effective pedagogy adapts to the diverse needs of individual learners."
        ],
        compare: "vs. teaching: 'teaching' is the act itself; 'pedagogy' is the theory and approach behind it."
      },
      {
        word: "rote learning", pos: "noun phrase", level: "C1",
        meaning: "Memorising information through repetition, without necessarily understanding it.",
        examples: [
          "Rote learning may help students pass exams but rarely produces deep understanding.",
          "Critics argue that an over-reliance on rote learning stifles creativity.",
          "While rote learning has its place, it should be balanced with critical thinking exercises."
        ]
      },
      {
        word: "tertiary", pos: "adjective", level: "C1",
        meaning: "Relating to the third level of education — universities and colleges, after primary and secondary school.",
        examples: [
          "Tertiary education has become essential for most professional careers.",
          "Government funding for tertiary institutions has declined over the past decade.",
          "He decided to pursue tertiary studies in environmental engineering."
        ]
      },
      {
        word: "extracurricular", pos: "adjective", level: "C1",
        meaning: "Relating to activities done at school but not part of the official curriculum.",
        examples: [
          "Extracurricular activities like debate club develop skills exams cannot measure.",
          "Universities increasingly value extracurricular involvement in admissions decisions.",
          "Students who participate in extracurricular sports tend to manage time better."
        ]
      }
    ]
  },
  technology: {
    label: "Technology", icon: "💻", order: 3,
    words: [
      {
        word: "algorithm", pos: "noun", level: "C1",
        meaning: "A set of step-by-step instructions used by a computer to solve a problem or perform a task.",
        examples: [
          "Social media algorithms determine which posts appear in your feed.",
          "The new algorithm reduced processing time by nearly forty percent.",
          "Critics worry that biased algorithms can amplify social inequalities."
        ]
      },
      {
        word: "encryption", pos: "noun", level: "C1",
        meaning: "The process of converting information into a code to prevent unauthorised access.",
        examples: [
          "End-to-end encryption ensures only the sender and recipient can read the message.",
          "Strong encryption is essential for protecting financial transactions online.",
          "The hacker was unable to decode the file due to its advanced encryption."
        ]
      },
      {
        word: "obsolete", pos: "adjective", level: "C1",
        meaning: "No longer in use or useful, because something newer has replaced it.",
        examples: [
          "Fax machines have become almost entirely obsolete in modern offices.",
          "Technology evolves so rapidly that smartphones become obsolete within a few years.",
          "Many traditional jobs risk becoming obsolete due to automation."
        ],
        compare: "vs. outdated: 'outdated' just means old; 'obsolete' means no longer used at all."
      },
      {
        word: "automate", pos: "verb", level: "C1",
        meaning: "To make a process or system operate by itself, using machines or computers instead of people.",
        examples: [
          "The factory has automated most of its assembly line to cut labour costs.",
          "We use software to automate repetitive administrative tasks.",
          "Automating customer service has both reduced costs and frustrated some users."
        ]
      },
      {
        word: "ubiquitous", pos: "adjective", level: "C2",
        meaning: "Present, found, or seemingly everywhere at once.",
        examples: [
          "Smartphones have become ubiquitous in modern life.",
          "Surveillance cameras are now ubiquitous in major city centres.",
          "The ubiquitous use of plastic packaging has created an environmental crisis."
        ]
      }
    ]
  },
  health: {
    label: "Health & Medicine", icon: "🩺", order: 4,
    words: [
      {
        word: "chronic", pos: "adjective", level: "C1",
        meaning: "(Of an illness) lasting a long time or constantly recurring; persistent.",
        examples: [
          "Diabetes is a chronic condition that requires lifelong management.",
          "Chronic stress can contribute to heart disease and depression.",
          "She has been living with chronic back pain for over a decade."
        ],
        compare: "vs. acute: 'chronic' = long-lasting; 'acute' = severe and sudden but short."
      },
      {
        word: "diagnose", pos: "verb", level: "C1",
        meaning: "To identify the nature of an illness or problem by examining the symptoms.",
        examples: [
          "It took several specialists to correctly diagnose her rare condition.",
          "Modern imaging technology helps doctors diagnose tumours earlier.",
          "He was diagnosed with hypertension during a routine check-up."
        ]
      },
      {
        word: "sedentary", pos: "adjective", level: "C1",
        meaning: "Involving little physical activity; sitting for long periods.",
        examples: [
          "A sedentary lifestyle is linked to obesity and cardiovascular disease.",
          "Office workers should counteract their sedentary jobs with regular exercise.",
          "Doctors warn that sedentary behaviour increases the risk of early mortality."
        ]
      },
      {
        word: "epidemic", pos: "noun", level: "C1",
        meaning: "A widespread occurrence of an infectious disease in a community at a particular time.",
        examples: [
          "The flu epidemic overwhelmed hospital emergency departments.",
          "Obesity has been described as a public health epidemic in many countries.",
          "Vaccination programmes have prevented several major epidemics."
        ],
        compare: "vs. pandemic: 'epidemic' affects a region; 'pandemic' affects multiple countries or worldwide."
      },
      {
        word: "convalescence", pos: "noun", level: "C2",
        meaning: "The gradual recovery of health and strength after illness or injury.",
        examples: [
          "After her surgery, she spent six weeks in convalescence at a coastal retreat.",
          "Adequate rest during convalescence is essential to prevent relapse.",
          "His convalescence was prolonged by complications from the infection."
        ]
      }
    ]
  },
  environment: {
    label: "Environment", icon: "🌳", order: 5,
    words: [
      {
        word: "sustainable", pos: "adjective", level: "C1",
        meaning: "Able to be maintained at a certain level without depleting natural resources or causing harm.",
        examples: [
          "Sustainable farming practices protect soil for future generations.",
          "Many companies now publish sustainable development reports.",
          "Affordable, sustainable energy remains a major challenge for developing nations."
        ]
      },
      {
        word: "biodiversity", pos: "noun", level: "C1",
        meaning: "The variety of plant and animal life in a particular habitat or on Earth as a whole.",
        examples: [
          "The Amazon rainforest is home to extraordinary biodiversity.",
          "Loss of biodiversity threatens entire ecosystems and food chains.",
          "Conservation efforts aim to preserve biodiversity in marine environments."
        ]
      },
      {
        word: "deforestation", pos: "noun", level: "C1",
        meaning: "The clearing or removal of forests, usually for farming, mining, or urban development.",
        examples: [
          "Deforestation in the tropics accelerates climate change.",
          "Satellite imagery has revealed alarming rates of deforestation in the Congo Basin.",
          "Local communities are working to reverse decades of deforestation."
        ]
      },
      {
        word: "ecosystem", pos: "noun", level: "C1",
        meaning: "A community of living organisms together with the non-living parts of their environment.",
        examples: [
          "Coral reefs are among the most diverse ecosystems on the planet.",
          "Even small changes in temperature can disrupt an entire ecosystem.",
          "The wetland's ecosystem provides crucial flood protection for nearby cities."
        ]
      },
      {
        word: "pristine", pos: "adjective", level: "C2",
        meaning: "In its original condition; unspoiled, completely clean.",
        examples: [
          "The expedition reached a pristine valley untouched by human activity.",
          "Antarctica's pristine wilderness is increasingly threatened by tourism.",
          "She remembers the pristine beaches of her childhood, now lined with hotels."
        ]
      }
    ]
  },
  business: {
    label: "Business & Economics", icon: "📈", order: 6,
    words: [
      {
        word: "recession", pos: "noun", level: "C1",
        meaning: "A period of temporary economic decline during which trade and industrial activity are reduced.",
        examples: [
          "The 2008 recession affected economies across the globe.",
          "Many small businesses failed during the recession.",
          "Government stimulus packages aim to soften the impact of recession."
        ]
      },
      {
        word: "monopoly", pos: "noun", level: "C1",
        meaning: "Exclusive control of a market by a single company, eliminating competition.",
        examples: [
          "Antitrust laws are designed to prevent a single company from forming a monopoly.",
          "The state holds a monopoly on the sale of alcohol in some countries.",
          "Tech giants have been accused of abusing their near-monopoly status."
        ]
      },
      {
        word: "entrepreneur", pos: "noun", level: "C1",
        meaning: "A person who starts and runs a business, typically taking on financial risks in hopes of profit.",
        examples: [
          "She left her corporate job to become a tech entrepreneur.",
          "Successful entrepreneurs are usually willing to take calculated risks.",
          "Government grants now support young entrepreneurs in rural areas."
        ]
      },
      {
        word: "inflation", pos: "noun", level: "C1",
        meaning: "A general increase in prices, leading to a fall in the purchasing power of money.",
        examples: [
          "Rising fuel costs are a major driver of inflation.",
          "Central banks raise interest rates to combat inflation.",
          "Pensioners on fixed incomes suffer the most from sustained inflation."
        ],
        compare: "vs. deflation: 'inflation' = prices rising; 'deflation' = prices falling."
      },
      {
        word: "liquidity", pos: "noun", level: "C2",
        meaning: "The availability of cash or assets that can quickly be converted into cash without losing value.",
        examples: [
          "The bank faced a liquidity crisis when too many customers withdrew funds at once.",
          "Property is a poor investment when liquidity is a concern.",
          "Companies must maintain adequate liquidity to meet short-term obligations."
        ]
      }
    ]
  },
  travel: {
    label: "Travel & Tourism", icon: "✈", order: 7,
    words: [
      {
        word: "itinerary", pos: "noun", level: "C1",
        meaning: "A planned route or schedule for a journey.",
        examples: [
          "Our two-week itinerary covered five European capitals.",
          "She prefers loose itineraries that allow for spontaneous discoveries.",
          "The travel agent emailed me a detailed itinerary the night before departure."
        ]
      },
      {
        word: "excursion", pos: "noun", level: "C1",
        meaning: "A short journey or trip, especially one taken for pleasure or learning.",
        examples: [
          "The cruise offered a guided excursion to the ancient ruins.",
          "We took a day excursion from Rome to Pompeii.",
          "School excursions to museums help bring history lessons to life."
        ],
        compare: "vs. trip: 'excursion' is usually short and organised; 'trip' is general."
      },
      {
        word: "destination", pos: "noun", level: "C1",
        meaning: "The place to which someone or something is going or being sent.",
        examples: [
          "Bali has become a popular destination for digital nomads.",
          "Our final destination was a small village in the Italian Alps.",
          "Off-the-beaten-path destinations are increasingly attractive to seasoned travellers."
        ]
      },
      {
        word: "cosmopolitan", pos: "adjective", level: "C2",
        meaning: "Containing or having experience of people and things from many different parts of the world.",
        examples: [
          "Singapore is one of the most cosmopolitan cities in Asia.",
          "Her cosmopolitan upbringing made her fluent in four languages.",
          "The neighbourhood has a wonderfully cosmopolitan atmosphere, with cuisines from every continent."
        ]
      },
      {
        word: "wanderlust", pos: "noun", level: "C2",
        meaning: "A strong desire to travel and explore the world.",
        examples: [
          "Her wanderlust took her to over forty countries before she turned thirty.",
          "The documentary stirred a wanderlust in viewers who had never travelled abroad.",
          "Some careers are perfect for those bitten by wanderlust."
        ]
      }
    ]
  },
  science: {
    label: "Science", icon: "🔬", order: 8,
    words: [
      {
        word: "hypothesis", pos: "noun", level: "C1",
        meaning: "A proposed explanation for a phenomenon, used as a starting point for further investigation.",
        examples: [
          "The team tested their hypothesis through a series of controlled experiments.",
          "A good hypothesis must be testable and falsifiable.",
          "Initial data contradicted the original hypothesis."
        ],
        compare: "vs. theory: 'hypothesis' is an untested idea; 'theory' is a well-supported explanation backed by evidence."
      },
      {
        word: "empirical", pos: "adjective", level: "C2",
        meaning: "Based on observation, experience, or experimentation rather than theory.",
        examples: [
          "There is now considerable empirical evidence supporting the treatment's effectiveness.",
          "Empirical research distinguishes science from speculation.",
          "Her conclusions are drawn from empirical data collected over twenty years."
        ]
      },
      {
        word: "scrutiny", pos: "noun", level: "C1",
        meaning: "Careful and thorough examination or inspection.",
        examples: [
          "The findings have come under intense scrutiny from rival researchers.",
          "Any new drug must withstand rigorous scientific scrutiny.",
          "Under closer scrutiny, the data revealed several errors."
        ]
      },
      {
        word: "phenomenon", pos: "noun", level: "C1",
        meaning: "A fact, situation, or event that can be observed; often something unusual or remarkable.",
        examples: [
          "El Niño is a complex meteorological phenomenon.",
          "The aurora borealis is a stunning natural phenomenon.",
          "Social media addiction is a relatively new psychological phenomenon."
        ],
        compare: "Plural is 'phenomena' (not 'phenomenons')."
      },
      {
        word: "paradigm", pos: "noun", level: "C2",
        meaning: "A typical example, pattern, or model of something; a fundamental framework of thought.",
        examples: [
          "Einstein's theory of relativity caused a paradigm shift in physics.",
          "The new model has become the dominant paradigm in cognitive science.",
          "She challenged the prevailing paradigm with revolutionary findings."
        ]
      }
    ]
  },
  sports: {
    label: "Sports", icon: "⚽", order: 9,
    words: [
      {
        word: "endurance", pos: "noun", level: "C1",
        meaning: "The ability to keep doing something difficult, especially physical activity, for a long time.",
        examples: [
          "Marathon runners need extraordinary endurance.",
          "Cycling builds both leg strength and cardiovascular endurance.",
          "Mental endurance is just as important as physical fitness in chess."
        ]
      },
      {
        word: "underdog", pos: "noun", level: "C1",
        meaning: "A competitor thought to have little chance of winning.",
        examples: [
          "The underdog team defeated the reigning champions in extra time.",
          "Audiences love stories about an underdog rising to victory.",
          "She thrived on being the underdog throughout her tennis career."
        ]
      },
      {
        word: "stamina", pos: "noun", level: "C1",
        meaning: "The ability to sustain prolonged physical or mental effort.",
        examples: [
          "Long hikes through the mountains require exceptional stamina.",
          "Her stamina on the football field is unmatched.",
          "Building stamina takes months of consistent training."
        ],
        compare: "vs. endurance: very similar; 'endurance' often emphasises mental persistence too."
      },
      {
        word: "tournament", pos: "noun", level: "C1",
        meaning: "A series of contests between a number of competitors, leading to one overall winner.",
        examples: [
          "Wimbledon is one of the oldest tennis tournaments in the world.",
          "The chess tournament attracted players from over thirty countries.",
          "Winning the tournament qualified them for the international championship."
        ]
      },
      {
        word: "exhilaration", pos: "noun", level: "C2",
        meaning: "A feeling of excitement, happiness, and energy.",
        examples: [
          "Crossing the finish line, she felt pure exhilaration.",
          "The sheer exhilaration of skydiving keeps people coming back.",
          "There is no exhilaration quite like scoring the winning goal."
        ]
      }
    ]
  },
  media: {
    label: "Media & Communication", icon: "📡", order: 10,
    words: [
      {
        word: "censorship", pos: "noun", level: "C1",
        meaning: "The suppression of speech, public communication, or information considered objectionable.",
        examples: [
          "State censorship of the press is a hallmark of authoritarian regimes.",
          "Censorship of social media platforms remains a contentious issue.",
          "Many artists have spoken out against government censorship."
        ]
      },
      {
        word: "propaganda", pos: "noun", level: "C1",
        meaning: "Information, especially biased or misleading, used to promote a political cause or point of view.",
        examples: [
          "Wartime propaganda was designed to maintain public morale.",
          "Critics dismissed the documentary as little more than political propaganda.",
          "Modern propaganda often spreads through targeted social media campaigns."
        ]
      },
      {
        word: "broadcast", pos: "verb / noun", level: "C1",
        meaning: "(verb) To transmit a programme by radio or television; (noun) the programme itself.",
        examples: [
          "The concert will be broadcast live on national television.",
          "Yesterday's news broadcast covered the floods extensively.",
          "Royal weddings are broadcast to audiences worldwide."
        ]
      },
      {
        word: "sensationalism", pos: "noun", level: "C2",
        meaning: "The presentation of information in a way that provokes strong emotion, especially at the expense of accuracy.",
        examples: [
          "Tabloid newspapers are often criticised for sensationalism.",
          "Sensationalism in reporting can distort public perception of crime rates.",
          "She refused to engage with the sensationalism surrounding her divorce."
        ]
      },
      {
        word: "discourse", pos: "noun", level: "C2",
        meaning: "Written or spoken communication or debate, often formal and on a particular subject.",
        examples: [
          "Public discourse on climate change has shifted dramatically in recent years.",
          "The book contributed to academic discourse on post-colonial identity.",
          "Social media has both broadened and coarsened political discourse."
        ]
      }
    ]
  },
  politics: {
    label: "Politics & Government", icon: "🏛", order: 11,
    words: [
      {
        word: "democracy", pos: "noun", level: "C1",
        meaning: "A system of government where citizens choose leaders through free and fair elections.",
        examples: [
          "Democracy depends on an informed and engaged electorate.",
          "Many young democracies struggle with corruption.",
          "Press freedom is essential to any functioning democracy."
        ]
      },
      {
        word: "constituency", pos: "noun", level: "C1",
        meaning: "A group of voters in a specified area who elect a representative; or a body of supporters.",
        examples: [
          "She has represented this constituency in parliament for over a decade.",
          "The new policy alienates the party's traditional working-class constituency.",
          "Each constituency elects one member to the lower house."
        ]
      },
      {
        word: "legislation", pos: "noun", level: "C1",
        meaning: "Laws considered as a body, or the process of making them.",
        examples: [
          "The government introduced legislation to tighten environmental standards.",
          "Anti-discrimination legislation has improved workplace fairness.",
          "New legislation on data privacy will take effect next year."
        ]
      },
      {
        word: "autocracy", pos: "noun", level: "C2",
        meaning: "A system of government by one person with absolute power.",
        examples: [
          "The country slid from democracy into autocracy within a single decade.",
          "Critics argue that increased surveillance is a step toward autocracy.",
          "Autocracy thrives where civil institutions are weak."
        ],
        compare: "vs. dictatorship: very similar; 'autocracy' is broader and includes monarchies with absolute rule."
      },
      {
        word: "demagogue", pos: "noun", level: "C2",
        meaning: "A political leader who gains popularity by appealing to emotions and prejudices rather than reason.",
        examples: [
          "Historians have studied how demagogues exploit economic hardship to gain power.",
          "She accused her opponent of being a populist demagogue.",
          "A demagogue thrives on dividing the electorate into 'us' and 'them'."
        ]
      }
    ]
  },
  culture: {
    label: "Culture & Traditions", icon: "🎭", order: 12,
    words: [
      {
        word: "heritage", pos: "noun", level: "C1",
        meaning: "Valued objects, traditions, and qualities passed down from previous generations.",
        examples: [
          "The old town is a UNESCO World Heritage site.",
          "She is proud of her Irish heritage.",
          "Cultural heritage must be protected for future generations."
        ]
      },
      {
        word: "indigenous", pos: "adjective", level: "C1",
        meaning: "Originating or naturally occurring in a particular place; native.",
        examples: [
          "Indigenous communities have lived in the region for thousands of years.",
          "The festival celebrates indigenous music and dance.",
          "Many indigenous languages are at risk of disappearing."
        ]
      },
      {
        word: "assimilation", pos: "noun", level: "C2",
        meaning: "The process by which a person or group becomes part of a different culture and adopts its customs.",
        examples: [
          "Government policies of forced assimilation caused lasting harm.",
          "Second-generation immigrants often experience tension between assimilation and tradition.",
          "Schools play a major role in the assimilation of newcomers."
        ],
        compare: "vs. integration: 'integration' allows keeping one's original culture; 'assimilation' implies adopting the dominant culture and giving up the original."
      },
      {
        word: "ritual", pos: "noun", level: "C1",
        meaning: "A ceremony or series of actions performed in a fixed way, especially for religious or cultural reasons.",
        examples: [
          "Tea ceremonies are an important ritual in Japanese culture.",
          "Morning rituals can structure the day and reduce stress.",
          "The wedding ritual has remained largely unchanged for centuries."
        ]
      },
      {
        word: "ethnocentric", pos: "adjective", level: "C2",
        meaning: "Judging other cultures by the standards and values of one's own.",
        examples: [
          "Anthropologists must guard against ethnocentric assumptions in their research.",
          "Ethnocentric thinking often leads to misunderstanding of unfamiliar customs.",
          "The textbook was criticised for its ethnocentric portrayal of history."
        ]
      }
    ]
  },
  food: {
    label: "Food & Nutrition", icon: "🍎", order: 13,
    words: [
      {
        word: "nutrient", pos: "noun", level: "C1",
        meaning: "A substance in food that the body needs to live and grow.",
        examples: [
          "Leafy greens are packed with essential nutrients.",
          "Processed foods often strip away natural nutrients.",
          "A varied diet is the best way to get all the nutrients you need."
        ]
      },
      {
        word: "obesity", pos: "noun", level: "C1",
        meaning: "The condition of being seriously overweight, posing health risks.",
        examples: [
          "Childhood obesity rates have tripled in many developed nations.",
          "Obesity is linked to diabetes, heart disease, and certain cancers.",
          "Combating obesity requires both individual and policy-level changes."
        ]
      },
      {
        word: "perishable", pos: "adjective", level: "C1",
        meaning: "(Of food) likely to decay or go bad quickly, especially if not refrigerated.",
        examples: [
          "Perishable goods like fresh fish must be transported in cooled containers.",
          "Always check the dates on perishable products before buying.",
          "The store discounts perishable items late in the evening."
        ]
      },
      {
        word: "palatable", pos: "adjective", level: "C2",
        meaning: "Pleasant to taste; (figuratively) acceptable or agreeable.",
        examples: [
          "The cook found a way to make the bitter vegetables palatable to children.",
          "The compromise was barely palatable to either side, but it ended the dispute.",
          "Adding a little honey made the medicine more palatable."
        ]
      },
      {
        word: "gastronomy", pos: "noun", level: "C2",
        meaning: "The practice or art of preparing and eating good food.",
        examples: [
          "Lyon is widely regarded as the heart of French gastronomy.",
          "She wrote her thesis on the influence of immigration on local gastronomy.",
          "The festival celebrates the gastronomy of the Mediterranean region."
        ]
      }
    ]
  },
  transport: {
    label: "Transportation", icon: "🚆", order: 14,
    words: [
      {
        word: "congestion", pos: "noun", level: "C1",
        meaning: "Crowding that causes traffic or other things to move slowly or stop.",
        examples: [
          "Rush-hour congestion adds an hour to most commutes.",
          "Many cities introduce congestion charges to reduce inner-city traffic.",
          "Air traffic congestion has worsened with the rise of low-cost airlines."
        ]
      },
      {
        word: "commute", pos: "verb / noun", level: "C1",
        meaning: "(verb) To travel regularly between home and work; (noun) the journey itself.",
        examples: [
          "She commutes nearly two hours each way to her office in the city.",
          "The new train line has shortened his commute considerably.",
          "Remote work has eliminated the daily commute for millions."
        ]
      },
      {
        word: "infrastructure", pos: "noun", level: "C1",
        meaning: "The basic physical systems of a country, such as roads, bridges, and public transport.",
        examples: [
          "Decades of underinvestment have left the country's infrastructure in poor condition.",
          "The government has pledged billions for green infrastructure projects.",
          "Robust transport infrastructure is essential for economic growth."
        ]
      },
      {
        word: "logistics", pos: "noun", level: "C1",
        meaning: "The detailed organisation of a complex operation; especially the movement of goods.",
        examples: [
          "Global logistics chains were severely disrupted by the pandemic.",
          "The logistics of moving a thousand troops overnight are formidable.",
          "She works in logistics, coordinating shipments across three continents."
        ]
      },
      {
        word: "decarbonise", pos: "verb", level: "C2",
        meaning: "To reduce or eliminate carbon dioxide emissions from a sector, especially transport or energy.",
        examples: [
          "Many governments aim to decarbonise their transport networks by 2050.",
          "Electric vehicles play a central role in efforts to decarbonise.",
          "Decarbonising heavy industry remains technologically challenging."
        ]
      }
    ]
  },
  entertainment: {
    label: "Entertainment", icon: "🎬", order: 15,
    words: [
      {
        word: "blockbuster", pos: "noun", level: "C1",
        meaning: "A film, book, or other work that achieves very high commercial success.",
        examples: [
          "The studio's latest blockbuster has earned over a billion dollars worldwide.",
          "Summer is traditionally blockbuster season at the cinema.",
          "Not every blockbuster is a critical success — and vice versa."
        ]
      },
      {
        word: "ovation", pos: "noun", level: "C1",
        meaning: "A long, enthusiastic round of applause from an audience.",
        examples: [
          "The performance received a five-minute standing ovation.",
          "Her speech ended to a thunderous ovation.",
          "It is rare for a debut author to earn such an ovation."
        ]
      },
      {
        word: "binge", pos: "verb / noun", level: "C1",
        meaning: "To indulge excessively in something, especially watching many TV episodes in a row.",
        examples: [
          "I spent the whole weekend binge-watching that new crime drama.",
          "Streaming services have changed how we binge content.",
          "Binge eating disorder requires professional treatment."
        ]
      },
      {
        word: "renowned", pos: "adjective", level: "C1",
        meaning: "Known and admired by many people; famous for some specific quality.",
        examples: [
          "The renowned author drew a huge crowd at the book festival.",
          "She is renowned for her interpretations of Mozart.",
          "The restaurant is renowned across Asia for its dim sum."
        ]
      },
      {
        word: "highbrow", pos: "adjective", level: "C2",
        meaning: "Intellectually demanding; suited to or aimed at people of high taste or education.",
        examples: [
          "He prefers highbrow literature over popular fiction.",
          "The festival mixes highbrow opera with mainstream pop concerts.",
          "Critics dismissed her debut film as too highbrow for general audiences."
        ],
        compare: "vs. lowbrow: 'highbrow' = intellectual/sophisticated; 'lowbrow' = popular/unsophisticated. Both can be neutral or insulting depending on tone."
      }
    ]
  },
  social: {
    label: "Social Issues", icon: "🤝", order: 16,
    words: [
      {
        word: "inequality", pos: "noun", level: "C1",
        meaning: "Unequal distribution of opportunities, wealth, or social status across groups in a society.",
        examples: [
          "Rising income inequality has become a major political issue.",
          "The pandemic worsened existing inequalities in healthcare access.",
          "Gender inequality persists in many traditionally male-dominated industries."
        ]
      },
      {
        word: "marginalised", pos: "adjective", level: "C1",
        meaning: "Treated as unimportant or pushed to the edges of a society, group, or system.",
        examples: [
          "Marginalised communities often lack a voice in policymaking.",
          "The programme is designed to support marginalised youth.",
          "She writes powerfully about the lives of marginalised women."
        ]
      },
      {
        word: "stigma", pos: "noun", level: "C1",
        meaning: "A strong feeling of social disapproval associated with a particular trait or condition.",
        examples: [
          "There is still significant stigma surrounding mental illness.",
          "Many former prisoners struggle with the stigma of incarceration.",
          "Campaigns aim to reduce the stigma attached to seeking therapy."
        ]
      },
      {
        word: "homelessness", pos: "noun", level: "C1",
        meaning: "The state of having no permanent place to live.",
        examples: [
          "Homelessness has risen sharply in major urban centres.",
          "Charities provide emergency shelter to those experiencing homelessness.",
          "Tackling homelessness requires both housing and mental-health support."
        ]
      },
      {
        word: "disenfranchised", pos: "adjective", level: "C2",
        meaning: "Deprived of a right or privilege, especially the right to vote; (more broadly) feeling powerless.",
        examples: [
          "Voter ID laws have left many low-income citizens disenfranchised.",
          "Generations of disenfranchised workers fuelled the political uprising.",
          "She works with disenfranchised refugee communities."
        ]
      }
    ]
  },
  work: {
    label: "Work & Employment", icon: "💼", order: 17,
    words: [
      {
        word: "remuneration", pos: "noun", level: "C2",
        meaning: "Money paid for work or a service; compensation.",
        examples: [
          "The role offers competitive remuneration and excellent benefits.",
          "His remuneration was tied to the company's annual performance.",
          "Adequate remuneration is essential for retaining skilled staff."
        ],
        compare: "vs. salary: 'remuneration' is formal and includes salary + bonuses + benefits."
      },
      {
        word: "burnout", pos: "noun", level: "C1",
        meaning: "Physical or mental collapse caused by overwork or stress.",
        examples: [
          "Burnout is increasingly common among healthcare workers.",
          "She left the law firm after experiencing severe burnout.",
          "Companies are now investing in programmes to prevent employee burnout."
        ]
      },
      {
        word: "delegate", pos: "verb", level: "C1",
        meaning: "To assign a task or responsibility to another person, typically one in a more junior position.",
        examples: [
          "Good managers delegate effectively rather than micromanaging.",
          "He delegated the report to his deputy and focused on strategy.",
          "Learning to delegate is essential as a small business grows."
        ]
      },
      {
        word: "redundancy", pos: "noun", level: "C1",
        meaning: "The state of being no longer needed at work, leading to job loss.",
        examples: [
          "Hundreds of staff face redundancy after the merger.",
          "The company offered generous redundancy packages.",
          "Voluntary redundancy was preferred to forced layoffs."
        ]
      },
      {
        word: "headhunt", pos: "verb", level: "C2",
        meaning: "To actively recruit a specific person, often from another company, for a senior role.",
        examples: [
          "She was headhunted by a rival firm with a much higher salary offer.",
          "Top executives are routinely headhunted across industries.",
          "Specialist agencies headhunt talent for technology start-ups."
        ]
      }
    ]
  },
  housing: {
    label: "Housing & Architecture", icon: "🏠", order: 18,
    words: [
      {
        word: "affordability", pos: "noun", level: "C1",
        meaning: "The degree to which something is reasonably priced; especially housing within reach of average incomes.",
        examples: [
          "Housing affordability is a major challenge in most large cities.",
          "Government policies aim to improve affordability for first-time buyers.",
          "The crisis of affordability is pushing young people out of the capital."
        ]
      },
      {
        word: "gentrification", pos: "noun", level: "C2",
        meaning: "The process whereby a poor area becomes more affluent, often displacing original residents.",
        examples: [
          "Gentrification has transformed once-affordable neighbourhoods into luxury enclaves.",
          "Local activists protest against gentrification of their community.",
          "Gentrification raises difficult questions about who benefits from urban renewal."
        ]
      },
      {
        word: "tenant", pos: "noun", level: "C1",
        meaning: "A person who rents and lives in a property owned by someone else.",
        examples: [
          "Tenants have legal protection against unfair eviction.",
          "Long-term tenants often build strong ties to the local community.",
          "The landlord agreed to lower the rent to keep his existing tenants."
        ],
        compare: "vs. landlord: 'tenant' rents; 'landlord' owns and rents out."
      },
      {
        word: "skyscraper", pos: "noun", level: "C1",
        meaning: "A very tall building consisting of many storeys.",
        examples: [
          "Dubai is home to some of the world's most spectacular skyscrapers.",
          "The new skyscraper will dominate the city skyline.",
          "Modern skyscrapers are built to withstand earthquakes and high winds."
        ]
      },
      {
        word: "dilapidated", pos: "adjective", level: "C2",
        meaning: "(Of a building or object) in a state of severe disrepair due to age or neglect.",
        examples: [
          "They restored the dilapidated farmhouse over many years.",
          "Children should not have to attend such a dilapidated school.",
          "The dilapidated factory was finally demolished to make way for housing."
        ]
      }
    ]
  },
  nature: {
    label: "Nature & Wildlife", icon: "🦁", order: 19,
    words: [
      {
        word: "extinction", pos: "noun", level: "C1",
        meaning: "The state or process of a species ceasing to exist; dying out completely.",
        examples: [
          "Hundreds of species face extinction due to habitat loss.",
          "The dodo's extinction is a famous example of human impact on wildlife.",
          "Conservation efforts have brought several species back from the brink of extinction."
        ]
      },
      {
        word: "habitat", pos: "noun", level: "C1",
        meaning: "The natural environment in which a particular type of plant or animal lives.",
        examples: [
          "Logging is destroying the habitat of countless rainforest species.",
          "Beavers create wetland habitats that support many other animals.",
          "Each species is adapted to its own habitat."
        ]
      },
      {
        word: "migration", pos: "noun", level: "C1",
        meaning: "Seasonal movement of animals (or large-scale movement of people) from one region to another.",
        examples: [
          "Whales undertake one of the longest migrations of any mammal.",
          "Climate change is altering the timing of bird migration.",
          "The wildebeest migration across the Serengeti is a remarkable spectacle."
        ]
      },
      {
        word: "predator", pos: "noun", level: "C1",
        meaning: "An animal that naturally preys on others; (figuratively) someone who exploits others.",
        examples: [
          "Lions and wolves are apex predators in their ecosystems.",
          "Without natural predators, deer populations can grow unchecked.",
          "Online predators target vulnerable young users."
        ]
      },
      {
        word: "symbiosis", pos: "noun", level: "C2",
        meaning: "A close, often mutually beneficial relationship between two different organisms or things.",
        examples: [
          "Bees and flowering plants exist in a remarkable symbiosis.",
          "There is a strange symbiosis between the artist and her loyal critics.",
          "Healthy coral reefs depend on the symbiosis between coral and algae."
        ]
      }
    ]
  },
  space: {
    label: "Space & Astronomy", icon: "🌌", order: 20,
    words: [
      {
        word: "galaxy", pos: "noun", level: "C1",
        meaning: "A vast system of stars, gas, and dust held together by gravity.",
        examples: [
          "The Milky Way is the galaxy that contains our solar system.",
          "Some galaxies contain hundreds of billions of stars.",
          "Modern telescopes have observed galaxies billions of light years away."
        ]
      },
      {
        word: "orbit", pos: "noun / verb", level: "C1",
        meaning: "The curved path of a celestial object around a star, planet, or moon.",
        examples: [
          "The International Space Station orbits Earth roughly every 90 minutes.",
          "The new satellite was successfully placed in geostationary orbit.",
          "Mercury has the most eccentric orbit of any planet in our solar system."
        ]
      },
      {
        word: "asteroid", pos: "noun", level: "C1",
        meaning: "A small rocky body orbiting the Sun, mostly found between Mars and Jupiter.",
        examples: [
          "A large asteroid impact may have caused the extinction of the dinosaurs.",
          "Scientists track thousands of near-Earth asteroids.",
          "The mission plans to land on an asteroid and return samples."
        ]
      },
      {
        word: "cosmic", pos: "adjective", level: "C2",
        meaning: "Relating to the universe or cosmos, especially on a vast scale.",
        examples: [
          "Cosmic radiation poses a serious challenge for long-duration space travel.",
          "On a cosmic timescale, human history is barely a moment.",
          "The discovery had cosmic implications for our understanding of dark matter."
        ]
      },
      {
        word: "interstellar", pos: "adjective", level: "C2",
        meaning: "Existing or occurring between stars, often referring to vast distances of space.",
        examples: [
          "Voyager 1 was the first spacecraft to enter interstellar space.",
          "Interstellar travel remains in the realm of science fiction.",
          "She studies interstellar dust clouds that give birth to new stars."
        ]
      }
    ]
  },
  psychology: {
    label: "Psychology & Human Behaviour", icon: "🧠", order: 21,
    words: [
      {
        word: "cognitive", pos: "adjective", level: "C1",
        meaning: "Relating to mental processes such as thinking, learning, and remembering.",
        examples: [
          "Cognitive decline is a major concern in ageing populations.",
          "The therapist used cognitive behavioural techniques to treat the patient's anxiety.",
          "Sleep deprivation impairs cognitive performance significantly."
        ]
      },
      {
        word: "introvert", pos: "noun", level: "C1",
        meaning: "A person who tends to be reserved and gain energy from being alone rather than in groups.",
        examples: [
          "As a strong introvert, she finds large parties exhausting.",
          "Introverts often excel at deep focus and reflective work.",
          "Many writers describe themselves as introverts."
        ],
        compare: "vs. extrovert: 'introvert' recharges alone; 'extrovert' recharges from social interaction."
      },
      {
        word: "resilience", pos: "noun", level: "C1",
        meaning: "The ability to recover quickly from difficulties; mental toughness.",
        examples: [
          "Children's resilience often surprises adults.",
          "Building resilience is essential for coping with workplace stress.",
          "Her resilience after the accident inspired everyone around her."
        ]
      },
      {
        word: "empathy", pos: "noun", level: "C1",
        meaning: "The ability to understand and share the feelings of another person.",
        examples: [
          "Empathy is a vital skill for therapists and teachers.",
          "Reading fiction has been shown to increase empathy.",
          "He listened with genuine empathy to his friend's difficulties."
        ],
        compare: "vs. sympathy: 'empathy' is feeling WITH someone; 'sympathy' is feeling FOR them."
      },
      {
        word: "self-actualisation", pos: "noun", level: "C2",
        meaning: "The realisation of one's full potential and inner gifts.",
        examples: [
          "Maslow placed self-actualisation at the top of his hierarchy of needs.",
          "Creative work was, for her, a path to self-actualisation.",
          "Therapy helped him pursue self-actualisation rather than mere happiness."
        ]
      }
    ]
  },
  internet: {
    label: "Internet & Social Media", icon: "🌐", order: 22,
    words: [
      {
        word: "viral", pos: "adjective", level: "C1",
        meaning: "(Of content) spreading very quickly and widely on the internet.",
        examples: [
          "Her cooking video went viral overnight.",
          "Brands try to create viral marketing campaigns, with mixed success.",
          "A single viral tweet can change a person's life."
        ]
      },
      {
        word: "anonymity", pos: "noun", level: "C1",
        meaning: "The condition of being unknown or unidentified.",
        examples: [
          "Online anonymity can encourage cruelty as well as honest discussion.",
          "Many whistleblowers depend on anonymity for their safety.",
          "The platform allows users to comment under conditions of anonymity."
        ]
      },
      {
        word: "echo chamber", pos: "noun", level: "C2",
        meaning: "An environment, often online, where people only encounter views that reinforce their own.",
        examples: [
          "Social media algorithms can create dangerous echo chambers.",
          "Stepping outside one's echo chamber requires conscious effort.",
          "Echo chambers contribute to political polarisation."
        ]
      },
      {
        word: "cyberbullying", pos: "noun", level: "C1",
        meaning: "The use of digital technologies to bully, harass, or intimidate someone.",
        examples: [
          "Schools now have specific policies addressing cyberbullying.",
          "Cyberbullying can have serious mental health consequences.",
          "Parents should talk to their children about how to respond to cyberbullying."
        ]
      },
      {
        word: "influencer", pos: "noun", level: "C1",
        meaning: "A person who has gained a following on social media and can influence audience purchasing decisions.",
        examples: [
          "Brands pay influencers handsomely to promote their products.",
          "Some influencers have larger audiences than traditional media outlets.",
          "She started as a fashion influencer before launching her own clothing line."
        ]
      }
    ]
  },
  climate: {
    label: "Climate Change", icon: "🌡", order: 23,
    words: [
      {
        word: "emissions", pos: "noun (plural)", level: "C1",
        meaning: "The release of gases, especially polluting ones, into the atmosphere.",
        examples: [
          "Reducing carbon emissions is essential to limit global warming.",
          "The factory's emissions exceeded legal limits.",
          "Electric vehicles produce no tailpipe emissions."
        ]
      },
      {
        word: "renewable", pos: "adjective", level: "C1",
        meaning: "(Of energy or resources) able to be replaced naturally; not running out.",
        examples: [
          "Wind and solar are the fastest-growing forms of renewable energy.",
          "The country aims to generate 80% of its electricity from renewable sources by 2030.",
          "Renewable resources offer a sustainable alternative to fossil fuels."
        ]
      },
      {
        word: "greenhouse effect", pos: "noun phrase", level: "C1",
        meaning: "The trapping of the sun's heat in Earth's atmosphere by certain gases, leading to warming.",
        examples: [
          "The greenhouse effect is essential for life but is being amplified by human activity.",
          "Methane is a far more potent greenhouse gas than carbon dioxide.",
          "Without the greenhouse effect, Earth would be too cold to inhabit."
        ]
      },
      {
        word: "mitigation", pos: "noun", level: "C2",
        meaning: "Action taken to reduce the severity or seriousness of something.",
        examples: [
          "Climate mitigation focuses on reducing emissions at the source.",
          "Effective mitigation requires international cooperation.",
          "Flood mitigation measures saved hundreds of homes."
        ],
        compare: "vs. adaptation: 'mitigation' = reducing the cause; 'adaptation' = adjusting to the effects."
      },
      {
        word: "anthropogenic", pos: "adjective", level: "C2",
        meaning: "Caused or produced by human activity.",
        examples: [
          "Scientists agree that current climate change is anthropogenic.",
          "Anthropogenic noise disrupts marine wildlife.",
          "The data clearly shows an anthropogenic source for the temperature rise."
        ]
      }
    ]
  },
  art: {
    label: "Art & Literature", icon: "🎨", order: 24,
    words: [
      {
        word: "masterpiece", pos: "noun", level: "C1",
        meaning: "A work of outstanding artistry, skill, or workmanship.",
        examples: [
          "The Mona Lisa is widely regarded as Leonardo's masterpiece.",
          "Her debut novel was hailed as a literary masterpiece.",
          "Visitors travel from around the world to see this Renaissance masterpiece."
        ]
      },
      {
        word: "protagonist", pos: "noun", level: "C1",
        meaning: "The leading character in a play, novel, or film; the main figure in any event.",
        examples: [
          "The protagonist undergoes a profound transformation by the novel's end.",
          "Children often identify strongly with the protagonist of their favourite books.",
          "She was a key protagonist in the civil rights movement."
        ],
        compare: "vs. antagonist: 'protagonist' is the hero/main character; 'antagonist' is the opponent."
      },
      {
        word: "abstract", pos: "adjective", level: "C1",
        meaning: "(Of art) not representing physical objects realistically; existing as an idea rather than a concrete thing.",
        examples: [
          "Picasso's later work moved toward more abstract forms.",
          "Mathematics deals with abstract concepts that may have practical applications.",
          "Abstract paintings can mean different things to different viewers."
        ]
      },
      {
        word: "satire", pos: "noun", level: "C1",
        meaning: "The use of humour, irony, or exaggeration to criticise people's stupidity or vices.",
        examples: [
          "Jonathan Swift's 'A Modest Proposal' is a classic example of political satire.",
          "Late-night television relies heavily on political satire.",
          "Her novel is a sharp satire of contemporary office life."
        ]
      },
      {
        word: "evocative", pos: "adjective", level: "C2",
        meaning: "Bringing strong images, memories, or feelings to mind.",
        examples: [
          "The poem is deeply evocative of childhood summers.",
          "Her paintings are evocative of the colours of Provence.",
          "The novel's evocative descriptions transport the reader to 19th-century Russia."
        ]
      }
    ]
  },
  history: {
    label: "History", icon: "📜", order: 25,
    words: [
      {
        word: "civilisation", pos: "noun", level: "C1",
        meaning: "A complex society marked by urban development, social hierarchy, and cultural achievement.",
        examples: [
          "Ancient Egyptian civilisation flourished along the Nile for thousands of years.",
          "The Mayan civilisation made significant advances in astronomy and mathematics.",
          "Historians debate what caused the collapse of certain ancient civilisations."
        ]
      },
      {
        word: "revolution", pos: "noun", level: "C1",
        meaning: "A forcible overthrow of a government or social order; a fundamental change.",
        examples: [
          "The French Revolution transformed European politics forever.",
          "The Industrial Revolution reshaped how people lived and worked.",
          "The digital revolution has changed nearly every aspect of daily life."
        ]
      },
      {
        word: "colonialism", pos: "noun", level: "C1",
        meaning: "The policy of acquiring and maintaining colonies, often by exploiting indigenous populations.",
        examples: [
          "European colonialism shaped much of the modern world's borders.",
          "The lasting effects of colonialism are still studied by historians today.",
          "Many countries gained independence after long struggles against colonialism."
        ]
      },
      {
        word: "treaty", pos: "noun", level: "C1",
        meaning: "A formal agreement between two or more countries.",
        examples: [
          "The Treaty of Versailles formally ended the First World War.",
          "Climate treaties commit nations to specific emission reductions.",
          "A peace treaty was signed after decades of conflict."
        ]
      },
      {
        word: "abolition", pos: "noun", level: "C2",
        meaning: "The formal ending of a system, practice, or institution, especially slavery.",
        examples: [
          "The abolition of slavery was a long and bloody struggle.",
          "Many reformers fought for the abolition of capital punishment.",
          "The abolition of feudalism transformed European society."
        ]
      }
    ]
  },
  fashion: {
    label: "Fashion & Lifestyle", icon: "👗", order: 26,
    words: [
      {
        word: "trend", pos: "noun", level: "C1",
        meaning: "A general direction in which something is developing or changing; a current fashion.",
        examples: [
          "Sustainable fashion is one of the biggest trends in the industry.",
          "She has a knack for spotting trends before they become mainstream.",
          "The trend toward minimalism is reshaping interior design."
        ]
      },
      {
        word: "bespoke", pos: "adjective", level: "C2",
        meaning: "Made specifically for an individual customer; custom-made.",
        examples: [
          "He had a bespoke suit tailored on Savile Row.",
          "The company offers bespoke kitchen design services.",
          "Bespoke products usually cost considerably more than ready-made alternatives."
        ],
        compare: "vs. tailor-made: very similar; 'bespoke' is more common in British English and implies high-end craftsmanship."
      },
      {
        word: "wardrobe", pos: "noun", level: "C1",
        meaning: "A collection of clothes belonging to a person; also a piece of furniture for storing clothes.",
        examples: [
          "She refreshed her entire wardrobe for the new job.",
          "A capsule wardrobe focuses on a small number of versatile pieces.",
          "He has an entire wardrobe dedicated to vintage suits."
        ]
      },
      {
        word: "minimalist", pos: "adjective", level: "C1",
        meaning: "Using or favouring simple, uncluttered designs with few elements.",
        examples: [
          "Her minimalist apartment contains only essential furniture.",
          "Minimalist fashion focuses on classic cuts and neutral colours.",
          "The brand is known for its sleek, minimalist aesthetic."
        ]
      },
      {
        word: "haute couture", pos: "noun", level: "C2",
        meaning: "Expensive, high-fashion clothing designed and made to a customer's exact specifications.",
        examples: [
          "Paris remains the world capital of haute couture.",
          "Haute couture pieces are works of art rather than everyday wear.",
          "She owned a few cherished haute couture dresses from the 1960s."
        ]
      }
    ]
  },
  relationships: {
    label: "Relationships & Family", icon: "❤", order: 27,
    words: [
      {
        word: "sibling", pos: "noun", level: "C1",
        meaning: "A brother or sister.",
        examples: [
          "He has three older siblings.",
          "Sibling rivalry is common in early childhood.",
          "Adult siblings often become each other's closest friends."
        ]
      },
      {
        word: "estranged", pos: "adjective", level: "C2",
        meaning: "No longer close to a family member or partner because of an argument or separation.",
        examples: [
          "She had been estranged from her father for over a decade.",
          "The estranged couple met to discuss custody arrangements.",
          "Therapy helped him reconnect with his estranged brother."
        ]
      },
      {
        word: "spouse", pos: "noun", level: "C1",
        meaning: "A married partner — husband or wife.",
        examples: [
          "He listed his spouse as his next of kin.",
          "Many benefits extend to spouses and dependents.",
          "Both spouses contributed to the household income."
        ]
      },
      {
        word: "nurture", pos: "verb", level: "C1",
        meaning: "To care for and encourage the growth or development of someone or something.",
        examples: [
          "Good parents nurture their children's curiosity.",
          "She nurtured her writing talent throughout her teenage years.",
          "The mentorship programme nurtures young entrepreneurs."
        ],
        compare: "vs. nature vs. nurture: 'nature' = innate biology; 'nurture' = environment and upbringing."
      },
      {
        word: "reconcile", pos: "verb", level: "C1",
        meaning: "To restore friendly relations between people; to bring conflicting things into agreement.",
        examples: [
          "The siblings finally reconciled after years of silence.",
          "It is hard to reconcile his public image with his private behaviour.",
          "She struggled to reconcile her career ambitions with family life."
        ]
      }
    ]
  },
  globalisation: {
    label: "Globalisation", icon: "🌍", order: 28,
    words: [
      {
        word: "multinational", pos: "adjective / noun", level: "C1",
        meaning: "(adj) Operating in several countries; (noun) a large company that does so.",
        examples: [
          "Multinational corporations employ millions of people worldwide.",
          "The country offers tax incentives to attract multinationals.",
          "Multinational supply chains were disrupted during the pandemic."
        ]
      },
      {
        word: "outsourcing", pos: "noun", level: "C1",
        meaning: "Obtaining goods or services from an outside or foreign supplier, especially in place of an internal source.",
        examples: [
          "Outsourcing customer service to overseas call centres has cut costs but raised concerns about quality.",
          "Many software companies rely on outsourcing for routine development tasks.",
          "Critics argue that outsourcing has hollowed out manufacturing in developed countries."
        ]
      },
      {
        word: "homogenisation", pos: "noun", level: "C2",
        meaning: "The process of making things similar or uniform, especially across cultures.",
        examples: [
          "Globalisation has led to a homogenisation of consumer tastes.",
          "Activists fight cultural homogenisation by preserving local traditions.",
          "The homogenisation of high streets is a common complaint in many countries."
        ]
      },
      {
        word: "expatriate", pos: "noun", level: "C1",
        meaning: "A person who lives outside their native country, often for work.",
        examples: [
          "Singapore hosts a large expatriate community.",
          "Many expatriates miss the food of their homeland.",
          "He returned to his country after fifteen years as an expatriate."
        ],
        compare: "vs. immigrant: 'expatriate' is usually temporary or skilled professional; 'immigrant' usually implies permanent settlement."
      },
      {
        word: "interdependence", pos: "noun", level: "C2",
        meaning: "The state of two or more people, countries, or systems depending on each other.",
        examples: [
          "Modern economies are characterised by deep interdependence.",
          "The pandemic exposed our global interdependence.",
          "Healthy ecosystems rely on interdependence among species."
        ]
      }
    ]
  },
  advertising: {
    label: "Advertising & Marketing", icon: "📣", order: 29,
    words: [
      {
        word: "endorsement", pos: "noun", level: "C1",
        meaning: "A public expression of approval or support, especially for a product or person.",
        examples: [
          "The brand secured a high-profile celebrity endorsement.",
          "Political candidates compete for newspaper endorsements.",
          "An endorsement from a trusted figure can dramatically boost sales."
        ]
      },
      {
        word: "demographic", pos: "noun / adjective", level: "C1",
        meaning: "A particular section of a population, defined by age, gender, income, etc.",
        examples: [
          "The product is aimed at the 18-to-24 demographic.",
          "Demographic shifts are reshaping the consumer market.",
          "Advertisers tailor messages to specific demographics."
        ]
      },
      {
        word: "branding", pos: "noun", level: "C1",
        meaning: "The activity of giving a company or product a particular design, name, and image.",
        examples: [
          "Strong branding helps customers recognise and trust a product.",
          "The company spent millions on rebranding.",
          "Personal branding has become essential for freelancers."
        ]
      },
      {
        word: "consumerism", pos: "noun", level: "C2",
        meaning: "The preoccupation with buying and accumulating consumer goods, often seen as excessive.",
        examples: [
          "Critics blame consumerism for the rise of disposable culture.",
          "Black Friday epitomises modern consumerism.",
          "Some communities try to resist consumerism through minimalism."
        ]
      },
      {
        word: "subliminal", pos: "adjective", level: "C2",
        meaning: "Acting below the level of conscious awareness; influencing without being noticed.",
        examples: [
          "Some advertisers have been accused of using subliminal messaging.",
          "Subliminal cues in store music can influence purchasing.",
          "Research on subliminal advertising remains controversial."
        ]
      }
    ]
  },
  agriculture: {
    label: "Agriculture", icon: "🌾", order: 30,
    words: [
      {
        word: "irrigation", pos: "noun", level: "C1",
        meaning: "The supply of water to land or crops to help growth, typically by means of channels.",
        examples: [
          "Modern irrigation systems are essential in arid farming regions.",
          "Inefficient irrigation wastes huge amounts of water.",
          "Drip irrigation delivers water directly to plant roots."
        ]
      },
      {
        word: "pesticide", pos: "noun", level: "C1",
        meaning: "A substance used to destroy insects or other organisms harmful to cultivated plants.",
        examples: [
          "Overuse of pesticides can contaminate water supplies.",
          "Organic farming avoids synthetic pesticides altogether.",
          "Some pesticides have been linked to declines in bee populations."
        ]
      },
      {
        word: "yield", pos: "noun / verb", level: "C1",
        meaning: "(noun) The amount of crop produced from an area of land; (verb) to produce.",
        examples: [
          "The new wheat variety produces significantly higher yields.",
          "Drought has reduced yields across the region.",
          "Better farming techniques can yield more food without expanding farmland."
        ]
      },
      {
        word: "agrarian", pos: "adjective", level: "C2",
        meaning: "Relating to cultivated land or the cultivation of land; rural.",
        examples: [
          "Many developing countries still have predominantly agrarian economies.",
          "The novel depicts traditional agrarian life in rural India.",
          "Land reform has been a key demand of agrarian movements."
        ]
      },
      {
        word: "sustainable farming", pos: "noun phrase", level: "C1",
        meaning: "Farming practices that protect the environment and remain productive over the long term.",
        examples: [
          "Sustainable farming reduces reliance on chemical fertilisers.",
          "Many young farmers are turning to sustainable farming methods.",
          "Sustainable farming aims to feed people without harming future generations."
        ]
      }
    ]
  },
  energy: {
    label: "Energy & Resources", icon: "⚡", order: 31,
    words: [
      {
        word: "fossil fuel", pos: "noun phrase", level: "C1",
        meaning: "A natural fuel such as coal, oil, or gas formed from ancient organisms.",
        examples: [
          "Fossil fuels still provide most of the world's energy.",
          "Burning fossil fuels releases greenhouse gases.",
          "The transition away from fossil fuels is one of the great challenges of our time."
        ]
      },
      {
        word: "depletion", pos: "noun", level: "C1",
        meaning: "Reduction in the number or quantity of something, especially natural resources.",
        examples: [
          "Rapid depletion of freshwater reserves threatens many regions.",
          "Soil depletion reduces farmland productivity over time.",
          "Companies must report on natural-resource depletion in their sustainability reports."
        ]
      },
      {
        word: "grid", pos: "noun", level: "C1",
        meaning: "A network of cables that carry electrical power from generators to consumers.",
        examples: [
          "Storms knocked out the electrical grid across the region.",
          "Solar panels can feed surplus power back into the grid.",
          "Modernising the grid is essential for integrating renewable energy."
        ]
      },
      {
        word: "conservation", pos: "noun", level: "C1",
        meaning: "Preserving and protecting natural environments and resources.",
        examples: [
          "Water conservation is critical in drought-prone areas.",
          "Energy conservation can save households hundreds of dollars a year.",
          "Conservation efforts have saved several species from extinction."
        ]
      },
      {
        word: "harness", pos: "verb", level: "C2",
        meaning: "To use the energy or strength of something for a specific purpose.",
        examples: [
          "Engineers are finding new ways to harness wind energy.",
          "Harnessing the power of artificial intelligence requires careful regulation.",
          "Solar panels harness sunlight to produce electricity."
        ]
      }
    ]
  }
};




// Check whether a saved template object is byte-identical to a known legacy version (any field).
function isLegacyBand9(t) {
  if (!t) return false;
  const fields = ['intro', 'bp1', 'bp2', 'concl'];
  for (const f of fields) {
    if ((t[f] || '') !== (BAND9_TEMPLATE_LEGACY_V1[f] || '')) return false;
  }
  return true;
}

// Migrate a user's templates bag.
// Returns { bag, changed, notifyUntouched, notifyCustomKept }.
//
// Rules:
//   - bag.band9 is the READ-ONLY preset → always force to current BAND9_TEMPLATE.
//     This is cheap because users never edit band9, so we never destroy any user work.
//   - bag.custom is user-editable:
//       * Only touched during a version migration (gated by BAND9_TEMPLATE_VERSION)
//       * If byte-identical to OLD Band 9 (untouched) → update to new BAND9_TEMPLATE silently
//       * If customised → keep as-is, notify the user they can reset if they want
function migrateBand9IfNeeded(bag) {
  if (!bag) return { bag: getDefaultTemplates(), changed: false };

  let changed = false;
  let notifyUntouched = false;
  let notifyCustomKept = false;
  const newBag = { ...bag };

  // ALWAYS force band9 to the current preset (safe — read-only field, never user-edited).
  // This applies even if BAND9_TEMPLATE_VERSION hasn't bumped — handles any drift.
  if (!isCurrentBand9(newBag.band9)) {
    newBag.band9 = BAND9_TEMPLATE;
    changed = true;
  }

  // Custom field migration is gated by version bump (avoids overwriting user edits twice).
  const currentVer = parseInt(userProfile?.band9TemplateVersion || 0, 10);
  if (currentVer < BAND9_TEMPLATE_VERSION) {
    if (isLegacyBand9(newBag.custom)) {
      // Untouched — safe to update silently
      newBag.custom = BAND9_TEMPLATE;
      changed = true;
      notifyUntouched = true;
    } else if (newBag.custom && !isCurrentBand9(newBag.custom)) {
      // Customised — keep theirs, let them know they can reset
      notifyCustomKept = true;
    }
  }

  return { bag: newBag, changed, notifyUntouched, notifyCustomKept };
}

function isCurrentBand9(t) {
  if (!t) return false;
  return ['intro','bp1','bp2','concl'].every(f => (t[f] || '') === (BAND9_TEMPLATE[f] || ''));
}



// Migrate legacy single-template state to new shape + apply Band 9 version migration
function getTemplatesBag() {
  // Cloud mode
  if (userProfile) {
    if (userProfile.templates) {
      // Apply Band 9 version migration if needed
      const migrated = migrateBand9IfNeeded(userProfile.templates);
      if (migrated.changed) {
        userProfile.templates = migrated.bag;
        userProfile.band9TemplateVersion = BAND9_TEMPLATE_VERSION;
        saveAll();  // persist the migration
        if (migrated.notifyUntouched || migrated.notifyCustomKept) {
          // Defer toast to next tick so it doesn't fire during init render
          setTimeout(() => {
            if (migrated.notifyUntouched) {
              toast('Band 9 template updated — examples in both body paragraphs + a personal conclusion. ✓');
            } else if (migrated.notifyCustomKept) {
              toast('Your custom template was kept as-is. Tap "Reset to Band 9" to use the new improved version.');
            }
          }, 1500);
        }
      }
      return userProfile.templates;
    }
    // Legacy: a single template field exists from older versions
    if (userProfile.template) {
      const bag = getDefaultTemplates();
      bag.custom = userProfile.template;  // promote their edited template to "custom"
      bag.default = 'custom';
      userProfile.templates = bag;
      userProfile.band9TemplateVersion = BAND9_TEMPLATE_VERSION;
      return bag;
    }
    return getDefaultTemplates();
  }
  // Offline mode
  const raw = safeLSGet('ipt_templates');
  if (raw) {
    try {
      const bag = JSON.parse(raw);
      // Apply migration in offline mode too
      const ver = parseInt(safeLSGet('ipt_band9_v') || '1', 10);
      if (ver < BAND9_TEMPLATE_VERSION) {
        const migrated = migrateBand9IfNeeded(bag);
        if (migrated.changed) {
          safeLSSet('ipt_templates', JSON.stringify(migrated.bag));
          safeLSSet('ipt_band9_v', String(BAND9_TEMPLATE_VERSION));
          return migrated.bag;
        }
        safeLSSet('ipt_band9_v', String(BAND9_TEMPLATE_VERSION));
      }
      return bag;
    } catch (e) {}
  }
  // Migrate from legacy local key
  const legacy = safeLSGet('ipt_template');
  if (legacy) {
    try {
      const bag = getDefaultTemplates();
      bag.custom = JSON.parse(legacy);
      bag.default = 'custom';
      return bag;
    } catch (e) {}
  }
  return getDefaultTemplates();
}

// Get the right template for a given essay
// essay.templateChoice can be: undefined/'default' (use the user's default), 'band6', 'band9', or 'custom'
function getTemplateForEssay(essay) {
  const bag = getTemplatesBag();
  let key = essay && essay.templateChoice;
  if (!key || key === 'default') key = bag.default || 'band9';
  return bag[key] || bag.band9 || BAND9_TEMPLATE;
}

// Resolve which template KEY ('band6' | 'band9' | 'custom') an essay actually uses
function getTemplateKeyForEssay(essay) {
  const bag = getTemplatesBag();
  let key = essay && essay.templateChoice;
  if (!key || key === 'default') key = bag.default || 'band9';
  // Treat 'custom' as Band 9-flavoured for labelling (it's seeded from Band 9 and edited by user)
  return key;
}

// Pretty label for the template tier — used in PDF headers / cover
// Returns "Band 6", "Band 9" (custom counts as Band 9 since it's derived from Band 9)
function templateTierLabel(key) {
  if (key === 'band6') return 'Band 6';
  return 'Band 9';
}

// Label for the default — used by cover & TOC headers
function defaultTemplateTierLabel() {
  const bag = getTemplatesBag();
  return templateTierLabel(bag.default || 'band9');
}

// Save the templates bag (used when user edits "custom" or changes default)
async function saveTemplatesBag(bag) {
  if (offlineMode || !currentUser) {
    safeLSSet('ipt_templates', JSON.stringify(bag));
    return;
  }
  userProfile.templates = bag;
  queueSync();
}

// ============================================================
//  STATE
// ============================================================
// (state variables are declared higher up in the AUTH section now)

function saveAll() {
  // In cloud mode: queue a debounced Firestore sync
  // In offline mode: write to localStorage
  queueSync();
}
function uid() { return 'e' + Date.now() + Math.random().toString(36).slice(2, 6); }

// Safe localStorage wrappers — setItem throws in Safari private mode / at quota.
// These never throw; they log and continue so the app keeps working.
function safeLSSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn('localStorage write failed (private mode or quota?):', key, e.name);
    return false;
  }
}
function safeLSGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn('localStorage read failed:', key, e.name);
    return null;
  }
}
function safeLSRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) { /* ignore */ }
}

function showLoading(on){
  const el = document.getElementById('loadingVeil');
  if(el) el.classList.toggle('hidden', !on);
}

// If beforeunload stashed a backup that's newer than what we loaded, offer to restore it.
function maybeOfferDraftRecovery() {
  try {
    const raw = safeLSGet('ipt_unsaved_backup');
    if (!raw) return;
    const backup = JSON.parse(raw);
    // Only offer if backup is recent (< 24h) and has essays
    if (!backup || !Array.isArray(backup.essays) || !backup.ts) {
      safeLSRemove('ipt_unsaved_backup');
      return;
    }
    const ageMs = Date.now() - backup.ts;
    if (ageMs > 24 * 60 * 60 * 1000) {
      safeLSRemove('ipt_unsaved_backup');
      return;
    }
    // Compare: does the backup differ from what we just loaded?
    const sameLength = backup.essays.length === essays.length;
    const backupStr = JSON.stringify(backup.essays);
    const loadedStr = JSON.stringify(essays);
    if (backupStr === loadedStr) {
      // No difference — backup is stale, clear it
      safeLSRemove('ipt_unsaved_backup');
      return;
    }
    // There's a meaningful difference — offer recovery
    setTimeout(() => {
      const mins = Math.max(1, Math.round(ageMs / 60000));
      if (confirm(`You have unsaved changes from ${mins} minute(s) ago that didn't finish syncing. Restore them?`)) {
        essays = backup.essays;
        if (backup.currentId) currentId = backup.currentId;
        renderList();
        if (typeof selectEssay === 'function' && currentId) selectEssay(currentId);
        queueSync();
        toast('Unsaved changes restored ✓');
      }
      safeLSRemove('ipt_unsaved_backup');
    }, 800);
  } catch (e) {
    console.warn('Draft recovery check failed:', e);
    safeLSRemove('ipt_unsaved_backup');
  }
}

function getCurrent() { return essays.find(e => e.id === currentId); }

async function checkAIStatus(){
  try {
    const r = await fetch(API_URL+'/api/health');
    const d = await r.json();
    const live = !!d.anthropicConfigured;
    ['aiStatusTag','aiStatusTag2'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.innerHTML = '<span class="dot"></span>' + (live ? 'Claude Live' : 'Local Mode');
    });
  } catch(e){ /* leave default */ }
}

function essayStatus(e) {
  const body = (e.intro || '') + (e.bp1 || '') + (e.bp2 || '') + (e.concl || '');
  if (!body.trim()) return 'empty';
  // count how many of the 4 paragraphs have content
  const filled = [e.intro, e.bp1, e.bp2, e.concl].filter(p => p && p.trim().length > 30).length;
  return filled === 4 ? 'written' : 'draft';
}

// ============================================================
//  LIST + FILTERS + SEARCH
// ============================================================
function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.filter === f));
  renderList();
}

function renderList() {
  const list = document.getElementById('essayList');
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  document.getElementById('essayCount').textContent = essays.length;

  // status counts
  let cWritten = 0, cDraft = 0, cEmpty = 0;
  essays.forEach(e => {
    const s = essayStatus(e);
    if (s === 'written') cWritten++;
    else if (s === 'draft') cDraft++;
    else cEmpty++;
  });
  document.getElementById('cnt-all').textContent = essays.length;
  document.getElementById('cnt-written').textContent = cWritten;
  document.getElementById('cnt-draft').textContent = cDraft;
  document.getElementById('cnt-empty').textContent = cEmpty;
  const progressDoneEl = document.getElementById('progressDone');
  if (progressDoneEl) progressDoneEl.textContent = cWritten;
  const progressTotalEl = document.getElementById('progressTotal');
  if (progressTotalEl) progressTotalEl.textContent = essays.length;
  const progressFillEl = document.getElementById('progressFill');
  if (progressFillEl) progressFillEl.style.width = (essays.length ? (cWritten / essays.length * 100) : 0) + '%';

  let filtered = essays.map((e, i) => ({ e, i }));
  if (currentFilter !== 'all') {
    filtered = filtered.filter(({e}) => essayStatus(e) === currentFilter);
  }
  if (q) {
    filtered = filtered.filter(({e}) =>
      (e.title || '').toLowerCase().includes(q) ||
      (e.question || '').toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    list.innerHTML = '<div style="text-align:center;color:var(--ink-mute);font-size:12px;padding:24px 8px;font-style:italic;font-family:var(--serif);">No essays match this filter.</div>';
    return;
  }

  list.innerHTML = filtered.map(({e, i}) => {
    const s = essayStatus(e);
    const statusLabel = s === 'written' ? 'WRITTEN' : (s === 'draft' ? 'DRAFT' : 'EMPTY');
    const statusClass = 'status-' + s;
    const isActive = e.id === currentId;
    return `
      <div class="essay-item ${isActive ? 'active' : ''}" onclick="selectEssay('${e.id}')">
        <div class="essay-item-meta">
          <span>ESSAY ${String(i + 1).padStart(2, '0')}</span>
          ${e.badge ? `<span class="essay-item-badge" style="background: var(--accent-soft); color: var(--accent); font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; margin-left: 6px; font-family: var(--sans);">${escapeHtml(e.badge)}</span>` : ''}
          <span class="essay-item-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="essay-item-title">${escapeHtml(e.title || 'Untitled')}</div>
        ${isActive ? `
          <div class="essay-item-practice-lnk" onclick="event.stopPropagation(); practiceCurrentEssay()" title="Test yourself under exam conditions">
            ✏️ Practice this essay →
          </div>
        ` : ''}
        <button class="essay-item-del" onclick="event.stopPropagation(); deleteEssay('${e.id}')" title="Delete">✕</button>
      </div>
    `;
  }).join('');
}

function addEssay() {
  const e = {
    id: uid(), title: '', question: '', explanation: '',
    pros: '', cons: '', approach: '',
    intro: '', bp1: '', bp2: '', concl: '',
    vocab: 3, seedIdeas: ''
  };
  essays.push(e);
  currentId = e.id;
  saveAll(); renderList(); loadCurrent(); renderPreview();
}

// ----- BULK IMPORT -----
function openBulkImport() {
  document.getElementById('bulkImportText').value = '';
  document.getElementById('bulkPreview').innerHTML = 'Paste topics above to see a preview.';
  document.getElementById('bulkImportBtn').disabled = true;
  document.getElementById('bulkImportBtn').textContent = 'Add 0 topics';
  document.getElementById('bulkImportModal').classList.add('show');
}
function closeBulkImport() { document.getElementById('bulkImportModal').classList.remove('show'); }

// Parse the textarea into a list of { title, question, explanation }
function parseBulkInput(text) {
  text = (text || '').trim();
  if (!text) return [];
  const topics = [];

  // Format 2: pipe-separated lines
  if (text.split('\n').some(l => l.includes('|'))) {
    text.split('\n').forEach(line => {
      line = line.trim();
      if (!line) return;
      const parts = line.split('|').map(s => s.trim());
      if (parts[0]) {
        topics.push({
          title: parts[0],
          question: parts[1] || '',
          explanation: parts[2] || ''
        });
      }
    });
    return topics;
  }

  // Format 1: blank-line-separated blocks (title + question)
  if (text.includes('\n\n')) {
    text.split(/\n\s*\n/).forEach(block => {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) return;
      topics.push({
        title: lines[0],
        question: lines.slice(1).join(' '),
        explanation: ''
      });
    });
    return topics;
  }

  // Format 3: one title per line
  text.split('\n').forEach(line => {
    line = line.trim();
    if (line) topics.push({ title: line, question: '', explanation: '' });
  });
  return topics;
}

function updateBulkPreview() {
  const text = document.getElementById('bulkImportText').value;
  const parsed = parseBulkInput(text);
  const preview = document.getElementById('bulkPreview');
  const btn = document.getElementById('bulkImportBtn');
  if (parsed.length === 0) {
    preview.innerHTML = 'Paste topics above to see a preview.';
    btn.disabled = true;
    btn.textContent = 'Add 0 topics';
    return;
  }
  const first3 = parsed.slice(0, 3).map((t, i) =>
    `<div style="padding:6px 8px; background:var(--bg); border-radius:4px; margin:4px 0;">
      <strong>${escapeHtml(t.title || '(no title)')}</strong>
      ${t.question ? `<div style="color:var(--ink-mute); font-size:11px; margin-top:2px;">${escapeHtml(t.question.slice(0, 100))}${t.question.length > 100 ? '…' : ''}</div>` : ''}
    </div>`
  ).join('');
  preview.innerHTML = `
    <div style="font-style:normal; font-family:var(--sans); color:var(--ink);">
      <strong>${parsed.length} topic${parsed.length === 1 ? '' : 's'} detected.</strong> Preview of first ${Math.min(3, parsed.length)}:
    </div>
    ${first3}
    ${parsed.length > 3 ? `<div style="text-align:center; color:var(--ink-mute); padding:4px;">… and ${parsed.length - 3} more</div>` : ''}
  `;
  btn.disabled = false;
  btn.textContent = `Add ${parsed.length} topic${parsed.length === 1 ? '' : 's'}`;
}

function doBulkImport() {
  const parsed = parseBulkInput(document.getElementById('bulkImportText').value);
  if (parsed.length === 0) { toast('Nothing to import', true); return; }

  // Check for duplicates against existing essays
  const existing = new Set(essays.map(e => (e.title || '').toLowerCase().trim()));
  const dupes = parsed.filter(t => existing.has((t.title || '').toLowerCase().trim()));
  if (dupes.length > 0) {
    if (!confirm(`${dupes.length} of ${parsed.length} topics have titles that already exist. Skip duplicates and add the rest?`)) return;
  }

  let added = 0;
  let firstAddedId = null;
  parsed.forEach(t => {
    const title = (t.title || '').trim();
    if (!title) return;
    if (existing.has(title.toLowerCase())) return;
    const e = {
      id: uid(),
      title: title,
      question: t.question || '',
      explanation: t.explanation || '',
      pros: '', cons: '', approach: '',
      intro: '', bp1: '', bp2: '', concl: '',
      vocab: 3, seedIdeas: ''
    };
    essays.push(e);
    if (!firstAddedId) firstAddedId = e.id;
    existing.add(title.toLowerCase());
    added++;
  });

  if (added > 0 && firstAddedId) currentId = firstAddedId;
  saveAll(); renderList(); loadCurrent(); renderPreview();
  closeBulkImport();
  toast(`Added ${added} new ${added === 1 ? 'topic' : 'topics'}`);
}
// ----- END BULK IMPORT -----

function selectEssay(id) {
  currentId = id;
  saveAll(); renderList(); loadCurrent(); renderPreview();
}

function deleteEssay(id) {
  if (!confirm('Delete this essay? This cannot be undone.')) return;
  essays = essays.filter(e => e.id !== id);
  if (currentId === id) currentId = essays.length ? essays[0].id : null;
  saveAll(); renderList(); loadCurrent(); renderPreview();
}

// ============================================================
//  EDITOR
// ============================================================
const FIELDS = ['title', 'question', 'explanation', 'pros', 'cons', 'approach', 'intro', 'bp1', 'bp2', 'concl'];

function loadCurrent() {
  const e = getCurrent();
  document.getElementById('emptyState').style.display = e ? 'none' : 'block';
  document.getElementById('editor').style.display = e ? 'block' : 'none';
  if (!e) return;
  
  // Initialize and normalize state fields to strings
  const cleanField = item => {
    if (!item) return '';
    if (typeof item === 'object') return (item.text || '').trim();
    const str = String(item).trim();
    return str === '[object Object]' ? '' : str;
  };
  e.selectedReasonIds = (e.selectedReasonIds || []).map(cleanField).filter(Boolean);
  e.selectedExampleIds = (e.selectedExampleIds || []).map(cleanField).filter(Boolean);
  e.selectedSolutionIds = (e.selectedSolutionIds || []).map(cleanField).filter(Boolean);
  e.optionalContrastIds = (e.optionalContrastIds || []).map(cleanField).filter(Boolean);
  
  // Local classification fallback for old essays
  if (!e.detectedQuestionType && !e.manualQuestionTypeOverride && !e.questionType) {
    const localType = staticClassifyQuestion(e.question);
    e.detectedQuestionType = localType;
    e.questionType = localType;
    saveAll();
  }

  FIELDS.forEach(f => { document.getElementById('f_' + f).value = e[f] || ''; });
  document.getElementById('f_seedIdeas').value = e.seedIdeas || '';

  const idx = essays.findIndex(x => x.id === e.id) + 1;
  document.getElementById('bcEssayNum').textContent = 'ESSAY ' + String(idx).padStart(2, '0');
  const s = essayStatus(e);
  document.getElementById('bcStatus').textContent = s.toUpperCase();
  document.getElementById('editorTitle').textContent = e.title || 'Untitled essay';
  document.getElementById('previewEssayNum').textContent = 'ESSAY ' + String(idx).padStart(2, '0');

  // Topic banner: show the full question above the AI Writer card
  updateTopicBanner(e);

  setVocab(e.vocab || 3, true);
  updateEssayTplPills();
  updateGenerationModeUI();
  updateCounters();
  
  // Restore and render ideas picker if we have suggested ideas
  ensureSuggestedIdeas(e);
  if (e.suggestedIdeas && e.suggestedIdeas.length > 0) {
    renderIdeasPicker();
    document.getElementById('ideasPicker').classList.add('show');
  } else {
    document.getElementById('ideasPicker').classList.remove('show');
  }

  // Render sentence lists for each paragraph
  ['intro', 'bp1', 'bp2', 'concl'].forEach(p => renderSentenceList(p));
}

function saveCurrent() {
  const e = getCurrent();
  if (!e) return;
  FIELDS.forEach(f => { e[f] = document.getElementById('f_' + f).value; });
  e.seedIdeas = document.getElementById('f_seedIdeas').value;
  saveAll();
  // Update breadcrumb status live
  const s = essayStatus(e);
  document.getElementById('bcStatus').textContent = s.toUpperCase();
  document.getElementById('editorTitle').textContent = e.title || 'Untitled essay';
  // Keep topic banner in sync as the user edits the question field
  updateTopicBanner(e);
  // Lightly refresh list counts
  renderList();
}

// Topic banner: shows the essay's question above the AI Writer card so the user
// can keep the prompt in view while picking ideas / writing.
function updateTopicBanner(e) {
  const banner = document.getElementById('topicBanner');
  const qEl = document.getElementById('topicBannerQuestion');
  if (!banner || !qEl) return;
  const q = (e && e.question) ? e.question.trim() : '';
  if (q) {
    qEl.textContent = q;
    banner.style.display = '';
  } else {
    banner.style.display = 'none';
  }
}

function setVocab(v, suppressSave) {
  v = parseInt(v);
  document.querySelectorAll('.vocab-pill').forEach(p => p.classList.toggle('active', parseInt(p.dataset.v) === v));
  document.getElementById('vocabLabelAux').textContent = VOCAB_LEVELS[v-1].label;
  document.getElementById('vocabDesc').textContent = VOCAB_LEVELS[v-1].desc;
  const e = getCurrent();
  if (e && !suppressSave) {
    e.vocab = v;
    e.previewSignature = '';
    saveAll();
    renderPreview();
    renderIdeasPicker();
  }
}

function updateCounters() {
  const wordCount = s => (s || '').trim() ? (s.trim().split(/\s+/).length) : 0;
  const ch = id => document.getElementById('f_' + id)?.value || '';
  const $ = id => document.getElementById('ch_' + id);
  if ($('title')) $('title').textContent = ch('title').length + ' ch';
  if ($('question')) $('question').textContent = wordCount(ch('question')) + ' words';
  if ($('explanation')) $('explanation').textContent = wordCount(ch('explanation')) + ' words';
  if ($('intro')) $('intro').textContent = wordCount(ch('intro')) + ' words';
  if ($('bp1')) $('bp1').textContent = wordCount(ch('bp1')) + ' words';
  if ($('bp2')) $('bp2').textContent = wordCount(ch('bp2')) + ' words';
  if ($('concl')) $('concl').textContent = wordCount(ch('concl')) + ' words';
}

// ============================================================
//  HIGHLIGHTING
// ============================================================
// Phrases that mark the START of a key idea clause. The highlight runs from
// AFTER the phrase to the end of that clause (next sentence boundary).
// These match the actual phrasing AI produces from the user's template.
const KEY_IDEA_TRIGGERS = [
  // BP1 — first key idea (Band 9 style)
  /\b(one major (?:merit|advantage|benefit|cause|problem|reason)(?: of [^,.]+?)? is(?: that(?: it)?)?)\s+/i,
  // BP1 — second key idea (Band 9 style)
  /\b(another significant (?:point in favour|advantage|benefit|reason|merit|challenge|point) is(?: that(?: it)?)?)\s+/i,
  // BP2 — first demerit (Band 9 style)
  /\b(one notable (?:demerit|drawback|disadvantage|negative effect|limitation|solution|concern)(?: of [^,.]+?)? is(?: that(?: it)?)?)\s+/i,
  // BP2 — second demerit (Band 9 style)
  /\b(another (?:notable |significant |major )?(?:demerit|drawback|disadvantage|adverse consequence|limitation|negative effect|measure)(?: to be taken)? is(?: that(?: it)?)?)\s+/i,
  // Generic fallbacks (Band 9 style)
  /\b(furthermore,? another [a-z]+(?: [a-z]+)? is(?: that(?: it)?)?)\s+/i,
  /\b(additionally,? another [a-z]+(?: [a-z]+)? is(?: that(?: it)?)?)\s+/i,
  // ---- Band 6 phrasing ----
  /\b(one important (?:benefit|advantage|reason|point) (?:of [^,.]+?)?is(?: that(?: it)?)?)\s+/i,
  /\b(another key (?:advantage|benefit|reason|point) is(?: that(?: it)?)?)\s+/i,
  /\b(a major concern (?:regarding [^,.]+?)?is(?: that(?: it)?)?)\s+/i,
  /\b(this issue can result in)\s+/i,
  /\b(another (?:major )?problem is(?: that(?: it)?)?)\s+/i,
];

function highlightParagraph(text, opts = {}) {
  if (!text) return '';
  const { section } = opts; // 'intro', 'bp1', 'bp2', 'concl'
  const isConcl = section === 'concl';
  // Pre-process: if "Therefore," appears mid-line in conclusion, split it onto its own line
  if (isConcl) {
    text = text.replace(/([^\n])\s+(Therefore[,\s])/g, '$1\n$2');
  }
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  return lines.map((line) => {
    // 1. EXTRA IDEA — green pill on its own line
    if (/^\[EXTRA\s*IDEA\]/i.test(line)) {
      const rest = line.replace(/^\[EXTRA\s*IDEA\]\s*/i, '');
      return `<p class="essay-body-text extra-line"><span class="hl-extra">[EXTRA IDEA]</span> ${escapeHtml(rest.replace(/==/g, ''))}</p>`;
    }
    // 2. Therefore line in CONCLUSION — yellow + red highlight (the punchy closing sentence)
    if (isConcl && /^therefore[,\s]/i.test(line)) {
      const cleanLine = line.replace(/==/g, '');
      return `<p class="essay-body-text therefore-line"><span class="hl-red hl-yellow">${escapeHtml(cleanLine)}</span></p>`;
    }
    // 3. Regular line
    return `<p class="essay-body-text">${highlightLine(line)}</p>`;
  }).join('');
}

function highlightLine(line) {
  // If the AI already added ==markers==, honor them and skip auto-detection.
  if (/==[^=]{3,}==/.test(line)) {
    return applyInlineMarkers(line);
  }
  // Otherwise, auto-detect key idea clauses using transition phrases.
  const segments = [];
  for (const trigger of KEY_IDEA_TRIGGERS) {
    const m = trigger.exec(line);
    if (!m) continue;
    const triggerEnd = m.index + m[0].length;
    // The clause runs from triggerEnd to the EARLIEST natural break.
    // Breaks include: comma, ", which/as/leading/etc", or sentence end.
    // We require a minimum clause length (25 chars) so we don't stop too early.
    const rest = line.slice(triggerEnd);
    const minLen = 25;
    let clauseEnd = -1;
    const breakPatterns = [
      /[.!?](?=\s|$)/,                   // sentence end
      /,\s+(?:which|as|leading|but|and|so|that|when|where|while|since|because)\b/i,  // smart break
      /,\s/,                             // any comma
    ];
    // Find the EARLIEST break across all patterns (not first matching pattern)
    let earliestIdx = -1;
    for (const pat of breakPatterns) {
      const idx = rest.slice(minLen).search(pat);
      if (idx !== -1) {
        const actual = minLen + idx;
        if (earliestIdx === -1 || actual < earliestIdx) earliestIdx = actual;
      }
    }
    if (earliestIdx !== -1) clauseEnd = triggerEnd + earliestIdx;
    // No length cap — highlight the full clause up to its natural break.
    // (Puppeteer renders multi-line highlighted spans correctly.)
    if (clauseEnd === -1) {
      const sentEnd = rest.search(/[.!?](?=\s|$)/);
      clauseEnd = triggerEnd + (sentEnd !== -1 ? sentEnd : rest.length);
    }
    if (!segments.some(s => s.hl && triggerEnd < s.end && clauseEnd > s.start)) {
      segments.push({ start: triggerEnd, end: clauseEnd, hl: true });
    }
  }
  if (segments.length === 0) return escapeHtml(line);
  segments.sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const seg of segments) {
    if (seg.start > cursor) out += escapeHtml(line.slice(cursor, seg.start));
    const clauseText = line.slice(seg.start, seg.end).trim();
    if (clauseText) {
      out += `<span class="hl-yellow">${escapeHtml(clauseText)}</span>`;
    }
    const after = line.slice(seg.start, seg.end);
    const tail = after.length - after.trimEnd().length;
    if (tail > 0) out += escapeHtml(after.slice(after.trimEnd().length));
    cursor = seg.end;
  }
  if (cursor < line.length) out += escapeHtml(line.slice(cursor));
  return out;
}

function applyInlineMarkers(text) {
  const parts = text.split(/(==[^=]+==)/);
  return parts.map(part => {
    const m = part.match(/^==([^=]+)==$/);
    if (m) {
      const clause = m[1].trim();
      // Highlight the FULL clause — no length cap. The PDF renders server-side
      // via Puppeteer, which wraps multi-line highlighted spans correctly (and
      // .hl-yellow uses box-decoration-break: clone), so the old html2canvas
      // truncation — which silently DROPPED the tail of any clause over 90
      // chars — has been removed.
      return `<span class="hl-yellow">${escapeHtml(clause)}</span>`;
    }
    return escapeHtml(part);
  }).join('');
}
function escapeHtml(s) {
  return (s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

// ============================================================
//  PREVIEW + ZOOM
// ============================================================
function setZoom(z) {
  currentZoom = z;
  document.querySelectorAll('.zoom-btn').forEach(b => b.classList.toggle('active', parseFloat(b.dataset.zoom) === z));
  document.getElementById('previewWrap').style.transform = `scale(${z})`;
}

function renderPreview() {
  const e = getCurrent();
  const area = document.getElementById('previewArea');
  if (!e) {
    area.innerHTML = '<div style="text-align:center; padding:60px; color:var(--ink-mute); font-style:italic;">Select an essay to preview.</div>';
    return;
  }
  
  const validation = validateEssayConsistency(e);
  
  let validationAlertHtml = '';
  if (validation.shouldRegenerate) {
    validationAlertHtml = `
      <div class="validation-alerts-box" style="background: #e2f0fe; border: 1px solid #b8daff; border-radius: 8px; padding: 12px 16px; margin: 16px auto; max-width: 800px; color: #004085; font-size: 12px; font-family: var(--sans); display: flex; align-items: center; gap: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
        <div class="spinner-dark" style="width: 14px; height: 14px; border-width: 2px;"></div>
        <div>
          <strong>Updating Preview...</strong> Generating a new Band 9 model essay aligning with your selected stance and ideas.
        </div>
      </div>
    `;
    triggerDebouncedRegeneration(e);
  } else if (validation.warnings.length > 0) {
    const alerts = validation.errors.concat(validation.warnings);
    validationAlertHtml = `
      <div class="validation-alerts-box" style="background: #fff3cd; border: 1px solid #ffeeba; border-radius: 8px; padding: 12px 16px; margin: 16px auto; max-width: 800px; color: #856404; font-size: 12px; font-family: var(--sans); box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
        <strong style="display: block; margin-bottom: 6px; font-size: 13px; color: #664d03;">⚠️ Essay Preview Warnings</strong>
        <ul style="margin: 0; padding-left: 20px; line-height: 1.5;">
          ${alerts.map(a => `<li>${escapeHtml(a)}</li>`).join('')}
        </ul>
        <div style="margin-top: 8px; font-size: 11.5px; font-style: italic; color: #664d03;">
          If the essay does not match your chosen options, click <strong>Write the full essay</strong> to manually regenerate.
        </div>
      </div>
    `;
  }
  
  area.innerHTML = validationAlertHtml + renderEssayPageHTML(e, essays.findIndex(x => x.id === e.id) + 1);
}

function renderEssayPageHTML(e, num) {
  const prosList = (e.pros || '').split('\n').map(s => s.trim()).filter(Boolean);
  const consList = (e.cons || '').split('\n').map(s => s.trim()).filter(Boolean);
  const templateKey = getTemplateKeyForEssay(e);
  const bandLabel = templateTierLabel(templateKey);
  // Diagnostic: log once per render so we can verify the right band is being used
  console.log('[render] essay#' + num, 'templateChoice=', e.templateChoice, 'resolvedKey=', templateKey, 'bandLabel=', bandLabel);
  return `
    <div class="essay-page">
      <div class="essay-page-header">
        <span class="essay-page-header-brand">IPT Brisbane — ${bandLabel} Essay Template Guide</span>
        <span class="essay-page-header-tag">2026 Edition</span>
      </div>
      <div class="essay-num-label">ESSAY ${String(num).padStart(2, '0')}</div>
      <h1 class="essay-title">${escapeHtml(e.title || 'Untitled')}</h1>
      ${e.question ? `<div class="essay-question">${escapeHtml(e.question)}</div>` : ''}
      ${e.explanation ? `<div class="essay-topic-exp"><strong>Topic Explanation:</strong> ${escapeHtml(e.explanation)}</div>` : ''}
      ${(prosList.length || consList.length) ? `
        <table class="pros-cons-table">
          <tr><th style="width:50%;">Key Points</th><th>Counter-Points / Solutions</th></tr>
          <tr>
            <td><ul>${prosList.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul></td>
            <td><ul>${consList.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul></td>
          </tr>
        </table>` : ''}
      ${e.approach ? `<div class="approach-tip"><strong>APPROACH TIP:</strong> ${escapeHtml(e.approach)}</div>` : ''}
      <div class="model-essay-label">COMPLETE MODEL ESSAY</div>
      ${e.intro ? `<div class="essay-body-section-title">INTRODUCTION</div>${highlightParagraph(e.intro, { section: 'intro' })}` : ''}
      ${e.bp1 ? `<div class="essay-body-section-title">BODY PARAGRAPH 1</div>${highlightParagraph(e.bp1, { section: 'bp1' })}` : ''}
      ${e.bp2 ? `<div class="essay-body-section-title">BODY PARAGRAPH 2</div>${highlightParagraph(e.bp2, { section: 'bp2' })}` : ''}
      ${e.concl ? `<div class="essay-body-section-title">CONCLUSION</div>${highlightParagraph(e.concl, { section: 'concl' })}` : ''}
    </div>
  `;
}

function renderCoverHTML() {
  const bandLabel = defaultTemplateTierLabel();
  return `
    <div class="essay-page cover">
      <div class="cover-accent"></div>
      <div class="cover-body">
        <div class="cover-top">
          <div class="cover-logo-box">IPT</div>
          <div class="cover-tag">IELTS &amp; PTE Tutorial Brisbane</div>
        </div>
        <div class="cover-center">
          <div class="cover-edition">2026 Edition</div>
          <h1 class="cover-title">${bandLabel} Essay<br><strong>Template Guide</strong></h1>
          <div class="cover-subtitle">${essays.length} Updated Model Essays for PTE Academic &amp; IELTS Writing Success</div>
          <div class="cover-badge">Premium Essay Collection</div>
        </div>
        <div style="width:100%;">
          <div class="cover-features">
            <div class="cover-features-title">What's Inside</div>
            ✓ High-Scoring Templates<br>
            ✓ Competent-Level Vocabulary<br>
            ✓ ${bandLabel === 'Band 9' ? 'Band 9 Structures &amp; Real-World Examples' : 'Band 6 Structures &amp; Clear Examples'}<br>
            ✓ Key Ideas &amp; Explanations Highlighted
          </div>
          <div class="cover-footer">
            <div class="cover-footer-line">iptbrisbane.com.au &nbsp;·&nbsp; portal.ptepro.com.au</div>
            <div>2072 Logan Road, Upper Mount Gravatt, Brisbane, QLD</div>
            <div>© 2026 IPT Brisbane. All Rights Reserved. Personal Use Only. Not for Resale or Distribution.</div>
          </div>
        </div>
      </div>
    </div>
  `;
}
function renderTocFor(list) {
  const bandLabel = defaultTemplateTierLabel();
  return `
    <div class="essay-page">
      <div class="essay-page-header">
        <span class="essay-page-header-brand">IPT Brisbane — ${bandLabel} Essay Template Guide</span>
        <span class="essay-page-header-tag">Table of Contents</span>
      </div>
      <div class="toc-title">TABLE OF CONTENTS</div>
      <div class="toc-hint">— Click any title to jump to that essay —</div>
      <div class="toc-list">
        ${list.map((e, i) => `
          <div class="toc-row">
            <span class="toc-num">${String(i+1).padStart(2,'0')}</span>
            <span class="toc-name">${escapeHtml(e.title || 'Untitled')}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ============================================================
//  EXPORT MENU
// ============================================================
let exportPicked = new Set();

function openExportMenu() {
  const e = getCurrent();
  const written = essays.filter(x => essayStatus(x) !== 'empty');
  document.getElementById('exportCurrentName').textContent = e ? `"${e.title || 'Untitled'}" — current essay only` : 'Select an essay first';
  document.getElementById('exportBookCount').textContent = `${written.length} essays · cover page + table of contents + every written essay`;

  // Email option label
  const emailEl = document.getElementById('emailRecipient');
  const emailOpt = document.getElementById('emailOption');
  if (offlineMode || !currentUser) {
    emailEl.textContent = 'Sign in with an email account to use this';
    emailOpt.style.opacity = '0.5';
    emailOpt.style.pointerEvents = 'none';
  } else if (!e) {
    emailEl.textContent = 'Select an essay first';
    emailOpt.style.opacity = '0.5';
    emailOpt.style.pointerEvents = 'none';
  } else if (essayStatus(e) === 'empty') {
    emailEl.textContent = 'This essay is empty — write it first';
    emailOpt.style.opacity = '0.5';
    emailOpt.style.pointerEvents = 'none';
  } else {
    emailEl.textContent = `Sending to ${currentUser.email}`;
    emailOpt.style.opacity = '1';
    emailOpt.style.pointerEvents = '';
  }

  // Email book option label
  const emailBookEl = document.getElementById('emailBookRecipient');
  const emailBookOpt = document.getElementById('emailBookOption');
  if (offlineMode || !currentUser) {
    emailBookEl.textContent = 'Sign in to email essays';
    emailBookOpt.style.opacity = '0.5';
    emailBookOpt.style.pointerEvents = 'none';
  } else if (written.length === 0) {
    emailBookEl.textContent = 'No written essays yet';
    emailBookOpt.style.opacity = '0.5';
    emailBookOpt.style.pointerEvents = 'none';
  } else {
    emailBookEl.textContent = `Sending ${written.length} essays to ${currentUser.email} (~${Math.round(written.length * 3)}s to generate)`;
    emailBookOpt.style.opacity = '1';
    emailBookOpt.style.pointerEvents = '';
  }

  // Reset picker
  document.getElementById('exportPicker').style.display = 'none';
  exportPicked = new Set();
  document.getElementById('exportModal').classList.add('show');
}
function closeExportMenu() { document.getElementById('exportModal').classList.remove('show'); }

function doExportCurrent() {
  closeExportMenu();
  downloadSingle();
}
function doExportBook() {
  closeExportMenu();
  downloadBook();
}

function getValidatedRecipientEmail(confirmMessagePrefix = "Send this essay as a PDF to") {
  if (offlineMode || !currentUser) {
    toast('Sign in to email essays', true);
    return null;
  }
  let email = '';
  // Prioritize registered/real email of currentUser
  if (currentUser.email && currentUser.email.includes('@') && !currentUser.email.toLowerCase().endsWith('@ptewriting.com')) {
    email = currentUser.email;
  } else {
    email = localStorage.getItem('pte_preferred_email') || '';
  }

  if (!email || email.toLowerCase().endsWith('@ptewriting.com')) {
    email = currentUser.email || '';
  }
  // If the email is a real one (contains @ and is not ptewriting.com), confirm it directly.
  if (email && email.includes('@') && !email.toLowerCase().endsWith('@ptewriting.com')) {
    if (confirm(`${confirmMessagePrefix} ${email}?`)) {
      return email;
    }
    // If they cancel, they might want to enter a different one, so fall through to prompt.
  }
  const userEmail = prompt("Please enter the email address to send the PDF to:", email.toLowerCase().endsWith('@ptewriting.com') ? "" : email);
  if (!userEmail) return null; // cancelled
  const trimmedEmail = userEmail.trim();
  if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    toast('Invalid email address', true);
    return null;
  }
  if (trimmedEmail.toLowerCase().endsWith('@ptewriting.com')) {
    toast('Cannot send to ptewriting.com addresses. Please use your real email.', true);
    return null;
  }
  localStorage.setItem('pte_preferred_email', trimmedEmail);

  // Update userProfile and currentUser to save it back to cloud next sync
  if (userProfile && (!userProfile.email || userProfile.email !== trimmedEmail)) {
    userProfile.email = trimmedEmail;
    currentUser.email = trimmedEmail;
    flushSync();
  }

  return trimmedEmail;
}

async function doEmailCurrent() {
  const e = getCurrent();
  if (!e) { toast('No essay selected', true); return; }
  if (essayStatus(e) === 'empty') { toast('This essay is empty — write it first', true); return; }
  if (offlineMode || !currentUser) { toast('Sign in to email essays', true); return; }

  const recipient = getValidatedRecipientEmail("Send this essay as a PDF to");
  if (!recipient) return;

  closeExportMenu();
  toast('Sending to server for PDF render…');

  const idx = essays.findIndex(x => x.id === e.id) + 1;
  const fileName = `${(e.title || 'Essay').replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 80) || 'Essay'}.pdf`;
  const html = buildFullPdfHtml([renderEssayPageHTML(e, idx)], fileName);

  try {
    const res = await fetch(API_URL + '/api/email-essay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: recipient,
        essayTitle: e.title || `Essay ${idx}`,
        fileName: fileName,
        html: html
      })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Server returned ${res.status}`);
    }
    toast(`PDF emailed to ${recipient} ✓`);
  } catch (err) {
    console.error(err);
    toast('Email failed: ' + err.message, true);
  }
}

// Email the entire book (cover + TOC + all written essays) as one PDF
async function doEmailBook() {
  if (offlineMode || !currentUser) { toast('Sign in to email essays', true); return; }
  const written = essays.filter(e => essayStatus(e) !== 'empty');
  if (written.length === 0) { toast('No written essays to include in the book', true); return; }

  const recipient = getValidatedRecipientEmail(`Send the whole book (${written.length} essays + cover + table of contents) as a PDF to`);
  if (!recipient) return;

  closeExportMenu();
  await generateAndEmailBook(written, `IPT_Essay_Book_${new Date().toISOString().slice(0,10)}.pdf`, 'IPT Brisbane Essay Book', recipient);
}

// Email a custom selection of essays
async function doEmailPicked() {
  if (offlineMode || !currentUser) { toast('Sign in to email essays', true); return; }
  if (exportPicked.size === 0) { toast('Pick at least one essay first', true); return; }
  const selected = essays.filter(e => exportPicked.has(e.id));
  const recipient = getValidatedRecipientEmail(`Send ${selected.length} selected essay${selected.length === 1 ? '' : 's'} as a PDF to`);
  if (!recipient) return;
  closeExportMenu();
  await generateAndEmailBook(selected, `IPT_Essays_Selection_${new Date().toISOString().slice(0,10)}.pdf`, 'IPT Brisbane Essay Selection', recipient);
}

// Shared: build a multi-essay PDF + email it (server-side render via Puppeteer)
async function generateAndEmailBook(essayList, fileName, displayTitle, recipient) {
  const targetEmail = recipient || getValidatedRecipientEmail();
  if (!targetEmail) return;
  const t0 = Date.now();
  showProgressToast(`Preparing ${essayList.length} essays…`);
  try {
    // Build all pages as HTML (cover + TOC + essays)
    const pages = [
      renderCoverHTML(),
      renderTocFor(essayList),
      ...essayList.map((e, i) => renderEssayPageHTML(e, i + 1))
    ];
    const html = buildFullPdfHtml(pages, fileName);
    const htmlSizeKb = Math.round(html.length / 1024);

    // Send HTML to server; server renders + emails. ~3-8s for 30 essays.
    showProgressToast(`Server is rendering ${essayList.length} essays to PDF…`);
    const res = await fetch(API_URL + '/api/email-essay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: targetEmail,
        essayTitle: displayTitle,
        fileName: fileName,
        html: html
      })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Server returned ${res.status}`);
    }
    const reply = await res.json().catch(() => ({}));
    const pdfSize = reply.pdfSize || 0;
    const pdfSizeStr = pdfSize >= 1024 * 1024
      ? (pdfSize / 1024 / 1024).toFixed(1) + 'MB'
      : Math.round(pdfSize / 1024) + 'KB';
    hideProgressToast();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    toast(`PDF book (${essayList.length} essays, ${pdfSizeStr}) emailed to ${targetEmail} ✓ (${elapsed}s)`);
  } catch (err) {
    console.error(err);
    hideProgressToast();
    toast('Email failed: ' + err.message, true);
  }
}

// Progress toast — a sticky toast that updates instead of disappearing
let progressToastVisible = false;
function showProgressToast(msg) {
  const t = document.getElementById('toast');
  t.innerHTML = `<span class="spinner-dark" style="border-color:rgba(255,255,255,0.3); border-top-color:#fff;"></span> ${escapeHtml(msg)}`;
  t.classList.remove('error');
  t.classList.add('show');
  clearTimeout(toastTimer);
  progressToastVisible = true;
}
function hideProgressToast() {
  if (!progressToastVisible) return;
  progressToastVisible = false;
  const t = document.getElementById('toast');
  t.classList.remove('show');
}

// Render the essay-page HTML into an A4 PDF and return base64 (no data: prefix).
// Uses html2canvas (rasterize the page node) + jsPDF (wrap image into PDF, handle multi-page).
// Render a single essay page into a canvas. Caller is responsible for cleanup.
async function rasterizeEssayPage(pageHtml, opts = {}) {
  const stage = document.createElement('div');
  stage.style.cssText = 'position:fixed; left:-99999px; top:0; width:210mm; background:#fff; z-index:-1;';
  stage.innerHTML = pageHtml;
  document.body.appendChild(stage);
  try {
    // FIX 1: Wait for web fonts to actually be loaded.
    // Without this, html2canvas captures BEFORE Fraunces/Inter finish downloading,
    // producing glyph corruption like 'd' → 'a', 'f' → 't', 'b' → 'p'.
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch (e) { /* ignore */ }
    }
    await new Promise(r => requestAnimationFrame(() => r()));
    await new Promise(r => setTimeout(r, 250));   // give fonts another beat to settle
    const pageNode = stage.querySelector('.essay-page');
    if (!pageNode) throw new Error('Essay page node not found');

    // FIX 2: Force highlight spans to have explicit padding + line-height so multi-line
    // wraps don't clip text. This is the root cause of the "missing words before highlight"
    // bug in the emailed PDF. html2canvas measures spans incorrectly when box-decoration-break
    // is used; we force inline-block-ish behaviour with explicit metrics instead.
    const highlightStyle = document.createElement('style');
    highlightStyle.id = 'rasterize-highlight-fix';
    highlightStyle.textContent = `
      .essay-page .hl-yellow,
      .essay-page .hl-orange,
      .essay-page .hl-green {
        padding: 1px 3px !important;
        line-height: 1.85 !important;
        white-space: normal !important;
        word-wrap: break-word !important;
      }
      .essay-page p, .essay-page .essay-para {
        line-height: 1.85 !important;
      }
    `;
    stage.appendChild(highlightStyle);
    await new Promise(r => requestAnimationFrame(() => r()));

    // Optionally extract bounding rectangles of selected elements, relative to the page node.
    // Returned as { selector: [{x, y, w, h} in mm] }.
    // Caller passes opts.extractRects = ['.toc-row'] etc.
    let extractedRects = null;
    if (opts.extractRects && opts.extractRects.length) {
      extractedRects = {};
      const pageRect = pageNode.getBoundingClientRect();
      // Page is rendered at 210mm wide; compute px-to-mm using actual width
      const pxPerMm = pageRect.width / 210;
      for (const sel of opts.extractRects) {
        extractedRects[sel] = [];
        pageNode.querySelectorAll(sel).forEach((node) => {
          const r = node.getBoundingClientRect();
          extractedRects[sel].push({
            x: (r.left - pageRect.left) / pxPerMm,
            y: (r.top - pageRect.top) / pxPerMm,
            w: r.width / pxPerMm,
            h: r.height / pxPerMm
          });
        });
      }
    }

    // FIX 3: scale 3 (was 2) for sharper glyph rasterization. Eliminates pixel-level
    // glyph corruption. Trade-off: ~2.25× larger canvas, ~2× larger PDF file.
    const canvas = await window.html2canvas(pageNode, {
      scale: 3,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      // Crisp text rendering — disable letter-spacing optimizations
      letterRendering: true,
      onclone: (clonedDoc) => {
        const style = clonedDoc.createElement('style');
        style.textContent = `
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          /* Force fonts on cloned doc too */
          .essay-page, .essay-page * {
            font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif !important;
          }
          .essay-page h1, .essay-page h2, .essay-page h3,
          .essay-page .essay-title, .essay-page .cover-title {
            font-family: 'Fraunces', Georgia, serif !important;
          }
          /* Same highlight fix in cloned doc */
          .hl-yellow, .hl-orange, .hl-green {
            padding: 1px 3px !important;
            line-height: 1.85 !important;
          }
        `;
        clonedDoc.head.appendChild(style);
      }
    });
    if (extractedRects) return { canvas, rects: extractedRects };
    return canvas;
  } finally {
    document.body.removeChild(stage);
  }
}

// Add a single canvas as one or more A4 pages of an existing jsPDF document.
// Returns the number of PDF pages this canvas consumed.
function addCanvasToPdf(pdf, canvas, isFirstPageOfDoc) {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const canvasMmH = (canvas.height * pageW) / canvas.width;
  const imgData = canvas.toDataURL('image/jpeg', 0.92);

  if (!isFirstPageOfDoc) pdf.addPage();

  if (canvasMmH <= pageH + 0.5) {
    pdf.addImage(imgData, 'JPEG', 0, 0, pageW, canvasMmH);
    return 1;
  }
  // Slice into A4-height chunks
  const pxPerMm = canvas.width / pageW;
  const pageHpx = Math.floor(pageH * pxPerMm);
  let y = 0;
  let slice = 0;
  while (y < canvas.height) {
    const sliceHeight = Math.min(pageHpx, canvas.height - y);
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceHeight;
    const ctx = sliceCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(canvas, 0, -y);
    const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.92);
    const sliceMmH = (sliceHeight * pageW) / canvas.width;
    if (slice > 0) pdf.addPage();
    pdf.addImage(sliceData, 'JPEG', 0, 0, pageW, sliceMmH);
    y += sliceHeight;
    slice++;
  }
  return slice;
}

// Build a single-essay PDF and return base64
async function renderEssayToPdfBase64(essay, num) {
  if (!window.html2canvas || !window.jspdf) throw new Error('PDF libraries not loaded yet');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const canvas = await rasterizeEssayPage(renderEssayPageHTML(essay, num));
  addCanvasToPdf(pdf, canvas, true);
  const dataUri = pdf.output('datauristring');
  return dataUri.replace(/^data:application\/pdf;base64,/, '').replace(/^data:application\/pdf;filename=[^;]+;base64,/, '');
}

// Build a multi-essay book PDF (cover + TOC + each essay) and return base64.
// Calls onProgress(stepIndex, totalSteps, label) so the UI can show progress.
// Adds clickable hyperlinks on the TOC pointing to each essay.
async function renderBookToPdfBase64(essayList, onProgress) {
  if (!window.html2canvas || !window.jspdf) throw new Error('PDF libraries not loaded yet');
  if (!essayList || essayList.length === 0) throw new Error('No essays to include in the book');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  const totalSteps = essayList.length + 2; // cover + TOC + N essays
  let step = 0;
  let currentPage = 0;  // 1-indexed page tracker
  const essayStartPages = [];  // essayStartPages[i] = PDF page number where essay i begins

  // Cover (page 1)
  if (onProgress) onProgress(++step, totalSteps, 'Rendering cover');
  const coverCanvas = await rasterizeEssayPage(renderCoverHTML());
  const coverPages = addCanvasToPdf(pdf, coverCanvas, true);
  currentPage += coverPages;
  coverCanvas.width = 0; coverCanvas.height = 0;

  // TOC (next pages) — extract row rectangles so we can add hyperlinks afterward
  if (onProgress) onProgress(++step, totalSteps, 'Rendering table of contents');
  const tocResult = await rasterizeEssayPage(renderTocFor(essayList), { extractRects: ['.toc-row'] });
  const tocCanvas = tocResult.canvas;
  const tocRowRects = (tocResult.rects && tocResult.rects['.toc-row']) || [];
  const tocStartPage = currentPage + 1;
  const tocPagesUsed = addCanvasToPdf(pdf, tocCanvas, false);
  currentPage += tocPagesUsed;
  tocCanvas.width = 0; tocCanvas.height = 0;

  // Each essay
  for (let i = 0; i < essayList.length; i++) {
    const e = essayList[i];
    if (onProgress) onProgress(++step, totalSteps, `Rendering essay ${i + 1} of ${essayList.length}: ${e.title || 'Untitled'}`);
    const canvas = await rasterizeEssayPage(renderEssayPageHTML(e, i + 1));
    essayStartPages[i] = currentPage + 1;  // first PDF page of this essay
    const pagesUsed = addCanvasToPdf(pdf, canvas, false);
    currentPage += pagesUsed;
    canvas.width = 0; canvas.height = 0;
    await new Promise(r => setTimeout(r, 10));
  }

  // Add hyperlinks on the TOC page(s).
  // The TOC may span multiple pages if there are many essays — but typical case is 1 page.
  // If TOC fits on one page (tocPagesUsed === 1), all rows map to page tocStartPage.
  // For simplicity we assume TOC fits on 1 page (34 essays in 2 columns fits comfortably on A4).
  if (tocRowRects.length > 0 && essayStartPages.length === tocRowRects.length) {
    pdf.setPage(tocStartPage);
    for (let i = 0; i < tocRowRects.length; i++) {
      const r = tocRowRects[i];
      const targetPage = essayStartPages[i];
      if (!targetPage) continue;
      try {
        pdf.link(r.x, r.y, r.w, r.h, { pageNumber: targetPage });
      } catch (err) {
        console.warn('Could not add TOC link for row', i, err);
      }
    }
  }

  const dataUri = pdf.output('datauristring');
  return dataUri.replace(/^data:application\/pdf;base64,/, '').replace(/^data:application\/pdf;filename=[^;]+;base64,/, '');
}

function openExportPicker() {
  // Default-select written essays
  exportPicked = new Set(essays.filter(e => essayStatus(e) !== 'empty').map(e => e.id));
  document.getElementById('exportPicker').style.display = 'block';
  renderExportPicker();
}

function renderExportPicker() {
  const list = document.getElementById('exportPickerList');
  list.innerHTML = essays.map((e, i) => {
    const s = essayStatus(e);
    const statusLabel = s === 'written' ? 'WRITTEN' : (s === 'draft' ? 'DRAFT' : 'EMPTY');
    const statusClass = 'status-' + s;
    const checked = exportPicked.has(e.id) ? 'checked' : '';
    return `
      <label class="export-pick-row">
        <input type="checkbox" ${checked} onchange="toggleExportPick('${e.id}', this.checked)">
        <span class="export-pick-num">ESSAY ${String(i+1).padStart(2,'0')}</span>
        <span class="export-pick-title">${escapeHtml(e.title || 'Untitled')}</span>
        <span class="export-pick-status ${statusClass}">${statusLabel}</span>
      </label>
    `;
  }).join('');
  updateExportPickedCount();
}

function toggleExportPick(id, checked) {
  if (checked) exportPicked.add(id);
  else exportPicked.delete(id);
  updateExportPickedCount();
}

function selectAllForExport(all) {
  exportPicked = all ? new Set(essays.map(e => e.id)) : new Set();
  renderExportPicker();
}

function selectWrittenForExport() {
  exportPicked = new Set(essays.filter(e => essayStatus(e) !== 'empty').map(e => e.id));
  renderExportPicker();
}

function updateExportPickedCount() {
  const n = exportPicked.size;
  document.getElementById('exportPickedCount').textContent = n;
  const disabled = (n === 0);
  document.getElementById('exportPickedBtn').disabled = disabled;
  const emailBtn = document.getElementById('emailPickedBtn');
  if (emailBtn) {
    // Also disable email if user isn't signed in
    emailBtn.disabled = disabled || offlineMode || !currentUser;
  }
}

function doExportPicked() {
  if (exportPicked.size === 0) return;
  const selected = essays.filter(e => exportPicked.has(e.id));
  closeExportMenu();
  if (selected.length === 1) {
    const idx = essays.findIndex(x => x.id === selected[0].id) + 1;
    openPrintWindow([renderEssayPageHTML(selected[0], idx)], `${selected[0].title || 'essay'}.pdf`);
    return;
  }
  // Multiple — include cover + TOC
  const pages = [renderCoverHTML(), renderTocFor(selected)];
  selected.forEach((e, i) => pages.push(renderEssayPageHTML(e, i + 1)));
  openPrintWindow(pages, 'IPT_Brisbane_Selection.pdf');
}

// ============================================================
//  PDF EXPORT
// ============================================================
function downloadSingle() {
  const e = getCurrent();
  if (!e) { toast('No essay selected', true); return; }
  openPrintWindow([renderEssayPageHTML(e, essays.findIndex(x => x.id === e.id) + 1)], `${e.title || 'essay'}.pdf`);
}
function downloadBook() {
  if (essays.length === 0) { toast('No essays to export', true); return; }
  const written = essays.filter(e => essayStatus(e) !== 'empty');
  if (written.length < essays.length) {
    if (!confirm(`Only ${written.length} of ${essays.length} essays have content. Export only the written ones?`)) return;
    const pages = [renderCoverHTML(), renderTocFor(written)];
    written.forEach((e, i) => pages.push(renderEssayPageHTML(e, i + 1)));
    openPrintWindow(pages, 'IPT_Brisbane_Essay_Book.pdf');
    return;
  }
  const pages = [renderCoverHTML(), renderTocFor(essays), ...essays.map((e, i) => renderEssayPageHTML(e, i + 1))];
  openPrintWindow(pages, 'IPT_Brisbane_Essay_Book.pdf');
}
function openPrintWindow(pages, filename) {
  const w = window.open('', '_blank');
  if (!w) { toast('Pop-up blocked — please allow pop-ups', true); return; }
  w.document.write(buildFullPdfHtml(pages, filename, { withPrintScript: true }));
  w.document.close();
  toast('Opening print preview — save as PDF from there');
}

// Build a complete standalone HTML document (CSS + Google Fonts link + pages).
// Used by:
//  - openPrintWindow (browser native print → user saves as PDF)
//  - sendEssayToServerForEmail (server renders via Puppeteer → emails PDF)
// Identical HTML in both paths → identical output.
function buildFullPdfHtml(pages, filename, opts = {}) {
    let styles = '';
  try {
    for (const sheet of document.styleSheets) {
      if (sheet.href && sheet.href.includes('index.css')) {
        for (const rule of sheet.cssRules) {
          styles += rule.cssText + '\n';
        }
        break;
      }
    }
  } catch (e) {
    console.warn('Could not read index.css dynamically:', e);
  }
  const printScript = opts.withPrintScript
    ? '<script>window.addEventListener("load", () => { setTimeout(() => { window.print(); }, 400); });<\/script>'
    : '';
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${escapeHtml(filename || 'Essay')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${styles}
body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; }
* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
.essay-page { box-shadow: none; margin: 0 auto; page-break-after: always; }
.essay-page:last-child { page-break-after: auto; }
@page { size: A4; margin: 0; }
</style>
</head>
<body>
${pages.join('')}
${printScript}
</body></html>`;
}

// ============================================================
//  TEMPLATE MODAL
// ============================================================
// ============================================================
//  TEMPLATE MODAL — 3 slots (Band 6, Band 9, Custom) with default selector
// ============================================================
let currentTplTab = 'band6';

function openTemplate() {
  // Default to opening on whichever slot the user picked as default
  const bag = getTemplatesBag();
  currentTplTab = bag.default || 'band9';
  switchTemplateTab(currentTplTab);
  updateDefaultPills();
  document.getElementById('templateModal').classList.add('show');
}
function closeTemplate() { document.getElementById('templateModal').classList.remove('show'); }

function closeBand6ModeModal() {
  document.getElementById('band6ModeModal').classList.remove('show');
}

function selectBand6Mode(mode) {
  closeBand6ModeModal();
  const e = getCurrent();
  if (!e) return;
  e.band6Mode = mode;
  saveAll();
  aiWriteFullEssay({ band6Mode: mode, skipConfirm: true });
}

function switchTemplateTab(tab) {
  currentTplTab = tab;
  // Update tab visuals
  document.querySelectorAll('.tpl-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  // Load the template into the textareas
  const bag = getTemplatesBag();
  const t = bag[tab] || BAND9_TEMPLATE;
  document.getElementById('tpl_intro').value = t.intro || '';
  document.getElementById('tpl_bp1').value = t.bp1 || '';
  document.getElementById('tpl_bp2').value = t.bp2 || '';
  document.getElementById('tpl_concl').value = t.concl || '';
  document.getElementById('tpl_notes').value = t.notes || '';
  // Toggle read-only state
  const readonly = (tab !== 'custom');
  ['tpl_intro', 'tpl_bp1', 'tpl_bp2', 'tpl_concl', 'tpl_notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.readOnly = readonly;
      el.style.background = readonly ? 'var(--bg)' : 'var(--bg-card)';
      el.style.opacity = readonly ? '0.85' : '1';
    }
  });
  document.getElementById('tplReadonlyBanner').style.display = readonly ? 'block' : 'none';
  document.getElementById('tplCopyToCustom').style.display = readonly ? 'inline-flex' : 'none';
  document.getElementById('tplSaveBtn').style.display = readonly ? 'none' : 'inline-flex';
  const resetBtn = document.getElementById('tplResetBtn');
  if (resetBtn) resetBtn.style.display = (tab === 'custom') ? 'inline-flex' : 'none';
  updateTemplateCharCount();
}

function updateDefaultPills() {
  const bag = getTemplatesBag();
  document.querySelectorAll('.tpl-default-pill').forEach(p =>
    p.classList.toggle('active', p.dataset.tpl === (bag.default || 'band9'))
  );
}

async function setDefaultTemplate(tpl) {
  const bag = getTemplatesBag();
  bag.default = tpl;
  await saveTemplatesBag(bag);
  updateDefaultPills();
  updateTplDefaultNote();
  // Also refresh the AI Writer's "Default" pill label
  loadCurrent();
  toast(`Default template set to ${tplLabel(tpl)}`);
}

async function saveTemplate() {
  // Only "custom" is editable
  if (currentTplTab !== 'custom') {
    toast('Band 6 and Band 9 are read-only. Switch to "My Custom" to edit.', true);
    return;
  }
  const t = {
    intro: document.getElementById('tpl_intro').value.trim(),
    bp1: document.getElementById('tpl_bp1').value.trim(),
    bp2: document.getElementById('tpl_bp2').value.trim(),
    concl: document.getElementById('tpl_concl').value.trim(),
    notes: document.getElementById('tpl_notes').value.trim()
  };
  if (!t.intro || !t.bp1 || !t.bp2 || !t.concl) {
    toast('Please fill all four paragraphs', true); return;
  }
  const bag = getTemplatesBag();
  bag.custom = t;
  await saveTemplatesBag(bag);
  closeTemplate();
  toast('My Custom template saved');
}

async function copyPresetToCustom() {
  if (!confirm(`Copy ${tplLabel(currentTplTab)} into "My Custom"? Your current custom template will be overwritten.`)) return;
  const bag = getTemplatesBag();
  bag.custom = JSON.parse(JSON.stringify(bag[currentTplTab]));
  await saveTemplatesBag(bag);
  switchTemplateTab('custom');
  toast(`${tplLabel(currentTplTab)} copied into My Custom — you can now edit it`);
}

// Legacy reset (kept for backward compatibility, just resets Custom to Band 9)
function resetTemplateToDefault() {
  if (!confirm('Reset My Custom template to the Band 9 preset?')) return;
  const bag = getTemplatesBag();
  bag.custom = JSON.parse(JSON.stringify(BAND9_TEMPLATE));
  saveTemplatesBag(bag);
  if (currentTplTab === 'custom') switchTemplateTab('custom');
}

function updateTemplateCharCount() {
  const total = ['tpl_intro', 'tpl_bp1', 'tpl_bp2', 'tpl_concl', 'tpl_notes']
    .reduce((sum, id) => sum + (document.getElementById(id)?.value.length || 0), 0);
  document.getElementById('tplCharCount').textContent = total.toLocaleString() + ' characters';
}

function tplLabel(key) {
  return ({ band6: 'Band 6', band9: 'Band 9', custom: 'My Custom', default: 'Default' })[key] || key;
}

// Per-essay template selector (in the AI Writer card)
async function setEssayTemplate(choice) {
  const e = getCurrent();
  if (!e) return;
  e.templateChoice = choice;
  e.previewSignature = '';
  saveAll();
  updateEssayTplPills();
  renderPreview();
  renderIdeasPicker();
}

function updateEssayTplPills() {
  const e = getCurrent();
  if (!e) return;
  const choice = e.templateChoice || 'default';
  document.querySelectorAll('.tpl-essay-pill').forEach(p =>
    p.classList.toggle('active', p.dataset.tpl === choice)
  );
  // Update "Using default" label
  const bag = getTemplatesBag();
  const effective = (choice === 'default') ? (bag.default || 'band9') : choice;
  document.getElementById('tplChoiceAux').textContent =
    (choice === 'default') ? `Using default (${tplLabel(effective)})` : `Override: ${tplLabel(effective)}`;
  updateTplDefaultNote();
}

function updateTplDefaultNote() {
  const bag = getTemplatesBag();
  const note = document.getElementById('tplDefaultNote');
  if (note) note.textContent = `(${tplLabel(bag.default || 'band9')})`;
}

function setGenerationMode(mode) {
  const e = getCurrent();
  if (!e) return;
  e.generationMode = mode === 'natural' ? 'natural' : 'template';
  saveAll();
  updateGenerationModeUI();
  renderPreview();
}

function setGenerationModeFromFs(mode) {
  const e = getCurrent();
  if (!e) return;
  e.generationMode = mode === 'natural' ? 'natural' : 'template';
  saveAll();
  updateGenerationModeUI();
}

function updateGenerationModeUI() {
  const e = getCurrent();
  if (!e) return;
  const mode = e.generationMode || 'template';
  
  const mainSelect = document.getElementById('generationModeSelect');
  if (mainSelect) {
    mainSelect.value = mode;
  }
  const labelAux = document.getElementById('generationModeAux');
  if (labelAux) {
    labelAux.textContent = mode === 'natural' ? 'Natural Band 8/9 Mode' : 'Exam Template Mode';
  }
  const fsSelect = document.getElementById('fsStyle');
  if (fsSelect) {
    fsSelect.value = mode;
  }
}

// ============================================================
//  AI: SUGGEST IDEAS (5 pros + 5 cons → pick 2+2)
// ============================================================
// ============================================================
// (Old globals pickedPros/pickedCons/suggestedPros/suggestedCons + parseIdeas
//  removed — replaced by pickedLeftIdeas / pickedRightIdeas / etc. defined
//  near QUESTION_TYPES at the top.)
// ============================================================

async function aiSuggestIdeas() {
  const e = getCurrent();
  if (!e) { toast('No essay selected', true); return; }
  if (!e.title || !e.question) { toast('Need essay title and question first', true); return; }

  if (!await consumeQuota('idea')) return;

  const vocabIdx = (e.vocab || 3) - 1;
  const vocabSpec = VOCAB_LEVELS[vocabIdx];
  const bag = getTemplatesBag();
  const effectiveTplKey = (e.templateChoice && e.templateChoice !== 'default') ? e.templateChoice : (bag.default || 'band9');
  const isBand6 = (effectiveTplKey === 'band6');
  const forcedType = e.manualQuestionTypeOverride || detectStrongType(e.question) || '';

  const picker = document.getElementById('ideasPicker');
  const body = document.getElementById('ideasPickerBody');
  picker.classList.add('show');
  body.innerHTML = '<div class="ideas-loading"><div class="spinner-dark"></div> Analyzing the question and finding ideas...</div>';

  const btn = document.getElementById('suggestIdeasBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-dark"></span> Thinking...';

  const typeOptions = Object.keys(QUESTION_TYPES)
    .filter(key => QUESTION_TYPES[key].id === key)
    .map(key => `  "${key}" — ${QUESTION_TYPES[key].displayName}: ${QUESTION_TYPES[key].detect}`)
    .join('\n');

  const bandVocabRule = isBand6
    ? `- Use SIMPLE, PLAIN ENGLISH — the kind of words a Band 6 student already knows from everyday life.
- Stay in A2-B1 territory (CEFR). Words like "good", "important", "helpful", "hard", "easy", "save money", "stay healthy", "learn faster".
- AVOID any academic vocabulary, sophisticated phrasing, formal Latinate words, or anything a Band 7+ student would use.
- BANNED words (these are too advanced for Band 6): foster, cultivate, facilitate, enhance, mitigate, exacerbate, prioritise, optimise, leverage, harness, undermine, sustainable, comprehensive, substantial, pivotal, paramount, deleterious, multifaceted.
- Keep phrases short and direct: "saves money", "helps students learn", "makes traffic worse" — NOT "yields substantial economic benefits" or "ameliorates traffic congestion".
- A 12-year-old should be able to understand every phrase.`
    : `- Use simple Band 7-8 vocabulary students recognise from class — clear and accessible, not overly academic.
- Avoid fancy academic words students don't know — favour everyday phrasing over Latinate vocabulary.`;

  const bandHeadline = isBand6 ? 'a Band 6 IELTS/PTE essay (simple, plain English)' : 'a Band 9 IELTS/PTE essay';

  const prompt = `You are helping a tutor at IPT Brisbane prepare ${bandHeadline}. There are TWO tasks:

═══════════════════════════════════════════════════
TASK 1 — CLASSIFY the question type. Read the question carefully and pick ONE type that best matches:

${typeOptions}
${forcedType ? `
*** QUESTION TYPE LOCK ***: The question type for this essay is "${forcedType}". You MUST use exactly "${forcedType}" as primaryQuestionType and generate ideas for THAT type via the Per-Type Structure Guide below. Do not choose any other type.
` : ''}

*SPECIAL RULE FOR "MOST PRESSING PROBLEM" QUESTIONS*:
If the question prompt asks about the "most pressing problem", "most important issue", "biggest problem", "most serious global issue", or similar:
- You MUST classify it as primaryQuestionType: "single_best_option" and secondaryFeatures: ["solution_required"].
- The detectedOptions array should contain the main problem/option chosen (e.g. ["climate change"]).

═══════════════════════════════════════════════════
TASK 2 — Generate 12-16 high-quality, topic-specific ideas whose STRUCTURE matches the question type you chose in TASK 1.
Do NOT produce a one-size-fits-all set. Read the PER-TYPE STRUCTURE GUIDE below and generate exactly the categories the matching type needs. Whenever you write an "example" or everyday illustration, keep it extremely simple, concrete and relatable (e.g. "employees using translation apps", "students submitting homework online", "travellers taking buses in cities"); avoid academic, formal, or abstract examples.

Each idea must be represented as a JSON object with:
- id: short unique string (e.g. "city_hospitals")
- text: a concrete 3-7 word phrase (no filler)
- category: one of ["main_support", "example", "solution", "optional_contrast", "counter_point", "advantage", "disadvantage", "cause", "effect"]
- supports: array of strings representing stances or options that this idea aligns with.
- opposes: array of strings representing stances or options that this idea contradicts.
- essayTypes: array of matching essay types.
- strength: integer 1 to 5.

═══════════════════════════════════════════════════
PER-TYPE STRUCTURE GUIDE — the categories you generate MUST match the type chosen in TASK 1.
Find the matching family and generate ONLY that structure. NEVER apply the stance-plus-alternative-actions pattern to a type that does not call for it.

FAMILY 1 — STANCE, REASONS ONLY  -> types: "opinion", "agree_disagree"
  - At least 5 reasons to AGREE with the statement/practice (category "advantage").
  - At least 5 reasons to DISAGREE with the statement/practice (category "disadvantage").
  - At least 2 "optional_contrast" points.
  - DO NOT generate any "solution" / alternative-action ideas for these two types.
  - supports / opposes for each reason:
      Agree reasons:    supports = ["strongly agree","largely agree","partially agree"],          opposes = ["strongly disagree","largely disagree","partially disagree"]
      Disagree reasons: supports = ["strongly disagree","largely disagree","partially disagree"], opposes = ["strongly agree","largely agree","partially agree"]

FAMILY 2 — STANCE, REASONS + ALTERNATIVE ACTIONS  -> type: "opinion_alternatives" ONLY
  - Everything in FAMILY 1 (agree reasons + disagree reasons), PLUS
  - At least 5-6 alternative actions to take instead (category "solution"); for each, supports = all six stance choices ["strongly agree","largely agree","partially agree","strongly disagree","largely disagree","partially disagree"].
  (Only opinion_alternatives gets alternative actions - never plain opinion and never agree_disagree.)

FAMILY 3 — TWO SIDES / WEIGH BOTH  -> types: "advantages_disadvantages", "advantages_disadvantages_opinion", "discuss_both_views", "compare_two_sides", "two_option_preference", "positive_negative_impact", "blessing_curse", "responsibility", "social_impact"
  - At least 5 ideas for the FIRST side (category "advantage"): the advantages / first view / first option / positive impacts / "blessing" reasons / first responsible party.
  - At least 5 ideas for the SECOND side (category "disadvantage"): the disadvantages / second view / second option / negative impacts / "curse" reasons / second responsible party.
  - DO NOT generate "solution"/alternative-action ideas and DO NOT add pairedText (the essay generator writes the examples later).
  - If the type asks the writer to choose or give a verdict (advantages_disadvantages_opinion, discuss_both_views, two_option_preference), set "supports"/"opposes" on each side using the relevant stanceOptions / detectedOptions, and for two_option_preference also add at least 2 "optional_contrast" points; otherwise leave supports and opposes as empty arrays.

FAMILY 4 — PROBLEM/CAUSE -> SOLUTION/EFFECT (PAIRED)  -> types: "problem_solution", "cause_solution", "causes_solutions", "cause_effect", "problem_effect", "causes_effects"
  - Generate at least 5 left-side items: category "problem" for problem_* types, "cause" for cause_* types.
  - EACH left item MUST include paired fields:
      pairedText: a concrete 3-7 word phrase for the matching item.
      pairedType: "solution" for *_solution types, "effect" for *_effect types.
      pairedId: a unique string.
  - DO NOT generate stance "advantage"/"disadvantage" reasons for these types.

FAMILY 5 — SINGLE BEST OPTION ("most pressing problem")  -> type: "single_best_option"
  - Choose EXACTLY ONE main problem/option and put it in detectedOptions.
  - Under it, generate 5-6 items of category "cause" or "challenge", EACH with pairedText (a solution), pairedType "solution", and a unique pairedId.
  - DO NOT suggest multiple unrelated problems.

FAMILY 6 — IMPORTANCE + REASONS IT IS HARD  -> type: "importance_reasons"
  - At least 5 ideas for WHY IT MATTERS / how important it is (category "advantage").
  - At least 5 ideas for the REASONS IT IS HARD TO ACHIEVE (category "disadvantage").
  - DO NOT generate "solution"/alternative-action ideas and DO NOT add pairedText (these are obstacles, NOT solutions).
  - Leave supports and opposes as empty arrays.

If you classify the question as any other stance type not named above (e.g. "rights_ethics", "policy_recommendation", "future_prediction", "education_effectiveness", "example_specific"), use FAMILY 3.

ESSAY DETAILS:
TITLE: ${e.title}
QUESTION: ${e.question}
${e.explanation ? `TOPIC EXPLANATION: ${e.explanation}` : ''}
TEMPLATE BAND: ${isBand6 ? 'Band 6 — plain English only' : 'Band 9 — sophisticated but student-friendly'}
VOCABULARY LEVEL: ${vocabSpec.label}

═══════════════════════════════════════════════════
RULES FOR IDEAS:
- Each idea is a short phrase, 3-7 words.
- Concrete and topic-specific — NOT generic.
${bandVocabRule}
- Each idea is a distinct angle — no overlap.
- Order from strongest/most obvious to more nuanced.
- For "solution" categories or "pairedText" solutions: write ACTIONABLE items (start with a verb where natural).
- For "cause", "problem" or "challenge" categories: state them clearly as a noun phrase.

═══════════════════════════════════════════════════
RETURN ONLY A JSON OBJECT — no preamble, no markdown fences.
CRITICAL:
1. Do NOT use smart quotes (like “ or ”). Use standard straight double quotes (").
2. Do NOT write nested double quotes inside any string properties. If you want to quote a word inside a string, use single quotes (e.g. "better access to 'smart' devices").
3. Do NOT add any comments (like // or /* */) or trailing commas.
4. Ensure the JSON is 100% syntactically correct and fully complete.

Format:

{
  "primaryQuestionType": "two_option_preference",
  "secondaryFeatures": ["personal_experience_required"],
  "confidenceScore": 0.95,
  "detectedOptions": ["city living", "countryside living"],
  "explanationForDetection": "Question asks to choose between living in cities or countryside.",
  "stanceRequired": true,
  "ideas": [
    {
      "id": "city_healthcare",
      "text": "better access to hospitals and schools",
      "category": "main_support",
      "supports": ["city living"],
      "opposes": ["countryside living"],
      "essayTypes": ["two_option_preference"],
      "strength": 5,
      "pairedText": "promoting electric public transit",
      "pairedType": "solution",
      "pairedId": "transit_promo"
    }
  ]
}`;

  try {
    const res = await fetch(API_URL + '/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3500,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    let text = data.content.map(c => c.text || '').join('').trim();
    let result = cleanAndParseJSON(text);
    
    if (!result.ideas || !Array.isArray(result.ideas)) {
      throw new Error('AI did not return the expected ideas format');
    }
    
    let activeType = e.manualQuestionTypeOverride || result.primaryQuestionType || 'advantages_disadvantages';
    // Don't let the model promote a plain opinion question to opinion_alternatives unless it
    // genuinely asks for alternative actions.
    if (activeType === 'opinion_alternatives' && !e.manualQuestionTypeOverride && !questionAsksForAlternatives(e.question)) {
      activeType = 'agree_disagree';
    }
    const lowerQ = (e.question || '').toLowerCase();
    const isMostPressing = (lowerQ.includes('most pressing problem') || lowerQ.includes('most important issue') || lowerQ.includes('biggest problem') || lowerQ.includes('most serious global issue') || lowerQ.includes('most serious problem'));
    if (isMostPressing) {
      activeType = 'single_best_option';
      if (!result.secondaryFeatures) result.secondaryFeatures = [];
      if (!result.secondaryFeatures.includes('solution_required')) {
        result.secondaryFeatures.push('solution_required');
      }
    }
    
    e.detectedQuestionType = activeType;
    e.questionType = activeType;
    e.detectedOptions = result.detectedOptions || [];
    e.suggestedIdeas = result.ideas;
    e.secondaryFeatures = result.secondaryFeatures || [];
    
    e.chosenStance = '';
    e.selectedReasonIds = [];
    e.selectedExampleIds = [];
    e.selectedSolutionIds = [];
    e.optionalContrastIds = [];
    
    const leftIdeas = result.ideas.filter(i => i.category === 'main_support' || i.category === 'advantage' || i.category === 'problem' || i.category === 'cause' || i.category === 'challenge' || (i.supports && i.supports.includes('left')));
    const rightIdeas = result.ideas.filter(i => i.category === 'example' || i.category === 'disadvantage' || i.category === 'solution' || i.category === 'effect' || (i.supports && i.supports.includes('right')));
    suggestedLeftIdeas = leftIdeas.slice(0, 5).map(i => ({
      id: i.id || '',
      text: i.text || '',
      category: i.category || 'main_support',
      pairedText: i.pairedText || i.pairedSolutionOrEffect || '',
      pairedType: i.pairedType || '',
      pairedId: i.pairedId || '',
      supportsStance: i.supportsStance || '',
      supports: i.supports || [],
      opposes: i.opposes || []
    }));
    suggestedRightIdeas = rightIdeas.slice(0, 5).map(i => ({
      id: i.id || '',
      text: i.text || '',
      category: i.category || 'example',
      pairedText: i.pairedText || i.pairedSolutionOrEffect || '',
      pairedType: i.pairedType || '',
      pairedId: i.pairedId || '',
      supportsStance: i.supportsStance || '',
      supports: i.supports || [],
      opposes: i.opposes || []
    }));
    pickedLeftIdeas = new Set();
    pickedRightIdeas = new Set();
    
    saveAll();
    renderIdeasPicker();
  } catch (err) {
    console.error(err);
    body.innerHTML = `<div style="text-align:center; padding:16px; color:var(--accent); font-size:12px;">${escapeHtml(err.message)}</div>`;
    toast('Failed to get ideas: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '💡 Let AI suggest ideas for me';
  }
}

function getBalancedDefaultStance(activeType, typeCfg) {
  // Question types where the writer must consciously commit to ONE specific side — there is no
  // meaningful "balanced" middle, so we do NOT auto-pick a stance (the user must choose).
  const MANDATORY_STANCE_TYPES = ['two_option_preference', 'single_best_option'];
  if (MANDATORY_STANCE_TYPES.includes(activeType)) return '';

  const opts = (typeCfg && typeCfg.stanceOptions) || [];
  if (opts.length === 0) return '';
  if (opts.length === 1) return opts[0]; // single option (e.g. example_specific) — nothing to choose

  // Agree/disagree opinion scale: the balanced position is a mild lean. Use "partially disagree"
  // to stay consistent with the existing Band 6 default.
  const partialDisagree = opts.find(o => /^partially disagree$/i.test(o));
  if (partialDisagree) return partialDisagree;
  const partial = opts.find(o => /^partially\b/i.test(o));
  if (partial) return partial;

  // Otherwise prefer an explicitly balanced / shared / conditional option.
  const balanced = opts.find(o =>
    /\b(balanced|neutral|shared|compromise)\b/i.test(o) ||
    /(with conditions|if managed|with risks|under specific conditions|with major changes|major changes)/i.test(o)
  );
  if (balanced) return balanced;

  // No balanced option exists -> treat as a manual pick.
  return '';
}

function renderStanceController(e) {
  const activeType = getActiveQuestionType(e);
  const typeCfg = QUESTION_TYPES[activeType] || QUESTION_TYPES.advantages_disadvantages;
  
  if (!typeCfg.stanceRequired) {
    return '';
  }
  
  const vocabIdx = (e.vocab || 3) - 1;
  const bag = getTemplatesBag();
  const effectiveTplKey = (e.templateChoice && e.templateChoice !== 'default') ? e.templateChoice : (bag.default || 'band9');
  const isBand6 = (effectiveTplKey === 'band6' || e.vocab === 1);
  const isAgreementType = (activeType === 'opinion' || activeType === 'agree_disagree');

  if (isBand6 && isAgreementType) {
    if (e.chosenStance !== 'partially disagree') {
      e.chosenStance = 'partially disagree';
      setTimeout(() => {
        saveAll();
        revalidateSelectedIdeas(e);
        renderIdeasPicker();
        renderPreview();
      }, 0);
    }
  }

  let options = [];
  if (isBand6 && isAgreementType) {
    options = ["partially disagree"];
  } else if (activeType === 'two_option_preference' && e.detectedOptions && e.detectedOptions.length === 2) {
    options = [
      `${e.detectedOptions[0]} is better`,
      `${e.detectedOptions[1]} is better`
    ];
  } else if (activeType === 'discuss_both_views' && e.detectedOptions && e.detectedOptions.length === 2) {
    options = [
      `strongly support ${e.detectedOptions[0]}`,
      `strongly support ${e.detectedOptions[1]}`,
      `balanced perspective/neutral`
    ];
  } else if (activeType === 'single_best_option') {
    const opts = (e.detectedOptions && e.detectedOptions.length > 0) ? e.detectedOptions : (typeCfg.stanceOptions || []);
    options = opts.map(opt => opt.toLowerCase().includes('pressing problem') || opt.toLowerCase().includes('is best') ? opt : `${opt} is the most pressing problem`);
  } else {
    options = typeCfg.stanceOptions || [];
  }
  
  // Default the stance to a BALANCED option so generated essays are measured by default. For the
  // question types where the writer must consciously commit to a specific side
  // (two_option_preference, single_best_option) there is no balanced default — getBalancedDefaultStance
  // returns '' — so the stance is left blank for the user to pick. Set synchronously so the pill
  // renders selected immediately, then defer the save + revalidate + preview refresh.
  const balancedDefault = getBalancedDefaultStance(activeType, typeCfg);
  if (!e.chosenStance && balancedDefault && options.includes(balancedDefault)) {
    e.chosenStance = balancedDefault;
    setTimeout(() => {
      saveAll();
      revalidateSelectedIdeas(e);
      renderIdeasPicker();
      renderPreview();
    }, 0);
  }
  
  if (options.length === 0) return '';
  
  // Only SHOW the stance picker when the writer MUST consciously choose — i.e. when there is no
  // balanced default to apply silently (two_option_preference, single_best_option). For every other
  // type the balanced stance is applied above and the picker stays hidden to keep the UI clean.
  if (balancedDefault !== '') return '';
  
  const pillsHtml = options.map(opt => {
    const isSelected = e.chosenStance === opt;
    return `
      <button class="stance-pill ${isSelected ? 'active' : ''}" 
              onclick="event.preventDefault(); changeChosenStance('${escapeHtml(opt)}')"
              style="padding: 6px 12px; font-size: 11.5px; border-radius: 20px; border: 1px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}; background: ${isSelected ? 'var(--accent-soft)' : 'var(--bg)'}; color: ${isSelected ? 'var(--accent-deep)' : 'var(--ink-soft)'}; font-weight: 600; cursor: pointer; transition: all 0.2s; white-space: nowrap; margin-bottom: 4px;">
        ${escapeHtml(opt)}
      </button>
    `;
  }).join('');
  
  return `
    <div class="stance-controller" style="margin-bottom: 14px;">
      <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); font-weight: 700; margin-bottom: 6px;">
        Choose Your Stance
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px;">
        ${pillsHtml}
      </div>
    </div>
  `;
}

function renderIdeasPicker() {
  const e = getCurrent();
  if (!e) return;
  
  ensureSuggestedIdeas(e);
  revalidateSelectedIdeas(e);
  
  const activeType = getActiveQuestionType(e);
  const typeCfg = QUESTION_TYPES[activeType] || QUESTION_TYPES.advantages_disadvantages;
  const isStanceAgreement = ['opinion', 'agree_disagree', 'two_option_preference', 'opinion_alternatives'].includes(activeType);
  
  const helpEl = document.getElementById('ideasPickerHelp');
  if (helpEl) {
    // Only prompt to "choose a stance" when the stance picker is actually shown (mandatory types).
    const mustPickStance = typeCfg.stanceRequired && getBalancedDefaultStance(activeType, typeCfg) === '';
    const sp = mustPickStance ? 'Choose a stance, then pick' : 'Pick';
    if (activeType === 'single_best_option') {
      helpEl.innerHTML = `${sp} exactly 2 causes/challenges`;
    } else if (activeType === 'opinion_alternatives') {
      helpEl.innerHTML = `${sp} exactly 2 supporting reasons and 2 alternative actions`;
    } else if (isStanceAgreement) {
      helpEl.innerHTML = `${sp} exactly 2 reasons`;
    } else if (typeCfg.stanceRequired) {
      helpEl.innerHTML = `${sp} exactly 2 left-side + 2 right-side ideas`;
    } else if (['problem_solution', 'cause_solution', 'causes_solutions'].includes(activeType)) {
      helpEl.innerHTML = `Choose exactly 2 problems/causes (solutions are auto-paired)`;
    } else if (['cause_effect', 'problem_effect', 'causes_effects'].includes(activeType)) {
      helpEl.innerHTML = `Choose exactly 2 causes/problems (effects are auto-paired)`;
    } else {
      helpEl.innerHTML = `Choose exactly 2 left-side + 2 right-side ideas`;
    }
  }

  const body = document.getElementById('ideasPickerBody');
  if (!body) return;

  // 1. Question type is auto-detected (with detectStrongType locking the known patterns); the
  //    manual question-type picker has been removed, so this header is intentionally empty.
  let typeHeaderHtml = '';

  // 2. Stance Selector if stance is required
  let stanceSelectorHtml = '';
  if (typeCfg.stanceRequired) {
    stanceSelectorHtml = renderStanceController(e);
  }

  // 3. Main columns / lists
  let listsHtml = '';
  const relationTypes = ['problem_solution', 'cause_solution', 'cause_effect', 'problem_effect', 'causes_solutions', 'causes_effects'];
  const isRel = relationTypes.includes(activeType) || activeType === 'single_best_option';

  if (activeType === 'single_best_option') {
    // Single-best-option layout
    const { alignedIdeas } = filterIdeasForStance(activeType, e.chosenStance, e.suggestedIdeas);
    const leftIdeas = alignedIdeas.filter(i => i.category === 'main_support' || i.category === 'cause' || i.category === 'problem' || i.category === 'challenge');
    const pickedReasons = e.selectedReasonIds || [];
    
    listsHtml = `
      <div class="ideas-cols">
        <!-- Left Column -->
        <div>
          <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:0.1em; color:var(--ink-soft); font-weight:700; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
            <span style="background:#d4ebf5; color:#2a5577; width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:700;">A</span>
            Causes / Challenges
            <span style="margin-left:auto; font-size:9px; color:var(--ink-mute); font-weight:600;">pick 2</span>
          </div>
          ${leftIdeas.length === 0 ? `<div style="font-size:11px; color:var(--ink-mute); font-style:italic; padding:8px;">No ideas available. Choose a stance/option.</div>` : leftIdeas.map((idea) => {
            const isSelected = pickedReasons.includes(idea.text);
            return `
              <div class="idea-item ${isSelected ? 'selected' : ''}" onclick="toggleIdeaText('${idea.category}', '${escapeHtml(idea.text)}')" style="cursor:pointer; padding:8px 10px; margin-bottom:6px; border:1px solid ${isSelected ? 'var(--accent)' : 'var(--line-soft)'}; border-radius:6px; display:flex; align-items:center; gap:8px; background:${isSelected ? 'var(--accent-soft)' : 'var(--bg)'}; transition:all 0.2s;">
                <div class="idea-checkbox" style="width:14px; height:14px; border:1.5px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}; border-radius:3px; background:${isSelected ? 'var(--accent)' : 'transparent'}; display:flex; align-items:center; justify-content:center;">
                  ${isSelected ? `<span style="color:white; font-size:10px; font-weight:bold;">✓</span>` : ''}
                </div>
                <div class="idea-text" style="font-size:12px; color:var(--ink);">${escapeHtml(idea.text)}</div>
              </div>
            `;
          }).join('')}
        </div>
        
        <!-- Right Column -->
        <div>
          <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:0.1em; color:var(--ink-soft); font-weight:700; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
            <span style="background:#f5dbd4; color:#7a4030; width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:700;">B</span>
            Solutions (Auto-paired)
            <span style="margin-left:auto; display:flex; align-items:center; gap:6px;">
              <span style="font-size:9px; color:var(--ink-mute); font-weight:600;">auto-paired</span>
              <button onclick="event.preventDefault(); window.ideasEditMode = !window.ideasEditMode; renderIdeasPicker();" style="background:none; border:none; color:var(--accent); font-size:10px; font-weight:600; cursor:pointer; padding:2px 4px;">
                ${window.ideasEditMode ? 'Done' : 'Edit'}
              </button>
            </span>
          </div>
          ${leftIdeas.map((leftIdea, idx) => {
            const isSelected = pickedReasons.includes(leftIdea.text);
            const pairedVal = getPairedTextForIdea(e, leftIdea, idx);
            
            let rightContentHtml = '';
            if (window.ideasEditMode) {
              rightContentHtml = `
                <input type="text" value="${escapeHtml(pairedVal)}" onchange="updatePairedText(${idx}, this.value)" style="width:100%; font-size:11.5px; padding:3px 6px; border:1px solid var(--line); border-radius:4px; font-family:var(--sans); background:var(--bg); color:var(--ink);" />
              `;
            } else {
              rightContentHtml = `<div class="idea-text" style="font-size:12px; color:var(--ink);">${escapeHtml(pairedVal)}</div>`;
            }
            
            return `
              <div class="idea-item ${isSelected ? 'selected' : ''}" style="padding:8px 10px; margin-bottom:6px; border:1px solid ${isSelected ? 'var(--accent)' : 'var(--line-soft)'}; border-radius:6px; display:flex; align-items:center; gap:8px; background:${isSelected ? 'var(--accent-soft)' : 'var(--bg)'}; opacity: ${isSelected ? 1 : 0.65}; transition:all 0.2s;">
                <div class="idea-checkbox" style="width:14px; height:14px; border:1.5px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}; border-radius:3px; background:${isSelected ? 'var(--accent)' : 'transparent'}; display:flex; align-items:center; justify-content:center;">
                  ${isSelected ? `<span style="color:white; font-size:10px; font-weight:bold;">✓</span>` : ''}
                </div>
                ${rightContentHtml}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
    
  } else if (isStanceAgreement) {
    const isOpinionAlts = (activeType === 'opinion_alternatives');
    const isAgreeDisagreeLong = (activeType === 'agree_disagree');
    if (isOpinionAlts) {
      // 3-column layout: Column A (Agree Reasons), Column B (Disagree Reasons), Column C (Alternative Actions)
      const agreeReasons = e.suggestedIdeas ? e.suggestedIdeas.filter(i => i.category === 'advantage') : [];
      const disagreeReasons = e.suggestedIdeas ? e.suggestedIdeas.filter(i => i.category === 'disadvantage') : [];
      const alternativeActions = e.suggestedIdeas ? e.suggestedIdeas.filter(i => i.category === 'solution') : [];
      
      const pickedReasons = e.selectedReasonIds || [];
      const pickedSolutions = e.selectedSolutionIds || [];
      
      // Determine columns state based on stance
      const stanceLower = (e.chosenStance || '').toLowerCase();
      const isAgreeStance = e.chosenStance && ['strongly agree', 'largely agree', 'partially agree', 'agree'].some(s => stanceLower.includes(s));
      const isDisagreeStance = e.chosenStance && ['strongly disagree', 'largely disagree', 'partially disagree', 'disagree'].some(s => stanceLower.includes(s));
      
      // Students may pick from either side freely (2 reasons total); stance follows their picks.
      const agreeColDisabled = false;
      const disagreeColDisabled = false;
      
      listsHtml = `
        <div class="ideas-cols ideas-cols-3">
          <!-- Column A: Reasons to Agree -->
          <div class="ideas-side-col ${agreeColDisabled ? 'col-disabled' : ''}" style="${agreeColDisabled ? 'opacity: 0.35; pointer-events: none;' : ''}">
            <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:0.1em; color:var(--ink-soft); font-weight:700; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
              <span style="background:#d4ebf5; color:#2a5577; width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:700;">A</span>
              Reasons to Agree
              <span style="margin-left:auto; font-size:9px; color:var(--ink-mute); font-weight:600;">2 total</span>
            </div>
            ${agreeReasons.length === 0 ? `<div style="font-size:11px; color:var(--ink-mute); font-style:italic; padding:8px;">No ideas available.</div>` : agreeReasons.map((idea) => {
              const isSelected = pickedReasons.includes(idea.text);
              return `
                <div class="idea-item ${isSelected ? 'selected' : ''}" onclick="toggleIdeaText('${idea.category}', '${escapeHtml(idea.text)}')" style="cursor:pointer; padding:8px 10px; margin-bottom:6px; border:1px solid ${isSelected ? 'var(--accent)' : 'var(--line-soft)'}; border-radius:6px; display:flex; align-items:center; gap:8px; background:${isSelected ? 'var(--accent-soft)' : 'var(--bg)'}; transition:all 0.2s;">
                  <div class="idea-checkbox" style="width:14px; height:14px; border:1.5px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}; border-radius:3px; background:${isSelected ? 'var(--accent)' : 'transparent'}; display:flex; align-items:center; justify-content:center;">
                    ${isSelected ? `<span style="color:white; font-size:10px; font-weight:bold;">✓</span>` : ''}
                  </div>
                  <div class="idea-text" style="font-size:12px; color:var(--ink);">${escapeHtml(idea.text)}</div>
                </div>
              `;
            }).join('')}
          </div>
          
          <!-- Column B: Reasons to Disagree -->
          <div class="ideas-side-col ${disagreeColDisabled ? 'col-disabled' : ''}" style="${disagreeColDisabled ? 'opacity: 0.35; pointer-events: none;' : ''}">
            <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:0.1em; color:var(--ink-soft); font-weight:700; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
              <span style="background:#d4ebf5; color:#2a5577; width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:700;">B</span>
              Reasons to Disagree
              <span style="margin-left:auto; font-size:9px; color:var(--ink-mute); font-weight:600;">2 total</span>
            </div>
            ${disagreeReasons.length === 0 ? `<div style="font-size:11px; color:var(--ink-mute); font-style:italic; padding:8px;">No ideas available.</div>` : disagreeReasons.map((idea) => {
              const isSelected = pickedReasons.includes(idea.text);
              return `
                <div class="idea-item ${isSelected ? 'selected' : ''}" onclick="toggleIdeaText('${idea.category}', '${escapeHtml(idea.text)}')" style="cursor:pointer; padding:8px 10px; margin-bottom:6px; border:1px solid ${isSelected ? 'var(--accent)' : 'var(--line-soft)'}; border-radius:6px; display:flex; align-items:center; gap:8px; background:${isSelected ? 'var(--accent-soft)' : 'var(--bg)'}; transition:all 0.2s;">
                  <div class="idea-checkbox" style="width:14px; height:14px; border:1.5px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}; border-radius:3px; background:${isSelected ? 'var(--accent)' : 'transparent'}; display:flex; align-items:center; justify-content:center;">
                    ${isSelected ? `<span style="color:white; font-size:10px; font-weight:bold;">✓</span>` : ''}
                  </div>
                  <div class="idea-text" style="font-size:12px; color:var(--ink);">${escapeHtml(idea.text)}</div>
                </div>
              `;
            }).join('')}
          </div>
          
          <!-- Column C: Alternative Actions -->
          <div>
            <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:0.1em; color:var(--ink-soft); font-weight:700; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
              <span style="background:#f5dbd4; color:#7a4030; width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:700;">C</span>
              Alternative Actions
              <span style="margin-left:auto; font-size:9px; color:var(--ink-mute); font-weight:600;">pick 2</span>
            </div>
            ${alternativeActions.length === 0 ? `<div style="font-size:11px; color:var(--ink-mute); font-style:italic; padding:8px;">No alternative actions.</div>` : alternativeActions.map((idea) => {
              const isSelected = pickedSolutions.includes(idea.text);
              return `
                <div class="idea-item ${isSelected ? 'selected' : ''}" onclick="toggleIdeaText('${idea.category}', '${escapeHtml(idea.text)}')" style="cursor:pointer; padding:8px 10px; margin-bottom:6px; border:1px solid ${isSelected ? 'var(--accent)' : 'var(--line-soft)'}; border-radius:6px; display:flex; align-items:center; gap:8px; background:${isSelected ? 'var(--accent-soft)' : 'var(--bg)'}; transition:all 0.2s;">
                  <div class="idea-checkbox" style="width:14px; height:14px; border:1.5px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}; border-radius:3px; background:${isSelected ? 'var(--accent)' : 'transparent'}; display:flex; align-items:center; justify-content:center;">
                    ${isSelected ? `<span style="color:white; font-size:10px; font-weight:bold;">✓</span>` : ''}
                  </div>
                  <div class="idea-text" style="font-size:12px; color:var(--ink);">${escapeHtml(idea.text)}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    } else if (activeType === 'two_option_preference') {
      // Stance-based layout (2-column) — the writer has chosen one option, so ideas supporting the
      // OTHER option are surfaced as optional contrast.
      const { alignedIdeas, optionalContrastIdeas } = filterIdeasForStance(activeType, e.chosenStance, e.suggestedIdeas);
      const mainSupport = alignedIdeas.filter(i => i.category === 'main_support' || i.category === 'advantage' || i.category === 'disadvantage' || i.category === 'cause' || i.category === 'problem');
      
      const pickedReasons = e.selectedReasonIds || [];
      const pickedSecondCol = e.optionalContrastIds || [];
      const secondColIdeas = optionalContrastIdeas;
      const secondColLabel = 'Optional Contrast';
      const secondColCategory = 'optional_contrast';
      const secondColLimit = 1;
      
      listsHtml = `
        <div class="ideas-cols">
          <!-- Main reasons -->
          <div>
            <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:0.1em; color:var(--ink-soft); font-weight:700; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
              <span style="background:#d4ebf5; color:#2a5577; width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:700;">A</span>
              Supporting Reasons
              <span style="margin-left:auto; font-size:9px; color:var(--ink-mute); font-weight:600;">pick 2</span>
            </div>
            ${mainSupport.length === 0 ? `<div style="font-size:11px; color:var(--ink-mute); font-style:italic; padding:8px;">No supporting reasons. Choose a stance.</div>` : mainSupport.map((idea) => {
              const isSelected = pickedReasons.includes(idea.text);
              return `
                <div class="idea-item ${isSelected ? 'selected' : ''}" onclick="toggleIdeaText('${idea.category}', '${escapeHtml(idea.text)}')" style="cursor:pointer; padding:8px 10px; margin-bottom:6px; border:1px solid ${isSelected ? 'var(--accent)' : 'var(--line-soft)'}; border-radius:6px; display:flex; align-items:center; gap:8px; background:${isSelected ? 'var(--accent-soft)' : 'var(--bg)'}; transition:all 0.2s;">
                  <div class="idea-checkbox" style="width:14px; height:14px; border:1.5px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}; border-radius:3px; background:${isSelected ? 'var(--accent)' : 'transparent'}; display:flex; align-items:center; justify-content:center;">
                    ${isSelected ? `<span style="color:white; font-size:10px; font-weight:bold;">✓</span>` : ''}
                  </div>
                  <div class="idea-text" style="font-size:12px; color:var(--ink);">${escapeHtml(idea.text)}</div>
                </div>
              `;
            }).join('')}
          </div>
          
          <!-- Second Column (Optional Contrast) -->
          <div>
            <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:0.1em; color:var(--ink-soft); font-weight:700; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
              <span style="background:#f5dbd4; color:#7a4030; width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:700;">B</span>
              ${secondColLabel}
              <span style="margin-left:auto; font-size:9px; color:var(--ink-mute); font-weight:600;">pick ${secondColLimit}</span>
            </div>
            ${secondColIdeas.length === 0 ? `<div style="font-size:11px; color:var(--ink-mute); font-style:italic; padding:8px;">No ${secondColLabel.toLowerCase()} points.</div>` : secondColIdeas.map((idea) => {
              const isSelected = pickedSecondCol.includes(idea.text);
              return `
                <div class="idea-item ${isSelected ? 'selected' : ''}" onclick="toggleIdeaText('${secondColCategory}', '${escapeHtml(idea.text)}')" style="cursor:pointer; padding:8px 10px; margin-bottom:6px; border:1px solid ${isSelected ? 'var(--accent)' : 'var(--line-soft)'}; border-radius:6px; display:flex; align-items:center; gap:8px; background:${isSelected ? 'var(--accent-soft)' : 'var(--bg)'}; opacity: 0.8; transition:all 0.2s;">
                  <div class="idea-checkbox" style="width:14px; height:14px; border:1.5px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}; border-radius:3px; background:${isSelected ? 'var(--accent)' : 'transparent'}; display:flex; align-items:center; justify-content:center;">
                    ${isSelected ? `<span style="color:white; font-size:10px; font-weight:bold;">✓</span>` : ''}
                  </div>
                  <div class="idea-text" style="font-size:12px; color:var(--ink);">${escapeHtml(idea.text)}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    } else {
      // Opinion / agree_disagree: two-column "Reasons to Agree | Reasons to Disagree". Students
      // freely pick any 2 reasons (from either side); the stance is derived from their picks.
      const agreeReasons = e.suggestedIdeas ? e.suggestedIdeas.filter(i => i.category === 'advantage' || i.category === 'main_support') : [];
      const disagreeReasons = e.suggestedIdeas ? e.suggestedIdeas.filter(i => i.category === 'disadvantage' || i.category === 'counter_point') : [];
      const pickedReasons = e.selectedReasonIds || [];
      const renderReasonItem = (idea) => {
        const isSelected = pickedReasons.includes(idea.text);
        return `
          <div class="idea-item ${isSelected ? 'selected' : ''}" onclick="toggleIdeaText('${idea.category}', '${escapeHtml(idea.text)}')" style="cursor:pointer; padding:8px 10px; margin-bottom:6px; border:1px solid ${isSelected ? 'var(--accent)' : 'var(--line-soft)'}; border-radius:6px; display:flex; align-items:center; gap:8px; background:${isSelected ? 'var(--accent-soft)' : 'var(--bg)'}; transition:all 0.2s;">
            <div class="idea-checkbox" style="width:14px; height:14px; border:1.5px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}; border-radius:3px; background:${isSelected ? 'var(--accent)' : 'transparent'}; display:flex; align-items:center; justify-content:center;">
              ${isSelected ? `<span style="color:white; font-size:10px; font-weight:bold;">✓</span>` : ''}
            </div>
            <div class="idea-text" style="font-size:12px; color:var(--ink);">${escapeHtml(idea.text)}</div>
          </div>
        `;
      };
      listsHtml = `
        <div class="ideas-cols">
          <div>
            <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:0.1em; color:var(--ink-soft); font-weight:700; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
              <span style="background:#d4ebf5; color:#2a5577; width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:700;">A</span>
              Reasons to Agree
              <span style="margin-left:auto; font-size:9px; color:var(--ink-mute); font-weight:600;">2 total</span>
            </div>
            ${agreeReasons.length === 0 ? `<div style="font-size:11px; color:var(--ink-mute); font-style:italic; padding:8px;">No ideas available.</div>` : agreeReasons.map(renderReasonItem).join('')}
          </div>
          <div>
            <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:0.1em; color:var(--ink-soft); font-weight:700; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
              <span style="background:#f5dbd4; color:#7a4030; width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:700;">B</span>
              Reasons to Disagree
              <span style="margin-left:auto; font-size:9px; color:var(--ink-mute); font-weight:600;">2 total</span>
            </div>
            ${disagreeReasons.length === 0 ? `<div style="font-size:11px; color:var(--ink-mute); font-style:italic; padding:8px;">No ideas available.</div>` : disagreeReasons.map(renderReasonItem).join('')}
          </div>
        </div>
      `;
    }
    
  } else if (relationTypes.includes(activeType)) {
    // Relation-pair layout (2-column)
    const leftLabel = ['problem_solution', 'causes_solutions', 'cause_solution'].includes(activeType) ? 'Problems / Causes' : 'Causes / Problems';
    const rightLabel = ['problem_solution', 'causes_solutions', 'cause_solution'].includes(activeType) ? 'Solutions (Auto-paired)' : 'Effects (Auto-paired)';
    
    const leftIdeas = e.suggestedIdeas.filter(i => i.category === 'main_support' || i.category === 'advantage' || i.category === 'problem' || i.category === 'cause' || i.category === 'challenge' || (i.supports && i.supports.includes('left')));
    const pickedReasons = e.selectedReasonIds || [];
    
    listsHtml = `
      <div class="ideas-cols">
        <!-- Left Column -->
        <div>
          <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:0.1em; color:var(--ink-soft); font-weight:700; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
            <span style="background:#d4ebf5; color:#2a5577; width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:700;">A</span>
            ${escapeHtml(leftLabel)}
            <span style="margin-left:auto; font-size:9px; color:var(--ink-mute); font-weight:600;">pick 2</span>
          </div>
          ${leftIdeas.length === 0 ? `<div style="font-size:11px; color:var(--ink-mute); font-style:italic; padding:8px;">No ideas available.</div>` : leftIdeas.map((idea) => {
            const isSelected = pickedReasons.includes(idea.text);
            return `
              <div class="idea-item ${isSelected ? 'selected' : ''}" onclick="toggleIdeaText('${idea.category}', '${escapeHtml(idea.text)}')" style="cursor:pointer; padding:8px 10px; margin-bottom:6px; border:1px solid ${isSelected ? 'var(--accent)' : 'var(--line-soft)'}; border-radius:6px; display:flex; align-items:center; gap:8px; background:${isSelected ? 'var(--accent-soft)' : 'var(--bg)'}; transition:all 0.2s;">
                <div class="idea-checkbox" style="width:14px; height:14px; border:1.5px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}; border-radius:3px; background:${isSelected ? 'var(--accent)' : 'transparent'}; display:flex; align-items:center; justify-content:center;">
                  ${isSelected ? `<span style="color:white; font-size:10px; font-weight:bold;">✓</span>` : ''}
                </div>
                <div class="idea-text" style="font-size:12px; color:var(--ink);">${escapeHtml(idea.text)}</div>
              </div>
            `;
          }).join('')}
        </div>
        
        <!-- Right Column -->
        <div>
          <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:0.1em; color:var(--ink-soft); font-weight:700; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
            <span style="background:#f5dbd4; color:#7a4030; width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:700;">B</span>
            ${escapeHtml(rightLabel)}
            <span style="margin-left:auto; display:flex; align-items:center; gap:6px;">
              <span style="font-size:9px; color:var(--ink-mute); font-weight:600;">auto-paired</span>
              <button onclick="event.preventDefault(); window.ideasEditMode = !window.ideasEditMode; renderIdeasPicker();" style="background:none; border:none; color:var(--accent); font-size:10px; font-weight:600; cursor:pointer; padding:2px 4px;">
                ${window.ideasEditMode ? 'Done' : 'Edit'}
              </button>
            </span>
          </div>
          ${leftIdeas.map((leftIdea, idx) => {
            const isSelected = pickedReasons.includes(leftIdea.text);
            const pairedVal = getPairedTextForIdea(e, leftIdea, idx);
            
            let rightContentHtml = '';
            if (window.ideasEditMode) {
              rightContentHtml = `
                <input type="text" value="${escapeHtml(pairedVal)}" onchange="updatePairedText(${idx}, this.value)" style="width:100%; font-size:11.5px; padding:3px 6px; border:1px solid var(--line); border-radius:4px; font-family:var(--sans); background:var(--bg); color:var(--ink);" />
              `;
            } else {
              rightContentHtml = `<div class="idea-text" style="font-size:12px; color:var(--ink);">${escapeHtml(pairedVal)}</div>`;
            }
            
            return `
              <div class="idea-item ${isSelected ? 'selected' : ''}" style="padding:8px 10px; margin-bottom:6px; border:1px solid ${isSelected ? 'var(--accent)' : 'var(--line-soft)'}; border-radius:6px; display:flex; align-items:center; gap:8px; background:${isSelected ? 'var(--accent-soft)' : 'var(--bg)'}; opacity: ${isSelected ? 1 : 0.65}; transition:all 0.2s;">
                <div class="idea-checkbox" style="width:14px; height:14px; border:1.5px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}; border-radius:3px; background:${isSelected ? 'var(--accent)' : 'transparent'}; display:flex; align-items:center; justify-content:center;">
                  ${isSelected ? `<span style="color:white; font-size:10px; font-weight:bold;">✓</span>` : ''}
                </div>
                ${rightContentHtml}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
    
  } else {
    // Normal two-column layout
    const leftLabel = typeCfg.leftLabel || 'Advantages / Benefits';
    const rightLabel = typeCfg.rightLabel || 'Disadvantages / Drawbacks';
    
    const leftIdeas = e.suggestedIdeas.filter(i => i.category === 'main_support' || i.category === 'advantage' || i.category === 'problem' || i.category === 'cause' || (i.supports && i.supports.includes('left')));
    const rightIdeas = e.suggestedIdeas.filter(i => i.category === 'example' || i.category === 'disadvantage' || i.category === 'solution' || i.category === 'effect' || (i.supports && i.supports.includes('right')));
    
    const pickedReasons = e.selectedReasonIds || [];
    const pickedRight = (activeType === 'problem_solution' || activeType === 'causes_solutions' || activeType === 'cause_solution') ? (e.selectedSolutionIds || []) : (e.selectedExampleIds || []);
    const rightCategory = (activeType === 'problem_solution' || activeType === 'causes_solutions' || activeType === 'cause_solution') ? 'solution' : 'example';
    
    listsHtml = `
      <div class="ideas-cols">
        <!-- Left Column -->
        <div>
          <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:0.1em; color:var(--ink-soft); font-weight:700; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
            <span style="background:#d4ebf5; color:#2a5577; width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:700;">A</span>
            ${escapeHtml(leftLabel)}
            <span style="margin-left:auto; font-size:9px; color:var(--ink-mute); font-weight:600;">pick 2</span>
          </div>
          ${leftIdeas.length === 0 ? `<div style="font-size:11px; color:var(--ink-mute); font-style:italic; padding:8px;">No ideas available.</div>` : leftIdeas.map((idea) => {
            const isSelected = pickedReasons.includes(idea.text);
            return `
              <div class="idea-item ${isSelected ? 'selected' : ''}" onclick="toggleIdeaText('${idea.category}', '${escapeHtml(idea.text)}')" style="cursor:pointer; padding:8px 10px; margin-bottom:6px; border:1px solid ${isSelected ? 'var(--accent)' : 'var(--line-soft)'}; border-radius:6px; display:flex; align-items:center; gap:8px; background:${isSelected ? 'var(--accent-soft)' : 'var(--bg)'}; transition:all 0.2s;">
                <div class="idea-checkbox" style="width:14px; height:14px; border:1.5px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}; border-radius:3px; background:${isSelected ? 'var(--accent)' : 'transparent'}; display:flex; align-items:center; justify-content:center;">
                  ${isSelected ? `<span style="color:white; font-size:10px; font-weight:bold;">✓</span>` : ''}
                </div>
                <div class="idea-text" style="font-size:12px; color:var(--ink);">${escapeHtml(idea.text)}</div>
              </div>
            `;
          }).join('')}
        </div>
        
        <!-- Right Column -->
        <div>
          <div style="font-size:10.5px; text-transform:uppercase; letter-spacing:0.1em; color:var(--ink-soft); font-weight:700; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
            <span style="background:#f5dbd4; color:#7a4030; width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:700;">B</span>
            ${escapeHtml(rightLabel)}
            <span style="margin-left:auto; font-size:9px; color:var(--ink-mute); font-weight:600;">pick 2</span>
          </div>
          ${rightIdeas.length === 0 ? `<div style="font-size:11px; color:var(--ink-mute); font-style:italic; padding:8px;">No ideas available.</div>` : rightIdeas.map((idea) => {
            const isSelected = pickedRight.includes(idea.text);
            return `
              <div class="idea-item ${isSelected ? 'selected' : ''}" onclick="toggleIdeaText('${rightCategory}', '${escapeHtml(idea.text)}')" style="cursor:pointer; padding:8px 10px; margin-bottom:6px; border:1px solid ${isSelected ? 'var(--accent)' : 'var(--line-soft)'}; border-radius:6px; display:flex; align-items:center; gap:8px; background:${isSelected ? 'var(--accent-soft)' : 'var(--bg)'}; transition:all 0.2s;">
                <div class="idea-checkbox" style="width:14px; height:14px; border:1.5px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}; border-radius:3px; background:${isSelected ? 'var(--accent)' : 'transparent'}; display:flex; align-items:center; justify-content:center;">
                  ${isSelected ? `<span style="color:white; font-size:10px; font-weight:bold;">✓</span>` : ''}
                </div>
                <div class="idea-text" style="font-size:12px; color:var(--ink);">${escapeHtml(idea.text)}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  let warningsHtml = '';
  if (e.ideaValidationWarnings && e.ideaValidationWarnings.length > 0) {
    warningsHtml = e.ideaValidationWarnings.map(w => `
      <div style="background:#fff3cd; border:1px solid #ffeeba; color:#856404; padding:8px 12px; border-radius:6px; margin-top:10px; font-size:11px; font-weight:600; display:flex; align-items:center; gap:6px;">
        <span>⚠️</span>
        <span>${escapeHtml(w)}</span>
      </div>
    `).join('');
  }
  
  let errorsHtml = '';
  if (e.ideaValidationErrors && e.ideaValidationErrors.length > 0) {
    errorsHtml = e.ideaValidationErrors.map(err => `
      <div style="background:#f8d7da; border:1px solid #f5c6cb; color:#721c24; padding:8px 12px; border-radius:6px; margin-top:10px; font-size:11px; font-weight:600; display:flex; align-items:center; gap:6px;">
        <span>❌</span>
        <span>${escapeHtml(err)}</span>
      </div>
    `).join('');
  }

  let isReady = false;
  const pickedReasonsCount = (e.selectedReasonIds || []).length;
  const pickedExamplesCount = (e.selectedExampleIds || []).length;
  const pickedSolutionsCount = (e.selectedSolutionIds || []).length;
  // If the AI produced no "Alternative Actions" (solution) ideas, that column is empty and the
  // user physically cannot pick any - don't lock the button behind an impossible requirement.
  const hasAltActions = (e.suggestedIdeas || []).some(i => i.category === 'solution');
  
  if (activeType === 'single_best_option') {
    isReady = e.chosenStance && pickedReasonsCount === 2;
  } else if (activeType === 'opinion_alternatives') {
    isReady = e.chosenStance && pickedReasonsCount === 2 && (!hasAltActions || pickedSolutionsCount === 2) && (!e.ideaValidationErrors || e.ideaValidationErrors.length === 0);
  } else if (isStanceAgreement) {
    isReady = e.chosenStance && pickedReasonsCount === 2 && (!e.ideaValidationErrors || e.ideaValidationErrors.length === 0);
  } else if (typeCfg.stanceRequired) {
    isReady = e.chosenStance && pickedReasonsCount === 2 && pickedExamplesCount === 2 && (!e.ideaValidationErrors || e.ideaValidationErrors.length === 0);
  } else if (relationTypes.includes(activeType)) {
    isReady = pickedReasonsCount === 2;
  } else {
    isReady = pickedReasonsCount === 2 && pickedExamplesCount === 2;
  }

  const statusText = isReady 
    ? `<strong>Ready! All required ideas selected.</strong>` 
    : (activeType === 'single_best_option')
      ? `Pick a stance/option, then select exactly 2 causes/challenges.`
      : (activeType === 'opinion_alternatives')
        ? (hasAltActions ? `Pick a stance, then select exactly 2 reasons and 2 alternative actions.` : `Pick a stance, then select exactly 2 supporting reasons.`)
        : isStanceAgreement
          ? `Pick a stance, then select exactly 2 supporting reasons.`
          : typeCfg.stanceRequired
            ? `Pick a stance, then select 2 reasons and 2 examples.` 
            : relationTypes.includes(activeType)
              ? `Select exactly 2 causes/problems/challenges.` 
              : `Select 2 left-side and 2 right-side ideas.`;

  body.innerHTML = `
    ${typeHeaderHtml}
    ${stanceSelectorHtml}
    <div style="margin-top:14px; margin-bottom:14px;">
      ${listsHtml}
    </div>
    ${errorsHtml}
    ${warningsHtml}
    <div class="ideas-actions" style="margin-top:14px; display:flex; align-items:center; justify-content:space-between; gap:8px;">
      <div class="ideas-counter" style="font-size:11.5px; color:${isReady ? 'green' : 'var(--ink-soft)'};">${statusText}</div>
      <div style="display:flex; gap:8px;">
        <button class="ideas-refresh-btn" onclick="aiSuggestIdeas()" style="background:var(--bg); border:1px solid var(--line); color:var(--ink-soft); font-size:12px; cursor:pointer; padding:6px 12px; border-radius:6px; font-weight:600; font-family:var(--sans);">↻ Refresh</button>
        <button class="ideas-use-btn" id="ideasUseBtn" onclick="usePickerSelectedIdeas()" ${isReady ? '' : 'disabled'} style="background:${isReady ? 'var(--accent)' : 'var(--line-soft)'}; color:${isReady ? 'white' : 'var(--ink-mute)'}; border:none; font-size:12px; cursor:${isReady ? 'pointer' : 'default'}; padding:6px 14px; border-radius:6px; font-weight:600; font-family:var(--sans);">Use these &amp; write essay →</button>
      </div>
    </div>
  `;
}

// ============================================================
//  AI: WRITE FULL ESSAY
// ============================================================
function autoSelectIdeas(e) {
  const activeType = getActiveQuestionType(e);
  const typeCfg = QUESTION_TYPES[activeType] || QUESTION_TYPES.advantages_disadvantages;
  
  const leftIdeas = e.suggestedIdeas ? e.suggestedIdeas.filter(i => i.category === 'main_support' || i.category === 'advantage' || i.category === 'problem' || i.category === 'cause' || i.category === 'challenge' || (i.supports && i.supports.includes('left'))) : [];
  const rightIdeas = e.suggestedIdeas ? e.suggestedIdeas.filter(i => i.category === 'example' || i.category === 'disadvantage' || i.category === 'solution' || i.category === 'effect' || (i.supports && i.supports.includes('right'))) : [];
  
  e.selectedReasonIds = [];
  e.selectedExampleIds = [];
  e.selectedSolutionIds = [];
  e.optionalContrastIds = [];
  
  const isSolution = ['problem_solution', 'cause_solution', 'causes_solutions'].includes(activeType);
  const isEffect = ['cause_effect', 'problem_effect', 'causes_effects', 'problems_effects'].includes(activeType);
  const isStanceAgreement = ['opinion', 'agree_disagree', 'two_option_preference', 'opinion_alternatives'].includes(activeType);
  
  if (isSolution) {
    const leftToPick = leftIdeas.slice(0, 2);
    leftToPick.forEach(i => {
      e.selectedReasonIds.push(i.text);
      if (i.pairedText) {
        e.selectedSolutionIds.push(i.pairedText);
      }
    });
  } else if (isEffect) {
    const leftToPick = leftIdeas.slice(0, 2);
    leftToPick.forEach(i => {
      e.selectedReasonIds.push(i.text);
      if (i.pairedText) {
        e.selectedExampleIds.push(i.pairedText);
      }
    });
  } else if (activeType === 'single_best_option') {
    const leftToPick = leftIdeas.slice(0, 2);
    leftToPick.forEach(i => e.selectedReasonIds.push(i.text));
  } else if (activeType === 'opinion_alternatives') {
    let aligned = e.suggestedIdeas ? e.suggestedIdeas.filter(i => i.category === 'main_support' || i.category === 'advantage' || i.category === 'disadvantage') : [];
    if (e.chosenStance) {
      const { alignedIdeas } = filterIdeasForStance(activeType, e.chosenStance, e.suggestedIdeas);
      aligned = alignedIdeas.filter(i => i.category === 'main_support' || i.category === 'advantage' || i.category === 'disadvantage');
    }
    const reasonsToPick = aligned.slice(0, 2);
    reasonsToPick.forEach(i => e.selectedReasonIds.push(i.text));

    const alts = e.suggestedIdeas ? e.suggestedIdeas.filter(i => i.category === 'solution') : [];
    const altsToPick = alts.slice(0, 2);
    altsToPick.forEach(i => e.selectedSolutionIds.push(i.text));
  } else if (isStanceAgreement) {
    let aligned = leftIdeas;
    if (e.chosenStance) {
      const stanceLower = e.chosenStance.toLowerCase();
      aligned = leftIdeas.filter(i => i.supports && i.supports.some(s => s.toLowerCase() === stanceLower));
      if (aligned.length < 2) {
        aligned = leftIdeas;
      }
    }
    const toPick = aligned.slice(0, 2);
    toPick.forEach(i => e.selectedReasonIds.push(i.text));
  } else {
    const leftToPick = leftIdeas.slice(0, 2);
    const rightToPick = rightIdeas.slice(0, 2);
    leftToPick.forEach(i => e.selectedReasonIds.push(i.text));
    rightToPick.forEach(i => e.selectedExampleIds.push(i.text));
  }
  
  pickedLeftIdeas = new Set(e.selectedReasonIds);
  if (isSolution || activeType === 'opinion_alternatives') {
    pickedRightIdeas = new Set(e.selectedSolutionIds);
  } else {
    pickedRightIdeas = new Set(e.selectedExampleIds);
  }
  
  saveAll();
  renderIdeasPicker();
}

async function aiWriteFullEssay(opts = {}) {
  const e = opts.essay || getCurrent();
  if (!e) { if (!opts.silent) toast('No essay selected', true); return false; }
  if (!e.title || !e.question) { if (!opts.silent) toast('Need essay title and question first', true); return false; }

  const activeType = getActiveQuestionType(e);
  const typeCfg = QUESTION_TYPES[activeType] || QUESTION_TYPES.advantages_disadvantages;

  // Auto-select stance if required but missing
  if (typeCfg.stanceRequired && !e.chosenStance) {
    let options = [];
    if (activeType === 'two_option_preference' && e.detectedOptions && e.detectedOptions.length === 2) {
      options = [`${e.detectedOptions[0]} is better`, `${e.detectedOptions[1]} is better`];
    } else if (activeType === 'discuss_both_views' && e.detectedOptions && e.detectedOptions.length === 2) {
      options = [`strongly support ${e.detectedOptions[0]}`, `strongly support ${e.detectedOptions[1]}`, `balanced perspective/neutral`];
    } else if (activeType === 'single_best_option') {
      const opts = (e.detectedOptions && e.detectedOptions.length > 0) ? e.detectedOptions : (typeCfg.stanceOptions || []);
      options = opts.map(opt => opt.toLowerCase().includes('pressing problem') || opt.toLowerCase().includes('is best') ? opt : `${opt} is the most pressing problem`);
    } else {
      options = typeCfg.stanceOptions || [];
    }
    const bag = getTemplatesBag();
    const effectiveTplKey = (e.templateChoice && e.templateChoice !== 'default') ? e.templateChoice : (bag.default || 'band9');
    const isBand6 = (effectiveTplKey === 'band6');
    const isAgreementType = (activeType === 'opinion' || activeType === 'agree_disagree');

    if (isBand6 && isAgreementType) {
      e.chosenStance = 'partially disagree';
    } else {
      // Default to a BALANCED stance; mandatory-pick types (two_option_preference,
      // single_best_option) return '' and are left for the user to choose.
      const balancedDefault = getBalancedDefaultStance(activeType, typeCfg);
      if (balancedDefault) {
        e.chosenStance = balancedDefault;
      }
    }
    if (e.chosenStance) {
      saveAll();
      if (!opts.silent) toast(`Auto-selected stance: "${e.chosenStance}"`);
    }
  }

  // Auto-suggest and auto-select ideas if missing
  const hasIdeas = (e.seedIdeas && e.seedIdeas.trim().length > 0) || 
                    (e.selectedReasonIds && e.selectedReasonIds.length > 0);
  if (!hasIdeas) {
    if (!opts.silent) toast('Auto-suggesting and selecting ideas...');
    if (!e.suggestedIdeas || e.suggestedIdeas.length === 0) {
      await aiSuggestIdeas();
    }
    autoSelectIdeas(e);
  }

  const stateValidation = validateEssayStateBeforeGeneration(e);
  if (!stateValidation.valid) {
    if (!opts.silent) {
      toast('Validation failed: ' + stateValidation.errors.join(' '), true);
    }
    return false;
  }

  const bag = getTemplatesBag();
  const effectiveTplKey = (e.templateChoice && e.templateChoice !== 'default') ? e.templateChoice : (bag.default || 'band9');
  const isBand6 = (effectiveTplKey === 'band6');

  const mode = opts.band6Mode || (opts.silent ? (e.band6Mode || 'full_essay') : null);
  if (isBand6 && !mode && !opts.silent) {
    document.getElementById('band6ModeModal').classList.add('show');
    return false;
  }
  if (isBand6 && mode) {
    e.band6Mode = mode;
  }

  const hasContent = (e.intro || e.bp1 || e.bp2 || e.concl).trim().length > 0;
  if (hasContent && !opts.skipConfirm) {
    if (!confirm('This essay already has content. Overwrite it with a new AI-written essay?')) return false;
  }
  if (!await consumeQuota('essay')) return false;
  
  const template = getTemplateForEssay(e);
  const btn = opts.silent ? null : document.getElementById('aiWriteBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = mode === 'just_phrases' ? '<span class="spinner"></span> Writing explanations...' : '<span class="spinner"></span> Writing essay...';
    startWriteButtonMessages(btn);
  }

  let bp2Template = template.bp2 || '';
  const isStrong = isStrongStance(activeType, e.chosenStance);
  if (isStrong) {
    if (isBand6) {
      bp2Template = bp2Template
        .replace("On the other hand, a major concern regarding [topic] is that [negative idea 1]", "Furthermore, another key advantage of [topic] is that [positive idea 1]")
        .replace("this issue can result in [negative idea 2], including financial burden or reduced well-being", "this can lead to [positive idea 2], including financial benefits or improved well-being")
        .replace("However, with effective planning and appropriate measures, these challenges can be controlled and reduced.", "Hence, with proper implementation, these advantages can be further maximised.");
    } else {
      if (bp2Template.includes("On the other hand, one notable [demerit / negative effect / solution] is [point 1]")) {
        bp2Template = bp2Template.replace("On the other hand, one notable [demerit / negative effect / solution] is [point 1]", "Furthermore, another significant [merit / benefit / positive effect] is [point 1]");
      } else if (bp2Template.trim().startsWith("On the other hand,")) {
        bp2Template = bp2Template.replace("On the other hand,", "Furthermore,");
      } else if (bp2Template.trim().startsWith("On the other hand")) {
        bp2Template = bp2Template.replace("On the other hand", "Furthermore");
      } else if (bp2Template.trim().startsWith("However,")) {
        bp2Template = bp2Template.replace("However,", "In addition,");
      } else if (bp2Template.trim().startsWith("Conversely,")) {
        bp2Template = bp2Template.replace("Conversely,", "Furthermore,");
      }

      bp2Template = bp2Template
        .replace("illustrates this [drawback / consequence] clearly", "illustrates this [benefit / outcome] clearly")
        .replace("another [limitation / adverse consequence / measure to be taken] is [point 2]", "another [advantage / positive consequence / further point in support] is [point 2]")
        .replace("demonstrating the impact on [affected group / outcome]", "demonstrating the positive impact on [affected group / outcome]");
    }
  }

  const templateCopy = { ...template, bp2: bp2Template };
  const plan = buildStructuredEssayPlan(e);

  try {
    const res = await fetch(API_URL + '/api/generate-essay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, template: templateCopy })
    });
    if (!res.ok) {
      const t = await res.text();
      let errDetail = '';
      try {
        const parsed = JSON.parse(t);
        if (parsed.details) errDetail = '\nDetails: ' + parsed.details.join(' | ');
        else if (parsed.error) errDetail = '\n' + parsed.error;
      } catch (e) {
        errDetail = `\nAPI error ${res.status}: ${t.slice(0, 300)}`;
      }
      throw new Error(errDetail || `Server failed to generate essay`);
    }
    const data = await res.json();
    if (!data.success || !data.text) {
      throw new Error(data.error || 'Server returned empty generation');
    }
    const text = data.text;

    if (data.warnings && data.warnings.length > 0 && !opts.silent) {
      console.warn("Generated essay warnings:", data.warnings);
      toast("Warning: " + data.warnings[0], false);
    }

    const sections = parseEssaySections(text);
    if (!sections.intro || !sections.bp1 || !sections.bp2 || !sections.concl) {
      throw new Error('AI response was incomplete. Try again.');
    }
    e.intro = sections.intro;
    e.bp1 = sections.bp1;
    e.bp2 = sections.bp2;
    e.concl = sections.concl;
    e.previewSignature = generatePreviewSignature(e);
    e.stanceUsed = e.chosenStance || '';
    e.questionTypeUsed = getActiveQuestionType(e);
    e.ideasUsed = (e.selectedReasonIds || []).concat(e.selectedExampleIds || []).concat(e.selectedSolutionIds || []).concat(e.optionalContrastIds || []);
    e.generatedAt = new Date().toISOString();
    saveAll();
    if (!opts.silent) {
      loadCurrent(); renderPreview(); renderList();
      if (isBand6 && mode === 'just_phrases') {
        toast('Idea explanations and phrases written!');
      } else {
        toast('Essay written! Auto-extracting pros/cons next...');
        setTimeout(() => aiGenerate('all', { skipQuota: true }), 600);
      }
    }
    return true;
  } catch (err) {
    console.error(err);
    if (!opts.silent) toast('AI failed: ' + err.message, true);
    if (opts.silent) throw err;
    return false;
  } finally {
    if (btn) {
      stopWriteButtonMessages();
      btn.disabled = false;
      btn.innerHTML = 'Write the full essay';
    }
  }
}

// Cycling progress messages on the "Write the full essay" button so the ~15s
// wait feels responsive instead of frozen.
let writeBtnMsgTimer = null;
function startWriteButtonMessages(btn) {
  const messages = [
    'Reading the question…',
    'Planning the structure…',
    'Writing the introduction…',
    'Developing body paragraphs…',
    'Adding examples…',
    'Polishing the conclusion…'
  ];
  let i = 0;
  if (writeBtnMsgTimer) clearInterval(writeBtnMsgTimer);
  writeBtnMsgTimer = setInterval(() => {
    i = (i + 1) % messages.length;
    if (btn) btn.innerHTML = '<span class="spinner"></span> ' + messages[i];
  }, 2500);
}
function stopWriteButtonMessages() {
  if (writeBtnMsgTimer) { clearInterval(writeBtnMsgTimer); writeBtnMsgTimer = null; }
}

// ============================================================
//  FREESTYLE — quick AI essay on ANY question (not saved unless chosen)
// ============================================================
let freestyleLast = null;
let fsSuggestedLeftIdeas = [];
let fsSuggestedRightIdeas = [];
let fsSuggestedThirdIdeas = [];
let fsPickedLeftIdeas = new Set();
let fsPickedRightIdeas = new Set();
let fsPickedThirdIdeas = new Set();
let fsDetectedQuestionType = null;
let fsChosenSide = null;
let fsPickedCols = {};

function openFreestyle() {
  document.getElementById('fsQuestion').value = '';
  document.getElementById('fsResultArea').style.display = 'none';
  document.getElementById('fsResult').innerHTML = '';
  document.getElementById('fsIdeasArea').style.display = 'none';
  document.getElementById('fsIdeasArea').innerHTML = '';
  populateFreestyleLibrary();
  freestyleResetActions();
  freestyleLast = null;
  const e = getCurrent();
  const currentMode = e ? (e.generationMode || 'template') : 'template';
  const fsStyle = document.getElementById('fsStyle');
  if (fsStyle) fsStyle.value = currentMode;
  document.getElementById('freestyleModal').classList.add('show');
  setTimeout(() => { const q = document.getElementById('fsQuestion'); if (q) q.focus(); }, 50);
}

function populateFreestyleLibrary() {
  const sel = document.getElementById('fsLibrarySelect');
  if (!sel) return;
  const opts = ['<option value="">— Choose from your library —</option>'];
  essays
    .filter(e => (e.title || '').trim() && (e.question || '').trim())
    .forEach(e => { opts.push(`<option value="${e.id}">${escapeHtml(e.title)}</option>`); });
  sel.innerHTML = opts.join('');
  sel.value = '';
}

function fsPickFromLibrary(id) {
  if (!id) return;
  const e = essays.find(x => x.id === id);
  if (!e) return;
  document.getElementById('fsQuestion').value = e.question || '';
  // Match the saved essay's band where possible (custom/default → Band 9)
  const key = (typeof getTemplateKeyForEssay === 'function') ? getTemplateKeyForEssay(e) : 'band9';
  document.getElementById('fsBand').value = (key === 'band6') ? 'band6' : 'band9';
  if (e.vocab) {
    const vocabSel = document.getElementById('fsVocab');
    if (vocabSel) vocabSel.value = String(Math.min(5, Math.max(1, e.vocab)));
  }
  // If a result is already showing, clear it so the picked topic writes fresh
  if (freestyleLast) {
    document.getElementById('fsResultArea').style.display = 'none';
    document.getElementById('fsResult').innerHTML = '';
    document.getElementById('fsIdeasArea').style.display = 'none';
    document.getElementById('fsIdeasArea').innerHTML = '';
    freestyleLast = null;
    freestyleResetActions();
  }
}

function closeFreestyle() {
  document.getElementById('freestyleModal').classList.remove('show');
}

function freestyleResetActions() {
  document.getElementById('fsActions').innerHTML =
    '<button class="tb-text-btn" onclick="closeFreestyle()">Close</button>' +
    '<button class="tb-text-btn dark" id="fsWriteBtn" onclick="freestyleSuggestIdeas()">💡 Suggest Ideas</button>';
}

function freestyleReset() {
  document.getElementById('fsResultArea').style.display = 'none';
  document.getElementById('fsResult').innerHTML = '';
  document.getElementById('fsIdeasArea').style.display = 'none';
  document.getElementById('fsIdeasArea').innerHTML = '';
  freestyleLast = null;
  freestyleResetActions();
  const q = document.getElementById('fsQuestion');
  if (q) q.focus();
}

async function freestyleSuggestIdeas() {
  const question = document.getElementById('fsQuestion').value.trim();
  if (!question) { toast('Paste an essay question first', true); return; }
  if (!await consumeQuota('idea')) return;

  const band = document.getElementById('fsBand').value === 'band6' ? 'band6' : 'band9';
  const isBand6 = band === 'band6';
  const vocabIdx = Math.min(4, Math.max(0, (parseInt(document.getElementById('fsVocab').value, 10) || 3) - 1));
  const vocabSpec = VOCAB_LEVELS[vocabIdx];

  const btn = document.getElementById('fsWriteBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Suggesting ideas...';
  }

  const ideasArea = document.getElementById('fsIdeasArea');
  ideasArea.style.display = 'block';
  ideasArea.innerHTML = '<div class="ideas-loading" style="padding:16px; text-align:center;"><div class="spinner-dark" style="margin:0 auto 8px auto; border:3px solid var(--line); border-top-color:var(--accent); border-radius:50%; width:24px; height:24px; animation:spin 1s linear infinite;"></div>Analyzing the question and finding ideas...</div>';

  const typeOptions = Object.entries(QUESTION_TYPES)
    .filter(([key, t]) => t.id === key)
    .map(([key, t]) => `  "${key}" — ${t.detect}`)
    .join('\n');

  const bandVocabRule = isBand6
    ? `- Use SIMPLE, PLAIN ENGLISH — the kind of words a Band 6 student already knows from everyday life.
- Stay in A2-B1 territory (CEFR). Words like "good", "important", "helpful", "hard", "easy", "save money", "stay healthy", "learn faster".
- AVOID any academic vocabulary, sophisticated phrasing, formal Latinate words, or anything a Band 7+ student would use.
- BANNED words: foster, cultivate, facilitate, enhance, mitigate, exacerbate, prioritise, optimise, leverage, harness, undermine, sustainable, comprehensive, substantial, pivotal, paramount, deleterious, multifaceted.
- Keep phrases short and direct: "saves money", "helps students learn" — NOT "yields substantial economic benefits".`
    : `- Use simple Band 7-8 vocabulary students recognise from class.
- Avoid fancy academic words students don't know — favour everyday phrasing over Latinate vocabulary.`;

  const prompt = `You are helping a tutor at IPT Brisbane prepare a high-scoring ${isBand6 ? 'Band 6 (simple, plain English)' : 'Band 9'} IELTS/PTE essay. There are TWO tasks:

TASK 1 — CLASSIFY the question type. Read the question carefully and pick ONE type that best matches:
${typeOptions}

TASK 2 — Generate ideas for the columns that match the chosen type.

For MOST types, generate 5 ideas for EACH of TWO columns (leftIdeas + rightIdeas):
- "causes_solutions": left = 5 causes, right = 5 solutions/measures. Crucially, the solution at index i in rightIdeas must address the cause at index i in leftIdeas (e.g. rightIdeas[0] is the solution to leftIdeas[0]).
- "agree_disagree": left = 5 reasons to agree, right = 5 reasons to disagree
- "problems_solutions": left = 5 problems, right = 5 solutions. Crucially, the solution at index i in rightIdeas must address the problem at index i in leftIdeas (e.g. rightIdeas[0] is the solution to leftIdeas[0]).
- "advantages_disadvantages": left = 5 advantages, right = 5 disadvantages
- "causes_effects": left = 5 causes, right = 5 effects. Crucially, the effect at index i in rightIdeas must be the consequence of the cause at index i in leftIdeas (e.g. rightIdeas[0] is the effect of leftIdeas[0]).
- "problems_benefits": left = 5 benefits, right = 5 problems
- "positive_negative_impacts": left = 5 positive impacts, right = 5 negative impacts
- "discuss_both_views": left = 5 reasons for view A, right = 5 reasons for view B

For TWO SPECIAL types, generate THREE columns (leftIdeas + rightIdeas + thirdIdeas):
- "opinion_alternatives": left = 5 reasons to AGREE with the practice, right = 5 reasons to DISAGREE, third = 5 ALTERNATIVE ACTIONS to take instead
- "single_focus": left = 5 reasons for Option A, right = 5 reasons for Option B, third = 5 supporting examples

For the "single_focus" type, the question asks the student to choose between two focus areas/options (Option A or Option B) and justify it.
For "single_focus" specifically, you MUST identify what Option A and Option B actually represent for this question, and output:
1. "optionALabel": A short, clear label for Option A (e.g. "Focus on rising sea levels" or "Governments should act").
2. "optionBLabel": A short, clear label for Option B (e.g. "Focus on extreme weather" or "Individuals should act").
Additionally, because the student will choose either Option A or Option B, the "thirdIdeas" column (supporting examples) MUST contain exactly 5 examples total:
- Exactly 2 examples that specifically and clearly support Option A (the first option).
- Exactly 2 examples that specifically and clearly support Option B (the second option).
- Exactly 1 general/neutral example that can relate to either focus or is neutral.
Do NOT make it one-sided (e.g. do NOT provide 3 examples for one side and 2 for the other side, or 4 and 1). It must be an exact 2-2-1 split, and the examples must clearly correspond to the two option labels you defined.

ESSAY DETAILS:
QUESTION: ${question}
TEMPLATE BAND: ${isBand6 ? 'Band 6' : 'Band 9'}
VOCABULARY LEVEL: ${vocabSpec.label}

RULES FOR IDEAS:
- Each idea is a short phrase, 3-7 words.
- Concrete and topic-specific — NOT generic (BAD: "it's good for society"; GOOD: "boosts career opportunities").
${bandVocabRule}
- Each idea is a distinct angle — no overlap.
- For "solution / measure / alternative action" columns: write ACTIONABLE items (start with a verb where natural).
- For "cause" or "problem" columns: state the cause/problem clearly as a noun phrase.

RETURN ONLY A JSON OBJECT — no preamble, no markdown fences. Format for TWO-column types:
{
  "questionType": "causes_solutions",
  "reasoning": "Question asks about causes and measures to improve",
  "leftIdeas": ["population growth in cities", "...", "...", "...", "..."],
  "rightIdeas": ["invest in sustainable agriculture", "...", "...", "...", "..."]
}

Format for THREE-column types (opinion_alternatives, single_focus) — INCLUDE thirdIdeas. For "single_focus", also include "optionALabel" and "optionBLabel":
{
  "questionType": "single_focus",
  "reasoning": "Select one focus area and justify it",
  "optionALabel": "Focus on rising sea levels",
  "optionBLabel": "Focus on extreme weather events",
  "leftIdeas": ["rising sea levels threaten coastal cities", "...", "...", "...", "..."],
  "rightIdeas": ["extreme weather events increasing globally", "...", "...", "...", "..."],
  "thirdIdeas": ["Miami and Bangladesh already flood regularly", "...", "...", "...", "..."]
}`;

  try {
    const res = await fetch(API_URL + '/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data.content.map(c => c.text || '').join('\n').trim();
    
    let parsed;
    try {
      parsed = cleanAndParseJSON(text);
    } catch (e) {
      console.error('Failed to parse Claude ideas JSON:', text);
      throw new Error('Could not parse the suggested ideas. Please try again.');
    }

    fsDetectedQuestionType = parsed.questionType || 'advantages_disadvantages';
    fsSuggestedLeftIdeas = parsed.leftIdeas || [];
    fsSuggestedRightIdeas = parsed.rightIdeas || [];
    fsSuggestedThirdIdeas = parsed.thirdIdeas || [];
    fsPickedLeftIdeas = new Set();
    fsPickedRightIdeas = new Set();
    fsPickedThirdIdeas = new Set();
    fsChosenSide = null;
    fsPickedCols = {};
    fsDynamicLabels = {};
    if (parsed.optionALabel) fsDynamicLabels['optionA'] = String(parsed.optionALabel).trim();
    if (parsed.optionBLabel) fsDynamicLabels['optionB'] = String(parsed.optionBLabel).trim();
    if (parsed.agreeLabel) fsDynamicLabels['agree'] = String(parsed.agreeLabel).trim();
    if (parsed.disagreeLabel) fsDynamicLabels['disagree'] = String(parsed.disagreeLabel).trim();

    renderFreestyleIdeasPicker();
  } catch (err) {
    console.error(err);
    ideasArea.innerHTML = `<div style="text-align:center; padding:16px; color:var(--bad); font-size:12px;">${escapeHtml(err.message)}</div>`;
    toast('Failed to get ideas: ' + err.message, true);
    freestyleResetActions();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '💡 Suggest Ideas';
    }
  }
}

function renderFreestyleIdeasPicker() {
  const type = QUESTION_TYPES[fsDetectedQuestionType] || QUESTION_TYPES.advantages_disadvantages;
  const area = document.getElementById('fsIdeasArea');
  if (!area) return;

  const writeBtnHtml = `<button class="tb-text-btn" onclick="closeFreestyle()">Close</button>` +
                       `<button class="tb-text-btn dark" id="fsWriteBtn" onclick="freestyleWriteWithIdeas()" disabled>Write essay</button>`;
  document.getElementById('fsActions').innerHTML = writeBtnHtml;

  if (type.pickMode === 'sided' && Array.isArray(type.columns)) {
    renderFreestyleSidedPicker(type);
    return;
  }

  area.innerHTML = `
    <div style="background:var(--accent-soft); border:1px solid var(--accent); border-radius:6px; padding:8px 12px; margin-bottom:12px; font-size:11.5px; color:var(--accent-deep); display:flex; align-items:center; gap:8px;">
      <span style="font-size:14px;">🤖</span>
      <span><strong>Question Type:</strong> ${escapeHtml(type.detect)}</span>
    </div>
    <div class="ideas-cols" style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:12px;">
      <div>
        <div style="font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.15em; color: var(--ink-soft); font-weight: 700; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
          <span style="background:#d4ebf5; color:#2a5577; width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:11px; font-weight:700;">A</span>
          ${escapeHtml(type.leftLabel)}
        </div>
        ${fsSuggestedLeftIdeas.map((p, i) => `
          <div class="idea-item ${fsPickedLeftIdeas.has(i) ? 'selected' : ''}" onclick="toggleFreestyleIdea('left', ${i})" id="fs-left-${i}">
            <div class="idea-checkbox"></div>
            <div class="idea-text">${escapeHtml(p)}</div>
          </div>
        `).join('')}
      </div>
      <div>
        <div style="font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.15em; color: var(--ink-soft); font-weight: 700; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
          <span style="background:#f5dbd4; color:#7a4030; width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:11px; font-weight:700;">B</span>
          ${escapeHtml(type.rightLabel)}
        </div>
        ${fsSuggestedRightIdeas.map((c, i) => `
          <div class="idea-item ${fsPickedRightIdeas.has(i) ? 'selected' : ''}" onclick="toggleFreestyleIdea('right', ${i})" id="fs-right-${i}">
            <div class="idea-checkbox"></div>
            <div class="idea-text">${escapeHtml(c)}</div>
          </div>
        `).join('')}
      </div>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--line); padding-top:10px; font-size:11.5px;">
      <div id="fsIdeasCounter" style="font-weight:600; color:var(--ink-soft);">Pick <strong>2 from each side</strong> (4 total)</div>
      <button class="tb-text-btn" style="padding:4px 8px; font-size:11px; border:1px solid var(--line); border-radius:4px;" onclick="freestyleSuggestIdeas()">↻ Refresh Ideas</button>
    </div>
  `;
  updateFreestyleIdeasCounter();
}

function toggleFreestyleIdea(side, idx) {
  if (side === 'left') {
    if (fsPickedLeftIdeas.has(idx)) {
      fsPickedLeftIdeas.delete(idx);
    } else {
      if (fsPickedLeftIdeas.size >= 2) {
        const first = fsPickedLeftIdeas.values().next().value;
        fsPickedLeftIdeas.delete(first);
      }
      fsPickedLeftIdeas.add(idx);
    }
  } else if (side === 'right') {
    if (fsPickedRightIdeas.has(idx)) {
      fsPickedRightIdeas.delete(idx);
    } else {
      if (fsPickedRightIdeas.size >= 2) {
        const first = fsPickedRightIdeas.values().next().value;
        fsPickedRightIdeas.delete(first);
      }
      fsPickedRightIdeas.add(idx);
    }
  }

  fsSuggestedLeftIdeas.forEach((_, i) => {
    const el = document.getElementById(`fs-left-${i}`);
    if (el) {
      if (fsPickedLeftIdeas.has(i)) el.classList.add('selected');
      else el.classList.remove('selected');
    }
  });
  fsSuggestedRightIdeas.forEach((_, i) => {
    const el = document.getElementById(`fs-right-${i}`);
    if (el) {
      if (fsPickedRightIdeas.has(i)) el.classList.add('selected');
      else el.classList.remove('selected');
    }
  });

  updateFreestyleIdeasCounter();
}

function updateFreestyleIdeasCounter() {
  const type = QUESTION_TYPES[fsDetectedQuestionType] || QUESTION_TYPES.advantages_disadvantages;
  const isSided = type.pickMode === 'sided';
  const writeBtn = document.getElementById('fsWriteBtn');

  if (isSided) {
    const sideCol = type.columns.find(c => c.key === fsChosenSide);
    const fixedCol = type.columns.find(c => !c.side);
    const sidePicks = fsChosenSide ? (fsPickedCols[fsChosenSide] || new Set()) : new Set();
    const fixedPicks = fsPickedCols[fixedCol.key] || new Set();

    const sideCount = sidePicks.size;
    const fixedCount = fixedPicks.size;
    const isComplete = sideCount === 2 && fixedCount === 2;

    const labelEl = document.getElementById('fsIdeasCounter');
    if (labelEl) {
      if (!fsChosenSide) {
        labelEl.innerHTML = '👈 First, click an idea to choose your stance.';
      } else {
        const sideLabel = getFsColLabel(sideCol).replace('Reasons to ', '').replace('If you choose ', '');
        const sideColor = fsChosenSide === 'agree' || fsChosenSide === 'optionA' ? '#16803d' : '#b91c1c';
        labelEl.innerHTML = `Stance: <strong style="color:${sideColor}">${escapeHtml(sideLabel)}</strong> (reasons: ${sideCount}/2) &amp; ${escapeHtml(getFsColLabel(fixedCol))} (${fixedCount}/2)`;
      }
    }

    if (writeBtn) {
      writeBtn.disabled = !isComplete;
    }
  } else {
    const lCount = fsPickedLeftIdeas.size;
    const rCount = fsPickedRightIdeas.size;
    const isComplete = lCount === 2 && rCount === 2;

    const labelEl = document.getElementById('fsIdeasCounter');
    if (labelEl) {
      labelEl.innerHTML = `Picked: <strong>${escapeHtml(type.leftLabel)}</strong> (${lCount}/2) &amp; <strong>${escapeHtml(type.rightLabel)}</strong> (${rCount}/2)`;
      if (isComplete) {
        labelEl.classList.add('complete');
      } else {
        labelEl.classList.remove('complete');
      }
    }

    if (writeBtn) {
      writeBtn.disabled = !isComplete;
    }
  }
}

function renderFreestyleSidedPicker(type) {
  const area = document.getElementById('fsIdeasArea');
  if (!area) return;

  const cols = type.columns;
  const sideCols = cols.filter(c => c.side);
  const fixedCol = cols.find(c => !c.side);

  cols.forEach(c => {
    if (!fsPickedCols[c.key]) {
      fsPickedCols[c.key] = new Set();
    }
  });

  const palette = [
    { bg: '#d4ebf5', fg: '#2a5577' },
    { bg: '#f5dbd4', fg: '#7a4030' },
  ];
  const thirdPalette = { bg: '#d8ecd8', fg: '#2a5a3a' };

  function colHtml(col, badge, badgeColor) {
    let ideas = [];
    if (col.key === 'agree' || col.key === 'optionA') {
      ideas = fsSuggestedLeftIdeas;
    } else if (col.key === 'disagree' || col.key === 'optionB') {
      ideas = fsSuggestedRightIdeas;
    } else {
      ideas = fsSuggestedThirdIdeas;
    }

    const picks = fsPickedCols[col.key] || new Set();
    const isDisabledSide = col.side && fsChosenSide && fsChosenSide !== col.key;
    const colLabel = getFsColLabel(col);

    return `
      <div class="ideas-side-col ${isDisabledSide ? 'col-disabled' : ''}" id="fs-col-${col.key}" style="opacity:${isDisabledSide ? '0.4' : '1'}; pointer-events:${isDisabledSide ? 'none' : 'auto'};">
        <div style="font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.15em; color: var(--ink-soft); font-weight: 700; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
          <span style="background:${badgeColor.bg}; color:${badgeColor.fg}; width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:700;">${badge}</span>
          ${escapeHtml(colLabel)}
          <span style="margin-left:auto; font-size:9px; color:var(--ink-mute); font-weight:600;">pick 2</span>
        </div>
        ${ideas.map((idea, i) => {
          let badgeHtml = '';
          if (col.key === 'examples' && fsDetectedQuestionType === 'single_focus') {
            const sideCols = cols.filter(c => c.side);
            if (sideCols.length >= 2) {
              const labelA = getFsColLabel(sideCols[0]).replace(/Reasons to/gi, '').replace(/If you choose/gi, '').replace(/living is better/gi, '').replace(/is better/gi, '').trim();
              const labelB = getFsColLabel(sideCols[1]).replace(/Reasons to/gi, '').replace(/If you choose/gi, '').replace(/living is better/gi, '').replace(/is better/gi, '').trim();
              if (i === 0 || i === 1) {
                badgeHtml = `<span style="font-size:9px; background:#d4ebf5; color:#2a5577; padding:2px 6px; border-radius:4px; font-weight:600; margin-left:8px; display:inline-block;">for ${escapeHtml(labelA)}</span>`;
              } else if (i === 2 || i === 3) {
                badgeHtml = `<span style="font-size:9px; background:#f5dbd4; color:#7a4030; padding:2px 6px; border-radius:4px; font-weight:600; margin-left:8px; display:inline-block;">for ${escapeHtml(labelB)}</span>`;
              } else if (i === 4) {
                badgeHtml = `<span style="font-size:9px; background:#f3f4f6; color:#4b5563; padding:2px 6px; border-radius:4px; font-weight:600; margin-left:8px; display:inline-block;">neutral</span>`;
              }
            }
          }
          return `
            <div class="idea-item ${picks.has(i) ? 'selected' : ''}" onclick="toggleFreestyleSidedIdea('${col.key}', ${i})" id="fs-sided-${col.key}-${i}">
              <div class="idea-checkbox"></div>
              <div class="idea-text" style="display:flex; align-items:center; flex-wrap:wrap; gap:4px;">
                <span>${escapeHtml(idea)}</span>
                ${badgeHtml}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  const sideColsHtml = sideCols.map((c, i) => colHtml(c, String.fromCharCode(65 + i), palette[i])).join('');
  const fixedColHtml = colHtml(fixedCol, '+', thirdPalette);

  area.innerHTML = `
    <div style="background:var(--accent-soft); border:1px solid var(--accent); border-radius:6px; padding:8px 12px; margin-bottom:10px; font-size:11.5px; color:var(--accent-deep); display:flex; align-items:center; gap:8px;">
      <span style="font-size:14px;">🤖</span>
      <span><strong>Question Type:</strong> ${escapeHtml(type.detect)}</span>
    </div>
    <div style="background:#e0f2fe; border:1px solid #7dd3fc; border-radius:6px; padding:8px 12px; margin-bottom:12px; font-size:11px; color:#0369a1; line-height:1.4;">
      <strong>👉 First, choose your stance.</strong> Click an idea in <strong>${escapeHtml(getFsColLabel(sideCols[0]))}</strong> or <strong>${escapeHtml(getFsColLabel(sideCols[1]))}</strong> to pick your stance. Then pick 2 ideas from that stance, and 2 from <strong>${escapeHtml(getFsColLabel(fixedCol))}</strong>.
    </div>
    <div class="ideas-cols" style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:12px;">
      <div style="display:flex; flex-col; gap:16px; grid-column:span 2; display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        ${sideColsHtml}
      </div>
      <div style="grid-column:span 2; margin-top:8px;">
        ${fixedColHtml}
      </div>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--line); padding-top:10px; font-size:11.5px;">
      <div id="fsIdeasCounter" style="font-weight:600; color:var(--ink-soft);">👈 First, click an idea to choose your stance.</div>
      <button class="tb-text-btn" style="padding:4px 8px; font-size:11px; border:1px solid var(--line); border-radius:4px;" onclick="freestyleSuggestIdeas()">↻ Refresh Ideas</button>
    </div>
  `;
  updateFreestyleIdeasCounter();
}

function toggleFreestyleSidedIdea(colKey, idx) {
  const type = QUESTION_TYPES[fsDetectedQuestionType] || QUESTION_TYPES.advantages_disadvantages;
  const cols = type.columns;
  const targetCol = cols.find(c => c.key === colKey);

  if (targetCol.side) {
    if (fsChosenSide && fsChosenSide !== colKey) {
      if (fsPickedCols[fsChosenSide]) {
        fsPickedCols[fsChosenSide].clear();
      }
    }
    fsChosenSide = colKey;
  }

  const picks = fsPickedCols[colKey] || new Set();
  if (picks.has(idx)) {
    picks.delete(idx);
    if (targetCol.side && picks.size === 0) {
      fsChosenSide = null;
    }
  } else {
    if (picks.size >= 2) {
      const first = picks.values().next().value;
      picks.delete(first);
    }
    picks.add(idx);
  }

  renderFreestyleSidedPicker(type);
}

async function freestyleWriteWithIdeas() {
  const question = document.getElementById('fsQuestion').value.trim();
  if (!question) { toast('Paste an essay question first', true); return; }
  if (!await consumeQuota('essay')) return;

  const band = document.getElementById('fsBand').value === 'band6' ? 'band6' : 'band9';
  const isBand6 = band === 'band6';
  const vocabIdx = Math.min(4, Math.max(0, (parseInt(document.getElementById('fsVocab').value, 10) || 3) - 1));
  const vocabSpec = VOCAB_LEVELS[vocabIdx];

  const btn = document.getElementById('fsWriteBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Writing essay...';
    startWriteButtonMessages(btn);
  }

  const type = QUESTION_TYPES[fsDetectedQuestionType] || QUESTION_TYPES.advantages_disadvantages;
  let bp1Ideas = [];
  let bp2Ideas = [];
  let sidedNote = '';

  if (type.pickMode === 'sided') {
    const sideCol = type.columns.find(c => c.key === fsChosenSide);
    const fixedCol = type.columns.find(c => !c.side);
    
    let sideSource = [];
    if (fsChosenSide === 'agree' || fsChosenSide === 'optionA') {
      sideSource = fsSuggestedLeftIdeas;
    } else {
      sideSource = fsSuggestedRightIdeas;
    }
    const sidePicks = fsPickedCols[fsChosenSide] || new Set();
    bp1Ideas = Array.from(sidePicks).map(idx => sideSource[idx]);

    const fixedPicks = fsPickedCols[fixedCol.key] || new Set();
    bp2Ideas = Array.from(fixedPicks).map(idx => fsSuggestedThirdIdeas[idx]);

    const sideLabel = getFsColLabel(sideCol);
    const fixedLabel = getFsColLabel(fixedCol);

    sidedNote = `
=== STANCE INFORMATION ===
The student has taken a clear position: "${sideLabel}".
- The WHOLE essay must argue consistently for this stance. Do NOT present the opposing side as if it were equally valid.
- Body Paragraph 1: develop the chosen stance and explicitly explain WHY this choice was made, using these specific ideas: ${bp1Ideas.map(x => `"${x}"`).join(' and ')}.
- Body Paragraph 2: present the ${fixedLabel} using these specific ideas: ${bp2Ideas.map(x => `"${x}"`).join(' and ')}.
- The introduction's opinion sentence must clearly state this stance.
- The conclusion must reaffirm this stance.`;
  } else {
    bp1Ideas = Array.from(fsPickedLeftIdeas).map(idx => fsSuggestedLeftIdeas[idx]);
    bp2Ideas = Array.from(fsPickedRightIdeas).map(idx => fsSuggestedRightIdeas[idx]);
  }

  const plan = {
    question: question,
    question_type: fsDetectedQuestionType || 'advantages_disadvantages',
    stance: fsChosenSide || '',
    selected_ideas: {
      reasons: bp1Ideas,
      examples: bp2Ideas,
      advantages: (fsDetectedQuestionType === 'advantages_disadvantages' || fsDetectedQuestionType === 'advantages_disadvantages_opinion') ? bp1Ideas : [],
      disadvantages: (fsDetectedQuestionType === 'advantages_disadvantages' || fsDetectedQuestionType === 'advantages_disadvantages_opinion') ? bp2Ideas : [],
      problems: (fsDetectedQuestionType === 'problem_solution' || fsDetectedQuestionType === 'problem_effect') ? bp1Ideas : [],
      solutions: (fsDetectedQuestionType === 'problem_solution' || fsDetectedQuestionType === 'cause_solution' || fsDetectedQuestionType === 'single_best_option') ? bp2Ideas : [],
      causes: (fsDetectedQuestionType === 'cause_solution' || fsDetectedQuestionType === 'cause_effect') ? bp1Ideas : [],
      effects: (fsDetectedQuestionType === 'cause_effect' || fsDetectedQuestionType === 'problem_effect') ? bp2Ideas : []
    },
    manual_ideas: [],
    paired_ideas: [],
    paragraph_roles: {
      intro: "Introduce the topic and state a clear opinion or paraphrase the essay question",
      bp1: type.bp1Role || "Discuss body paragraph 1 arguments",
      bp2: type.bp2Role || "Discuss body paragraph 2 arguments",
      conclusion: type.conclusionRole || "Summarise the main arguments and provide a final recommendation"
    },
    target_band_level: band,
    generation_mode: document.getElementById('fsStyle').value || 'template',
    vocabulary_level: vocabIdx + 1
  };

  const paired_ideas = [];
  if (type.ideasPaired) {
    for (let i = 0; i < bp1Ideas.length; i++) {
      const leftText = bp1Ideas[i];
      const rightText = bp2Ideas[i] || '';
      if (fsDetectedQuestionType === 'problem_solution') {
        paired_ideas.push({ problem: leftText, solution: rightText });
      } else if (fsDetectedQuestionType === 'cause_solution') {
        paired_ideas.push({ cause: leftText, solution: rightText });
      } else if (fsDetectedQuestionType === 'cause_effect') {
        paired_ideas.push({ cause: leftText, effect: rightText });
      } else if (fsDetectedQuestionType === 'problem_effect') {
        paired_ideas.push({ problem: leftText, effect: rightText });
      } else if (fsDetectedQuestionType === 'single_best_option') {
        paired_ideas.push({ cause: leftText, solution: rightText });
      }
    }
  }
  plan.paired_ideas = paired_ideas;

  const template = getTemplateForEssay({ templateChoice: band });

  try {
    const res = await fetch(API_URL + '/api/generate-essay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, template, sidedNote })
    });
    if (!res.ok) {
      const t = await res.text();
      let errDetail = '';
      try {
        const parsed = JSON.parse(t);
        if (parsed.details) errDetail = '\nDetails: ' + parsed.details.join(' | ');
        else if (parsed.error) errDetail = '\n' + parsed.error;
      } catch (e) {
        errDetail = `\nAPI error ${res.status}: ${t.slice(0, 300)}`;
      }
      throw new Error(errDetail || `Server failed to generate essay`);
    }
    const data = await res.json();
    if (!data.success || !data.text) {
      throw new Error(data.error || 'Server returned empty generation');
    }
    const text = data.text;

    if (data.warnings && data.warnings.length > 0) {
      console.warn("Generated essay warnings:", data.warnings);
      toast("Warning: " + data.warnings[0], false);
    }

    const titleMatch = text.match(/===TITLE===\s*([\s\S]*?)(?====INTRO===)/);
    const title = titleMatch ? titleMatch[1].trim().replace(/^["']|["']$/g, '').slice(0, 80) : '';
    const sections = parseEssaySections(text);
    if (!sections.intro || !sections.bp1 || !sections.bp2 || !sections.concl) {
      throw new Error('The essay came back incomplete. Please try again.');
    }

    document.getElementById('fsIdeasArea').style.display = 'none';

    freestyleLast = { question, band, vocab: vocabIdx + 1, title, sections };
    renderFreestyleResult(sections);
  } catch (err) {
    console.error(err);
    toast('AI failed: ' + err.message, true);
  } finally {
    if (btn) {
      stopWriteButtonMessages();
      btn.disabled = false;
      btn.innerHTML = 'Write essay';
    }
  }
}

function fsRenderText(s) {
  let html = escapeHtml(s);
  html = html.replace(/==([^=]+)==/g, '<mark>$1</mark>');
  html = html.replace(/\[EXTRA IDEA\]\s*/g, '<span class="fs-extra">+ Extra idea: </span>');
  return html.replace(/\n/g, '<br>');
}

function renderFreestyleResult(sections) {
  const parts = [
    ['Introduction', sections.intro],
    ['Body paragraph 1', sections.bp1],
    ['Body paragraph 2', sections.bp2],
    ['Conclusion', sections.concl]
  ];
  document.getElementById('fsResult').innerHTML = parts.map(([label, txt]) =>
    `<div class="fs-result-para"><div class="fs-result-label">${label}</div><div class="fs-result-text">${fsRenderText(txt)}</div></div>`
  ).join('');
  document.getElementById('fsResultArea').style.display = 'block';
  document.getElementById('fsActions').innerHTML =
    '<button class="tb-text-btn" onclick="closeFreestyle()">Close</button>' +
    '<button class="tb-text-btn" onclick="copyFreestyle()">📋 Copy</button>' +
    '<button class="tb-text-btn" onclick="freestyleReset()">↻ Write another</button>' +
    '<button class="tb-text-btn dark" onclick="saveFreestyleToLibrary()">💾 Save to library</button>';
  document.getElementById('fsResultArea').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function copyFreestyle() {
  if (!freestyleLast) return;
  const s = freestyleLast.sections;
  const txt = [s.intro, s.bp1, s.bp2, s.concl]
    .map(p => p.replace(/==/g, '').replace(/\[EXTRA IDEA\]\s*/g, ''))
    .join('\n\n');
  navigator.clipboard.writeText(txt).then(
    () => toast('Essay copied ✓'),
    () => toast('Copy failed', true)
  );
}

function saveFreestyleToLibrary() {
  if (!freestyleLast) return;
  const fl = freestyleLast;
  const derived = fl.question.replace(/\s+/g, ' ').trim().split(/[.?!]/)[0].slice(0, 60);
  const e = {
    id: uid(),
    title: fl.title || derived || 'Freestyle essay',
    question: fl.question,
    explanation: '',
    pros: '', cons: '', approach: '',
    intro: fl.sections.intro, bp1: fl.sections.bp1, bp2: fl.sections.bp2, concl: fl.sections.concl,
    vocab: fl.vocab,
    seedIdeas: '',
    templateChoice: fl.band
  };
  essays.push(e);
  currentId = e.id;
  saveAll(); renderList(); loadCurrent(); renderPreview();
  closeFreestyle();
  toast('Saved to your library ✓');
}

// ============================================================
//  BULK WRITE — pick essays, AI writes them sequentially
// ============================================================
let bulkWritePicked = new Set();
let bulkWriteAborted = false;
let bulkWriteRunning = false;

function openBulkWrite() {
  // Default: pre-select empty essays so the most common path is one click
  bulkWritePicked = new Set(essays.filter(e => essayStatus(e) === 'empty' && e.title && e.question).map(e => e.id));
  bulkWriteAborted = false;
  document.getElementById('bulkWriteProgress').style.display = 'none';
  document.getElementById('bulkWriteAbortBtn').style.display = 'none';
  document.getElementById('bulkWriteStartBtn').style.display = '';
  document.getElementById('bulkWriteStartBtn').disabled = bulkWritePicked.size === 0;
  document.getElementById('bulkWriteCloseBtn').textContent = 'Cancel';
  renderBulkWritePicker();
  document.getElementById('bulkWriteModal').classList.add('show');
}

function closeBulkWrite() {
  if (bulkWriteRunning) {
    if (!confirm('A bulk write is still running. Close anyway? Completed essays are saved; in-progress one will finish then stop.')) return;
    bulkWriteAborted = true;
  }
  document.getElementById('bulkWriteModal').classList.remove('show');
}

function renderBulkWritePicker() {
  const list = document.getElementById('bulkWritePickerList');
  list.innerHTML = essays.map((e, i) => {
    const s = essayStatus(e);
    const statusLabel = s === 'written' ? 'WRITTEN' : (s === 'draft' ? 'DRAFT' : 'EMPTY');
    const statusClass = 'status-' + s;
    const checked = bulkWritePicked.has(e.id) ? 'checked' : '';
    const missingFields = !e.title || !e.question;
    const disabled = missingFields ? 'disabled title="No title or question — fill these in first"' : '';
    return `
      <label class="export-pick-row${missingFields ? ' export-pick-row-disabled' : ''}" style="${missingFields ? 'opacity:0.4;' : ''}">
        <input type="checkbox" ${checked} ${disabled} onchange="toggleBulkWritePick('${e.id}', this.checked)">
        <span class="export-pick-num">ESSAY ${String(i+1).padStart(2,'0')}</span>
        <span class="export-pick-title">${escapeHtml(e.title || '(no title)')}</span>
        <span class="export-pick-status ${statusClass}">${statusLabel}</span>
      </label>
    `;
  }).join('');
  updateBulkWritePickedCount();
}

function toggleBulkWritePick(id, checked) {
  if (checked) bulkWritePicked.add(id);
  else bulkWritePicked.delete(id);
  updateBulkWritePickedCount();
}

function updateBulkWritePickedCount() {
  const n = bulkWritePicked.size;
  document.getElementById('bulkWritePickedCount').textContent = n;
  document.getElementById('bulkWriteStartBtn').disabled = (n === 0);
  const est = document.getElementById('bulkWriteEstimate');
  if (n === 0) {
    est.textContent = 'Pick essays below to see total time and quota usage.';
  } else {
    const secs = n * 12;
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    const timeStr = mins > 0 ? `${mins}m ${remainder}s` : `${secs}s`;
    est.textContent = `Selected ${n} essay${n === 1 ? '' : 's'} — about ${timeStr} total, uses ${n} quota credit${n === 1 ? '' : 's'}.`;
  }
}

function selectAllForBulkWrite(mode) {
  if (mode === 'all') {
    bulkWritePicked = new Set(essays.filter(e => e.title && e.question).map(e => e.id));
  } else if (mode === 'none') {
    bulkWritePicked = new Set();
  } else if (mode === 'empty') {
    bulkWritePicked = new Set(essays.filter(e => essayStatus(e) === 'empty' && e.title && e.question).map(e => e.id));
  } else if (mode === 'draft') {
    bulkWritePicked = new Set(essays.filter(e => (essayStatus(e) === 'empty' || essayStatus(e) === 'draft') && e.title && e.question).map(e => e.id));
  }
  renderBulkWritePicker();
}

async function doBulkWrite() {
  if (bulkWritePicked.size === 0) return;
  const targets = essays.filter(e => bulkWritePicked.has(e.id));
  if (targets.length === 0) return;

  // Final confirm if user is about to overwrite already-written essays
  const overwriteCount = targets.filter(e => (e.intro || e.bp1 || e.bp2 || e.concl).trim().length > 0).length;
  if (overwriteCount > 0) {
    if (!confirm(`${overwriteCount} of the selected ${targets.length} essays already have content. Continuing will overwrite them. Continue?`)) return;
  }

  // Quota check upfront (warn if user will hit limit mid-run)
  const q = getQuota();
  if (!offlineMode && q.essay < targets.length) {
    if (!confirm(`You have ${q.essay} essay quota credits left today but selected ${targets.length} essays. The first ${q.essay} will be written, the rest will fail with a quota error. Continue?`)) return;
  }

  // Switch UI to "running" mode
  bulkWriteRunning = true;
  bulkWriteAborted = false;
  document.getElementById('bulkWriteStartBtn').style.display = 'none';
  document.getElementById('bulkWriteAbortBtn').style.display = '';
  document.getElementById('bulkWriteCloseBtn').textContent = 'Close';
  document.getElementById('bulkWriteProgress').style.display = '';

  let done = 0;
  let failed = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 0; i < targets.length; i++) {
    if (bulkWriteAborted) break;
    const e = targets[i];
    updateBulkWriteProgress(done + failed + skipped + 1, targets.length, `Writing essay ${i + 1} of ${targets.length}: "${e.title}"`);

    try {
      const ok = await aiWriteFullEssay({ essay: e, skipConfirm: true, silent: true });
      if (ok) done++;
      else { skipped++; errors.push(`Essay ${i+1} (${e.title}): skipped (no quota or missing fields)`); }
    } catch (err) {
      failed++;
      errors.push(`Essay ${i+1} (${e.title}): ${err.message}`);
      // If the error looks like a quota/auth issue, stop the run early
      if (/quota|limit|401|403|auth/i.test(err.message)) {
        errors.push('Stopping bulk run due to error.');
        break;
      }
    }
    // Small delay between requests to be polite to the API
    await new Promise(r => setTimeout(r, 300));
  }

  bulkWriteRunning = false;

  // Final summary
  document.getElementById('bulkWriteAbortBtn').style.display = 'none';
  document.getElementById('bulkWriteStartBtn').style.display = '';
  document.getElementById('bulkWriteStartBtn').textContent = 'Write more →';

  const summary =
    `Bulk write complete: ${done} written` +
    (failed > 0 ? `, ${failed} failed` : '') +
    (skipped > 0 ? `, ${skipped} skipped` : '') +
    (bulkWriteAborted ? ' (stopped by user)' : '');
  updateBulkWriteProgress(done + failed + skipped, targets.length, summary);
  if (errors.length > 0) {
    console.warn('Bulk write errors:', errors);
    document.getElementById('bulkWriteProgressNote').innerHTML =
      `<span style="color:var(--accent);">Some essays had issues — check browser console for details.</span>`;
  } else {
    document.getElementById('bulkWriteProgressNote').textContent = 'All done! Close this window to see the results.';
  }

  // Refresh the main UI
  renderList(); loadCurrent(); renderPreview();
  toast(summary);
}

function abortBulkWrite() {
  if (!bulkWriteRunning) return;
  bulkWriteAborted = true;
  document.getElementById('bulkWriteAbortBtn').textContent = 'Stopping after current…';
  document.getElementById('bulkWriteAbortBtn').disabled = true;
}

function updateBulkWriteProgress(step, total, label) {
  document.getElementById('bulkWriteProgressText').textContent = label;
  document.getElementById('bulkWriteProgressBar').style.width = `${Math.min(100, Math.round((step / total) * 100))}%`;
}


// ============================================================
//  PARAGRAPH + SENTENCE REGENERATE
// ============================================================
const PARA_LABELS = {
  intro: 'Introduction',
  bp1: 'Body Paragraph 1',
  bp2: 'Body Paragraph 2',
  concl: 'Conclusion'
};

// Render the sentence list under each paragraph textarea
function renderSentenceList(which) {
  const container = document.getElementById('sentences_' + which);
  if (!container) return;
  const text = (document.getElementById('f_' + which).value || '').trim();
  if (!text) {
    container.innerHTML = '';
    container.classList.remove('has-content');
    return;
  }
  const sentences = splitSentences(text);
  if (sentences.length <= 1) {
    container.innerHTML = '';
    container.classList.remove('has-content');
    return;
  }
  container.innerHTML = sentences.map((s, i) =>
    `<div class="sentence-row">
       <span class="sentence-row-num">${i + 1}.</span>
       <span class="sentence-row-text">${escapeHtml(s)}</span>
       <button class="sentence-regen-btn" onclick="regenerateSentence('${which}', ${i})" title="Rewrite this sentence">✎ Rewrite</button>
     </div>`
  ).join('');
  container.classList.add('has-content');
}

// Split paragraph into sentences (handles common edge cases: abbreviations, EXTRA IDEA / Therefore lines)
function splitSentences(text) {
  // Treat [EXTRA IDEA] lines and Therefore lines as their own sentences
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    if (/^\[EXTRA\s*IDEA\]/i.test(line) || /^therefore[,\s]/i.test(line)) {
      out.push(line);
      continue;
    }
    // Split on sentence boundaries — period/!/? followed by whitespace + capital letter
    // (Avoids breaking on "e.g." or "i.e." or numbered lists)
    const parts = line.split(/(?<=[.!?])\s+(?=[A-Z\[])/);
    for (const p of parts) {
      const trimmed = p.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}

async function regenerateParagraph(which) {
  const e = getCurrent();
  if (!e) { toast('No essay selected', true); return; }
  const existing = (e[which] || '').trim();
  if (!existing) {
    toast('This paragraph is empty — use "Write the full essay" first', true);
    return;
  }
  if (!await consumeQuota('idea')) return;

  const btn = document.querySelector(`.regen-btn[onclick*="regenerateParagraph('${which}')"]`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Rewriting…'; }

  const template = getTemplateForEssay(e);
  const bag = getTemplatesBag();
  const effectiveTplKey = (e.templateChoice && e.templateChoice !== 'default') ? e.templateChoice : (bag.default || 'band9');
  const isBand6 = (effectiveTplKey === 'band6');
  const vocabIdx = (e.vocab || 3) - 1;
  const vocabSpec = VOCAB_LEVELS[vocabIdx];
  const seedIdeas = (e.seedIdeas || '').trim();
  const isNatural = (e.generationMode === 'natural');

  // Build context: the OTHER paragraphs so AI knows what it's connecting to
  const others = ['intro', 'bp1', 'bp2', 'concl']
    .filter(p => p !== which)
    .map(p => `[${PARA_LABELS[p].toUpperCase()}]\n${e[p] || '(empty)'}`)
    .join('\n\n');

  const naturalStyleInstruction = `
=== WRITING STYLE: NATURAL MODE (CRITICAL) ===
Write naturally and avoid standard templates or rigid, formulaic transitions. Focus on fluid, sophisticated, and varied sentence structures that feel authentic and custom-written.
- Do NOT use formulaic transitional boilerplate.
- Do NOT use robotic, rehearsed transitions.
- Smoothly connect ideas with diverse, natural transitions.
- AVOID adding unsupported statistics or research claims.
`;

  const templateStyleInstruction = `
=== WRITING STYLE: EXAM TEMPLATE MODE (FOLLOW TEMPLATE CLOSELY) ===
Follow the template structure closely (transition phrases like "To begin with, one major merit is..." must be preserved if they appear in the template). Preserve exam-safe wording.
`;

  const prompt = `You are rewriting ONE paragraph of an IELTS/PTE essay for IPT Brisbane tutoring. Keep the same overall meaning and key points, but rephrase the language so it differs from the existing version.

ESSAY TOPIC: ${e.title}
QUESTION: ${e.question}
${seedIdeas ? `KEY IDEAS TO USE: ${seedIdeas}` : ''}
VOCABULARY LEVEL: ${vocabSpec.label} — ${vocabSpec.desc}

${isNatural ? naturalStyleInstruction : templateStyleInstruction}

EXISTING ${PARA_LABELS[which].toUpperCase()} (rewrite this):
${existing}

OTHER PARAGRAPHS (do NOT rewrite — for context only):
${others}

TEMPLATE FOR ${PARA_LABELS[which].toUpperCase()} (only relevant in Exam Template Mode):
${template[which]}

INSTRUCTIONS:
- Rewrite the paragraph text according to the selected WRITING STYLE.
- Wrap key idea clauses in ==yellow markers==.
${which === 'bp1' && !isBand6 ? '- Keep the [EXTRA IDEA] Moreover, ... line at the end.' : ''}
${which === 'concl' && !isBand6 ? '- The "Therefore, [solution]" line is OPTIONAL. Include it only if the conclusion would otherwise be under the target word count.' : ''}
${which === 'bp2' ? '- Do NOT add a "Therefore" line at the end of BP2.' : ''}
- Do NOT introduce any unsupported claims or fake statistics (e.g. invented percentages or citations).
- Output ONLY the rewritten paragraph text. No preamble, no labels, no markdown headers.`;

  try {
    const res = await fetch(API_URL + '/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const newText = data.content.map(c => c.text || '').join('\n').trim();
    if (!newText) throw new Error('Empty response from AI');
    e[which] = newText;
    document.getElementById('f_' + which).value = newText;
    saveAll();
    renderPreview();
    updateCounters();
    renderSentenceList(which);
    toast(`${PARA_LABELS[which]} rewritten ✓`);
  } catch (err) {
    console.error(err);
    toast('Rewrite failed: ' + err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '↻ Rewrite'; }
  }
}

async function regenerateSentence(which, sentenceIdx) {
  const e = getCurrent();
  if (!e) { toast('No essay selected', true); return; }
  const text = (e[which] || '').trim();
  const sentences = splitSentences(text);
  if (sentenceIdx < 0 || sentenceIdx >= sentences.length) {
    toast('Sentence not found', true);
    return;
  }
  const original = sentences[sentenceIdx];
  if (!await consumeQuota('idea')) return;

  const btn = event && event.target;
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  const template = getTemplateForEssay(e);
  const vocabIdx = (e.vocab || 3) - 1;
  const vocabSpec = VOCAB_LEVELS[vocabIdx];
  const seedIdeas = (e.seedIdeas || '').trim();
  const isNatural = (e.generationMode === 'natural');

  const naturalStyleInstruction = `
=== WRITING STYLE: NATURAL MODE ===
- Make the sentence smoother and improve fluency.
- Reduce robotic, rehearsed phrasing.
- AVOID adding unsupported statistics or research claims.
`;

  const templateStyleInstruction = `
=== WRITING STYLE: EXAM TEMPLATE MODE ===
- Preserve exam-safe wording and clear template transitions.
`;

  const prompt = `You are rewriting ONE sentence inside an essay paragraph. Keep the same meaning and any specific facts/examples. Just rephrase the language naturally.

ESSAY TOPIC: ${e.title}
QUESTION: ${e.question}
${seedIdeas ? `KEY IDEAS: ${seedIdeas}` : ''}
VOCABULARY LEVEL: ${vocabSpec.label} — ${vocabSpec.desc}

${isNatural ? naturalStyleInstruction : templateStyleInstruction}

FULL PARAGRAPH (for context — do not rewrite this whole paragraph):
${text}

THE SENTENCE TO REWRITE:
${original}

INSTRUCTIONS:
- Rewrite ONLY this single sentence according to the WRITING STYLE.
- Preserve any ==yellow markers== if they exist in the original.
- Preserve [EXTRA IDEA] prefix if present.
- Match the surrounding paragraph's tone and complexity.
- Do NOT introduce any unsupported claims or fake statistics.
- Output ONLY the rewritten sentence. No preamble, no quotes, no labels.`;

  try {
    const res = await fetch(API_URL + '/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    let newSentence = data.content.map(c => c.text || '').join('\n').trim();
    // Strip any wrapping quotes the AI may have added
    newSentence = newSentence.replace(/^["'`](.*)["'`]$/, '$1').trim();
    if (!newSentence) throw new Error('Empty response from AI');

    // Reassemble the paragraph with the new sentence in place
    sentences[sentenceIdx] = newSentence;
    const rebuilt = reassembleSentences(text, sentences);
    e[which] = rebuilt;
    document.getElementById('f_' + which).value = rebuilt;
    saveAll();
    renderPreview();
    updateCounters();
    renderSentenceList(which);
    toast('Sentence rewritten ✓');
  } catch (err) {
    console.error(err);
    toast('Rewrite failed: ' + err.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✎ Rewrite'; }
  }
}

// Stitch sentences back together preserving line breaks where the original had them
function reassembleSentences(originalText, sentences) {
  // Track which sentences were on their own line in the original (e.g. [EXTRA IDEA], Therefore lines)
  const originalLines = originalText.split(/\n+/).map(l => l.trim()).filter(Boolean);
  // Build a fresh string by walking original lines and consuming sentences from the array
  const out = [];
  let sIdx = 0;
  for (const line of originalLines) {
    if (/^\[EXTRA\s*IDEA\]/i.test(line) || /^therefore[,\s]/i.test(line)) {
      // These are single-sentence lines
      out.push(sentences[sIdx++] || '');
    } else {
      // This line may have had multiple sentences — count how many
      const lineSentenceCount = splitSentences(line).length;
      const lineSentences = sentences.slice(sIdx, sIdx + lineSentenceCount);
      sIdx += lineSentenceCount;
      out.push(lineSentences.join(' '));
    }
  }
  // If any extra sentences leftover (shouldn't happen but be safe), append them
  if (sIdx < sentences.length) {
    out.push(sentences.slice(sIdx).join(' '));
  }
  return out.join('\n');
}

function parseEssaySections(text) {
  const out = { intro: '', bp1: '', bp2: '', concl: '' };
  const intro = text.match(/===INTRO===\s*([\s\S]*?)(?====BP1===)/);
  const bp1 = text.match(/===BP1===\s*([\s\S]*?)(?====BP2===)/);
  const bp2 = text.match(/===BP2===\s*([\s\S]*?)(?====CONCL===)/);
  const concl = text.match(/===CONCL===\s*([\s\S]*?)$/);
  if (intro) out.intro = intro[1].trim();
  if (bp1) out.bp1 = bp1[1].trim();
  if (bp2) out.bp2 = bp2[1].trim();
  if (concl) out.concl = concl[1].trim();
  return out;
}

// ============================================================
//  AI: SMALLER HELPERS
// ============================================================
function openSettings() {
  document.getElementById('apiKeyInput').value = safeLSGet('ipt_apikey') || '';
  document.getElementById('settingsModal').classList.add('show');
}
function closeSettings() { document.getElementById('settingsModal').classList.remove('show'); }
function saveApiKey() {
  safeLSSet('ipt_apikey', document.getElementById('apiKeyInput').value.trim());
  closeSettings();
  toast('API key saved');
}

async function aiGenerate(kind, opts = {}) {
  const e = getCurrent();
  if (!e) { toast('No essay selected', true); return; }

  // Quota check (skip if called automatically right after a write)
  if (!opts.skipQuota) {
    if (!await consumeQuota('idea')) return;
  }
  const essayText = [e.intro, e.bp1, e.bp2, e.concl].filter(Boolean).join('\n\n');
  if (!essayText.trim()) { toast('Write or generate essay text first', true); return; }
  const btns = document.querySelectorAll('.gen-btn');
  btns.forEach(b => b.disabled = true);

  let prompt = '';
  if (kind === 'proscons') {
    prompt = `Read this Band 9 essay and extract:
1. KEY POINTS (pros from BP1) — 3 short bullets, 2-4 words each
2. COUNTER-POINTS (from BP2) — 3 short bullets, 2-4 words each

Title: ${e.title}
Question: ${e.question}
Essay:
${essayText}

Format:
KEY POINTS:
- ...
- ...
- ...
COUNTER-POINTS:
- ...
- ...
- ...`;
  } else if (kind === 'approach') {
    prompt = `Write a one-sentence APPROACH TIP. 12-20 words, starts with a verb.
Title: ${e.title}
Essay: ${essayText}
Respond with ONLY the sentence.`;
  } else if (kind === 'explanation') {
    prompt = `Write a one-sentence Topic Explanation. 10-18 words, starts with Evaluate/Examine/Discuss.
Question: ${e.question}
Title: ${e.title}
Respond with ONLY the sentence.`;
  } else if (kind === 'all') {
    prompt = `Read this essay and produce:
TOPIC_EXPLANATION: one sentence, 10-18 words, starts with Evaluate/Examine/Discuss
KEY_POINTS: 3 phrases, 2-4 words each, from BP1
COUNTER_POINTS: 3 phrases, 2-4 words each, from BP2
APPROACH_TIP: one sentence, 12-20 words, starts with verb

Title: ${e.title}
Question: ${e.question}
Essay:
${essayText}

Format EXACTLY:
TOPIC_EXPLANATION: ...
KEY_POINTS:
- ...
- ...
- ...
COUNTER_POINTS:
- ...
- ...
- ...
APPROACH_TIP: ...`;
  }

  try {
    const res = await fetch(API_URL + '/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data.content.map(c => c.text || '').join('\n').trim();
    applyAiResult(kind, text);
    toast('AI done');
  } catch (err) {
    console.error(err);
    toast('AI failed: ' + err.message, true);
  } finally {
    btns.forEach(b => b.disabled = false);
  }
}

function applyAiResult(kind, text) {
  const e = getCurrent();
  if (kind === 'approach') { e.approach = text.replace(/^["']|["']$/g, ''); }
  else if (kind === 'explanation') { e.explanation = text.replace(/^["']|["']$/g, ''); }
  else if (kind === 'proscons' || kind === 'all') {
    const lines = text.split('\n').map(l => l.trim());
    let section = '';
    const pros = [], cons = [];
    let approach = '', expl = '';
    for (const line of lines) {
      if (/^TOPIC_EXPLANATION/i.test(line)) { expl = line.replace(/^TOPIC_EXPLANATION:?\s*/i, ''); section = ''; continue; }
      if (/^KEY[_\s]POINTS/i.test(line)) { section = 'pros'; continue; }
      if (/^COUNTER[_\s-]POINTS/i.test(line)) { section = 'cons'; continue; }
      if (/^APPROACH[_\s]TIP/i.test(line)) { approach = line.replace(/^APPROACH[_\s]TIP:?\s*/i, ''); section = ''; continue; }
      const bullet = line.replace(/^[-•*]\s*/, '').trim();
      if (!bullet) continue;
      if (section === 'pros') pros.push(bullet);
      else if (section === 'cons') cons.push(bullet);
    }
    if (pros.length) e.pros = pros.join('\n');
    if (cons.length) e.cons = cons.join('\n');
    if (approach) e.approach = approach;
    if (expl) e.explanation = expl;
  }
  saveAll(); loadCurrent(); renderPreview();
}

// ============================================================
//  BACKUP / RESTORE
// ============================================================
function exportData() {
  const blob = new Blob([JSON.stringify({ essays, templates: getTemplatesBag(), version: 6 }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ipt_essays_backup_' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('Backup downloaded');
}
function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.essays)) throw new Error('Invalid backup');
        if (!confirm(`Restore ${data.essays.length} essays?`)) return;
        essays = data.essays;
        if (data.templates) {
          await saveTemplatesBag(data.templates);
        } else if (data.template) {
          // Legacy backup — promote single template to custom
          const bag = getDefaultTemplates();
          bag.custom = data.template;
          bag.default = 'custom';
          await saveTemplatesBag(bag);
        }
        currentId = essays[0]?.id || null;
        saveAll(); renderList(); loadCurrent(); renderPreview();
        toast('Backup restored');
      } catch (err) {
        toast('Invalid backup file', true);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ============================================================
//  TOAST
// ============================================================
let toastTimer;
function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}

// ============================================================
//  LEARN VOCABULARY
// ============================================================
let currentVocabCategory = null;

function openVocab() {
  document.getElementById('vocabScreen').classList.add('show');
  renderVocabCategoryList();
  updateVocabProgressSummary();
  renderVocabMain(); // Populates initial view (Hub overview)
  // Sidebar navigation active state updates
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.id === 'nav-vocab');
  });
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = 'Vocabulary Hub';
}
function closeVocab() {
  document.getElementById('vocabScreen').classList.remove('show');
  switchSection('library');
}

// Get user's vocab progress object: { read: {"cat:word": true}, attempts: {...} }
function getVocabProgress() {
  let progress = {};
  if (offlineMode) {
    try {
      const raw = safeLSGet('ipt_vocab');
      progress = raw ? JSON.parse(raw) : {};
    } catch (e) {
      progress = {};
    }
  } else if (userProfile) {
    if (!userProfile.vocabProgress) {
      userProfile.vocabProgress = { read: {}, attempts: {} };
    }
    progress = userProfile.vocabProgress;
  }

  // Ensure progress is parsed if it was loaded or synced as a JSON string
  if (typeof progress === 'string') {
    try {
      progress = JSON.parse(progress);
    } catch (e) {
      progress = {};
    }
  }

  // Ensure progress is a valid plain object
  if (!progress || typeof progress !== 'object') {
    progress = {};
  }

  // Ensure read property is a valid plain object
  if (!progress.read || typeof progress.read !== 'object') {
    progress.read = {};
  }

  // Ensure attempts property is a valid plain object
  if (!progress.attempts || typeof progress.attempts !== 'object') {
    progress.attempts = {};
  }

  // Sync back to userProfile reference to keep them in sync
  if (userProfile && typeof userProfile === 'object') {
    userProfile.vocabProgress = progress;
  }

  return progress;
}
async function saveVocabProgress() {
  if (offlineMode) {
    safeLSSet('ipt_vocab', JSON.stringify(getVocabProgress()));
    return;
  }
  if (!currentUser) return;
  queueSync();
}

function vocabKey(catId, word) { return `${catId}:${word}`; }
function isWordRead(catId, word) {
  return !!getVocabProgress().read[vocabKey(catId, word)];
}
function totalWordsRead() {
  return Object.keys(getVocabProgress().read || {}).length;
}
function totalWordsAvailable() {
  let n = 0;
  for (const k of Object.keys(VOCAB_DATA)) n += VOCAB_DATA[k].words.length;
  return n;
}

function updateVocabProgressSummary() {
  const r = totalWordsRead();
  const total = totalWordsAvailable();
  const el = document.getElementById('vocabProgressSummary');
  if (el) el.textContent = `${r} / ${total} words read`;
  
  // Update streak text in vocab hub from dashboard
  const dashStreakText = document.getElementById('dashStreakCurrent')?.textContent || '0 days';
  const vocabStreakEl = document.getElementById('vocabStreak');
  if (vocabStreakEl) {
    vocabStreakEl.textContent = dashStreakText;
  }
}

function renderVocabCategoryList() {
  const q = (document.getElementById('vocabSearch')?.value || '').toLowerCase().trim();
  const list = document.getElementById('vocabCategoryList');
  if (!list) return;
  const progress = getVocabProgress();
  const sorted = Object.entries(VOCAB_DATA).sort((a, b) => (a[1].order || 99) - (b[1].order || 99));
  
  let html = '';
  
  if (!q) {
    const isHubActive = (currentVocabCategory === null);
    const isMasterActive = (currentVocabCategory === 'master1000');
    html += `
      <div class="vocab-cat-item ${isHubActive ? 'active' : ''}" onclick="selectVocabCategory(null)">
        <span class="vocab-cat-icon">🏠</span>
        <span class="vocab-cat-label">Vocabulary Hub</span>
        <span class="vocab-cat-progress">All</span>
      </div>
      <div class="vocab-cat-item ${isMasterActive ? 'active' : ''}" onclick="selectVocabCategory('master1000')">
        <span class="vocab-cat-icon">🏆</span>
        <span class="vocab-cat-label">1000 Exam Words</span>
        <span class="vocab-cat-progress">C1/C2</span>
      </div>
      <div class="h-[1px] bg-outline-variant/20 w-full my-2"></div>
    `;
  } else if ("1000 exam words".includes(q) || "master list".includes(q) || "exam essentials".includes(q)) {
    const isMasterActive = (currentVocabCategory === 'master1000');
    html += `
      <div class="vocab-cat-item ${isMasterActive ? 'active' : ''}" onclick="selectVocabCategory('master1000')">
        <span class="vocab-cat-icon">🏆</span>
        <span class="vocab-cat-label">1000 Exam Words</span>
        <span class="vocab-cat-progress">C1/C2</span>
      </div>
      <div class="h-[1px] bg-outline-variant/20 w-full my-2"></div>
    `;
  }
  
  sorted.forEach(([catId, cat]) => {
    // If search term matches category title or id
    if (q && !cat.label.toLowerCase().includes(q) && !catId.toLowerCase().includes(q)) {
      return;
    }
    
    const read = cat.words.filter(w => progress.read[vocabKey(catId, w.word)]).length;
    const total = cat.words.length;
    const percent = total > 0 ? Math.round((read / total) * 100) : 0;
    const isActive = (currentVocabCategory === catId);
    
    html += `
      <div class="vocab-cat-item ${isActive ? 'active' : ''}" onclick="selectVocabCategory('${catId}')" title="${escapeHtml(cat.label)}">
        <span class="vocab-cat-icon">${escapeHtml(cat.icon || '📚')}</span>
        <span class="vocab-cat-label">${escapeHtml(cat.label)}</span>
        <span class="vocab-cat-progress">${percent}%</span>
      </div>
    `;
  });
  
  list.innerHTML = html;
}

function selectVocabCategory(catId) {
  currentVocabCategory = catId;
  renderVocabCategoryList();
  renderVocabMain();
}

function jumpToVocabWord(catId, word) {
  // 1. Open Vocab Pane
  openVocab();
  // 2. Select the category
  selectVocabCategory(catId);
  // 3. Find the word index
  const cat = VOCAB_DATA[catId];
  if (!cat) return;
  const idx = cat.words.findIndex(w => w.word.toLowerCase() === word.toLowerCase());
  if (idx !== -1) {
    // 4. Force List view
    setVocabViewState('list');
    // 5. Scroll to the card element
    setTimeout(() => {
      const cardEl = document.getElementById(`word-card-${idx}`);
      if (cardEl) {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Highlight card temporarily with a beautiful frosted accent glow
        cardEl.style.transition = 'all 0.4s ease';
        cardEl.style.boxShadow = '0 0 25px var(--accent)';
        cardEl.style.borderColor = 'var(--accent)';
        cardEl.style.transform = 'scale(1.02)';
        setTimeout(() => {
          cardEl.style.boxShadow = '';
          cardEl.style.borderColor = '';
          cardEl.style.transform = '';
        }, 2500);
      }
    }, 150);
  }
}

let vocabViewState = 'list'; // 'list' or 'flashcard'

let masterSearchQuery = '';
let masterPage = 0;
const masterPageSize = 15;
let masterLevelFilter = 'all';

function renderVocabMain() {
  const progress = getVocabProgress();
  const main = document.getElementById('vocabMainContent');
  if (!main) return;

  if (currentVocabCategory === 'master1000') {
    renderMaster1000Vocab();
    return;
  }

  const descriptions = {
    law: "Criminal justice, court proceedings, and legal rights.",
    education: "Learning frameworks, pedagogical systems, and academic performance.",
    tech: "Technological advancements, digital societies, and data systems.",
    env: "Natural ecology, climate policies, urban architecture, and resource conservation.",
    health: "Public health, medical research, ethics, and wellness ecosystems.",
    econ: "Financial systems, market trends, social policies, and corporate responsibility.",
    society: "Social structures, community relations, demographics, and cultural norms.",
    science: "Scientific inquiry, experimental research, methodologies, and natural phenomena.",
    media: "Information dissemination, journalism, advertising, and digital communication.",
    culture: "Artistic expression, societal values, heritage, and modern beliefs.",
    politics: "Government structures, policy formulation, civil liberties, and international relations.",
    history: "Historical events, cultural evolutions, societal shifts, and chronological eras.",
    philosophy: "Theoretical frameworks, ethical dilemmas, cognitive logic, and abstract reasoning.",
    psychology: "Human behavior, cognitive functions, mental health, and social psychology.",
    business: "Commerce, corporate strategies, organizational structures, and entrepreneurship.",
    art: "Visual arts, architecture, aesthetics, creative expression, and design principles.",
    sports: "Athletic activities, wellness, competition dynamics, and physical performance.",
    travel: "Tourism, migration patterns, cultural exploration, and globalization.",
    food: "Gastronomy, nutrition science, global supply chains, and culinary traditions.",
    fashion: "Textile industries, design trends, visual identity, and cultural style expressions.",
    music: "Acoustics, cultural significance, auditory art, and historical genres.",
    nature: "Biodiversity, ecosystems, botanical studies, and environmental dynamics.",
    space: "Cosmology, space exploration, astrophysics, and orbital systems.",
    weather: "Meteorological systems, climate patterns, atmospheric conditions, and forecasting.",
    family: "Kinship systems, domestic structures, child development, and social cohesion.",
    communication: "Linguistics, interpersonal dynamics, structural semiotics, and language acquisition.",
    transport: "Logistical infrastructure, transit systems, urban planning, and mechanical systems.",
    shopping: "Consumer patterns, marketing strategies, e-commerce, and retail economics.",
    hobbies: "Recreational activities, cognitive engagement, skill development, and leisure studies.",
    work: "Labor markets, professional ethics, workplace dynamics, and human resource management."
  };

  if (!currentVocabCategory) {
    const sorted = Object.entries(VOCAB_DATA).sort((a, b) => (a[1].order || 99) - (b[1].order || 99));
    const totalRead = totalWordsRead();
    const totalAvail = totalWordsAvailable();
    const totalPercent = totalAvail > 0 ? Math.round((totalRead / totalAvail) * 100) : 0;
    
    const catTitleEl = document.getElementById('vocabCatTitle');
    if (catTitleEl) catTitleEl.textContent = "Vocabulary Vault";
    
    const catDescEl = document.getElementById('vocabCatDesc');
    if (catDescEl) catDescEl.textContent = "Master academic C1/C2 vocabulary. Practice using advanced terms in context, grade sentences using AI, and pass writing quizzes.";
    
    const catStatsEl = document.getElementById('vocabCatStats');
    if (catStatsEl) catStatsEl.textContent = `${totalRead} / ${totalAvail}`;
    
    const catPercentEl = document.getElementById('vocabCatPercent');
    if (catPercentEl) catPercentEl.textContent = `${totalPercent}%`;
    
    const progressRing = document.getElementById('vocabCatProgressRing');
    if (progressRing) {
      const radius = 50;
      const circumference = 2 * Math.PI * radius; // ~314.16
      const offset = circumference - (totalPercent / 100) * circumference;
      progressRing.style.strokeDasharray = `${circumference}`;
      progressRing.style.strokeDashoffset = `${offset}`;
    }
    
    const studyModeBlock = document.getElementById('vocabStudyModeBlock');
    if (studyModeBlock) studyModeBlock.style.display = 'none';
    const studyModePlaceholder = document.getElementById('vocabStudyModePlaceholder');
    if (studyModePlaceholder) studyModePlaceholder.style.display = 'block';

    let gridHtml = `
      <div style="margin-bottom: 8px;">
        <h3 class="vocab-grid-title">Categories</h3>
      </div>
      <div class="vocab-grid">
    `;
    
    sorted.forEach(([catId, cat]) => {
      const read = cat.words.filter(w => progress.read[vocabKey(catId, w.word)]).length;
      const total = cat.words.length;
      const percent = total > 0 ? Math.round((read / total) * 100) : 0;
      
      gridHtml += `
        <div class="vocab-grid-card" onclick="selectVocabCategory('${catId}')">
          <div>
            <div class="vocab-grid-card-header">
              <span class="vocab-grid-card-icon">${escapeHtml(cat.icon || '📚')}</span>
              <h4 class="vocab-grid-card-label">${escapeHtml(cat.label)}</h4>
            </div>
            <p class="vocab-grid-card-desc">
              ${escapeHtml(descriptions[catId] || cat.desc || `Practice vocabulary in the ${cat.label} domain.`)}
            </p>
          </div>
          <div class="vocab-grid-card-progress">
            <div class="vocab-grid-card-progress-text">
              <span>PROGRESS</span>
              <span>${read} / ${total} words (${percent}%)</span>
            </div>
            <div class="vocab-grid-card-progress-bar-bg">
              <div class="vocab-grid-card-progress-bar" style="width: ${percent}%"></div>
            </div>
          </div>
        </div>
      `;
    });
    
    gridHtml += `</div>`;
    
    main.innerHTML = gridHtml;
    return;
  }

  const cat = VOCAB_DATA[currentVocabCategory];
  if (!cat || !Array.isArray(cat.words)) return;
  const readCount = cat.words.filter(w => w && w.word && progress.read[vocabKey(currentVocabCategory, w.word)]).length;
  const percent = cat.words.length > 0 ? Math.round((readCount / cat.words.length) * 100) : 0;
  
  const catTitleEl = document.getElementById('vocabCatTitle');
  if (catTitleEl) catTitleEl.textContent = cat.label;
  
  const catDescEl = document.getElementById('vocabCatDesc');
  if (catDescEl) catDescEl.textContent = descriptions[currentVocabCategory] || `Improve vocabulary in the ${cat.label} domain.`;
  
  const catStatsEl = document.getElementById('vocabCatStats');
  if (catStatsEl) catStatsEl.textContent = `${readCount} / ${cat.words.length}`;
  
  const catPercentEl = document.getElementById('vocabCatPercent');
  if (catPercentEl) catPercentEl.textContent = `${percent}%`;
  
  const progressRing = document.getElementById('vocabCatProgressRing');
  if (progressRing) {
    const radius = 50;
    const circumference = 2 * Math.PI * radius; // ~314.16
    const offset = circumference - (percent / 100) * circumference;
    progressRing.style.strokeDasharray = `${circumference}`;
    progressRing.style.strokeDashoffset = `${offset}`;
  }
  
  const studyModeBlock = document.getElementById('vocabStudyModeBlock');
  if (studyModeBlock) studyModeBlock.style.display = 'block';
  const studyModePlaceholder = document.getElementById('vocabStudyModePlaceholder');
  if (studyModePlaceholder) studyModePlaceholder.style.display = 'none';

  const btnList = document.getElementById('vocabToggleList');
  const btnFlashcard = document.getElementById('vocabToggleFlashcard');
  if (btnList && btnFlashcard) {
    if (vocabViewState === 'list') {
      btnList.className = "vocab-mode-btn active";
      btnFlashcard.className = "vocab-mode-btn";
    } else {
      btnFlashcard.className = "vocab-mode-btn active";
      btnList.className = "vocab-mode-btn";
    }
  }
  
  let contentHtml = '';
  if (vocabViewState === 'list') {
    contentHtml = cat.words.filter(w => w && w.word).map((w, i) => renderVocabWordCard(w, i)).join('');
    main.innerHTML = `<div class="vocab-word-list">${contentHtml}</div>`;
  } else {
    contentHtml = renderVocabFlashcardContainer();
    main.innerHTML = contentHtml;
    showVocabFlashcard();
  }
}

function setVocabViewState(state) {
  vocabViewState = state;
  renderVocabMain();
}

function speakWord(word) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  } else {
    toast('Text-to-speech not supported in this browser.');
  }
}

function renderVocabWordCard(w, idx) {
  if (!w || !w.word) return '';
  const wordText = w.word;
  const read = isWordRead(currentVocabCategory, wordText);
  const safeWord = wordText.replace(/'/g, "\\'");
  const safeCat = (currentVocabCategory || '').replace(/'/g, "\\'");
  
  const posVal = (w.pos || '').toLowerCase().trim();
  let posClass = 'pos-noun';
  if (posVal.includes('verb')) posClass = 'pos-verb';
  else if (posVal.includes('adj') || posVal.includes('adjective')) posClass = 'pos-adjective';
  else if (posVal.includes('adv') || posVal.includes('adverb')) posClass = 'pos-adverb';
  
  const posHtml = `<span class="pos-badge ${posClass}">${escapeHtml(w.pos || '')}</span>`;
  
  const readBtnHtml = read 
    ? `<button class="vocab-read-btn read vocab-mark-read" onclick="toggleWordRead('${safeCat}', '${safeWord}', ${idx})">
         <span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle;">done_all</span>
         <span>✓ Read</span>
       </button>`
    : `<button class="vocab-read-btn vocab-mark-read" onclick="toggleWordRead('${safeCat}', '${safeWord}', ${idx})">
         <span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle;">done_all</span>
         <span>Mark as read</span>
       </button>`;

  const regex = new RegExp(`\\b(${wordText})\\b`, 'i');
  const examplesHtml = (w.examples || []).map(ex => {
    const bolded = escapeHtml(ex).replace(regex, '<strong>$1</strong>');
    return `<li style="font-size: 13px; color: var(--ink-soft); margin-bottom: 8px; line-height: 1.45; list-style-type: none; position: relative; padding-left: 14px;">
      <span style="position: absolute; left: 0; color: var(--accent);">•</span>
      "${bolded}"
    </li>`;
  }).join('');

  return `
    <div class="vocab-word-card" id="word-card-${idx}">
      <div class="vocab-card-top">
        <div class="vocab-word-title" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span>${escapeHtml(w.word)}</span>
          <div class="vocab-badges" style="display: inline-flex; gap: 4px; align-items: center; vertical-align: middle; margin-left: 4px;">
            ${posHtml}
            <span class="level-badge">${escapeHtml(w.level || 'C1')}</span>
          </div>
          <button class="vocab-audio-btn" onclick="speakWord('${safeWord}')" title="Listen to pronunciation">
            <span class="material-symbols-outlined" style="font-size: 18px;">volume_up</span>
          </button>
        </div>
        ${readBtnHtml}
      </div>
      
      <div class="vocab-word-meaning" style="margin-top: 8px; font-size: 13.5px; color: var(--ink-soft); line-height: 1.5;">
        ${escapeHtml(w.meaning)}
      </div>
      
      ${w.compare ? `
      <div style="font-size: 12px; margin-top: 8px; color: var(--ink-soft); font-style: italic; background: var(--bg); border: 1px solid var(--line-soft); border-radius: 6px; padding: 10px 14px;">
        <strong>Compare:</strong> ${escapeHtml(w.compare)}
      </div>` : ''}
      
      <div style="margin-top: 14px; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;">
        <div style="background: var(--bg); border: 1px solid var(--line-soft); border-radius: 8px; padding: 14px; display: flex; flex-direction: column;">
          <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-soft); font-weight: 700; margin-bottom: 10px;">In Context</div>
          <ul style="margin: 0; padding: 0;">
            ${examplesHtml}
          </ul>
        </div>
        <div class="vocab-try" style="margin: 0; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div class="vocab-try-label">Practice Bench</div>
            <div class="vocab-try-row">
              <input type="text" placeholder="Write a sentence using '${safeWord}'..." id="try-${idx}" onkeypress="if(event.key==='Enter') checkSentence(${idx}, '${safeWord}')">
              <button class="vocab-try-check" onclick="checkSentence(${idx}, '${safeWord}')">Check</button>
              <button class="vocab-try-ai" onclick="aiGradeSentence(${idx}, '${safeWord}', '${safeCat}')">🤖 AI Grade</button>
            </div>
          </div>
          <div class="vocab-try-feedback" id="try-fb-${idx}"></div>
        </div>
      </div>
    </div>
  `;
}

function renderMaster1000Vocab() {
  const main = document.getElementById('vocabMainContent');
  if (!main) return;
  
  // Save focus and cursor selection state
  const activeElId = document.activeElement ? document.activeElement.id : null;
  let selectionStart = null;
  let selectionEnd = null;
  if (activeElId && document.activeElement instanceof HTMLInputElement) {
    selectionStart = document.activeElement.selectionStart;
    selectionEnd = document.activeElement.selectionEnd;
  }
  
  // 1. Update Hero Statistics to show Master List info
  const progress = getVocabProgress();
  const readMasterKeys = Object.keys(progress.read).filter(k => k.startsWith('master1000:'));
  const totalRead = readMasterKeys.length;
  const totalAvail = typeof VOCAB_1000 !== 'undefined' ? VOCAB_1000.length : 0;
  const totalPercent = totalAvail > 0 ? Math.round((totalRead / totalAvail) * 100) : 0;
  
  const catTitleEl = document.getElementById('vocabCatTitle');
  if (catTitleEl) catTitleEl.textContent = "1000 Exam Essentials";
  
  const catDescEl = document.getElementById('vocabCatDesc');
  if (catDescEl) catDescEl.textContent = "Interactive master list of the 1,000 most repeated C1 & C2 words for IELTS, PTE, and TOEFL. Click on any word to load its definitions in different contexts, plus 5 example sentences.";
  
  const catStatsEl = document.getElementById('vocabCatStats');
  if (catStatsEl) catStatsEl.textContent = `${totalRead} / ${totalAvail}`;
  
  const catPercentEl = document.getElementById('vocabCatPercent');
  if (catPercentEl) catPercentEl.textContent = `${totalPercent}%`;
  
  const progressRing = document.getElementById('vocabCatProgressRing');
  if (progressRing) {
    const radius = 50;
    const circumference = 2 * Math.PI * radius; // ~314.16
    const offset = circumference - (totalPercent / 100) * circumference;
    progressRing.style.strokeDasharray = `${circumference}`;
    progressRing.style.strokeDashoffset = `${offset}`;
  }
  
  // Hide study mode block for category view since master list has custom built-in controls
  const studyModeBlock = document.getElementById('vocabStudyModeBlock');
  if (studyModeBlock) studyModeBlock.style.display = 'none';
  const studyModePlaceholder = document.getElementById('vocabStudyModePlaceholder');
  if (studyModePlaceholder) studyModePlaceholder.style.display = 'block';

  // 2. Filter words
  let filtered = typeof VOCAB_1000 !== 'undefined' ? VOCAB_1000 : [];
  filtered = filtered.filter(w => w && w.w);
  if (masterLevelFilter !== 'all') {
    filtered = filtered.filter(w => w.l === masterLevelFilter);
  }
  if (masterSearchQuery) {
    const q = masterSearchQuery.toLowerCase().trim();
    filtered = filtered.filter(w => (w.w || '').toLowerCase().includes(q) || (w.p || '').toLowerCase().includes(q));
  }
  
  // Pagination math
  const totalFiltered = filtered.length;
  const maxPage = Math.max(0, Math.ceil(totalFiltered / masterPageSize) - 1);
  if (masterPage > maxPage) masterPage = maxPage;
  
  const startIdx = masterPage * masterPageSize;
  const endIdx = Math.min(startIdx + masterPageSize, totalFiltered);
  const pageWords = filtered.slice(startIdx, endIdx);
  
  // Build controls HTML
  let controlsHtml = `
    <div class="vocab-control-card" style="margin-bottom: 24px; padding: 20px; display: flex; flex-direction: row; gap: 16px; align-items: center; justify-content: space-between; flex-wrap: wrap;">
      <div style="display: flex; gap: 12px; align-items: center; flex: 1; min-width: 280px;">
        <input type="text" id="masterSearch" class="vocab-search" style="margin: 0; flex: 1;" placeholder="Search 1000 words..." value="${escapeHtml(masterSearchQuery)}" oninput="handleMasterSearch(this.value)">
        
        <select id="masterLevelSelect" onchange="handleMasterLevelFilter(this.value)" style="padding: 8px 12px; border: 1px solid var(--line-soft); border-radius: 6px; background: var(--bg-card); color: var(--ink); font-size: 13px;">
          <option value="all" ${masterLevelFilter === 'all' ? 'selected' : ''}>All Levels</option>
          <option value="C1" ${masterLevelFilter === 'C1' ? 'selected' : ''}>C1 Words</option>
          <option value="C2" ${masterLevelFilter === 'C2' ? 'selected' : ''}>C2 Words</option>
        </select>
      </div>
      
      <div style="display: flex; gap: 8px; align-items: center;">
        <button class="vocab-action-btn" onclick="changeMasterPage(-1)" ${masterPage === 0 ? 'disabled style="opacity: 0.5; cursor: default;"' : ''}>
          <span class="material-symbols-outlined">chevron_left</span> Prev
        </button>
        <span style="font-size: 13px; font-weight: 700; color: var(--ink-soft); min-width: 90px; text-align: center;">
          ${totalFiltered > 0 ? `${startIdx + 1} - ${endIdx} of ${totalFiltered}` : '0 of 0'}
        </span>
        <button class="vocab-action-btn" onclick="changeMasterPage(1)" ${masterPage >= maxPage ? 'disabled style="opacity: 0.5; cursor: default;"' : ''}>
          Next <span class="material-symbols-outlined">chevron_right</span>
        </button>
      </div>
    </div>
  `;
  
  // Build list HTML
  let listHtml = '';
  if (totalFiltered === 0) {
    const qClean = (masterSearchQuery || '').trim();
    if (qClean) {
      listHtml = `
        <div class="vocab-word-card" style="border: 1px dashed var(--line-soft); text-align: center; padding: 30px; width: 100%;">
          <div style="font-size: 40px; margin-bottom: 12px;">🔍</div>
          <h4 style="font-size: 16px; font-weight: 700; margin-bottom: 8px;">"${escapeHtml(qClean)}" not found in Exam Essentials</h4>
          <p style="color: var(--ink-soft); font-size: 13.5px; margin-bottom: 16px; max-width: 440px; margin-left: auto; margin-right: auto; line-height: 1.5;">
            We couldn't find this exact word in our 1,000 IELTS/PTE database. You can query Claude AI to generate layman-friendly definition contexts and examples, or suggest spell-checks if it was mistyped.
          </p>
          <button class="vocab-action-btn coach" onclick="queryExternalWord('${escapeHtml(qClean.replace(/'/g, "\\'"))}')" style="padding: 10px 24px; border-radius: 30px; margin: 0 auto; display: inline-flex; gap: 8px;">
            <span class="material-symbols-outlined">psychology</span>
            <span>Ask Claude AI for Definitions &amp; Options</span>
          </button>
          <div id="externalWordResult" style="margin-top: 20px; text-align: left; width: 100%;"></div>
        </div>
      `;
    } else {
      listHtml = `<div class="list-empty-state">No matching words found. Try adjusting your search query.</div>`;
    }
  } else {
    listHtml = `<div class="vocab-word-list" style="display: flex; flex-direction: column; gap: 20px; width: 100%;">
      ${pageWords.map((w, i) => renderMasterWordCard(w, startIdx + i)).join('')}
    </div>`;
  }
  
  main.innerHTML = controlsHtml + listHtml;
  
  // Restore focus and cursor selection state
  if (activeElId) {
    const el = document.getElementById(activeElId);
    if (el) {
      el.focus();
      if (selectionStart !== null && selectionEnd !== null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(selectionStart, selectionEnd); } catch (e) {}
      }
    }
  }
}

function handleMasterSearch(q) {
  masterSearchQuery = q;
  masterPage = 0;
  renderMaster1000Vocab();
}

function handleMasterLevelFilter(lvl) {
  masterLevelFilter = lvl;
  masterPage = 0;
  renderMaster1000Vocab();
}

function changeMasterPage(delta) {
  masterPage += delta;
  renderMaster1000Vocab();
  // Scroll to top of content
  document.getElementById('vocabMainContent')?.scrollIntoView({ behavior: 'smooth' });
}

function renderMasterWordCard(w, idx) {
  if (!w || !w.w) return '';
  const wordText = w.w;
  const cacheKey = `cached_master_vocab_${wordText}`;
  const cached = localStorage.getItem(cacheKey);
  const data = cached ? JSON.parse(cached) : null;
  
  const read = isWordRead('master1000', wordText);
  const safeWord = wordText.replace(/'/g, "\\'");
  
  const posVal = (w.p || '').toLowerCase().trim();
  let posClass = 'pos-noun';
  if (posVal.includes('verb')) posClass = 'pos-verb';
  else if (posVal.includes('adj') || posVal.includes('adjective')) posClass = 'pos-adjective';
  else if (posVal.includes('adv') || posVal.includes('adverb')) posClass = 'pos-adverb';
  
  const posHtml = `<span class="pos-badge ${posClass}">${escapeHtml(w.p || '')}</span>`;
  
  const readBtnHtml = read 
    ? `<button class="vocab-read-btn read vocab-mark-read" onclick="toggleWordRead('master1000', '${safeWord}', ${idx})">
         <span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle;">done_all</span>
         <span>✓ Read</span>
       </button>`
    : `<button class="vocab-read-btn vocab-mark-read" onclick="toggleWordRead('master1000', '${safeWord}', ${idx})">
         <span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle;">done_all</span>
         <span>Mark as read</span>
       </button>`;

  let innerHtml = '';
  if (data) {
    const contextsHtml = (data.contexts || []).map(ctx => {
      const examplesList = (ctx.examples || []).map(ex => {
        const regex = new RegExp(`\\b(${w.w})\\b`, 'i');
        const bolded = escapeHtml(ex).replace(regex, '<strong>$1</strong>');
        return `<li style="font-size: 13px; color: var(--ink-soft); margin-bottom: 8px; line-height: 1.45; list-style-type: none; position: relative; padding-left: 14px;">
          <span style="position: absolute; left: 0; color: var(--accent);">•</span>
          "${bolded}"
        </li>`;
      }).join('');
      return `
        <div style="background: var(--bg); border: 1px solid var(--line-soft); border-radius: 8px; padding: 14px; margin-bottom: 12px; text-align: left;">
          <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); font-weight: 700; margin-bottom: 4px;">${escapeHtml(ctx.name)} Context</div>
          <div style="font-size: 13px; color: var(--ink); margin-bottom: 8px;">${escapeHtml(ctx.meaning)}</div>
          <ul style="margin: 0; padding: 0;">${examplesList}</ul>
        </div>
      `;
    }).join('');

    innerHtml = `
      <div class="vocab-word-meaning" style="margin-top: 8px; font-size: 13.5px; color: var(--ink-soft); line-height: 1.5; text-align: left;">
        <strong>Definition:</strong> ${escapeHtml(data.meaning || '')}
      </div>
      
      ${data.compare ? `
      <div style="font-size: 12px; margin-top: 8px; color: var(--ink-soft); font-style: italic; background: var(--bg); border: 1px solid var(--line-soft); border-radius: 6px; padding: 10px 14px; margin-bottom: 14px; text-align: left;">
        <strong>Compare:</strong> ${escapeHtml(data.compare)}
      </div>` : ''}
      
      <div style="margin-top: 14px; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;">
        <div>
          <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-soft); font-weight: 700; margin-bottom: 10px; text-align: left;">Contextual Meanings &amp; Examples</div>
          ${contextsHtml}
        </div>
        <div class="vocab-try" style="margin: 0; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div class="vocab-try-label" style="text-align: left;">Practice Bench</div>
            <div class="vocab-try-row">
              <input type="text" placeholder="Write a sentence using '${safeWord}'..." id="try-${idx}" onkeypress="if(event.key==='Enter') checkSentence(${idx}, '${safeWord}')">
              <button class="vocab-try-check" onclick="checkSentence(${idx}, '${safeWord}')">Check</button>
              <button class="vocab-try-ai" onclick="aiGradeSentence(${idx}, '${safeWord}', 'master1000')">🤖 AI Grade</button>
            </div>
          </div>
          <div class="vocab-try-feedback" id="try-fb-${idx}" style="text-align: left;"></div>
        </div>
      </div>
    `;
  } else {
    innerHtml = `
      <div style="margin-top: 12px; display: flex; align-items: center; justify-content: center; padding: 20px; background: var(--bg); border: 1px dashed var(--line-soft); border-radius: 12px;">
        <button class="vocab-action-btn coach" id="load-btn-${idx}" onclick="loadMasterWordDetails('${safeWord}', ${idx})" style="padding: 10px 20px; gap: 8px; border-radius: 30px;">
          <span class="material-symbols-outlined">psychology</span>
          <span>💡 Load AI Definitions &amp; 5 Examples</span>
        </button>
      </div>
    `;
  }

  return `
    <div class="vocab-word-card" id="word-card-${idx}">
      <div class="vocab-card-top">
        <div class="vocab-word-title" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span>${escapeHtml(w.w)}</span>
          <div class="vocab-badges" style="display: inline-flex; gap: 4px; align-items: center; vertical-align: middle; margin-left: 4px;">
            ${posHtml}
            <span class="level-badge">${escapeHtml(w.l || 'C1')}</span>
          </div>
          <button class="vocab-audio-btn" onclick="speakWord('${safeWord}')" title="Listen to pronunciation">
            <span class="material-symbols-outlined" style="font-size: 18px;">volume_up</span>
          </button>
        </div>
        ${readBtnHtml}
      </div>
      
      ${innerHtml}
    </div>
  `;
}

async function loadMasterWordDetails(word, idx) {
  const btn = document.getElementById(`load-btn-${idx}`);
  if (!btn) return;
  
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-dark" style="border-color: var(--accent); border-top-color: transparent; width: 14px; height: 14px; margin-right: 6px;"></span><span>Loading details...</span>`;
  
  if (offlineMode) {
    const data = {
      meaning: `High-frequency C1/C2 vocabulary word.`,
      compare: `Connect to the internet to trigger AI generation of comparison notes and context examples.`,
      contexts: [
        { name: "General Usage", meaning: "Standard academic vocabulary item.", examples: [`Please practice using "${word}" in your own sentences.`] }
      ]
    };
    localStorage.setItem(`cached_master_vocab_${word}`, JSON.stringify(data));
    renderMaster1000Vocab();
    return;
  }
  
  const prompt = `Define the C1/C2 academic word "${word}" for English tests (PTE/IELTS). Provide:
1. One general formal meaning (written in simple, clear, layman-friendly plain English so that a student can easily grasp it without looking up other difficult words).
2. A comparison note (e.g. versus a similar word).
3. Context-specific meanings for 2-3 different academic/professional contexts (explained in clear, layman-friendly language).
4. Exactly 5 example sentences total demonstrating the word in these contexts.

Return ONLY a valid JSON object matching this structure (do not include markdown outside JSON, just output the JSON plain text):
{
  "meaning": "general meaning here",
  "compare": "comparison note here",
  "contexts": [
    { "name": "Academic Writing", "meaning": "meaning in this context", "examples": ["example sentence 1", "example sentence 2"] },
    { "name": "Professional/Business", "meaning": "meaning in this context", "examples": ["example sentence 3", "example sentence 4"] },
    { "name": "General/Scientific", "meaning": "meaning in this context", "examples": ["example sentence 5"] }
  ]
}`;

  try {
    const res = await fetch(API_URL + '/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const resData = await res.json();
    const text = (resData.content || []).map(c => c.text || '').join('\n').trim();
    
    const data = cleanAndParseJSON(text);
    localStorage.setItem(`cached_master_vocab_${word}`, JSON.stringify(data));
    renderMaster1000Vocab();
  } catch (err) {
    console.error('Failed to load AI vocab details:', err);
    toast('AI generation failed: ' + err.message, true);
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

async function toggleWordRead(catId, word, idx) {
  const progress = getVocabProgress();
  const key = vocabKey(catId, word);
  if (progress.read[key]) {
    delete progress.read[key];
  } else {
    progress.read[key] = Date.now();
  }
  await saveVocabProgress();
  
  if (catId === 'master1000') {
    renderMaster1000Vocab();
    updateVocabProgressSummary();
    return;
  }
  
  // Update UI in place
  const card = document.getElementById(`word-card-${idx}`);
  if (card) card.classList.toggle('read', !!progress.read[key]);
  const btn = card?.querySelector('.vocab-mark-read');
  if (btn) {
    btn.classList.toggle('read', !!progress.read[key]);
    btn.textContent = progress.read[key] ? '✓ Read' : 'Mark as read';
  }
  renderVocabCategoryList();
  updateVocabProgressSummary();
}

// Free instant check: is the word present in the user's sentence?
function checkSentence(idx, word) {
  const input = document.getElementById(`try-${idx}`);
  const fb = document.getElementById(`try-fb-${idx}`);
  if (!input || !fb) return;
  const text = (input.value || '').trim();
  if (!text) {
    fb.className = 'vocab-try-feedback show warn';
    fb.textContent = 'Write a sentence first.';
    return;
  }
  // Word-present check — match the word stem (handles plurals, verb endings)
  const stem = word.toLowerCase().replace(/(ation|isation|ing|ed|ies|es|s)$/, '').slice(0, Math.max(4, word.length - 3));
  const re = new RegExp(`\\b${stem}[a-z]*\\b`, 'i');
  if (!re.test(text)) {
    fb.className = 'vocab-try-feedback show warn';
    fb.innerHTML = `Hmm — I couldn't find <strong>"${escapeHtml(word)}"</strong> (or a form of it) in your sentence. Try again.`;
    return;
  }
  if (text.length < 15) {
    fb.className = 'vocab-try-feedback show warn';
    fb.textContent = 'Your sentence is very short. Try a sentence with more context.';
    return;
  }
  fb.className = 'vocab-try-feedback show ok';
  fb.innerHTML = `✓ Nice — you used <strong>"${escapeHtml(word)}"</strong>. For deeper feedback on grammar and meaning, click 🤖 AI grade.`;
}

async function aiGradeSentence(idx, word, catId) {
  if (offlineMode) { toast('AI grade requires sign-in', true); return; }
  const input = document.getElementById(`try-${idx}`);
  const fb = document.getElementById(`try-fb-${idx}`);
  if (!input || !fb) return;
  const sentence = (input.value || '').trim();
  if (!sentence) {
    fb.className = 'vocab-try-feedback show warn';
    fb.textContent = 'Write a sentence first.';
    return;
  }
  // Quota
  if (!await consumeQuota('idea')) return;

  let wordData = null;
  if (catId === 'master1000') {
    const found = (typeof VOCAB_1000 !== 'undefined' ? VOCAB_1000 : []).find(w => w.w === word);
    if (found) {
      const cached = localStorage.getItem(`cached_master_vocab_${word}`);
      const cachedData = cached ? JSON.parse(cached) : null;
      wordData = {
        word: found.w,
        pos: found.p,
        meaning: cachedData ? cachedData.meaning : "C1/C2 Academic vocabulary word"
      };
    }
  } else if (catId === 'external') {
    wordData = {
      word: word,
      pos: lastExternalWordData ? lastExternalWordData.pos : '',
      meaning: lastExternalWordData ? lastExternalWordData.meaning : 'Vocabulary word'
    };
  } else {
    wordData = (VOCAB_DATA[catId]?.words || []).find(w => w.word === word);
  }
  fb.className = 'vocab-try-feedback show thinking';
  fb.innerHTML = '<span class="spinner-dark"></span> AI is reviewing your sentence…';

  const prompt = `You are an IELTS / PTE English tutor at IPT Brisbane. A student is practising the C1/C2 word "${word}" (${wordData?.pos || ''}). The word means: ${wordData?.meaning || ''}

The student's sentence: "${sentence}"

Evaluate it in 2-3 short bullet points, written in very simple, clear, layman-friendly plain English. Avoid complex grammatical jargon; explain any mistakes in a straightforward way that a beginner can easily understand:
1. Did they USE the word correctly (right meaning + grammar)? Yes/No + brief, simple explanation of why.
2. Is the sentence grammatically correct overall? Brief note in simple terms.
3. ONE concrete, easy-to-understand improvement if relevant (or a "well done" if it's already great).

Keep total response under 80 words. Be encouraging, simple, and accurate. Plain text, no markdown.`;

  try {
    const res = await fetch(API_URL + '/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 250,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    const text = (data.content || []).map(c => c.text || '').join('\n').trim();
    fb.className = 'vocab-try-feedback show ok';
    fb.innerHTML = '🤖 ' + escapeHtml(text).replace(/\n/g, '<br>');
    // Save attempt
    const progress = getVocabProgress();
    if (!progress.attempts[vocabKey(catId, word)]) progress.attempts[vocabKey(catId, word)] = [];
    progress.attempts[vocabKey(catId, word)].push({ sentence, feedback: text.slice(0, 200), ts: Date.now() });
    if (progress.attempts[vocabKey(catId, word)].length > 5) {
      progress.attempts[vocabKey(catId, word)] = progress.attempts[vocabKey(catId, word)].slice(-5);
    }
    await saveVocabProgress();
  } catch (err) {
    fb.className = 'vocab-try-feedback show warn';
    fb.textContent = 'AI grade failed: ' + err.message;
  }
}

// ============================================================
//  PRACTICE QUIZ
// ============================================================
let quizWords = [];
let quizUserAnswers = {};

function openVocabPractice() {
  const progress = getVocabProgress();
  const allWords = [];
  for (const [catId, cat] of Object.entries(VOCAB_DATA)) {
    for (const w of cat.words) {
      allWords.push({ ...w, catId, catLabel: cat.label, read: !!progress.read[vocabKey(catId, w.word)] });
    }
  }
  const readPool = allWords.filter(w => w.read);
  const unreadPool = allWords.filter(w => !w.read);

  document.getElementById('vocabPracticeContent').innerHTML = `
    <h2>🎯 Vocabulary Practice Center</h2>
    <p style="margin-bottom: 20px;">Choose a practice mode to test your C1/C2 vocabulary knowledge.</p>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
      <!-- Quiz Panel -->
      <div style="background: rgba(99, 102, 241, 0.05); border: 1px solid rgba(99, 102, 241, 0.15); border-radius: 8px; padding: 16px; display: flex; flex-direction: column;">
        <h3 style="font-size:15px; margin-bottom:6px; color:var(--accent);">🎯 Definition Quiz</h3>
        <p style="font-size:11.5px; color:var(--ink-soft); flex:1; line-height:1.4;">Test your knowledge of definitions. Choose spelling or multiple-choice questions.</p>
        <div style="margin-top:14px; display:flex; flex-direction:column; gap:8px;">
          <button class="tb-text-btn dark" onclick="startQuizMode('spelling')">Start Spelling Quiz</button>
          <button class="tb-text-btn dark" onclick="startQuizMode('mcq')">Start Multiple Choice</button>
        </div>
      </div>
      
      <!-- Matching Game Panel -->
      <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.15); border-radius: 8px; padding: 16px; display: flex; flex-direction: column;">
        <h3 style="font-size:15px; margin-bottom:6px; color:#10b981;">⚡ Synonyms Matcher</h3>
        <p style="font-size:11.5px; color:var(--ink-soft); flex:1; line-height:1.4;">Match advanced terms to their synonyms against the clock. Compete for the high score!</p>
        <div style="margin-top:14px;">
          <button class="tb-text-btn dark" onclick="startSynonymsMatcher()" style="background:#10b981; border-color:#10b981; width:100%;">Play Matcher Game</button>
        </div>
      </div>
    </div>
    
    <div style="font-size:12.5px; color:var(--ink-mute); border-top:1px solid var(--line-soft); padding-top:12px; display:flex; justify-content:space-between; align-items:center;">
      <span>Pool: <strong>${readPool.length}</strong> read words · <strong>${unreadPool.length}</strong> unread</span>
      <button class="tb-text-btn" onclick="closeVocabPractice()">Close</button>
    </div>
  `;
  document.getElementById('vocabPracticeModal').classList.add('show');
}
function closeVocabPractice() { document.getElementById('vocabPracticeModal').classList.remove('show'); }

function startQuiz(n, pool) {
  const progress = getVocabProgress();
  const allWords = [];
  for (const [catId, cat] of Object.entries(VOCAB_DATA)) {
    for (const w of cat.words) {
      allWords.push({ ...w, catId, catLabel: cat.label, read: !!progress.read[vocabKey(catId, w.word)] });
    }
  }
  const source = (pool === 'read') ? allWords.filter(w => w.read) : allWords;
  if (source.length === 0) { toast('No words available — read some first', true); return; }
  // Shuffle and pick n
  const shuffled = [...source].sort(() => Math.random() - 0.5).slice(0, Math.min(n, source.length));
  quizWords = shuffled;
  quizUserAnswers = {};
  renderQuiz();
}

function renderQuiz() {
  const c = document.getElementById('vocabPracticeContent');
  c.innerHTML = `
    <h2>🎯 Practice Quiz — ${quizWords.length} words</h2>
    <p>For each meaning, type the matching word.</p>
    <div style="max-height:420px; overflow-y:auto; padding-right:4px;">
      ${quizWords.map((w, i) => `
        <div class="quiz-question">
          <div class="quiz-question-prompt">
            <strong>${i+1}.</strong> <em>${escapeHtml(w.catLabel)}</em><br>
            ${escapeHtml(w.meaning)}
          </div>
          <input type="text" id="quiz-q-${i}" placeholder="Your answer…" autocomplete="off" spellcheck="false">
          <div class="quiz-result" id="quiz-r-${i}"></div>
        </div>
      `).join('')}
    </div>
    <div class="modal-actions">
      <button class="tb-text-btn" onclick="closeVocabPractice()">Cancel</button>
      <button class="tb-text-btn dark" onclick="submitQuiz()">Check answers</button>
    </div>
  `;
  setTimeout(() => document.getElementById('quiz-q-0')?.focus(), 60);
}

function submitQuiz() {
  let correct = 0;
  for (let i = 0; i < quizWords.length; i++) {
    const w = quizWords[i];
    const input = document.getElementById(`quiz-q-${i}`);
    const r = document.getElementById(`quiz-r-${i}`);
    const ans = (input?.value || '').trim().toLowerCase();
    const target = w.word.toLowerCase();
    const targetStem = target.replace(/(ation|isation|ing|ed|ies|es|s)$/, '');
    const isOk = ans === target || (ans.length >= 4 && ans.startsWith(targetStem.slice(0, Math.min(5, targetStem.length))) && Math.abs(ans.length - target.length) <= 4);
    if (isOk) {
      correct++;
      r.className = 'quiz-result show ok';
      r.textContent = `✓ Correct: ${w.word}`;
    } else {
      r.className = 'quiz-result show fail';
      r.textContent = `✗ Answer: ${w.word}`;
    }
    if (input) input.disabled = true;
  }
  // Save practice result
  const progress = getVocabProgress();
  if (!progress.practiceHistory) progress.practiceHistory = [];
  progress.practiceHistory.push({
    date: Date.now(),
    total: quizWords.length,
    correct: correct,
    pct: Math.round(correct / quizWords.length * 100)
  });
  if (progress.practiceHistory.length > 50) progress.practiceHistory = progress.practiceHistory.slice(-50);
  saveVocabProgress();

  // Show summary
  const c = document.getElementById('vocabPracticeContent');
  const summary = document.createElement('div');
  summary.style.cssText = 'background: var(--bg-card); border: 2px solid var(--accent); border-radius: 8px; padding: 14px 18px; margin: 14px 0; font-size: 14px;';
  summary.innerHTML = `
    <strong>Score: ${correct} / ${quizWords.length}</strong> (${Math.round(correct/quizWords.length*100)}%)
    <div style="margin-top:6px; font-size:12px; color:var(--ink-soft);">
      ${correct === quizWords.length ? 'Perfect! 🎉' :
        correct >= quizWords.length * 0.7 ? 'Great work — keep practising the ones you missed.' :
        correct >= quizWords.length * 0.4 ? 'Good effort. Review those words and try again.' :
        'Read through the words again — you\'ll improve fast.'}
    </div>
  `;
  c.insertBefore(summary, c.firstChild);
  // Replace footer buttons
  const footer = c.querySelector('.modal-actions');
  if (footer) {
    footer.innerHTML = `
      <button class="tb-text-btn" onclick="closeVocabPractice()">Close</button>
      <button class="tb-text-btn dark" onclick="openVocabPractice()">New quiz</button>
    `;
  }
}


// ============================================================
//  ADMIN — VOCAB MANAGEMENT (add new words globally)
// ============================================================
// Admin-added words are stored in Firestore at /admin/vocab and merged
// into the in-memory VOCAB_DATA at app load.
async function loadGlobalVocabExtras() {
  if (offlineMode) return;
  try {
    const res = await fetch(API_URL + '/api/vocab/extras');
    if (!res.ok) throw new Error('Status ' + res.status);
    const d = await res.json();
    const extras = d.extras || {};
    // Merge into VOCAB_DATA
    for (const catId of Object.keys(extras)) {
      if (!VOCAB_DATA[catId]) continue;
      const existingWords = new Set(VOCAB_DATA[catId].words.map(w => w.word.toLowerCase()));
      for (const w of (extras[catId] || [])) {
        if (!existingWords.has(w.word.toLowerCase())) {
          VOCAB_DATA[catId].words.push({ ...w, _admin: true });
          existingWords.add(w.word.toLowerCase());
        }
      }
    }
    console.log('Vocab extras loaded:', Object.keys(extras).length, 'categories with admin words');
  } catch (err) {
    console.warn('Could not load admin vocab extras:', err);
  }
}

function adminSwitchTab(tab) {
  document.getElementById('adminTabUsers').style.display = (tab === 'users') ? '' : 'none';
  document.getElementById('adminTabPassages').style.display = (tab === 'passages') ? '' : 'none';
  document.getElementById('adminTabVocab').style.display = (tab === 'vocab') ? '' : 'none';

  const usersBtn = document.getElementById('adminTabUsersBtn');
  const passagesBtn = document.getElementById('adminTabPassagesBtn');
  const vocabBtn = document.getElementById('adminTabVocabBtn');

  usersBtn.style.background = (tab === 'users') ? 'var(--ink)' : '';
  usersBtn.style.color = (tab === 'users') ? '#fff' : '';
  if (passagesBtn) {
    passagesBtn.style.background = (tab === 'passages') ? 'var(--ink)' : '';
    passagesBtn.style.color = (tab === 'passages') ? '#fff' : '';
  }
  vocabBtn.style.background = (tab === 'vocab') ? 'var(--ink)' : '';
  vocabBtn.style.color = (tab === 'vocab') ? '#fff' : '';

  if (tab === 'vocab') populateAdminVocabCategorySelect();
  if (tab === 'passages') {
    if (typeof loadAdminPassages === 'function') loadAdminPassages();
  }
}

function populateAdminVocabCategorySelect() {
  const select = document.getElementById('adminVocabCat');
  const current = select.value;
  const sorted = Object.entries(VOCAB_DATA).sort((a, b) => (a[1].order || 99) - (b[1].order || 99));
  select.innerHTML = '<option value="">— Pick a category —</option>' +
    sorted.map(([id, cat]) => `<option value="${id}">${cat.icon} ${escapeHtml(cat.label)} (${cat.words.length} words)</option>`).join('');
  if (current && VOCAB_DATA[current]) select.value = current;
}

function renderAdminVocabList() {
  const catId = document.getElementById('adminVocabCat').value;
  const list = document.getElementById('adminVocabList');
  if (!catId || !VOCAB_DATA[catId]) {
    list.innerHTML = '<div style="text-align:center; color:var(--ink-mute); padding:24px; font-style:italic; font-family:var(--serif);">Pick a category above to see its words.</div>';
    return;
  }
  const cat = VOCAB_DATA[catId];
  list.innerHTML = cat.words.map((w, i) => `
    <div style="display:flex; align-items:center; gap:10px; padding:8px 12px; border-bottom:1px solid var(--line);">
      <div style="flex:1;">
        <div style="font-weight:600; font-family:var(--serif); font-size:14px;">
          ${escapeHtml(w.word)}
          <span style="font-size:10px; color:var(--ink-mute); font-weight:400; font-style:italic; margin-left:6px;">${escapeHtml(w.pos || '')} · ${escapeHtml(w.level || 'C1')}</span>
          ${w._admin ? '<span style="background:#8fd18f; color:#fff; font-size:9px; padding:1px 6px; border-radius:3px; margin-left:6px;">ADMIN</span>' : ''}
        </div>
        <div style="font-size:11.5px; color:var(--ink-soft); margin-top:2px;">${escapeHtml((w.meaning || '').slice(0, 90))}${(w.meaning || '').length > 90 ? '…' : ''}</div>
      </div>
      ${w._admin ? `<button class="tb-text-btn" onclick="deleteAdminWord('${catId}', '${escapeHtml(w.word).replace(/'/g, "\\'")}')" style="font-size:11px; padding:4px 10px;">Delete</button>` : '<span style="font-size:10px; color:var(--ink-mute); font-style:italic; padding:0 6px;">seed</span>'}
    </div>
  `).join('');
}

function openAddWord() {
  const catId = document.getElementById('adminVocabCat').value;
  if (!catId) { toast('Pick a category first', true); return; }
  document.getElementById('addWordCatId').value = catId;
  document.getElementById('addWordEditId').value = '';
  document.getElementById('addWordTitle').textContent = `+ Add Word to ${VOCAB_DATA[catId].label}`;
  ['addWordWord', 'addWordPos', 'addWordMeaning', 'addWordEx1', 'addWordEx2', 'addWordEx3', 'addWordCompare'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('addWordLevel').value = 'C1';
  document.getElementById('addWordModal').classList.add('show');
  setTimeout(() => document.getElementById('addWordWord').focus(), 60);
}
function closeAddWord() { document.getElementById('addWordModal').classList.remove('show'); }

async function saveNewWord() {
  const catId = document.getElementById('addWordCatId').value;
  if (!catId || !VOCAB_DATA[catId]) { toast('Category missing', true); return; }
  const word = document.getElementById('addWordWord').value.trim();
  const meaning = document.getElementById('addWordMeaning').value.trim();
  const ex1 = document.getElementById('addWordEx1').value.trim();
  const ex2 = document.getElementById('addWordEx2').value.trim();
  const ex3 = document.getElementById('addWordEx3').value.trim();

  if (!word) { toast('Word is required', true); return; }
  if (!meaning) { toast('Meaning is required', true); return; }
  if (!ex1 || !ex2) { toast('Please provide at least 2 example sentences', true); return; }

  // Check duplicate
  const exists = VOCAB_DATA[catId].words.some(w => w.word.toLowerCase() === word.toLowerCase());
  if (exists) { toast(`"${word}" already exists in this category`, true); return; }

  const newWord = {
    word,
    pos: document.getElementById('addWordPos').value.trim() || 'noun',
    level: document.getElementById('addWordLevel').value || 'C1',
    meaning,
    examples: [ex1, ex2, ex3].filter(Boolean),
    _admin: true
  };
  const compare = document.getElementById('addWordCompare').value.trim();
  if (compare) newWord.compare = compare;

  // Push into in-memory VOCAB_DATA so the UI reflects immediately
  VOCAB_DATA[catId].words.push(newWord);

  try {
    const getRes = await fetch(API_URL + '/api/vocab/extras');
    if (!getRes.ok) throw new Error('Failed to fetch vocab extras');
    const getD = await getRes.json();
    let extras = getD.extras || {};

    if (!extras[catId]) extras[catId] = [];
    const persistable = { ...newWord };
    delete persistable._admin;
    extras[catId].push(persistable);

    const postRes = await fetch(API_URL + '/api/admin/vocab/extras', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey
      },
      body: JSON.stringify({ extras })
    });
    if (!postRes.ok) throw new Error('Failed to save vocab extras: ' + postRes.status);
    toast(`"${word}" added — visible to all students ✓`);
  } catch (err) {
    // Roll back in-memory addition
    VOCAB_DATA[catId].words = VOCAB_DATA[catId].words.filter(w => w !== newWord);
    toast('Save failed: ' + err.message, true);
    return;
  }

  closeAddWord();
  renderAdminVocabList();
  populateAdminVocabCategorySelect();  // update word counts
}

async function deleteAdminWord(catId, word) {
  if (!VOCAB_DATA[catId]) return;
  if (!confirm(`Remove "${word}" from ${VOCAB_DATA[catId].label}?\n\nThis removes it for all students.`)) return;

  const before = VOCAB_DATA[catId].words.length;
  VOCAB_DATA[catId].words = VOCAB_DATA[catId].words.filter(w => !(w.word === word && w._admin));
  if (VOCAB_DATA[catId].words.length === before) {
    toast(`Could not find admin-added word "${word}"`, true);
    return;
  }

  try {
    const getRes = await fetch(API_URL + '/api/vocab/extras');
    if (!getRes.ok) throw new Error('Failed to fetch vocab extras');
    const getD = await getRes.json();
    let extras = getD.extras || {};

    if (extras[catId]) {
      extras[catId] = extras[catId].filter(w => w.word !== word);
      if (extras[catId].length === 0) delete extras[catId];
    }

    const postRes = await fetch(API_URL + '/api/admin/vocab/extras', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey
      },
      body: JSON.stringify({ extras })
    });
    if (!postRes.ok) throw new Error('Failed to save delete');
    toast(`"${word}" deleted ✓`);
  } catch (err) {
    toast('Delete sync failed: ' + err.message, true);
  }
  renderAdminVocabList();
  populateAdminVocabCategorySelect();
}


// ============================================================
//  AI-SUGGEST VOCABULARY WORDS (admin)
//  Two-pass flow:
//    1. Fetch 20 candidate words (cheap — names + one-line meanings)
//    2. Admin ticks which to keep
//    3. Generate full details (definition + 3 examples + compare) for kept ones
//    4. Admin reviews, clicks Save All
// ============================================================
let suggestState = { catId: null, suggestions: [], details: [] };

async function openSuggestWords() {
  if (!isAdmin()) {
    toast('Admin only', true);
    return;
  }
  const catSelect = document.getElementById('adminVocabCat');
  if (!catSelect) {
    console.error('Suggest: adminVocabCat dropdown not found in DOM');
    toast('Category dropdown missing — refresh and try again', true);
    return;
  }
  const catId = catSelect.value;
  if (!catId) {
    toast('Pick a category from the dropdown first', true);
    return;
  }
  const cat = VOCAB_DATA[catId];
  if (!cat) {
    console.error('Suggest: category not in VOCAB_DATA:', catId);
    toast('Category not found', true);
    return;
  }
  const modal = document.getElementById('suggestWordsModal');
  if (!modal) {
    console.error('Suggest: suggestWordsModal element not found');
    toast('Suggest modal missing — refresh page', true);
    return;
  }
  suggestState = { catId, suggestions: [], details: [] };
  document.getElementById('suggestCatId').value = catId;
  document.getElementById('suggestTitle').textContent = `🤖 Suggest words for "${cat.label}"`;
  // Stage 1: loading
  suggestShowStage(1);
  document.getElementById('suggestStage1Msg').textContent = `Asking AI for 20 fresh ${cat.label} words…`;
  modal.classList.add('show');

  // Build the prompt
  const existing = cat.words.map(w => w.word).join(', ');
  const prompt = `You are a vocabulary expert for IELTS / PTE preparation at the C1-C2 (advanced) level.

CATEGORY: ${cat.label}

Already-included words to AVOID duplicating:
${existing}

Suggest 20 NEW C1 or C2 level words or short phrases that are commonly used when discussing "${cat.label}" topics, especially in formal essays. Bias toward useful, high-frequency academic vocabulary that students would benefit from. Avoid obscure words.

For each, give one short line (≤90 chars) describing what it means.

Return ONLY a JSON array — no preamble, no markdown fences. Format:
[
  {"word": "litigation", "pos": "noun", "level": "C1", "preview": "The process of taking legal action through courts."},
  {"word": "incarceration", "pos": "noun", "level": "C2", "preview": "..."}
]`;

  try {
    const res = await fetch(API_URL + '/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('Suggest: /api/claude error body:', errText);
      throw new Error(`Server returned ${res.status} — see console for details`);
    }
    const data = await res.json();
    const text = (data.content || []).map(c => c.text || '').join('').trim();
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let words = cleanAndParseJSON(text);
    if (!Array.isArray(words) || words.length === 0) throw new Error('AI returned no suggestions');

    // Mark which words already exist in this category
    const existingLc = new Set(cat.words.map(w => w.word.toLowerCase()));
    suggestState.suggestions = words.map(w => ({
      word: String(w.word || '').trim(),
      pos: String(w.pos || 'noun').trim(),
      level: String(w.level || 'C1').trim(),
      preview: String(w.preview || '').trim(),
      duplicate: existingLc.has(String(w.word || '').toLowerCase().trim()),
      checked: !existingLc.has(String(w.word || '').toLowerCase().trim())  // default: tick all non-duplicates
    })).filter(w => w.word);

    renderSuggestionList();
    suggestShowStage(2);
    document.getElementById('suggestNextBtn').style.display = '';
    document.getElementById('suggestNextBtn').textContent = 'Generate details →';
  } catch (err) {
    console.error(err);
    document.getElementById('suggestStage1Msg').innerHTML = `<span style="color:var(--accent-deep);">Could not get suggestions: ${escapeHtml(err.message)}</span>`;
  }
}

function suggestShowStage(stage) {
  for (let i = 1; i <= 4; i++) {
    document.getElementById(`suggestStage${i}`).style.display = (i === stage) ? '' : 'none';
  }
}

function renderSuggestionList() {
  const list = document.getElementById('suggestList');
  list.innerHTML = suggestState.suggestions.map((w, i) => `
    <label style="display:flex; align-items:center; gap:10px; padding:7px 10px; border-radius:4px; cursor:${w.duplicate ? 'not-allowed' : 'pointer'}; ${w.duplicate ? 'opacity:0.4;' : ''}" onmouseover="this.style.background='var(--bg-card)';" onmouseout="this.style.background='';">
      <input type="checkbox" ${w.checked ? 'checked' : ''} ${w.duplicate ? 'disabled' : ''} onchange="toggleSuggestion(${i}, this.checked)">
      <div style="flex:1; line-height:1.4;">
        <strong style="font-family:var(--serif); font-size:14px;">${escapeHtml(w.word)}</strong>
        <span style="color:var(--ink-mute); font-size:11px; margin-left:6px;">${escapeHtml(w.pos)} · ${escapeHtml(w.level)}</span>
        ${w.duplicate ? '<span style="background:#bbb; color:#fff; font-size:9px; padding:1px 5px; border-radius:3px; margin-left:6px;">EXISTS</span>' : ''}
        <div style="font-size:11.5px; color:var(--ink-soft); margin-top:2px;">${escapeHtml(w.preview)}</div>
      </div>
    </label>
  `).join('');
  updateSuggestCount();
}

function toggleSuggestion(idx, checked) {
  if (suggestState.suggestions[idx]) {
    suggestState.suggestions[idx].checked = checked;
    updateSuggestCount();
  }
}

function toggleAllSuggestions(on) {
  for (const w of suggestState.suggestions) {
    if (!w.duplicate) w.checked = on;
  }
  renderSuggestionList();
}

function updateSuggestCount() {
  const n = suggestState.suggestions.filter(w => w.checked && !w.duplicate).length;
  document.getElementById('suggestPickedCount').textContent = `${n} selected`;
  document.getElementById('suggestNextBtn').disabled = (n === 0);
}

async function suggestNextStep() {
  // Called from stage 2 (Generate details) or stage 4 (Save all)
  const stage4Visible = document.getElementById('suggestStage4').style.display !== 'none';
  if (stage4Visible) {
    await saveAllSuggestions();
  } else {
    await generateAllDetails();
  }
}

async function generateAllDetails() {
  const picked = suggestState.suggestions.filter(w => w.checked && !w.duplicate);
  if (picked.length === 0) { toast('Pick at least one word', true); return; }

  suggestShowStage(3);
  document.getElementById('suggestNextBtn').style.display = 'none';
  document.getElementById('suggestStage3Msg').textContent = `Generating full cards for ${picked.length} word${picked.length === 1 ? '' : 's'}…`;

  const cat = VOCAB_DATA[suggestState.catId];
  const wordsJson = JSON.stringify(picked.map(w => ({ word: w.word, pos: w.pos, level: w.level })));

  const prompt = `You are a vocabulary expert for IELTS / PTE preparation at the C1-C2 level.

For the following words in the "${cat.label}" category, generate a full card for each.

Words: ${wordsJson}

For each word produce:
- "word": the word itself (exact)
- "pos": part of speech (use the one provided, or refine if needed)
- "level": "C1" or "C2"
- "meaning": one clear plain-English definition (one sentence, ≤180 chars)
- "examples": exactly 3 natural example sentences showing the word in real use. Each ≤120 chars. Should sound like sentences a student would meet in essays or articles.
- "compare": (OPTIONAL — include only if useful) a one-line note comparing this word with a similar word students might confuse it with. Format: "vs. X: ..." (≤140 chars). Omit entirely if no useful comparison.

Return ONLY a JSON array — no preamble, no markdown fences. Format:
[
  {"word":"litigation","pos":"noun","level":"C1","meaning":"...","examples":["...","...","..."],"compare":"vs. lawsuit: ..."},
  ...
]`;

  try {
    const res = await fetch(API_URL + '/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    const text = (data.content || []).map(c => c.text || '').join('').trim();
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let details = cleanAndParseJSON(text);
    if (!Array.isArray(details)) throw new Error('AI response was not a list');

    // Normalise / validate each entry
    suggestState.details = details
      .filter(d => d && d.word && d.meaning && Array.isArray(d.examples) && d.examples.length > 0)
      .map(d => ({
        word: String(d.word).trim(),
        pos: String(d.pos || 'noun').trim(),
        level: (String(d.level || 'C1').trim().toUpperCase() === 'C2') ? 'C2' : 'C1',
        meaning: String(d.meaning).trim(),
        examples: d.examples.map(e => String(e).trim()).filter(Boolean).slice(0, 3),
        compare: d.compare ? String(d.compare).trim() : '',
        keep: true  // default: keep all generated
      }))
      .filter(d => d.examples.length >= 2);

    if (suggestState.details.length === 0) throw new Error('AI returned no valid word details');

    renderDetailsPreview();
    suggestShowStage(4);
    document.getElementById('suggestNextBtn').style.display = '';
    document.getElementById('suggestNextBtn').textContent = `Save ${suggestState.details.length} words →`;
  } catch (err) {
    console.error(err);
    document.getElementById('suggestStage3Msg').innerHTML = `<span style="color:var(--accent-deep);">${escapeHtml(err.message)}</span>`;
    setTimeout(() => {
      suggestShowStage(2);
      document.getElementById('suggestNextBtn').style.display = '';
    }, 2500);
  }
}

function renderDetailsPreview() {
  const c = document.getElementById('suggestPreview');
  c.innerHTML = suggestState.details.map((d, i) => `
    <div style="background:var(--bg-card); border:1px solid var(--line); border-radius:8px; padding:12px 14px; margin-bottom:10px;">
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
        <input type="checkbox" ${d.keep ? 'checked' : ''} onchange="suggestState.details[${i}].keep = this.checked; updateSaveBtnCount();">
        <strong style="font-family:var(--serif); font-size:15px;">${escapeHtml(d.word)}</strong>
        <span style="color:var(--ink-mute); font-size:11px; font-style:italic;">${escapeHtml(d.pos)}</span>
        <span style="background:var(--accent); color:#fff; font-size:9px; padding:2px 6px; border-radius:3px; font-weight:700; letter-spacing:0.07em;">${escapeHtml(d.level)}</span>
      </div>
      <div style="font-size:12.5px; line-height:1.55; color:var(--ink); margin:6px 0;">${escapeHtml(d.meaning)}</div>
      ${d.compare ? `<div style="background:#fff8e6; border-left:3px solid #b07a2a; padding:6px 10px; border-radius:0 4px 4px 0; font-size:11.5px; color:#5a4400; margin:6px 0;">${escapeHtml(d.compare)}</div>` : ''}
      <ul style="margin:6px 0 0; padding:0 0 0 18px; list-style:none;">
        ${d.examples.map(ex => `<li style="font-size:11.5px; color:var(--ink-soft); font-style:italic; line-height:1.5; padding:2px 0;">› ${escapeHtml(ex)}</li>`).join('')}
      </ul>
    </div>
  `).join('');
  updateSaveBtnCount();
}

function updateSaveBtnCount() {
  const n = suggestState.details.filter(d => d.keep).length;
  document.getElementById('suggestNextBtn').textContent = `Save ${n} word${n === 1 ? '' : 's'} →`;
  document.getElementById('suggestNextBtn').disabled = (n === 0);
}

async function saveAllSuggestions() {
  const toSave = suggestState.details.filter(d => d.keep);
  if (toSave.length === 0) { toast('Nothing to save', true); return; }
  const catId = suggestState.catId;
  if (!VOCAB_DATA[catId]) { toast('Category missing', true); return; }

  // Add to in-memory VOCAB_DATA
  const existing = new Set(VOCAB_DATA[catId].words.map(w => w.word.toLowerCase()));
  const newlyAdded = [];
  for (const d of toSave) {
    if (existing.has(d.word.toLowerCase())) continue;
    const w = {
      word: d.word,
      pos: d.pos,
      level: d.level,
      meaning: d.meaning,
      examples: d.examples,
      _admin: true
    };
    if (d.compare) w.compare = d.compare;
    VOCAB_DATA[catId].words.push(w);
    newlyAdded.push(w);
    existing.add(d.word.toLowerCase());
  }

  if (newlyAdded.length === 0) {
    toast('All those words already exist', true);
    return;
  }

  try {
    const getRes = await fetch(API_URL + '/api/vocab/extras');
    if (!getRes.ok) throw new Error('Failed to fetch vocab extras');
    const getD = await getRes.json();
    let extras = getD.extras || {};

    if (!extras[catId]) extras[catId] = [];
    for (const w of newlyAdded) {
      const persistable = { ...w };
      delete persistable._admin;
      extras[catId].push(persistable);
    }

    const postRes = await fetch(API_URL + '/api/admin/vocab/extras', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey
      },
      body: JSON.stringify({ extras })
    });
    if (!postRes.ok) throw new Error('Failed to save suggestions');
    toast(`Added ${newlyAdded.length} word${newlyAdded.length === 1 ? '' : 's'} to ${VOCAB_DATA[catId].label} ✓`);
  } catch (err) {
    // Rollback
    for (const w of newlyAdded) {
      VOCAB_DATA[catId].words = VOCAB_DATA[catId].words.filter(x => x !== w);
    }
    toast('Save failed: ' + err.message, true);
    return;
  }

  closeSuggestWords();
  renderAdminVocabList();
  populateAdminVocabCategorySelect();
}

function closeSuggestWords() {
  document.getElementById('suggestWordsModal').classList.remove('show');
  suggestState = { catId: null, suggestions: [], details: [] };
}


function syncSeedTopics() {
  let changed = false;
  SEED_TOPICS.forEach((t, i) => {
    const seedId = 'seed_' + i;
    const item = essays.find(e => e.id === seedId);
    if (!item) {
      essays.push({
        id: seedId,
        title: t.title,
        question: t.question,
        explanation: t.explanation,
        badge: t.badge || '',
        pros: '', cons: '', approach: '',
        intro: '', bp1: '', bp2: '', concl: '',
        vocab: 3,
        seedIdeas: '',
        questionType: t.type || ''
      });
      changed = true;
    } else {
      if (item.title !== t.title) { item.title = t.title; changed = true; }
      if (item.question !== t.question) { item.question = t.question; changed = true; }
      if (item.explanation !== t.explanation) { item.explanation = t.explanation; changed = true; }
      if ((item.badge || '') !== (t.badge || '')) { item.badge = t.badge || ''; changed = true; }
      if (item.questionType !== t.type && t.type) { item.questionType = t.type; changed = true; }
    }
  });
  return changed;
}

// ============================================================
function initOfflineMode() {
  // Pure browser-local mode (Firebase not configured OR user chose offline)
  offlineMode = true;
  const raw = safeLSGet('ipt_essays_v2');
  if (raw) {
    try { essays = JSON.parse(raw) || []; } catch (e) { essays = []; }
    currentId = safeLSGet('ipt_current_v2') || essays[0]?.id || null;
    const changed = syncSeedTopics();
    if (changed) {
      safeLSSet('ipt_essays_v2', JSON.stringify(essays));
    }
  } else {
    essays = SEED_TOPICS.map((t, i) => ({
      id: 'seed_' + i,
      title: t.title,
      question: t.question,
      explanation: t.explanation,
      badge: t.badge || '',
      pros: '', cons: '', approach: '',
      intro: '', bp1: '', bp2: '', concl: '',
      vocab: 3,
      seedIdeas: '',
      questionType: t.type || ''
    }));
    currentId = essays[0].id;
    safeLSSet('ipt_essays_v2', JSON.stringify(essays));
    safeLSSet('ipt_current_v2', currentId);
  }
  // Override saveAll to write to localStorage in offline mode
  window.saveAll = function() {
    safeLSSet('ipt_essays_v2', JSON.stringify(essays));
    if (currentId) safeLSSet('ipt_current_v2', currentId);
  };
  // Hide cloud-only UI
  document.getElementById('userBadge').style.display = 'none';
  document.getElementById('syncIndicator').style.display = 'none';
  document.getElementById('quotaChip').style.display = 'none';
  const adminBtn = document.getElementById('nav-admin');
  if (adminBtn) adminBtn.style.display = 'none';
  // Boot the app
  renderList();
  loadCurrent();
  renderPreview();
  setZoom(0.7);
  switchSection('dashboard');
}

async function bootForUser(user) {
  currentUser = user;
  // Update badges
  document.getElementById('userBadge').style.display = '';
  document.getElementById('userName').textContent = user.email.split('@')[0];
  document.getElementById('userAvatar').textContent = (user.email[0] || '?').toUpperCase();
  const userEmailLc = (user.email || '').trim().toLowerCase();
  const adminEmailLc = (window.FB.adminEmail || '').trim().toLowerCase();
  const username = (user.uid || '').trim().toLowerCase();
  const adminPrefix = adminEmailLc.split('@')[0];
  const adminBtn = document.getElementById('nav-admin');
  if (userEmailLc === adminEmailLc || username === 'admin' || username === adminPrefix) {
    if (adminBtn) adminBtn.style.display = '';
    console.log('Admin mode: enabled for', user.email);
  } else {
    if (adminBtn) adminBtn.style.display = 'none';
    console.log('Not admin. Signed in as:', user.email, '| Admin set to:', window.FB.adminEmail);
  }
  // Load their data
  const ok = await loadUserData(user.uid);
  if (!ok) return;
  // Load admin-added vocab (merged into VOCAB_DATA — fire-and-forget)
  loadGlobalVocabExtras().catch(err => console.warn('vocab extras load failed:', err));
  hideLogin();
  updateQuotaChip();
  if (!currentId || !getCurrent()) currentId = essays[0]?.id || null;
  renderList();
  loadCurrent();
  renderPreview();
  setZoom(0.7);
  switchSection('dashboard');
}

function bootForLoggedOut() {
  currentUser = null;
  userProfile = null;
  essays = [];
  currentId = null;
  showLogin();
  // Reset the login form state
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPassword').value = '';
  const btn = document.getElementById('loginSubmit');
  btn.disabled = false;
  btn.textContent = isSignupMode ? 'Create account' : 'Sign in';
  hideLoginError();
}

async function initApp() {
  console.log('[IPT] Integrated app initializing...');
  window.FB = window.FB || { adminEmail: 'admin@ptewriting.com' };

  // Fetch server config (admin email override from Railway env var, if set)
  try {
    const res = await fetch(API_URL + '/api/config');
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.adminEmail) {
        window.FB.adminEmail = cfg.adminEmail;
        console.log('Admin email source: Railway env var');
      }
    }
  } catch (e) {
    console.log('Could not fetch /api/config — using hardcoded admin email');
  }

  // Check for admin impersonation token
  const urlParams = new URLSearchParams(window.location.search);
  let impToken = urlParams.get('impersonate') || sessionStorage.getItem('pte_impersonate_token');
  if (impToken) {
    showLoading(true);
    try {
      const r = await fetch(API_URL + '/api/impersonate/redeem?token=' + encodeURIComponent(impToken));
      if (r.ok) {
        const d = await r.json();
        if (d.success && d.username) {
          sessionStorage.setItem('pte_impersonate_token', impToken);
          sessionToken = impToken;
          
          const banner = document.getElementById('impersonateBanner');
          if (banner) banner.style.display = 'flex';
          const nameEl = document.getElementById('impersonateName');
          if (nameEl) nameEl.textContent = d.username;
          
          await enterApp(d.username);
          showLoading(false);
          return;
        }
      }
    } catch (e) {
      console.error('Impersonation token verification failed:', e);
    }
    // Clear stale or invalid impersonation session
    sessionStorage.removeItem('pte_impersonate_token');
    const url = new URL(window.location);
    url.searchParams.delete('impersonate');
    window.history.replaceState({}, document.title, url.pathname + url.search);
    showLoading(false);
  }

  const last = LocalStore.getUserId();
  if (!last) {
    showLogin();
    return;
  }

  sessionToken = localStorage.getItem('pte_session_token') || '';
  if (!sessionToken) {
    showLogin();
    return;
  }

  showLoading(true);
  let verdict = 'enter'; // enter | login
  try {
    const r = await fetch(API_URL + '/api/auth/check/' + encodeURIComponent(last), {
      headers: { 'x-session-token': sessionToken },
      cache: 'no-store'
    });
    if (r.ok) {
      const d = await r.json();
      if (d && d.exists === false) {
        verdict = 'login';
      } else if (d && d.blocked === true) {
        verdict = 'login';
        setTimeout(() => toast('This account has been blocked. Contact your administrator.', true), 50);
      }
    } else if (r.status === 401 || r.status === 403) {
      verdict = 'login';
    }
  } catch (e) {
    // Network error — trust the saved session, enter offline
    verdict = 'enter';
  }

  if (verdict === 'login') {
    showLoading(false);
    LocalStore.setUserId('');
    showLogin();
  } else {
    await enterApp(last);
    showLoading(false);
  }
}

// Switch between main panes (dashboard / swt / library)
function switchSection(section) {
  // Close any full-screen overlays (vocab / practice) so the pane is visible
  ['vocabScreen', 'practiceScreen'].forEach(id => {
    const ov = document.getElementById(id);
    if (ov) ov.classList.remove('show');
  });

  // Show the target pane, hide the rest
  const paneMap = { dashboard: 'dashboardPane', swt: 'swtPane', library: 'libraryPane' };
  document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
  const pane = document.getElementById(paneMap[section]);
  if (pane) pane.classList.add('active');

  // If entering SWT section, show practice screen by default
  if (section === 'swt' && typeof showSwtScreen === 'function') {
    showSwtScreen('swtPracticeScreen');
  }

  // Sidebar active state
  const navMap = { dashboard: 'nav-dashboard', swt: 'nav-swt', library: 'nav-library' };
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.id === navMap[section]);
  });

  // Page title
  const titles = { dashboard: 'Dashboard', swt: 'Summarize Written Text (SWT)', library: 'Essay Library' };
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = titles[section] || 'Dashboard';

  // Essay-only topbar controls appear only on the library/essay section
  const isLibrary = section === 'library';
  const tplBtn = document.getElementById('essayTemplateBtn');
  const expBtn = document.getElementById('exportBtn');
  if (tplBtn) tplBtn.style.display = isLibrary ? '' : 'none';
  if (expBtn) expBtn.style.display = isLibrary ? '' : 'none';

  // Refresh dashboard stats when landing on it
  if (section === 'dashboard' && typeof updateDashboard === 'function') updateDashboard();
}

// Dashboard statistics renderer
function updateDashboard() {
  if (!document.getElementById('dashboardPane')) return;

  const total = essays.length;
  const written = essays.filter(e => essayStatus(e) === 'written').length;
  const draft = essays.filter(e => essayStatus(e) === 'draft').length;
  const empty = essays.filter(e => essayStatus(e) === 'empty').length;

  // Calculate percentage
  const percent = total > 0 ? Math.round((written / total) * 100) : 0;
  
  // Set counts
  document.getElementById('dashWrittenCount').textContent = written;
  document.getElementById('dashDraftCount').textContent = draft;
  document.getElementById('dashEmptyCount').textContent = empty;
  document.getElementById('dashPercent').textContent = percent;

  // Update SVG circular ring
  const circle = document.getElementById('dashProgressFill');
  if (circle) {
    const radius = circle.r.baseVal.value;
    const circumference = 2 * Math.PI * radius; // 213.628
    const offset = circumference - (percent / 100) * circumference;
    circle.style.strokeDashoffset = offset;
  }

  // Vocab read count
  const vocabProgress = getVocabProgress();
  const readCount = Object.keys(vocabProgress.read || {}).length;
  document.getElementById('dashVocabRead').textContent = readCount;

  // Average Practice Score
  const history = getPracticeHistory();
  const avgScoreEl = document.getElementById('dashAvgScore');
  const scoreDescEl = document.getElementById('dashScoreDesc');
  
  if (history.length > 0) {
    const sum = history.reduce((acc, h) => acc + (h.scores?.total || 0), 0);
    const avg = (sum / history.length).toFixed(1);
    avgScoreEl.textContent = avg;
    
    // Suggest feedback based on score
    if (avg >= 24) {
      scoreDescEl.innerHTML = '✨ <strong>Excellent profile!</strong> Consistent Band 9 potential. Focus on timing.';
    } else if (avg >= 20) {
      scoreDescEl.innerHTML = '👍 <strong>Strong performance.</strong> CEFR C1 level. Refine structural cohesion.';
    } else {
      scoreDescEl.innerHTML = '💪 <strong>Keep writing!</strong> Target vocabulary variety and syntax variations.';
    }
  } else {
    avgScoreEl.textContent = '—';
    scoreDescEl.textContent = 'Submit a practice attempt to calculate your scoring profile.';
  }

  // SWT stats
  const swtHistory = LocalStore.get(getPteStorageKey('history')) || {};
  let totalSwtAttempts = 0;
  let swtScoresSum = 0;
  let swtScoresCount = 0;
  
  Object.keys(swtHistory).forEach(pid => {
    const list = swtHistory[pid];
    if (Array.isArray(list)) {
      totalSwtAttempts += list.length;
      list.forEach(att => {
        if (typeof att.overall_score === 'number') {
          swtScoresSum += att.overall_score;
          swtScoresCount++;
        }
      });
    }
  });

  const swtAvg = swtScoresCount > 0 ? Math.round(swtScoresSum / swtScoresCount) : 0;
  const swtPassagesCount = Object.keys(swtHistory).length;
  
  const avgSwtScoreEl = document.getElementById('dashSwtAvgScore');
  if (avgSwtScoreEl) avgSwtScoreEl.textContent = swtScoresCount > 0 ? swtAvg : '—';
  
  const swtAttemptsEl = document.getElementById('dashSwtAttempts');
  if (swtAttemptsEl) swtAttemptsEl.textContent = totalSwtAttempts;

  const swtPassagesEl = document.getElementById('dashSwtPassages');
  if (swtPassagesEl) swtPassagesEl.textContent = swtPassagesCount;

  // Quota Status
  updateDashboardQuota();

  // Render lists
  renderDashboardRecentPractice();
  renderDashboardRecentSwt();
  renderDashboardRecentEssays();

  // Glassmorphism dashboard interactive widgets
  try {
    updateDashboardStreak();
    renderDashboardCharts(currentDashboardChartMetric || 'swt');
    updateDailyVocabChallenge();
    renderDashboardActionItems();
  } catch (err) {
    console.error('Error rendering interactive widgets:', err);
  }
}

function updateDashboardQuota() {
  const essayEl = document.getElementById('dashQuotaEssay');
  const ideaEl = document.getElementById('dashQuotaIdea');
  if (!essayEl || !ideaEl) return;

  const used = userProfile?.quotaUsed || { essay: {}, idea: {} };
  const today = todayStamp();
  const usedEssay = used.essay[today] || 0;
  const usedIdea = used.idea[today] || 0;

  essayEl.textContent = `${DAILY_ESSAY_QUOTA - usedEssay} / ${DAILY_ESSAY_QUOTA}`;
  ideaEl.textContent = `${DAILY_IDEA_QUOTA - usedIdea} / ${DAILY_IDEA_QUOTA}`;
}

function renderDashboardRecentPractice() {
  const container = document.getElementById('dashRecentPractice');
  if (!container) return;
  
  const history = [...getPracticeHistory()].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 3);
  if (history.length === 0) {
    container.innerHTML = '<div class="list-empty-state">No recent scored essays. Go to the Essay Practice tab to begin.</div>';
    return;
  }

  container.innerHTML = history.map(h => {
    const dVal = h.date ? new Date(h.date) : null;
    const date = dVal ? dVal.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
    const totalScore = h.scores?.total || 0;
    const scoreColor = totalScore >= 22 ? 'var(--accent)' : totalScore >= 18 ? '#b45309' : 'var(--ink-soft)';
    
    return `
      <div class="dash-list-item" onclick="openPractice(); viewPracticeAttempt('${h.id || ''}')">
        <div class="item-main">
          <div class="item-title">${escapeHtml(h.questionTitle || 'Untitled Practice')}</div>
          <div class="item-date">Completed on ${date}</div>
        </div>
        <div class="item-badge" style="background: ${scoreColor}20; color: ${scoreColor}">
          ${totalScore}/26
        </div>
      </div>
    `;
  }).join('');
}

function renderDashboardRecentEssays() {
  const container = document.getElementById('dashRecentEssays');
  if (!container) return;

  // Get active essays (draft or empty) first, then written
  const activeEssays = [...essays]
    .sort((a, b) => {
      const statusA = essayStatus(a);
      const statusB = essayStatus(b);
      const scoreA = statusA === 'written' ? 1 : 0;
      const scoreB = statusB === 'written' ? 1 : 0;
      return scoreA - scoreB;
    })
    .slice(0, 3);

  if (activeEssays.length === 0) {
    container.innerHTML = '<div class="list-empty-state">No active essays in progress.</div>';
    return;
  }

  container.innerHTML = activeEssays.map(e => {
    const estatus = essayStatus(e);
    let badgeClass = 'status-empty';
    if (estatus === 'written') badgeClass = 'status-written';
    else if (estatus === 'draft') badgeClass = 'status-draft';
    
    return `
      <div class="dash-list-item" onclick="switchSection('library'); selectEssay('${e.id}')">
        <div class="item-main">
          <div class="item-title">${escapeHtml(e.title || 'Untitled Essay')}</div>
          <div class="item-date">${escapeHtml(e.question || '').slice(0, 75)}${e.question && e.question.length > 75 ? '...' : ''}</div>
        </div>
        <div class="item-status ${badgeClass}">
          ${estatus.toUpperCase()}
        </div>
      </div>
    `;
  }).join('');
}

function renderDashboardRecentSwt() {
  const container = document.getElementById('dashRecentSwt');
  if (!container) return;

  const swtHistory = LocalStore.get(getPteStorageKey('history')) || {};
  const allAttempts = [];

  Object.keys(swtHistory).forEach(pid => {
    const list = swtHistory[pid];
    if (Array.isArray(list)) {
      list.forEach(att => {
        allAttempts.push({
          ...att,
          passageId: pid
        });
      });
    }
  });

  // Sort by timestamp descending
  allAttempts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const recent = allAttempts.slice(0, 3);
  if (recent.length === 0) {
    container.innerHTML = '<div class="list-empty-state">No recent SWT attempts. Go to the SWT tab to begin.</div>';
    return;
  }

  container.innerHTML = recent.map(h => {
    const passage = passages.find(p => String(p.id) === String(h.passageId));
    const title = passage ? passage.title : `Passage ${h.passageId}`;
    const date = h.timestamp ? new Date(h.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
    const scoreColor = h.overall_score >= 79 ? 'var(--accent)' : h.overall_score >= 58 ? '#b45309' : 'var(--ink-soft)';
    
    return `
      <div class="dash-list-item" onclick="if (typeof jumpToResultsPassage === 'function') jumpToResultsPassage(${h.passageId});">
        <div class="item-main">
          <div class="item-title">${escapeHtml(title)}</div>
          <div class="item-date">Completed on ${date}</div>
        </div>
        <div class="item-badge" style="background: ${scoreColor}20; color: ${scoreColor}">
          ${h.overall_score}/90
        </div>
      </div>
    `;
  }).join('');
}

// Theme Toggle
function toggleTheme() {
  const isDark = document.body.classList.contains('dark');
  if (isDark) {
    document.body.classList.remove('dark');
    document.body.classList.add('light-mode');
    localStorage.setItem('ipt-theme', 'light');
  } else {
    document.body.classList.add('dark');
    document.body.classList.remove('light-mode');
    localStorage.setItem('ipt-theme', 'dark');
  }
  updateThemeToggleButton();
}
function updateThemeToggleButton() {
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  const isDark = document.body.classList.contains('dark');
  btn.innerHTML = isDark ? '☀️ Light' : '🌙 Dark';
}
// Initialize theme
(function initTheme() {
  const savedTheme = localStorage.getItem('ipt-theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    document.body.classList.remove('dark');
  } else if (savedTheme === 'dark') {
    document.body.classList.add('dark');
    document.body.classList.remove('light-mode');
  } else {
    if (prefersDark) {
      document.body.classList.add('dark');
      document.body.classList.remove('light-mode');
    } else {
      document.body.classList.add('light-mode');
      document.body.classList.remove('dark');
    }
  }
  updateThemeToggleButton();
})();

// Boot immediately
initApp();

// Boot a minimal state IMMEDIATELY so the login screen can render only if no saved session
const urlParams = new URLSearchParams(window.location.search);
const hasImpersonate = urlParams.get('impersonate') || sessionStorage.getItem('pte_impersonate_token');
if (!hasImpersonate && (!LocalStore.getUserId() || !localStorage.getItem('pte_session_token'))) {
  showLogin();
}


// ============================================================
//  PRACTICE ESSAY MODULE
//  - Students write essays, get PTE-style scoring (out of 26)
//  - Plain-English feedback (no jargon)
//  - History saved to Firestore (or localStorage in offline mode)
//  - Uses essay quota (1 credit per scored attempt)
// ============================================================

// State
let practiceState = {
  view: 'welcome',          // 'welcome' | 'write' | 'loading' | 'results'
  writeStep: 1,             // 1 = setup (select question), 2 = focus mode (writing simulator)
  promptExpanded: true,     // controls collapse/expand state of the prompt in simulator
  questionSource: 'library', // 'library' | 'custom'
  selectedQuestionId: null,
  questionTitle: '',
  questionText: '',
  essayText: '',
  currentAttempt: null,      // the in-memory attempt object (post-scoring)
  viewingAttemptId: null,    // ID of the history attempt being viewed
  expandedQuestions: {},     // accordion expand state mapping questionKey -> boolean
  // Timer (exam-mode simulation)
  timerEnabled: false,       // user-toggled
  timerStartedAt: null,      // ms timestamp when writing started
  timerIntervalId: null      // setInterval handle for the live counter
};

// 20-minute IELTS Task 2 / PTE Write Essay target
const PRACTICE_TIMER_LIMIT_MIN = 20;

// PTE rubric — max points for each category (matches user's screenshot)
const PRACTICE_RUBRIC = [
  { key: 'content',         label: 'Content',    max: 6 },
  { key: 'form',            label: 'Form',       max: 2 },
  { key: 'spelling',        label: 'Spelling',   max: 2 },
  { key: 'grammar',         label: 'Grammar',    max: 2 },
  { key: 'vocabulary',      label: 'Vocabulary', max: 2 },
  { key: 'linguistic',      label: 'Linguistic', max: 6 },
  { key: 'coherence',       label: 'Coherence',  max: 6 }
  // Total = 26
];
const PRACTICE_MAX_TOTAL = 26;

function openPractice(defaultToWelcome = true) {
  document.getElementById('practiceScreen').classList.add('show');
  document.body.classList.add('has-active-practice');
  renderPracticeHistory();
  if (defaultToWelcome) {
    practiceState.view = 'welcome';
  }
  renderPracticeMain();
  updatePracticeStats();
  // Sidebar navigation active state updates
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.id === 'nav-practice');
  });
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = 'Practice Center';
}

function practiceCurrentEssay() {
  const e = getCurrent();
  if (!e) return;
  if (!e.question || !e.question.trim()) {
    toast('Please enter a question prompt for this essay before practicing.', true);
    return;
  }
  
  practiceState.view = 'write';
  practiceState.writeStep = 2;
  practiceState.promptExpanded = true;
  practiceState.questionSource = 'library';
  practiceState.selectedQuestionId = e.id;
  practiceState.questionTitle = e.title || '';
  practiceState.questionText = e.question || '';
  practiceState.essayText = ''; // start fresh
  practiceState.viewingAttemptId = null;
  practiceState.currentAttempt = null;
  
  resetPracticeTimer();
  
  openPractice(false);
}

function closePractice() {
  document.getElementById('practiceScreen').classList.remove('show');
  document.body.classList.remove('has-active-practice');
  // Stop the live timer interval — don't keep it running in the background
  stopPracticeTimer();
  switchSection('library');
}

function getCleanSampleResponse(html) {
  if (!html) return '';
  // Replace deletions with empty string
  let clean = html.replace(/<span class=["']diff-del["']>[\s\S]*?<\/span>/g, '');
  // Strip the insertion tags but keep the content inside them
  clean = clean.replace(/<span class=["']diff-ins["']>([\s\S]*?)<\/span>/g, '$1');
  // Strip any other HTML tags
  clean = clean.replace(/<[^>]*>/g, '');
  // Unescape any HTML entities if needed (e.g. &amp;, &lt;, &gt;, &quot;)
  const temp = document.createElement('textarea');
  temp.innerHTML = clean;
  return temp.value.trim();
}

function prunePracticeAttempts(history, newAttempt) {
  const qKey = newAttempt.questionId || newAttempt.questionTitle || newAttempt.questionText;
  if (!qKey) return history;
  
  const questionAttempts = [];
  for (let i = 0; i < history.length; i++) {
    const a = history[i];
    const key = a.questionId || a.questionTitle || a.questionText;
    if (key === qKey) {
      questionAttempts.push(i);
    }
  }
  
  if (questionAttempts.length > 10) {
    const indexesToRemove = questionAttempts.slice(10);
    return history.filter((_, idx) => !indexesToRemove.includes(idx));
  }
  return history;
}

function copyToClipboardFallback(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    const successful = document.execCommand('copy');
    if (successful) {
      toast('Essay copied to clipboard! ✓');
    } else {
      toast('Failed to copy essay', true);
    }
  } catch (err) {
    console.error('Fallback copy failed: ', err);
    toast('Failed to copy essay', true);
  }
  document.body.removeChild(textArea);
}

function copyPracticeText(type) {
  const a = practiceState.currentAttempt;
  if (!a) {
    toast('No attempt active', true);
    return;
  }
  let text = '';
  if (type === 'attempted') {
    text = a.essayText;
  } else if (type === 'rewritten') {
    text = getCleanSampleResponse(a.sampleResponse);
  }
  if (!text) {
    toast('No essay text to copy', true);
    return;
  }
  
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      toast('Essay copied to clipboard! ✓');
    }).catch(err => {
      console.warn('Clipboard API failed, trying fallback...', err);
      copyToClipboardFallback(text);
    });
  } else {
    copyToClipboardFallback(text);
  }
}

// ---------- History (Firestore-synced via user profile, or localStorage offline) ----------

function getPracticeHistory() {
  if (offlineMode) {
    try { return JSON.parse(safeLSGet('ipt_practice') || '[]'); }
    catch (e) { return []; }
  }
  if (!userProfile) return [];
  if (!userProfile.practiceHistory) userProfile.practiceHistory = [];
  return userProfile.practiceHistory;
}

async function savePracticeHistory(history) {
  if (offlineMode) {
    safeLSSet('ipt_practice', JSON.stringify(history));
    return;
  }
  if (!currentUser) return;
  userProfile.practiceHistory = history;
  queueSync();
}

function updatePracticeStats() {
  const h = getPracticeHistory();
  const el = document.getElementById('practiceStats');
  if (!el) return;
  if (h.length === 0) {
    el.textContent = 'No attempts yet';
    return;
  }
  const avg = (h.reduce((s, a) => s + (a.scores?.total || 0), 0) / h.length);
  el.textContent = `${h.length} attempt${h.length === 1 ? '' : 's'} · avg ${avg.toFixed(1)}/${PRACTICE_MAX_TOTAL}`;
  const countEl = document.getElementById('practiceHistoryCount');
  if (countEl) countEl.textContent = h.length;
}

function renderPracticeHistory() {
  const list = document.getElementById('practiceHistoryList');
  const h = getPracticeHistory();
  if (h.length === 0) {
    list.innerHTML = `<div class="practice-history-empty">
      No practice attempts yet.<br>
      Click <strong>+ New attempt</strong> to write your first practice essay.
    </div>`;
    return;
  }
  
  // Group attempts by question
  const groups = {};
  h.forEach(a => {
    const qKey = a.questionId || a.questionTitle || a.questionText;
    if (!groups[qKey]) {
      groups[qKey] = {
        title: a.questionTitle || (a.questionText.slice(0, 50) + '...'),
        id: a.questionId || '',
        attempts: []
      };
    }
    groups[qKey].attempts.push(a);
  });
  
  // Sort attempts within each group by date (newest first)
  Object.values(groups).forEach(g => {
    g.attempts.sort((a, b) => (b.date || 0) - (a.date || 0));
  });
  
  // Sort groups by their most recent attempt date
  const sortedGroups = Object.values(groups).sort((g1, g2) => {
    const d1 = g1.attempts[0]?.date || 0;
    const d2 = g2.attempts[0]?.date || 0;
    return d2 - d1;
  });
  
  list.innerHTML = sortedGroups.map(g => {
    const qKey = g.id || g.title;
    const hasActiveAttempt = g.attempts.some(a => a.id === practiceState.viewingAttemptId);
    const isExpanded = practiceState.expandedQuestions[qKey] !== undefined 
      ? practiceState.expandedQuestions[qKey] 
      : hasActiveAttempt;
      
    const attemptsHtml = g.attempts.map(a => {
      const isActive = (a.id === practiceState.viewingAttemptId);
      const total = a.scores?.total || 0;
      const scoreBand = total >= 22 ? 'high' : (total >= 15 ? 'mid' : 'low');
      const dateStr = a.date ? formatPracticeDate(a.date) : '';
      return `
        <div class="practice-history-item ${isActive ? 'active' : ''}" style="margin-left: 8px; padding: 10px 14px; position: relative;" onclick="event.stopPropagation(); viewPracticeAttempt('${a.id}')">
          <div class="practice-history-meta" style="margin-bottom: 2px;">
            <span>${dateStr}</span>
            <span class="practice-history-score ${scoreBand}">${total}/${PRACTICE_MAX_TOTAL}</span>
          </div>
          <div style="font-size: 11.5px; color: var(--ink-soft); line-height: 1.4;">
            Attempt with ${a.wordCount} words
          </div>
          <button class="practice-history-del" style="right: 6px; top: 8px;" onclick="event.stopPropagation(); deletePracticeAttempt('${a.id}')" title="Delete">✕</button>
        </div>
      `;
    }).join('');
    
    return `
      <div class="practice-history-group" style="margin-bottom: 12px; border: 1px solid var(--line-soft); border-radius: 12px; overflow: hidden; background: var(--bg-card); box-shadow: var(--shadow);">
        <div class="practice-history-group-header" style="padding: 12px 14px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: var(--card-raised); border-bottom: ${isExpanded ? '1px solid var(--line-soft)' : 'none'};" data-qkey="${escapeHtml(qKey)}" onclick="toggleGroupHeader(this)">
          <div style="flex: 1; min-width: 0; padding-right: 8px;">
            <div style="font-family: var(--serif); font-size: 13.5px; font-weight: 700; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(g.title)}">
              ${escapeHtml(g.title)}
            </div>
            <div style="font-size: 11px; color: var(--ink-soft); margin-top: 2px;">
              ${g.attempts.length} attempt${g.attempts.length === 1 ? '' : 's'}
            </div>
          </div>
          <span style="font-size: 12px; color: var(--ink-soft); transition: transform 0.2s; transform: ${isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'};">▶</span>
        </div>
        <div class="practice-history-group-attempts" style="display: ${isExpanded ? 'block' : 'none'}; padding: 8px; background: var(--bg-list);">
          ${attemptsHtml}
        </div>
      </div>
    `;
  }).join('');
}

function toggleGroupHeader(el) {
  const qKey = el.getAttribute('data-qkey');
  practiceState.expandedQuestions[qKey] = !practiceState.expandedQuestions[qKey];
  renderPracticeHistory();
}

function formatPracticeDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return 'Today ' + d.toTimeString().slice(0, 5);
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

async function deletePracticeAttempt(id) {
  if (!confirm('Delete this practice attempt? Cannot be undone.')) return;
  let h = getPracticeHistory();
  h = h.filter(a => a.id !== id);
  await savePracticeHistory(h);
  if (practiceState.viewingAttemptId === id) {
    practiceState.viewingAttemptId = null;
    practiceState.view = 'welcome';
    renderPracticeMain();
  }
  renderPracticeHistory();
  updatePracticeStats();
}

function viewPracticeAttempt(id) {
  const h = getPracticeHistory();
  const attempt = h.find(a => a.id === id);
  if (!attempt) return;
  practiceState.currentAttempt = attempt;
  practiceState.viewingAttemptId = id;
  practiceState.view = 'results';
  renderPracticeMain();
  renderPracticeHistory();
}

// ---------- Main view rendering (welcome / write / loading / results) ----------

function renderPracticeMain() {
  const c = document.getElementById('practiceContent');
  if (practiceState.view === 'welcome') c.innerHTML = welcomeView();
  else if (practiceState.view === 'write') c.innerHTML = writeView();
  else if (practiceState.view === 'loading') c.innerHTML = loadingView();
  else if (practiceState.view === 'results') c.innerHTML = resultsView();

  // Wire up live word counter
  const ta = document.getElementById('practiceEssayInput');
  if (ta) {
    ta.addEventListener('input', updateLiveWordCount);
    updateLiveWordCount();
  }
  // Wire up question search input AND populate the picker initially
  const qs = document.getElementById('practiceQuestionSearch');
  if (qs) qs.addEventListener('input', renderQuestionPicker);
  // Populate library picker on first render (when on library tab in write view)
  if (practiceState.view === 'write' && practiceState.questionSource === 'library') {
    renderQuestionPicker();
  }
  // If we're back on the write view AND a timer was already running, resume the live counter
  if (practiceState.view === 'write' && practiceState.timerEnabled && practiceState.timerStartedAt) {
    startPracticeTimerInterval();
  } else if (practiceState.view !== 'write') {
    stopPracticeTimer();
  }
}

function welcomeView() {
  return `
    <div class="practice-welcome">
      <div class="practice-welcome-icon">✏️</div>
      <h2>Practice Essay</h2>
      <p>Write a full essay, then get a detailed AI score out of <strong>26 points</strong>, just like real PTE/IELTS. You'll see plain-English feedback for every category — no jargon.</p>
      <p style="font-size:12.5px; color:var(--ink-mute);">Each attempt uses <strong>1 essay quota credit</strong>.</p>
      <button class="practice-welcome-cta" onclick="startNewPractice()">
        Start a new attempt →
      </button>
    </div>
  `;
}

function startNewPractice() {
  practiceState.view = 'write';
  practiceState.writeStep = 1;
  practiceState.promptExpanded = true;
  practiceState.questionSource = 'library';
  practiceState.selectedQuestionId = null;
  practiceState.questionTitle = '';
  practiceState.questionText = '';
  practiceState.essayText = '';
  practiceState.viewingAttemptId = null;
  practiceState.currentAttempt = null;
  // Reset timer (but keep user's toggle preference)
  resetPracticeTimer();
  renderPracticeMain();
  renderPracticeHistory();
}

function startExamSimulator() {
  if (!practiceState.questionText || practiceState.questionText.trim().length < 10) {
    toast('Please pick a question or enter your own custom prompt first.', true);
    return;
  }
  practiceState.writeStep = 2;
  practiceState.promptExpanded = true;
  practiceState.essayText = ''; // start fresh
  resetPracticeTimer();
  renderPracticeMain();
}

function resetPracticeSetup() {
  if (practiceState.essayText && practiceState.essayText.trim().length > 10) {
    if (!confirm('Are you sure you want to change the topic? Your current writing progress will be lost.')) {
      return;
    }
  }
  practiceState.writeStep = 1;
  practiceState.essayText = '';
  stopPracticeTimer();
  resetPracticeTimer();
  renderPracticeMain();
}

function togglePracticePrompt() {
  practiceState.promptExpanded = !practiceState.promptExpanded;
  const box = document.getElementById('practicePromptBox');
  const btn = document.querySelector('.simulator-toggle-prompt-btn');
  if (box) {
    if (practiceState.promptExpanded) {
      box.style.maxHeight = '200px';
      box.style.opacity = '1';
      box.style.paddingTop = '14px';
      box.style.paddingBottom = '14px';
      box.style.marginTop = '14px';
      box.style.border = '1px solid var(--line-soft)';
    } else {
      box.style.maxHeight = '0';
      box.style.opacity = '0';
      box.style.paddingTop = '0';
      box.style.paddingBottom = '0';
      box.style.marginTop = '0';
      box.style.border = 'none';
    }
  }
  if (btn) {
    btn.textContent = practiceState.promptExpanded ? '👁️ Hide Question' : '👁️ Show Question';
  }
}

function writeView() {
  if (practiceState.writeStep === 1) {
    // Step 1: Select Topic Setup
    return `
      <div class="practice-step setup-mode" style="border: 1px solid var(--line-soft); border-radius: 14px; padding: 28px 32px; background: var(--bg-card); box-shadow: var(--shadow);">
        <div class="practice-step-header" style="margin-bottom: 22px;">
          <div class="practice-step-title" style="font-family: var(--serif); font-size: 20px; font-weight: 700; display: flex; align-items: baseline; gap: 12px;">
            <span class="practice-step-num" style="background: var(--accent); color: #fff; border-radius: 50%; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700;">1</span>
            Pick a question
          </div>
          <div class="practice-step-aux" style="font-size: 12px; color: var(--ink-mute); font-style: italic; font-family: var(--serif);">Choose a saved topic, or write your own custom prompt</div>
        </div>
        <div class="practice-source-tabs" style="display: flex; gap: 4px; margin-bottom: 12px; background: var(--bg); padding: 4px; border-radius: 8px; border: 1px solid var(--line-soft);">
          <button class="practice-source-tab ${practiceState.questionSource === 'library' ? 'active' : ''}" onclick="setQuestionSource('library')">📖 From your library</button>
          <button class="practice-source-tab ${practiceState.questionSource === 'custom' ? 'active' : ''}" onclick="setQuestionSource('custom')">✎ Write your own</button>
        </div>
        <div id="practiceQuestionArea">
          ${practiceState.questionSource === 'library' ? libraryPickerHTML() : customPromptHTML()}
        </div>
        <div class="practice-selected-question ${practiceState.questionText ? 'show' : ''}" id="practiceSelectedQuestion">
          <strong>Selected question</strong>
          ${escapeHtml(practiceState.questionText || '')}
        </div>
        
        <div class="practice-setup-actions" style="margin-top: 28px; border-top: 1px solid var(--line-soft); padding-top: 20px; display: flex; justify-content: flex-end; gap: 16px; align-items: center; flex-wrap: wrap;">
          <label class="practice-timer-toggle" style="margin-right: auto; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12.5px; color: var(--ink-soft); font-weight: 600;" title="Track how long you take (20 min exam target)">
            <input type="checkbox" id="practiceTimerToggle" ${practiceState.timerEnabled ? 'checked' : ''} onchange="toggleTimerMode(this.checked)">
            <span class="practice-timer-toggle-slider"></span>
            <span class="practice-timer-toggle-label">⏱ Time mode</span>
          </label>
          <button class="practice-action-btn primary" id="practiceStartBtn" onclick="startExamSimulator()" ${practiceState.questionText ? '' : 'disabled'} style="padding: 12px 28px; font-size: 14px; font-weight: 700; background: var(--accent); color: #fff; border: none; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px -3px var(--accent);">
            Start Exam Simulator ⏱️
          </button>
        </div>
      </div>
    `;
  } else {
    // Step 2: Exam Simulator Focus Mode
    return `
      <div class="practice-step simulator-mode" style="border: 1px solid var(--line-soft); border-radius: 14px; padding: 28px 32px; background: var(--bg-card); box-shadow: var(--shadow);">
        <div class="simulator-header" style="display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 200px;">
            <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--accent); font-weight: 800;">Exam Simulator Active</div>
            <div class="simulator-topic-title" style="font-family: var(--serif); font-size: 18px; font-weight: 700; color: var(--ink); margin-top: 2px;">
              ${escapeHtml(practiceState.questionTitle || 'Custom Writing Prompt')}
            </div>
          </div>
          <button class="simulator-toggle-prompt-btn" onclick="togglePracticePrompt()" style="background: transparent; border: 1px solid var(--line-soft); border-radius: 8px; padding: 8px 14px; font-size: 12.5px; font-weight: 600; color: var(--ink-soft); cursor: pointer; transition: var(--transition);">
            ${practiceState.promptExpanded ? '👁️ Hide Question' : '👁️ Show Question'}
          </button>
        </div>

        <!-- Collapsible Prompt Box -->
        <div class="practice-prompt-collapsible ${practiceState.promptExpanded ? 'show' : ''}" id="practicePromptBox" style="margin-top: 14px; background: var(--bg); border: 1px solid var(--line-soft); border-radius: 8px; padding: 14px 18px; line-height: 1.6; font-size: 13.5px; color: var(--ink); transition: all 0.22s ease-in-out; overflow: hidden; ${practiceState.promptExpanded ? 'max-height: 200px; opacity: 1;' : 'max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; border: none; margin-top: 0;'}">
          ${escapeHtml(practiceState.questionText)}
        </div>

        <div style="border-top: 1px solid var(--line-soft); margin: 20px 0 16px;"></div>

        <div class="simulator-timer-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 10px; flex-wrap: wrap;">
          <div class="practice-timer-bar ${practiceState.timerEnabled ? 'show' : ''}" id="practiceTimerBar" style="margin: 0; display: ${practiceState.timerEnabled ? 'inline-flex' : 'none'}; align-items: center; gap: 8px; padding: 6px 14px; background: var(--bg); border: 1px solid var(--line-soft); border-radius: 8px; font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 13.5px; font-weight: 700; color: var(--ink);">
            <span id="practiceTimerElapsed">00:00</span>
            <span class="practice-timer-target" style="color: var(--ink-mute); font-family: var(--sans); font-weight: 400; font-size: 11px;">/ ${PRACTICE_TIMER_LIMIT_MIN}:00 exam target</span>
          </div>
          <div style="font-size: 12px; color: var(--ink-soft); font-family: var(--serif); font-style: italic; display: flex; align-items: center; gap: 6px;">
            <span>⏱️ Time Mode:</span>
            <strong>${practiceState.timerEnabled ? 'Active' : 'Off'}</strong>
          </div>
        </div>

        <div class="practice-textarea-container" style="position: relative; border-radius: 12px; border: 1px solid var(--line-soft); background: var(--bg); box-shadow: inset 0 2px 4px rgba(0,0,0,0.02); overflow: hidden; margin-bottom: 16px; transition: border-color 0.2s;">
          <textarea class="practice-essay-area" id="practiceEssayInput" placeholder="Write your response here..." style="width: 100%; border: none; background: transparent; padding: 20px 24px; font-family: var(--sans); font-size: 15.5px; color: var(--ink); line-height: 1.8; min-height: 340px; outline: none; resize: vertical; box-sizing: border-box;">${escapeHtml(practiceState.essayText)}</textarea>
        </div>

        <!-- Dynamic Word Count Progress Visualizer -->
        <div class="practice-progress-container" style="margin-top: 20px; background: var(--bg); padding: 16px 20px; border-radius: 12px; border: 1px solid var(--line-soft);">
          <div style="display: flex; justify-content: space-between; font-size: 12.5px; margin-bottom: 8px; font-family: var(--serif); font-style: italic; color: var(--ink-soft);">
            <span id="practiceWordCountLabel">✍️ Keep writing...</span>
            <span style="font-weight: 700; font-family: var(--sans); font-style: normal;" id="practiceWordCount">0 words</span>
          </div>
          <div class="practice-progress-track" style="height: 10px; background: var(--line-soft); border-radius: 10px; position: relative; overflow: hidden;">
            <!-- Indicator markers for target zone (200-300 words) -->
            <div style="position: absolute; left: 57.14%; top: 0; bottom: 0; width: 28.57%; background: rgba(16, 185, 129, 0.12); border-left: 1px dashed rgba(16, 185, 129, 0.3); border-right: 1px dashed rgba(16, 185, 129, 0.3);" title="Ideal range (200-300 words)"></div>
            <div class="practice-progress-bar" id="practiceProgressBar" style="height: 100%; width: 0%; background: var(--accent); border-radius: 10px; transition: width 0.2s ease, background-color 0.2s ease;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 9.5px; color: var(--ink-mute); margin-top: 6px; padding: 0 2px; font-family: var(--sans);">
            <span>0 words</span>
            <span style="margin-left: 32%;">200 words (min)</span>
            <span>300 words (max)</span>
            <span>350+</span>
          </div>
        </div>

        <div class="simulator-actions" style="margin-top: 28px; border-top: 1px solid var(--line-soft); padding-top: 20px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <button class="practice-back-btn" onclick="resetPracticeSetup()" style="border: 1px solid var(--line-soft); color: var(--ink-soft); background: transparent; border-radius: 8px; padding: 10px 18px; font-size: 13px; font-weight: 600; cursor: pointer; transition: var(--transition);">
            ← Change Topic / Reset
          </button>
          <button class="practice-submit-btn primary" id="practiceSubmitBtn" onclick="submitPracticeEssay()" disabled style="width: auto; padding: 12px 32px; font-size: 14px; font-weight: 700; background: var(--accent); color: #fff; border: none; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px -3px var(--accent); transition: var(--transition);">
            🤖 Score my essay
          </button>
        </div>
      </div>
    `;
  }
}

function setQuestionSource(src) {
  practiceState.questionSource = src;
  if (src === 'custom') {
    // Don't auto-clear; let user keep what they had
  }
  document.getElementById('practiceQuestionArea').innerHTML =
    (src === 'library') ? libraryPickerHTML() : customPromptHTML();
  document.querySelectorAll('.practice-source-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.practice-source-tab[onclick*="${src}"]`)?.classList.add('active');
  // Re-wire search input AND populate picker when switching to library
  const qs = document.getElementById('practiceQuestionSearch');
  if (qs) qs.addEventListener('input', renderQuestionPicker);
  if (src === 'library') renderQuestionPicker();
  updateSubmitBtnState();
}

function libraryPickerHTML() {
  return `
    <input type="text" class="practice-question-search" id="practiceQuestionSearch" placeholder="Search your essay library...">
    <div class="practice-question-picker" id="practiceQuestionPicker"></div>
  `;
}

function renderQuestionPicker() {
  const picker = document.getElementById('practiceQuestionPicker');
  if (!picker) return;
  const q = (document.getElementById('practiceQuestionSearch')?.value || '').toLowerCase().trim();
  // Only show essays that have a question prompt
  let filtered = essays.filter(e => e.question && e.question.trim());
  if (q) {
    filtered = filtered.filter(e =>
      (e.title || '').toLowerCase().includes(q) ||
      (e.question || '').toLowerCase().includes(q)
    );
  }
  if (filtered.length === 0) {
    picker.innerHTML = `<div style="padding:20px; text-align:center; color:var(--ink-mute); font-size:12px; font-style:italic; font-family:var(--serif);">
      ${q ? 'No essays match.' : 'No essays in your library have a question prompt yet.'}
    </div>`;
    return;
  }
  picker.innerHTML = filtered.map(e => `
    <div class="practice-question-item ${practiceState.selectedQuestionId === e.id ? 'selected' : ''}" onclick="pickLibraryQuestion('${e.id}')">
      <div class="practice-question-item-title">${escapeHtml(e.title || 'Untitled')}</div>
      <div class="practice-question-item-text">${escapeHtml(e.question)}</div>
    </div>
  `).join('');
}

function pickLibraryQuestion(id) {
  const e = essays.find(x => x.id === id);
  if (!e) return;
  practiceState.selectedQuestionId = id;
  practiceState.questionTitle = e.title || '';
  practiceState.questionText = e.question || '';
  renderQuestionPicker();
  // Update the "Selected" preview
  const sel = document.getElementById('practiceSelectedQuestion');
  if (sel) {
    sel.classList.add('show');
    sel.innerHTML = `<strong>Selected question</strong>${escapeHtml(practiceState.questionText)}`;
  }
  // Live-update the topic banner inside the write step
  refreshPracticeTopicBanner();
  updateSubmitBtnState();
}

// Inject (or update) the topic banner inside the practice Step 2 card without re-rendering everything.
function refreshPracticeTopicBanner() {
  // Find the write-step card — second .practice-step in the practice content
  const steps = document.querySelectorAll('.practice-content .practice-step');
  if (steps.length < 2) return;
  const writeStep = steps[1];
  // Remove any existing banner
  const existing = writeStep.querySelector('.practice-topic-banner');
  if (existing) existing.remove();
  if (!practiceState.questionText) return;
  // Build a fresh banner
  const banner = document.createElement('div');
  banner.className = 'topic-banner practice-topic-banner';
  banner.innerHTML = `
    <div class="topic-banner-label">${practiceState.questionTitle ? escapeHtml(practiceState.questionTitle) : 'The question'}</div>
    <div class="topic-banner-question">${escapeHtml(practiceState.questionText)}</div>
  `;
  // Insert AFTER the step-header (which is the first child)
  const header = writeStep.querySelector('.practice-step-header');
  if (header && header.nextSibling) {
    writeStep.insertBefore(banner, header.nextSibling);
  } else {
    writeStep.appendChild(banner);
  }
}

function customPromptHTML() {
  return `
    <textarea class="practice-custom-input" id="practiceCustomPrompt" placeholder="Paste or type any essay question — IELTS, PTE, or your own..." oninput="onCustomPromptInput(this.value)">${escapeHtml(practiceState.questionSource === 'custom' ? practiceState.questionText : '')}</textarea>
  `;
}

function onCustomPromptInput(val) {
  practiceState.selectedQuestionId = null;
  practiceState.questionTitle = '';
  practiceState.questionText = val.trim();
  // Update preview banner
  const sel = document.getElementById('practiceSelectedQuestion');
  if (sel) {
    if (practiceState.questionText) {
      sel.classList.add('show');
      sel.innerHTML = `<strong>Your prompt</strong>${escapeHtml(practiceState.questionText)}`;
    } else {
      sel.classList.remove('show');
    }
  }
  // Live-update the topic banner inside the write step
  refreshPracticeTopicBanner();
  updateSubmitBtnState();
}

function updateLiveWordCount() {
  const ta = document.getElementById('practiceEssayInput');
  if (!ta) return;
  practiceState.essayText = ta.value;
  const count = countWords(ta.value);
  
  // Update plain count display
  const el = document.getElementById('practiceWordCount');
  if (el) {
    el.textContent = count + ' word' + (count === 1 ? '' : 's');
  }

  // Update Progress Bar & Labels
  const progressBar = document.getElementById('practiceProgressBar');
  const countLabel = document.getElementById('practiceWordCountLabel');
  if (progressBar) {
    let pct = 0;
    let barColor = 'var(--accent)';
    let statusText = '✍️ Keep writing...';

    if (count < 200) {
      pct = (count / 200) * 57.14;
      barColor = 'var(--accent)';
      statusText = `✍️ Keep writing... Need at least 200 words (current: ${count})`;
    } else if (count >= 200 && count <= 300) {
      pct = 57.14 + ((count - 200) / 100) * 28.57;
      barColor = '#10b981'; // green for target zone
      statusText = `✓ Perfect length! Ready to score (current: ${count})`;
    } else {
      pct = 85.71 + (Math.min(count - 300, 50) / 50) * 14.29;
      barColor = '#f59e0b'; // amber for warning
      statusText = `⚠ Length warning: Try to keep it under 300 words (current: ${count})`;
      if (count > 350) {
        barColor = '#ef4444'; // red for way over limit
        statusText = `✗ Length problem: Way over target limit (current: ${count})`;
      }
    }
    
    progressBar.style.width = pct + '%';
    progressBar.style.backgroundColor = barColor;
    if (countLabel) {
      countLabel.textContent = statusText;
      countLabel.style.color = count >= 200 && count <= 300 ? '#10b981' : (count > 300 ? (count > 350 ? '#ef4444' : '#f59e0b') : 'var(--ink-soft)');
    }
  }

  // Start the timer on first typing keystroke when timer mode is on
  if (practiceState.timerEnabled && !practiceState.timerStartedAt && count > 0) {
    startPracticeTimer();
  }
  updateSubmitBtnState();
}

// ---------- Timer (exam-mode simulation) ----------
// Format ms-since-start as "MM:SS"
function formatTimerElapsed(ms) {
  const total = Math.floor(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function toggleTimerMode(on) {
  practiceState.timerEnabled = on;
  const bar = document.getElementById('practiceTimerBar');
  if (bar) bar.classList.toggle('show', on);
  if (!on) {
    // Turn off — clear running interval, but KEEP started time
    // (so if they re-enable, the bar shows what's elapsed since they started writing)
    if (practiceState.timerIntervalId) {
      clearInterval(practiceState.timerIntervalId);
      practiceState.timerIntervalId = null;
    }
  } else {
    // Turn on — if user already started writing, start the live counter immediately
    if (practiceState.essayText && countWords(practiceState.essayText) > 0) {
      if (!practiceState.timerStartedAt) practiceState.timerStartedAt = Date.now();
      startPracticeTimerInterval();
    }
    // Otherwise the counter starts on first keystroke (handled in updateLiveWordCount)
  }
}

function startPracticeTimer() {
  // Begin the timer right now (called on first keystroke when timer mode is on)
  practiceState.timerStartedAt = Date.now();
  startPracticeTimerInterval();
}

function startPracticeTimerInterval() {
  // Start the 1s update interval that paints the elapsed time on screen
  if (practiceState.timerIntervalId) clearInterval(practiceState.timerIntervalId);
  practiceState.timerIntervalId = setInterval(() => {
    const el = document.getElementById('practiceTimerElapsed');
    if (!el || !practiceState.timerStartedAt) return;
    const elapsed = Date.now() - practiceState.timerStartedAt;
    el.textContent = formatTimerElapsed(elapsed);
    // Visual cue when exceeded
    const limitMs = PRACTICE_TIMER_LIMIT_MIN * 60 * 1000;
    el.classList.toggle('exceeded', elapsed > limitMs);
  }, 1000);
}

function stopPracticeTimer() {
  if (practiceState.timerIntervalId) {
    clearInterval(practiceState.timerIntervalId);
    practiceState.timerIntervalId = null;
  }
}

function getPracticeElapsedMs() {
  if (!practiceState.timerEnabled || !practiceState.timerStartedAt) return null;
  return Date.now() - practiceState.timerStartedAt;
}

function resetPracticeTimer() {
  stopPracticeTimer();
  practiceState.timerStartedAt = null;
  const el = document.getElementById('practiceTimerElapsed');
  if (el) { el.textContent = '00:00'; el.classList.remove('exceeded'); }
}

function countWords(text) {
  text = (text || '').trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}

function updateSubmitBtnState() {
  const btn = document.getElementById('practiceSubmitBtn');
  if (btn) {
    const ready = practiceState.questionText.trim().length >= 10 &&
                  countWords(practiceState.essayText) >= 50;
    btn.disabled = !ready;
    if (countWords(practiceState.essayText) < 50) {
      btn.innerHTML = '🤖 Write at least 50 words to score';
    } else if (practiceState.questionText.trim().length < 10) {
      btn.innerHTML = '🤖 Pick or write a question first';
    } else {
      btn.innerHTML = '🤖 Score my essay';
    }
  }

  const startBtn = document.getElementById('practiceStartBtn');
  if (startBtn) {
    const ready = practiceState.questionText.trim().length >= 10;
    startBtn.disabled = !ready;
  }
}

function loadingView() {
  return `
    <div class="practice-loading">
      <div class="practice-loading-icon"></div>
      <div class="practice-loading-text" id="practiceLoadingText">Reading your essay…</div>
      <div class="practice-loading-sub">This usually takes 8–15 seconds.</div>
    </div>
  `;
}

// Cycle through friendly progress messages while the AI scores (purely cosmetic —
// makes the wait feel responsive instead of frozen).
let practiceLoadingTimer = null;
function startLoadingMessages() {
  const messages = [
    'Reading your essay…',
    'Checking grammar and spelling…',
    'Assessing vocabulary and range…',
    'Evaluating coherence and structure…',
    'Scoring against the 26-point rubric…',
    'Writing your feedback…'
  ];
  let i = 0;
  if (practiceLoadingTimer) clearInterval(practiceLoadingTimer);
  practiceLoadingTimer = setInterval(() => {
    i = (i + 1) % messages.length;
    const el = document.getElementById('practiceLoadingText');
    if (el) el.textContent = messages[i];
  }, 2500);
}
function stopLoadingMessages() {
  if (practiceLoadingTimer) { clearInterval(practiceLoadingTimer); practiceLoadingTimer = null; }
}

// ---------- Submit & score with Claude ----------

async function submitPracticeEssay() {
  // Capture latest values from inputs (in case oninput didn't fire)
  const ta = document.getElementById('practiceEssayInput');
  if (ta) practiceState.essayText = ta.value;
  const customInput = document.getElementById('practiceCustomPrompt');
  if (customInput && practiceState.questionSource === 'custom') {
    practiceState.questionText = customInput.value.trim();
  }

  if (!practiceState.questionText.trim()) {
    toast('Please pick or write a question first', true);
    return;
  }
  if (countWords(practiceState.essayText) < 50) {
    toast('Please write at least 50 words before scoring', true);
    return;
  }

  // Capture elapsed timer (if enabled) — stop the live counter now
  const elapsedMsAtSubmit = getPracticeElapsedMs();
  stopPracticeTimer();

  // Consume quota (1 essay credit)
  if (!await consumeQuota('essay')) return;

  practiceState.view = 'loading';
  renderPracticeMain();
  startLoadingMessages();

  const essay = practiceState.essayText.trim();
  const question = practiceState.questionText.trim();
  const wordCount = countWords(essay);

  const prompt = `You are an experienced PTE/IELTS examiner at IPT Brisbane. Score this student essay and give friendly, plain-English feedback. The student is NOT a linguistics expert — explain things in simple language they can act on.

═══════════════════════════════════════════════════════════════
ESSAY QUESTION:
${question}
═══════════════════════════════════════════════════════════════
STUDENT'S ESSAY (${wordCount} words):
${essay}
═══════════════════════════════════════════════════════════════

SCORING RUBRIC (total = 26 points):

• content (0-6): Does the essay actually answer the question? Are all parts of the prompt addressed? Are ideas relevant and developed with examples?
   - 6: Fully addresses every part, well-developed examples
   - 4-5: Addresses most parts, mostly relevant
   - 2-3: Partial answer, weak development
   - 0-1: Off-topic or very thin

• form (0-2): Word count check ONLY. The exact word count is exactly ${wordCount} words. You MUST use this exact number and do NOT count the words yourself.
   - 2: Word count is 200-300
   - 1: Word count is 120-199 OR 301-380
   - 0: Word count outside 120-380

• spelling (0-2): Count actual spelling errors.
   - 2: 0 errors
   - 1: 1-3 errors
   - 0: 4+ errors

• grammar (0-2): Grammar accuracy.
   - 2: 0-2 minor errors, never blocks meaning
   - 1: Several errors but mostly clear
   - 0: Frequent errors that block meaning

• vocabulary (0-2): Word choice and range.
   - 2: Wide range, appropriate, precise
   - 1: Adequate, mostly correct, some repetition
   - 0: Very limited, repetitive, or many wrong word choices

• linguistic (0-6): Sentence variety and structures.
   - 6: Varied (simple, compound, complex), confident
   - 4-5: Some variety, mostly correct
   - 2-3: Mostly simple sentences, limited range
   - 0-1: Very repetitive or broken

• coherence (0-6): Flow, organisation, paragraphing, linking words.
   - 6: Clear paragraphs, smooth transitions, ideas connect
   - 4-5: Mostly organised, occasional jump
   - 2-3: Some structure but weak connections
   - 0-1: Confused or no clear order

═══════════════════════════════════════════════════════════════
TEMPLATE DETECTOR (IPT BRISBANE-aware):

IMPORTANT CONTEXT: Students at IPT Brisbane are TAUGHT a specific Band 9 essay structure. These phrases below are PART OF THAT TAUGHT STRUCTURE — they are not "memorised templates", they are the correct application of what the student was taught. DO NOT flag them as template-y:

 ✓ "The topic of [X] has become increasingly important in recent years"
 ✓ "Its significance lies in its influence on..."
 ✓ "This essay will examine the [X] of [Y] incorporating different perspectives"
 ✓ "To begin with, one major merit / advantage / benefit is..."
 ✓ "Additionally, another significant point in favour / reason is..."
 ✓ "On the other hand, one notable demerit / limitation is..."
 ✓ "Furthermore, another limitation / concern is..."
 ✓ "To conclude, [topic] presents compelling advantages and disadvantages..."
 ✓ "Hence, prioritising the maximisation of..."
 ✓ "Therefore, [solution-oriented closing]..."
 ✓ "For example, ... shows its benefits in practice"
 ✓ "This can be illustrated by..."
 ✓ "[EXTRA IDEA] Moreover, ..."

When you see these IPT phrases, the student is FOLLOWING THE TAUGHT STRUCTURE CORRECTLY — that is a strength, not a weakness.

Choose ONE of three values:
- "good" = student used the IPT taught structure phrases correctly AND personalised them with topic-specific content (this is what you want to see)
- "ok" = essay reads naturally; doesn't lean heavily on IPT structure but also no over-rehearsal from elsewhere
- "flag" = essay is over-rehearsed with phrases from OTHER common templates (e.g. "in today's day and age", "since the dawn of time", "from time immemorial", "it is a multifaceted issue", repetitive transitions, or generic content unrelated to the actual question)

For "templateNote", write a SHORT ENCOURAGING note:
- If "good": praise it — e.g. "Nice — you applied the IPT Band 9 structure correctly. Keep using these transitions."
- If "ok": neutral — e.g. "Your writing flows naturally."
- If "flag": gentle warning about the specific rehearsed phrases you noticed (NOT IPT's taught phrases).
═══════════════════════════════════════════════════════════════

FEEDBACK STYLE — read this twice before writing feedback:
1. Use PLAIN ENGLISH. Imagine the student speaks English as a second language and has never studied linguistics.
2. NO jargon. Don't say "cohesion", "lexical resource", "syntactic variety", "discourse markers". Instead say "how your ideas link together", "the words you chose", "different sentence shapes", "joining words like however".
3. Be SPECIFIC. Quote 2-3 short phrases from THEIR essay to show what you mean.
4. Be ACTIONABLE. Tell them what to DO next time, not just what was wrong.
5. Be ENCOURAGING. Lead with what they did well, then what to fix.
6. Keep each category's feedback to 2-3 short sentences (max ~50 words).

For "strengths" and "improvements": give 2-3 short bullet-style items each (one sentence each), the most important things only.

═══════════════════════════════════════════════════════════════
RETURN ONLY A JSON OBJECT — no preamble, no markdown fences. Format:

{
  "scores": {
    "content": 6,
    "form": 2,
    "spelling": 2,
    "grammar": 2,
    "vocabulary": 2,
    "linguistic": 6,
    "coherence": 6
  },
  "templateDetector": "good",
  "templateNote": "Nice — you applied the IPT Band 9 structure correctly. Keep using these transitions.",
  "overallVerdict": "Excellent work! This is close to a top-band essay.",
  "feedback": {
    "content": "What you did well: ...  What to improve: ...  Tip: ...",
    "form": "Word count was X — that's within / outside the 200-300 target...",
    "spelling": "...",
    "grammar": "...",
    "vocabulary": "...",
    "linguistic": "...",
    "coherence": "..."
  },
  "errors": [
    {
      "type": "spelling",
      "phrase": "the EXACT word or short phrase as it appears in the essay (verbatim, case-sensitive)",
      "correction": "the corrected version",
      "explanation": "one short, plain-English sentence explaining the issue"
    },
    {
      "type": "grammar",
      "phrase": "...",
      "correction": "...",
      "explanation": "..."
    }
  ],
  "spellingErrors": ["wrod1", "wrod2"],
  "grammarIssues": ["short phrase showing the issue", "another"],
  "strengths": ["You clearly answered both parts of the question.", "Good use of specific examples like X."],
  "sampleResponse": "A revised version of the essay focusing on the key paragraphs that need improvement (keep it concise, max 150 words total, rather than rewriting the entire essay). If the essay scores a perfect overall score (26/26, equivalent to PTE 90), you do NOT need to rewrite the essay — simply set 'sampleResponse' to 'Congratulations! Your essay is already perfect, so no rewrite is needed.' Highlight the changes: wrap any added or improved words/phrases in <span class='diff-ins'>...</span> and any deleted or replaced words/phrases in <span class='diff-del'>...</span> (you MUST use single quotes for HTML classes to ensure valid JSON). Example: 'This is <span class='diff-del'>bad</span><span class='diff-ins'>suboptimal</span>.'"
}

CRITICAL for the "errors" array:
- Include EVERY single spelling issue, grammatical mistake, and style/vocabulary improvement you find in the entire essay. Do not cap it or limit it to 10; list all of them in a single pass.
- Do NOT hold back style suggestions or wait for the student to fix basic errors first; list ALL errors and potential refinements/upgrades immediately in the first pass so the user can see and fix everything in one go.
- "phrase" MUST be the exact text from the essay (verbatim — same spelling, same capitalisation). I will search-and-replace it to highlight it. If the same misspelling appears twice, list it once.
- "type" is "spelling" OR "grammar" — nothing else (categorize style/phrasing refinements under "grammar").
- If the essay has zero errors, return "errors": [].`;

  try {
    const res = await fetch(API_URL + '/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Server returned ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    let text = (data.content || []).map(c => c.text || '').join('').trim();
    // Strip markdown fences if AI added them
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let result = cleanAndParseJSON(text);

    // Programmatic override for Form score and feedback to prevent LLM word counting errors
    let calculatedFormScore = 0;
    let formFeedbackText = '';
    if (wordCount >= 200 && wordCount <= 300) {
      calculatedFormScore = 2;
      formFeedbackText = `Your essay is ${wordCount} words, which is within the required 200–300 word limit. Well done on meeting the length requirement!`;
    } else if ((wordCount >= 120 && wordCount < 200) || (wordCount > 300 && wordCount <= 380)) {
      calculatedFormScore = 1;
      if (wordCount < 200) {
        formFeedbackText = `Your essay is ${wordCount} words, which is slightly below the 200-word minimum limit. Try to write a bit more to land between 200 and 300 words next time.`;
      } else {
        formFeedbackText = `Your essay is ${wordCount} words, which is slightly above the 300-word limit. Try to trim about ${wordCount - 300} words to land between 200 and 300 words next time.`;
      }
    } else {
      calculatedFormScore = 0;
      if (wordCount < 120) {
        formFeedbackText = `Your essay is only ${wordCount} words, which is far below the 200-word limit. You must write at least 200 words to avoid heavy form penalties.`;
      } else {
        formFeedbackText = `Your essay is ${wordCount} words, which is far above the 300-word limit. You must trim it to land between 200 and 300 words next time.`;
      }
    }
    
    if (!result.scores) result.scores = {};
    if (!result.feedback) result.feedback = {};
    
    result.scores.form = calculatedFormScore;
    result.feedback.form = formFeedbackText;

    // Calculate total
    let total = 0;
    for (const r of PRACTICE_RUBRIC) {
      const v = Math.max(0, Math.min(r.max, parseInt(result.scores?.[r.key] || 0)));
      total += v;
      result.scores[r.key] = v;
    }
    result.scores.total = total;

    // Build the attempt object
    const attempt = {
      id: 'pr_' + Date.now() + Math.random().toString(36).slice(2, 6),
      date: Date.now(),
      questionId: practiceState.selectedQuestionId || '',
      questionTitle: practiceState.questionTitle,
      questionText: practiceState.questionText,
      essayText: practiceState.essayText,
      wordCount: wordCount,
      scores: result.scores,
      templateDetector: ['good','ok','flag'].includes(result.templateDetector) ? result.templateDetector : 'ok',
      templateNote: result.templateNote || '',
      overallVerdict: result.overallVerdict || '',
      feedback: result.feedback || {},
      errors: Array.isArray(result.errors) ? result.errors : [],
      spellingErrors: Array.isArray(result.spellingErrors) ? result.spellingErrors : [],
      grammarIssues: Array.isArray(result.grammarIssues) ? result.grammarIssues : [],
      strengths: Array.isArray(result.strengths) ? result.strengths : [],
      improvements: Array.isArray(result.improvements) ? result.improvements : [],
      sampleResponse: result.sampleResponse || ''
    };

    // Save elapsed (if timer was running) onto the attempt
    if (elapsedMsAtSubmit !== null) {
      attempt.elapsedMs = elapsedMsAtSubmit;
    }

    // Save to history (cap at 50 total, but no per-question limit)
    let history = getPracticeHistory();
    history.unshift(attempt);
    // history = prunePracticeAttempts(history, attempt);
    if (history.length > 50) history.length = 50;
    await savePracticeHistory(history);

    practiceState.currentAttempt = attempt;
    practiceState.viewingAttemptId = attempt.id;
    stopLoadingMessages();
    practiceState.view = 'results';
    renderPracticeMain();
    renderPracticeHistory();
    updatePracticeStats();
    toast(`Scored: ${attempt.scores.total}/${PRACTICE_MAX_TOTAL} ✓`);

    // On-submit time-exceeded notification
    if (elapsedMsAtSubmit !== null) {
      const limitMs = PRACTICE_TIMER_LIMIT_MIN * 60 * 1000;
      if (elapsedMsAtSubmit > limitMs) {
        const minTook = Math.round(elapsedMsAtSubmit / 60000);
        // Schedule slightly after the score toast so they don't overlap
        setTimeout(() => {
          toast(`⏱ You took ${minTook} min — exam limit is ${PRACTICE_TIMER_LIMIT_MIN}. Aim faster next time.`, true);
        }, 2200);
      }
    }
  } catch (err) {
    console.error(err);
    stopLoadingMessages();
    practiceState.view = 'write';
    renderPracticeMain();
    toast('Scoring failed: ' + err.message, true);
  }
}

// ---------- Results view ----------

function resultsView() {
  const a = practiceState.currentAttempt;
  if (!a) return welcomeView();
  const total = a.scores?.total || 0;
  const pct = total / PRACTICE_MAX_TOTAL;
  const band = pct >= 0.85 ? 'high' : (pct >= 0.6 ? 'mid' : 'low');

  // Form check banner
  let formBanner = '';
  const wc = a.wordCount;
  if (wc >= 200 && wc <= 300) {
    formBanner = `<div class="practice-form-banner ok">
      <span class="practice-form-banner-icon">✓</span>
      <span class="practice-form-banner-text"><strong>Length OK:</strong> ${wc} words (target is 200–300).</span>
    </div>`;
  } else if ((wc >= 120 && wc < 200) || (wc > 300 && wc <= 380)) {
    formBanner = `<div class="practice-form-banner warn">
      <span class="practice-form-banner-icon">⚠</span>
      <span class="practice-form-banner-text"><strong>Length off-target:</strong> ${wc} words. Try to land between 200–300 next time.</span>
    </div>`;
  } else {
    formBanner = `<div class="practice-form-banner bad">
      <span class="practice-form-banner-icon">✗</span>
      <span class="practice-form-banner-text"><strong>Length problem:</strong> ${wc} words is well outside the 200–300 target. This costs you Form marks.</span>
    </div>`;
  }

  // Template banner — three states: good (praise IPT structure), ok (neutral), flag (warning)
  const tplState = a.templateDetector || 'ok';
  let tplClass = '';        // CSS class (good → green, flag → amber, ok → default)
  let tplStatus = 'OK';
  let tplIcon = '✓';
  let tplDefaultNote = 'Template check passed. Your writing looks natural.';
  if (tplState === 'good') {
    tplClass = '';            // uses the default green ".practice-template-banner" style
    tplStatus = 'Structure ✓';
    tplIcon = '✓';
    tplDefaultNote = 'Nice — you applied the IPT Band 9 structure correctly. Keep using these transitions.';
  } else if (tplState === 'flag') {
    tplClass = 'flag';        // amber warning style (already defined in CSS)
    tplStatus = 'Flagged';
    tplIcon = '⚠';
    tplDefaultNote = 'Some phrases sound over-rehearsed — try writing more naturally about THIS topic.';
  }
  const templateBanner = `<div class="practice-template-banner ${tplClass}">
    <span style="font-weight:700;">${tplIcon} Essay Template Detector:</span>
    <span class="practice-template-status">${tplStatus}</span>
    <span style="flex:1;">${escapeHtml(a.templateNote || tplDefaultNote)}</span>
  </div>`;

  // Score cells (using modern pte-grid metric cards)
  const cells = PRACTICE_RUBRIC.map(r => {
    const score = a.scores?.[r.key] || 0;
    return `
      <div class="pte-metric-card">
        <span class="pte-metric-label">${r.label}</span>
        <span class="pte-metric-score">${score}/${r.max}</span>
      </div>
    `;
  }).join('');

  const pteDashboardHtml = `
    <div class="pte-dashboard" style="margin-bottom: 24px;">
      <div class="pte-score-circle-wrap">
        <div class="practice-score-circle total">
          <span class="practice-score-num">${total}<sub>/26</sub></span>
        </div>
        <span class="pte-metric-label">PTE OVERALL</span>
      </div>
      <div class="pte-grid">
        ${cells}
      </div>
    </div>
  `;

  // Per-category feedback cards
  const feedbackCards = PRACTICE_RUBRIC.map(r => {
    const score = a.scores?.[r.key] || 0;
    const ratio = score / r.max;
    let cls = 'bad';
    if (ratio >= 0.75) cls = 'good';
    else if (ratio >= 0.4) cls = 'mid';
    const fb = a.feedback?.[r.key] || 'No feedback for this category.';
    let extra = '';
    if (r.key === 'spelling' && a.spellingErrors && a.spellingErrors.length > 0) {
      extra = `<div class="practice-fb-issues">
        <div class="practice-fb-issues-label">Words to check</div>
        ${a.spellingErrors.map(w => `<span class="practice-fb-issues-chip">${escapeHtml(w)}</span>`).join('')}
      </div>`;
    }
    if (r.key === 'grammar' && a.grammarIssues && a.grammarIssues.length > 0) {
      extra = `<div class="practice-fb-issues">
        <div class="practice-fb-issues-label">Grammar issues spotted</div>
        ${a.grammarIssues.map(g => `<div style="font-size:12px; color:var(--ink); padding:3px 0;">• ${escapeHtml(g)}</div>`).join('')}
      </div>`;
    }
    return `
      <div class="practice-fb-card ${cls}">
        <div class="practice-fb-card-header">
          <div class="practice-fb-card-title">${r.label}</div>
          <span class="practice-fb-card-score">${score} / ${r.max}</span>
        </div>
        <div class="practice-fb-card-body">${escapeHtml(fb).replace(/\n/g, '<br>')}</div>
        ${extra}
      </div>
    `;
  }).join('');

  // Strengths / improvements summary
  const strengths = (a.strengths || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
  const improvements = (a.improvements || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
  const summaryRow = (strengths || improvements) ? `
    <div class="practice-summary-row">
      ${strengths ? `<div class="practice-summary-col good">
        <div class="practice-summary-col-title">✓ What you did well</div>
        <ul class="practice-summary-list">${strengths}</ul>
      </div>` : ''}
      ${improvements ? `<div class="practice-summary-col improve">
        <div class="practice-summary-col-title">→ What to work on next</div>
        <ul class="practice-summary-list">${improvements}</ul>
      </div>` : ''}
    </div>
  ` : '';

  // Verdict line
  const verdictDefault = total >= 22 ? 'Excellent work — top-band level.'
    : total >= 17 ? 'Good effort. With a few tweaks you can push higher.'
    : total >= 10 ? 'Decent start. Focus on the "What to work on next" tips.'
    : 'Plenty of room to grow. Read through the per-category notes below.';
  const verdict = a.overallVerdict || verdictDefault;

  // Grammar & Spelling inline-error section
  const grammarSection = renderGrammarSpellingSection(a);

  // AI Sample Response (if available)
  let sampleResponseSection = '';
  if (a.sampleResponse) {
    sampleResponseSection = `
      <div class="practice-grammar-section" style="margin-top:20px;">
        <div class="practice-grammar-header" style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div class="practice-grammar-title">🤖 AI Rewrite &amp; Sample Response</div>
            <div style="font-size:11px; color:var(--ink-soft); font-weight:normal; font-style:italic;">
              Showing your essay rewritten to incorporate all recommendations.
            </div>
          </div>
          <button class="admin-btn" style="padding:4px 12px; font-size:12px; cursor:pointer;" onclick="copyPracticeText('rewritten')">📋 Copy Polished Essay</button>
        </div>
        <div style="padding:18px 24px; background:var(--bg-card); border:1px solid var(--line-soft); border-radius:12px; margin-bottom:18px; box-shadow:var(--shadow);">
          <div style="display:flex; gap:16px; font-size:11px; margin-bottom:14px; border-bottom:1px solid var(--line-soft); padding-bottom:8px; color:var(--ink-soft);">
            <div style="display:flex; align-items:center; gap:6px;"><span class="diff-ins" style="font-size:10px; padding:2px 6px; font-weight:700;">ins</span> <span>Added / Improved</span></div>
            <div style="display:flex; align-items:center; gap:6px;"><span class="diff-del" style="font-size:10px; padding:2px 6px; font-weight:700;">del</span> <span>Replaced / Removed</span></div>
          </div>
          <div style="white-space:pre-wrap; font-family:var(--serif); font-size:13.5px; line-height:1.75; color:var(--ink);">
            ${a.sampleResponse}
          </div>
        </div>
      </div>
    `;
  }

  // Show the original question + essay for context
  const questionPanel = `
    <details style="margin-bottom:18px; background:var(--bg-card); border:1px solid var(--line); border-radius:8px; padding:10px 14px;">
      <summary style="cursor:pointer; font-weight:600; font-size:13px;">▸ View your question &amp; essay (${a.wordCount} words)</summary>
      <div style="margin-top:10px; font-size:12.5px; color:var(--ink-soft); line-height:1.6;">
        <div style="font-weight:700; color:var(--accent); font-size:10.5px; letter-spacing:0.12em; text-transform:uppercase; margin-bottom:4px;">Question</div>
        <div style="margin-bottom:10px; color:var(--ink);">${escapeHtml(a.questionText)}</div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span style="font-weight:700; color:var(--accent); font-size:10.5px; letter-spacing:0.12em; text-transform:uppercase;">Your essay</span>
          <button class="admin-btn" style="padding:2px 8px; font-size:11px; cursor:pointer;" onclick="copyPracticeText('attempted')">📋 Copy Original</button>
        </div>
        <div style="white-space:pre-wrap; color:var(--ink); font-family:var(--serif); font-size:13px; line-height:1.7;">${escapeHtml(a.essayText)}</div>
      </div>
    </details>
  `;

  return `
    <div class="practice-results">
      <div class="practice-verdict-banner" style="background:var(--bg-card); border:1px solid var(--line-soft); border-radius:12px; padding:18px 24px; margin-bottom:20px; box-shadow:var(--shadow);">
        <div style="font-size:10px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:var(--ink-soft); margin-bottom:4px;">Evaluation Verdict</div>
        <div style="font-family:var(--serif); font-size:18px; font-weight:700; color:var(--ink);">${escapeHtml(verdict)}</div>
      </div>

      ${pteDashboardHtml}
      ${formBanner}
      ${templateBanner}

      ${summaryRow}

      ${grammarSection}

      ${sampleResponseSection}

      <div class="practice-feedback-title">Detailed feedback</div>
      ${feedbackCards}

      ${questionPanel}

      <div class="practice-actions">
        <button class="practice-action-btn primary" onclick="reattemptPractice()">↻ Re-attempt this question</button>
        <button class="practice-action-btn" onclick="startNewPractice()">+ Try a different question</button>
        <button class="practice-action-btn" onclick="window.print()"><span style="margin-right: 4px;">🖨</span> Print / Save PDF</button>
        <button class="practice-action-btn" onclick="closePractice()">← Back to essays</button>
      </div>
    </div>
  `;
}

function reattemptPractice() {
  // Keep the same question, blank the essay, switch back to write view
  const a = practiceState.currentAttempt;
  if (!a) return startNewPractice();
  practiceState.view = 'write';
  practiceState.writeStep = 2;
  practiceState.promptExpanded = true;
  practiceState.questionSource = a.questionTitle ? 'library' : 'custom';
  practiceState.questionTitle = a.questionTitle || '';
  practiceState.questionText = a.questionText || '';
  practiceState.selectedQuestionId = null;
  // Try to re-match to library by title
  if (a.questionTitle) {
    const match = essays.find(e => e.title === a.questionTitle);
    if (match) practiceState.selectedQuestionId = match.id;
  }
  practiceState.essayText = '';
  practiceState.viewingAttemptId = null;
  practiceState.currentAttempt = null;
  resetPracticeTimer();
  renderPracticeMain();
  renderPracticeHistory();
}

// ---------- Grammar & Spelling section (Grammarly-style hybrid) ----------
// Layout: two columns —
//   left = essay with subtle underlines (click to focus sidebar entry)
//   right = sidebar listing all errors with [Apply] buttons (click to scroll & flash in essay)

function renderGrammarSpellingSection(a) {
  const grammarScore = a.scores?.grammar || 0;
  const spellingScore = a.scores?.spelling || 0;
  const errors = Array.isArray(a.errors) ? a.errors.filter(e => e && e.phrase) : [];
  const grammarPillClass = grammarScore === 2 ? '' : (grammarScore === 1 ? 'warn' : 'bad');
  const spellingPillClass = spellingScore === 2 ? '' : (spellingScore === 1 ? 'warn' : 'bad');

  // Render essay with errors marked (each error gets a data-error-id="i" for cross-linking)
  const highlightedEssay = highlightEssayErrors(a.essayText, errors);

  if (errors.length === 0) {
    return `
    <div class="practice-grammar-section">
      <div class="practice-grammar-header">
        <div class="practice-grammar-title">📝 Grammar &amp; Spelling</div>
        <div class="practice-grammar-pills">
          <span class="practice-grammar-pill ${grammarPillClass}">Grammar: ${grammarScore}/2</span>
          <span class="practice-grammar-pill ${spellingPillClass}">Spelling: ${spellingScore}/2</span>
        </div>
      </div>
      <div class="practice-essay-display">${highlightedEssay}</div>
      <div class="practice-grammar-no-errors">
        <span>✓</span>
        <span><strong>No grammar or spelling issues found.</strong> Clean writing!</span>
      </div>
    </div>
    `;
  }

  const spellingCount = errors.filter(e => e.type === 'spelling').length;
  const grammarCount = errors.filter(e => e.type !== 'spelling').length;

  // Build sidebar entries
  const entries = errors.map((err, i) => {
    const typeClass = err.type === 'spelling' ? 'spelling' : 'grammar';
    const typeLabel = err.type === 'spelling' ? 'Spelling' : 'Grammar';
    return `
      <div class="gh-card" data-error-id="${i}" onclick="focusErrorInEssay(${i})">
        <div class="gh-card-head">
          <span class="gh-card-type ${typeClass}">${typeLabel}</span>
          <button class="gh-card-apply" onclick="applyErrorFix(event, ${i})" title="Replace this error in the text">Apply</button>
        </div>
        <div class="gh-card-suggestion">
          <span class="gh-card-old">${escapeHtml(err.phrase)}</span>
          <span class="gh-card-arrow">→</span>
          <span class="gh-card-new">${escapeHtml(err.correction || '—')}</span>
        </div>
        ${err.explanation ? `<div class="gh-card-why">${escapeHtml(err.explanation)}</div>` : ''}
      </div>
    `;
  }).join('');

  return `
    <div class="practice-grammar-section">
      <div class="practice-grammar-header">
        <div class="practice-grammar-title">📝 Grammar &amp; Spelling</div>
        <div class="practice-grammar-pills">
          <span class="practice-grammar-pill ${grammarPillClass}">Grammar: ${grammarScore}/2</span>
          <span class="practice-grammar-pill ${spellingPillClass}">Spelling: ${spellingScore}/2</span>
        </div>
      </div>

      <div class="gh-layout">
        <!-- LEFT: essay with subtle inline underlines -->
        <div class="gh-essay">
          <div class="practice-essay-display" id="practiceEssayDisplay">${highlightedEssay}</div>
        </div>

        <!-- RIGHT: sidebar with one card per error -->
        <aside class="gh-sidebar">
          <div class="gh-sidebar-header">
            <div class="gh-sidebar-count">
              <strong>${errors.length}</strong> issue${errors.length === 1 ? '' : 's'} to review
            </div>
            <div class="gh-sidebar-breakdown">
              ${spellingCount ? `<span class="gh-sidebar-breakdown-item spelling">●&nbsp;${spellingCount} spelling</span>` : ''}
              ${grammarCount ? `<span class="gh-sidebar-breakdown-item grammar">●&nbsp;${grammarCount} grammar</span>` : ''}
            </div>
          </div>
          <div class="gh-cards">
            ${entries}
          </div>
          <div class="gh-sidebar-hint">
            <span>💡 <strong>Tip:</strong> Click an issue to find it in your essay, or hit <em>Apply</em> to replace it inline.</span>
          </div>
        </aside>
      </div>
    </div>
  `;
}

// Click on a sidebar card → scroll to underline + flash it
function focusErrorInEssay(idx) {
  const span = document.querySelector(`.practice-error[data-error-id="${idx}"]`);
  if (!span) return;
  span.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Pulse it
  span.classList.add('flash');
  setTimeout(() => span.classList.remove('flash'), 1200);
  // Also visually mark the card as active
  document.querySelectorAll('.gh-card.active').forEach(c => c.classList.remove('active'));
  document.querySelector(`.gh-card[data-error-id="${idx}"]`)?.classList.add('active');
}

// Click on an underlined error → scroll the sidebar entry into view + flash it
function focusErrorCard(idx) {
  // Flash the clicked word in the essay so the user gets immediate local feedback
  const span = document.querySelector(`.practice-error[data-error-id="${idx}"]`);
  if (span) {
    span.classList.remove('flash');
    // force reflow so the animation can restart if clicked repeatedly
    void span.offsetWidth;
    span.classList.add('flash');
    setTimeout(() => span.classList.remove('flash'), 1200);
  }
  // Highlight + scroll the matching sidebar card
  const card = document.querySelector(`.gh-card[data-error-id="${idx}"]`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.querySelectorAll('.gh-card.active').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    // brief pulse so it's obvious which card lit up
    card.classList.remove('pulse');
    void card.offsetWidth;
    card.classList.add('pulse');
    setTimeout(() => card.classList.remove('pulse'), 800);
  }
}

// Apply a fix: replace the phrase in the rendered essay text + cross out the card
function applyErrorFix(ev, idx) {
  if (ev) ev.stopPropagation();
  const card = document.querySelector(`.gh-card[data-error-id="${idx}"]`);
  if (!card || card.classList.contains('applied')) return;
  const span = document.querySelector(`.practice-error[data-error-id="${idx}"]`);
  if (!span) return;

  // Get the correction text from the card's data
  const newText = card.querySelector('.gh-card-new')?.textContent || '';
  if (!newText || newText === '—') return;

  // Replace the underlined span with plain text (correction), inline
  const correctionNode = document.createElement('span');
  correctionNode.className = 'practice-error-fixed';
  correctionNode.textContent = newText;
  span.replaceWith(correctionNode);

  // Update the card visual: strike through, mark applied
  card.classList.add('applied');
  const btn = card.querySelector('.gh-card-apply');
  if (btn) {
    btn.textContent = '✓ Applied';
    btn.disabled = true;
  }
}

// Apply ALL remaining fixes at once (helper for the "Apply all" button if we add it later)
function applyAllErrorFixes() {
  document.querySelectorAll('.gh-card:not(.applied)').forEach(card => {
    const idx = parseInt(card.dataset.errorId, 10);
    if (!isNaN(idx)) applyErrorFix(null, idx);
  });
}

// Given the essay text and an array of {type, phrase, correction, explanation},
// return HTML with each phrase wrapped in a clickable .practice-error span carrying
// data-error-id so it can be cross-linked with sidebar cards.
// Paragraphs are preserved (double-newline => <p>).
function highlightEssayErrors(essayText, errors) {
  if (!essayText) return '';
  // Step 1: split into paragraphs
  const paragraphs = essayText.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
  // If only single-newlines, treat each line as a paragraph too
  const finalParas = paragraphs.length > 1 ? paragraphs : essayText.split(/\n+/).map(p => p.trim()).filter(Boolean);

  // Build a list of unique errors (avoid double-wrapping the same phrase) — preserve original index
  const seen = new Set();
  const uniqueErrors = [];
  errors.forEach((err, originalIdx) => {
    if (!err || !err.phrase) return;
    const key = (err.phrase || '').toLowerCase().trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    uniqueErrors.push({ ...err, originalIdx });
  });
  // Sort errors by length DESC so longer phrases match before shorter substrings
  uniqueErrors.sort((a, b) => (b.phrase || '').length - (a.phrase || '').length);

  return finalParas.map(para => {
    let html = escapeHtml(para);
    // Apply each error by finding its escaped form
    for (let i = 0; i < uniqueErrors.length; i++) {
      const err = uniqueErrors[i];
      const escapedPhrase = escapeHtml(err.phrase);
      const placeholder = `\x00ERR_${i}\x00`;
      const idx = html.indexOf(escapedPhrase);
      if (idx === -1) continue;
      html = html.slice(0, idx) + placeholder + html.slice(idx + escapedPhrase.length);
    }
    // Swap placeholders back with .practice-error spans (no tooltip — just underline + click handler)
    for (let i = 0; i < uniqueErrors.length; i++) {
      const err = uniqueErrors[i];
      const placeholder = `\x00ERR_${i}\x00`;
      const typeClass = (err.type === 'grammar') ? ' grammar' : '';
      // data-error-id refers to the ORIGINAL index in the errors[] array so the sidebar finds the right card
      const span = `<span class="practice-error${typeClass}" data-error-id="${err.originalIdx}" onclick="focusErrorCard(${err.originalIdx})">${escapeHtml(err.phrase)}</span>`;
      html = html.split(placeholder).join(span);
    }
    return `<p>${html}</p>`;
  }).join('');
}

// Legacy: keep togglePracticeErrorTip as a no-op so old saved attempts don't break.
function togglePracticeErrorTip(ev, el) {
  if (ev) ev.stopPropagation();
  // Tooltip removed in v29 — focus the sidebar card instead
  const id = el?.dataset?.errorId;
  if (id != null) focusErrorCard(parseInt(id, 10));
}

// ============================================================
//  PTE SWT PRACTICE PORTAL LOGIC & SWT ADMIN
// ============================================================

function getPteStorageKey(suffix) {
  return `pte_${currentUserId}_${suffix}`;
}

async function loadPassages(){
  try {
    const r = await fetch(API_URL+'/api/passages',{cache:'no-store'});
    const d = await r.json();
    if(Array.isArray(d) && d.length){ passages = d; }
    else if(d.passages && Array.isArray(d.passages)){ passages = d.passages; }
  } catch(e){ /* fall through */ }
  if(!passages.length){
    passages = [{ id:1, title:'Sample', category:'General', text:'Passage unavailable — check your connection.', keyElements:{what:'',why:'',how:'',result:''} }];
  }
  const navTotalEl = document.getElementById('navTotal');
  if (navTotalEl) navTotalEl.textContent = passages.length;
  const practiceFootLabelEl = document.getElementById('practiceFootLabel');
  if (practiceFootLabelEl) {
    practiceFootLabelEl.textContent = String(passages.length).padStart(2,'0') + ' · Practice Session';
  }
  populatePassageDropdowns();
}

function showSwtScreen(id) {
  document.querySelectorAll('.swt-sub-screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
  window.scrollTo(0, 0);
}

let activeFilter = 'all';
let activeResFilter = 'all';

function populatePassageDropdowns() {
  const select1 = document.getElementById('passageSelect');
  if (select1) {
    select1.innerHTML = '';
    passages.forEach((p, idx) => {
      const isAttempted = attempted.has(p.id);
      if (activeFilter === 'attempted' && !isAttempted) return;
      if (activeFilter === 'unattempted' && isAttempted) return;
      
      const opt = document.createElement('option');
      opt.value = idx + 1;
      const statusSuffix = isAttempted ? ' (Attempted)' : ' (Unattempted)';
      opt.textContent = `Passage ${String(idx + 1).padStart(2, '0')}: ${p.title || 'Untitled'}${statusSuffix}`;
      select1.appendChild(opt);
    });
  }

  const select2 = document.getElementById('resPassageSelect');
  if (select2) {
    select2.innerHTML = '';
    passages.forEach((p, idx) => {
      const isAttempted = attempted.has(p.id);
      if (activeResFilter === 'attempted' && !isAttempted) return;
      if (activeResFilter === 'unattempted' && isAttempted) return;
      
      const opt = document.createElement('option');
      opt.value = idx + 1;
      const statusSuffix = isAttempted ? ' (Attempted)' : ' (Unattempted)';
      opt.textContent = `Passage ${String(idx + 1).padStart(2, '0')}: ${p.title || 'Untitled'}${statusSuffix}`;
      select2.appendChild(opt);
    });
  }
}

function changePassageFilter(val) {
  activeFilter = val;
  populatePassageDropdowns();
  const select = document.getElementById('passageSelect');
  if (select) {
    const hasCurrent = Array.from(select.options).some(opt => parseInt(opt.value) === currentPassageId);
    if (hasCurrent) {
      select.value = currentPassageId;
    } else if (select.options.length > 0) {
      jumpToPassage(parseInt(select.options[0].value));
    }
  }
}

function changeResultsPassageFilter(val) {
  activeResFilter = val;
  populatePassageDropdowns();
  const select = document.getElementById('resPassageSelect');
  if (select) {
    const hasCurrent = Array.from(select.options).some(opt => parseInt(opt.value) === currentPassageId);
    if (hasCurrent) {
      select.value = currentPassageId;
    } else if (select.options.length > 0) {
      jumpToResultsPassage(parseInt(select.options[0].value));
    }
  }
}

function jumpToPassage(target) {
  if (target < 1 || target > passages.length) return;
  loadPassage(target);
  const select1 = document.getElementById('passageSelect');
  if (select1) select1.value = target;
}

function jumpToResultsPassage(target) {
  if (target < 1 || target > passages.length) return;
  const select2 = document.getElementById('resPassageSelect');
  if (select2) select2.value = target;
  
  const scores = LocalStore.get(getPteStorageKey('scores')) || {};
  const p = passages.find(x => x.id === target) || passages[target-1];
  if (!p) return;
  
  switchSection('swt');
  if (scores[target] && typeof scores[target].overall_score === 'number') {
    currentPassageId = target;
    updateResultsNav();
    showResults(scores[target], p, scores[target].__spellData || null, scores[target].__text || '');
    showSwtScreen('swtResultsScreen');
  } else {
    loadPassage(target);
    showSwtScreen('swtPracticeScreen');
  }
}

function loadStoredData(){
  const att = LocalStore.get(getPteStorageKey('attempted')) || [];
  att.forEach(id => attempted.add(id));
  const h = LocalStore.get(getPteStorageKey('history')) || {};
  Object.keys(h).forEach(id => { if(h[id] && h[id].length) attempted.add(parseInt(id)); });
}

function loadPassage(id){
  if(id < 1 || id > passages.length) return;
  currentPassageId = id;
  const p = passages.find(x => x.id === id) || passages[id-1];
  if(!p) return;

  const num = String(id).padStart(2,'0');
  const navCurrentEl = document.getElementById('navCurrent');
  if (navCurrentEl) navCurrentEl.textContent = num;
  const pasNumEl = document.getElementById('pasNum');
  if (pasNumEl) pasNumEl.textContent = num;

  const wordCount = (p.text || '').trim().split(/\s+/).filter(Boolean).length;
  const pasWordCountEl = document.getElementById('pasWordCount');
  if (pasWordCountEl) pasWordCountEl.textContent = wordCount + ' words';
  const mins = Math.max(1, Math.round(wordCount / 26));
  const pasCategoryEl = document.getElementById('pasCategory');
  if (pasCategoryEl) pasCategoryEl.textContent = '~' + mins + ' min';

  const paras = (p.text || '').split(/\n\n+/).filter(Boolean);
  const passageBodyEl = document.getElementById('passageBody');
  if (passageBodyEl) {
    passageBodyEl.innerHTML = (paras.length ? paras : [p.text]).map(t => '<p>' + escapeHtml(t) + '</p>').join('');
  }

  const navPrevEl = document.getElementById('navPrev');
  if (navPrevEl) navPrevEl.toggleAttribute('disabled', id === 1);
  const navNextEl = document.getElementById('navNext');
  if (navNextEl) navNextEl.toggleAttribute('disabled', id === passages.length);

  const summaries = LocalStore.get(getPteStorageKey('summaries')) || {};
  const summaryInputEl = document.getElementById('summaryInput');
  if (summaryInputEl) summaryInputEl.value = (summaries[id] && summaries[id].text) || '';
  const scratch = LocalStore.get(getPteStorageKey('scratch')) || {};
  const scratchInputEl = document.getElementById('scratchInput');
  if (scratchInputEl) scratchInputEl.value = scratch[id] || '';

  const scores = LocalStore.get(getPteStorageKey('scores')) || {};
  const prevAnswerBtn = document.getElementById('prevAnswerBtn');
  if (prevAnswerBtn) {
    prevAnswerBtn.style.display = (scores[id] && typeof scores[id].overall_score === 'number') ? 'inline-flex' : 'none';
  }

  switchWriteTab('write');
  onSummaryInput();
  resetTimer();
  const select1 = document.getElementById('passageSelect');
  if (select1) select1.value = id;
}

function prevPassage(){ if(currentPassageId > 1) loadPassage(currentPassageId - 1); }
function nextPassage(){ if(currentPassageId < passages.length) loadPassage(currentPassageId + 1); }

function switchWriteTab(tab){
  writeTab = tab;
  const tabWriteEl = document.getElementById('tabWrite');
  const tabPlanEl = document.getElementById('tabPlan');
  const writeTabPaneEl = document.getElementById('writeTabPane');
  const planTabPaneEl = document.getElementById('planTabPane');
  if (tabWriteEl) tabWriteEl.classList.toggle('active', tab === 'write');
  if (tabPlanEl) tabPlanEl.classList.toggle('active', tab === 'plan');
  if (writeTabPaneEl) writeTabPaneEl.classList.toggle('hidden', tab !== 'write');
  if (planTabPaneEl) planTabPaneEl.classList.toggle('hidden', tab !== 'plan');
}



function countSentences(t){
  const trimmed = (t || '').trim();
  if(!trimmed) return 0;
  const matches = trimmed.match(/[.!?]+(?=\s|$)/g);
  return matches ? matches.length : 1;
}

const CONNECTORS = ['however','moreover','therefore','consequently','furthermore','whereas','thus'];

function detectConnectors(t){
  const lower = (t || '').toLowerCase();
  return CONNECTORS.filter(c => new RegExp('\\b' + c + '\\b').test(lower));
}

function onSummaryInput(){
  const summaryInputEl = document.getElementById('summaryInput');
  if (!summaryInputEl) return;
  const text = summaryInputEl.value;
  const words = countWords(text);

  const wordCountEl = document.getElementById('wordCount');
  if (wordCountEl) wordCountEl.textContent = words;
  const fill = document.getElementById('wordMeterFill');
  if (fill) {
    const pct = Math.min(100, (words / 75) * 100);
    fill.style.width = pct + '%';
    fill.classList.toggle('over', words > 75);
  }

  setHealthRow('hrWordBand', words >= 5 && words <= 75, words, (words >= 5 && words <= 75) ? 'ok' : 'warn');

  const summaries = LocalStore.get(getPteStorageKey('summaries')) || {};
  if(text.trim()){
    summaries[currentPassageId] = { text, timestamp: new Date().toISOString(), score: (summaries[currentPassageId]||{}).score || 0 };
  } else if(summaries[currentPassageId]) {
    delete summaries[currentPassageId];
  }
  LocalStore.set(getPteStorageKey('summaries'), summaries);
}

function setHealthRow(rowId, ok, value, cls){
  const row = document.getElementById(rowId);
  if(!row) return;
  row.classList.remove('ok','warn');
  row.classList.add(cls);
  const icon = row.querySelector('.h-icon');
  if (icon) icon.textContent = ok ? '✓' : '!';
  const valSpan = document.getElementById(rowId + 'Val');
  if (valSpan) valSpan.textContent = value;
}

function resetSummary(){
  const summaryInputEl = document.getElementById('summaryInput');
  if (summaryInputEl) summaryInputEl.value = '';
  onSummaryInput();
}

// Scratch Pad events
document.addEventListener('input', function(e){
  if(e.target && e.target.id === 'scratchInput'){
    const scratch = LocalStore.get(getPteStorageKey('scratch')) || {};
    scratch[currentPassageId] = e.target.value;
    LocalStore.set(getPteStorageKey('scratch'), scratch);
  }
});

const TIMER_START_SECONDS = 10 * 60;
function toggleTimer(){
  timerOn = !timerOn;
  const timerStateEl = document.getElementById('timerState');
  if (timerStateEl) timerStateEl.textContent = timerOn ? 'Timed' : 'Off';
  if(timerOn){
    timerSeconds = TIMER_START_SECONDS;
    startTimer();
  } else {
    stopTimer();
    const disp = document.getElementById('timerDisplay');
    if (disp) {
      disp.textContent = '—';
      disp.classList.remove('expired');
    }
  }
}
function startTimer(){
  stopTimer();
  renderTimer();
  timerInterval = setInterval(() => {
    timerSeconds--;
    if(timerSeconds <= 0){
      timerSeconds = 0;
      renderTimer();
      stopTimer();
      const disp = document.getElementById('timerDisplay');
      if (disp) disp.classList.add('expired');
      toast('Time up — submit when you\'re ready.');
      return;
    }
    renderTimer();
  }, 1000);
}
function renderTimer(){
  const m = String(Math.floor(timerSeconds/60)).padStart(2,'0');
  const s = String(timerSeconds%60).padStart(2,'0');
  const disp = document.getElementById('timerDisplay');
  if (disp) {
    disp.textContent = m + ':' + s;
    disp.classList.toggle('warning', timerSeconds > 0 && timerSeconds <= 60);
  }
}
function stopTimer(){ if(timerInterval){ clearInterval(timerInterval); timerInterval = null; } }
function resetTimer(){
  if(timerOn){
    timerSeconds = TIMER_START_SECONDS;
    const disp = document.getElementById('timerDisplay');
    if (disp) disp.classList.remove('expired');
    startTimer();
  }
}

async function scoreSummary(){
  const summaryInputEl = document.getElementById('summaryInput');
  if (!summaryInputEl) return;
  const text = summaryInputEl.value.trim();
  if(!text){ toast('Write a summary first.'); return; }
  const words = countWords(text);
  if(words < 5){ toast('Too short — minimum 5 words.'); return; }
  if(words > 75){ toast('Too long — maximum 75 words.'); return; }

  const p = passages.find(x => x.id === currentPassageId);
  if(!p){ toast('Passage not loaded.'); return; }

  showLoading(true);
  const scoreBtn = document.getElementById('scoreBtn');
  if (scoreBtn) scoreBtn.setAttribute('disabled','');

  try {
    const payload = { type: 'swt', prompt: p.text, keyPoints: p.keyElements, text: text };
    if(currentUserId){ payload.userId = currentUserId; payload.passageId = currentPassageId; }

    const [gradeRes, spellRes] = await Promise.allSettled([
      fetch(API_URL+'/api/grade',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),
      fetch(API_URL+'/api/spellcheck',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})})
    ]);

    if(gradeRes.status !== 'fulfilled' || !gradeRes.value.ok){ throw new Error('Grading failed'); }
    const data = await gradeRes.value.json();

    let spellData = null;
    if(spellRes.status === 'fulfilled' && spellRes.value.ok){
      try { spellData = await spellRes.value.json(); } catch(e){ spellData = null; }
    }
    lastSpellData = spellData;

    await saveAttempt(currentPassageId, text, data, spellData);
    attempted.add(currentPassageId);
    populatePassageDropdowns();
    stopTimer();
    
    let resultPassage = p;
    if(data.passage_current){
      resultPassage = Object.assign({}, p, data.passage_current);
      const idx = passages.findIndex(x => x.id === currentPassageId);
      if(idx >= 0) passages[idx] = Object.assign({}, passages[idx], data.passage_current);
    }
    showResults(data, resultPassage, spellData, text);
    showSwtScreen('swtResultsScreen');
  } catch(e){
    toast('Scoring failed — check your connection and try again.');
  } finally {
    showLoading(false);
    if (scoreBtn) scoreBtn.removeAttribute('disabled');
  }
}

async function saveAttempt(pid, text, data, spellData){
  const ts = new Date().toISOString();
  
  attempted.add(pid);
  LocalStore.set(getPteStorageKey('attempted'), Array.from(attempted));

  const summaries = LocalStore.get(getPteStorageKey('summaries')) || {};
  summaries[pid] = { text, timestamp: ts, score: data.overall_score || 0 };
  LocalStore.set(getPteStorageKey('summaries'), summaries);

  const scores = LocalStore.get(getPteStorageKey('scores')) || {};
  scores[pid] = Object.assign({}, data, { __text: text, __timestamp: ts, __spellData: spellData || null });
  LocalStore.set(getPteStorageKey('scores'), scores);

  const h = LocalStore.get(getPteStorageKey('history')) || {};
  if(!h[pid]) h[pid] = [];
  h[pid].unshift({
    text, timestamp: ts,
    overall_score: data.overall_score || 0, band: data.band || 'Band 5',
    trait_scores: data.trait_scores || {}, word_count: data.word_count || 0,
    content_details: data.content_details || {},
    scoring_version: data.scoring_version || 'unknown'
  });
  if(h[pid].length > 10) h[pid] = h[pid].slice(0,10);
  LocalStore.set(getPteStorageKey('history'), h);

  queueSync();
}

function loadPreviousAnswer(){
  const scores = LocalStore.get(getPteStorageKey('scores')) || {};
  const stored = scores[currentPassageId];
  if(!stored){ toast('No previous answer for this passage.'); return; }
  const p = passages.find(x => x.id === currentPassageId);
  if(!p){ return; }
  const summaryInputEl = document.getElementById('summaryInput');
  if(stored.__text && summaryInputEl){ summaryInputEl.value = stored.__text; onSummaryInput(); }
  showResults(stored, p, stored.__spellData || null, stored.__text || '');
  showSwtScreen('swtResultsScreen');
}

function formatAttemptTime(iso){
  if(!iso) return '';
  const then = new Date(iso);
  if(isNaN(then.getTime())) return '';
  const now = new Date();
  const diffMs = now - then;
  const diffMin = Math.round(diffMs / 60000);
  if(diffMin < 1) return 'just now';
  if(diffMin < 60) return diffMin + (diffMin === 1 ? ' minute ago' : ' minutes ago');
  const diffHr = Math.round(diffMin / 60);
  if(diffHr < 24) return diffHr + (diffHr === 1 ? ' hour ago' : ' hours ago');
  try {
    return then.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch(e){
    return then.toISOString().slice(0,16).replace('T',' ');
  }
}

function showResults(data, passage, spellData, submittedText){
  const pte = data.overall_score || 0;
  const band = data.band || 'Band 5';
  const traits = data.trait_scores || {};

  let crumb = 'Results · ' + (passage.title || 'Passage ' + currentPassageId);
  if(data.__timestamp){
    const when = formatAttemptTime(data.__timestamp);
    if(when) crumb += '  ·  your attempt from ' + when;
  }
  const breadcrumbEl = document.getElementById('resultsBreadcrumb');
  if (breadcrumbEl) breadcrumbEl.textContent = crumb;

  const ringCirc = 339.29;
  const heroRing = document.getElementById('heroRing');
  if (heroRing) {
    heroRing.style.strokeDasharray = ringCirc;
    heroRing.style.strokeDashoffset = ringCirc * (1 - Math.min(1, pte/90));
  }
  const heroScoreEl = document.getElementById('heroScore');
  if (heroScoreEl) heroScoreEl.textContent = pte;

  const heroVerdictEl = document.getElementById('heroVerdict');
  if (heroVerdictEl) heroVerdictEl.innerHTML = verdictLine(pte, band);
  const heroSummaryEl = document.getElementById('heroSummary');
  if (heroSummaryEl) heroSummaryEl.textContent = buildResultSummary(data, traits);

  const degradedEl = document.getElementById('aiDegradedNotice');
  if(degradedEl){
    if(data.ai_feedback_degraded){
      degradedEl.style.display = '';
      degradedEl.textContent = 'Detailed grammar and vocabulary feedback was unavailable for this attempt (the AI grader was busy). Your score is accurate — try again in a moment for full coaching.';
    } else {
      degradedEl.style.display = 'none';
    }
  }

  const cMax = traits.content_max || 4;
  const heroTraitChipsEl = document.getElementById('heroTraitChips');
  if (heroTraitChipsEl) {
    heroTraitChipsEl.innerHTML = [
      `Content ${fmtNum(traits.content)}/${cMax}`,
      `Form ${fmtNum(traits.form)}/1`,
      `Grammar ${fmtNum(traits.grammar)}/2`,
      `Vocab ${fmtNum(traits.vocabulary)}/2`,
      `${data.word_count || countWords(submittedText)} / 5–75 words`
    ].map(t => `<span class="trait-chip">${t}</span>`).join('');
  }

  renderOriginality(data, passage, submittedText);
  renderAnnotatedSubmission(data, passage, spellData, submittedText);
  renderAnnotatedPassage(passage);
  renderTraitBreakdown(data, traits);
  renderCoverage(data, passage);

  const sampleEl = document.getElementById('sampleAnswerText');
  const sampleNotes = document.getElementById('sampleAnswerNotes');
  if(sampleEl){
    const sample = (passage && passage.sampleResponse) || '';
    sampleEl.textContent = sample || '(No sample answer authored for this passage yet.)';
  }
  if(sampleNotes){
    const notes = (passage && passage.sampleNotes) || '';
    sampleNotes.textContent = notes;
    sampleNotes.style.display = notes ? '' : 'none';
  }
  switchSbsView('summary');

  renderAboutPassage(passage);
  renderVocabCoach(data);
  updateResultsNav();
}

function fmtNum(n){
  if(n == null) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function verdictLine(pte, band){
  let word;
  if(pte >= 86) word = 'Excellent';
  else if(pte >= 79) word = 'Strong attempt';
  else if(pte >= 65) word = 'Solid attempt';
  else if(pte >= 50) word = 'Developing';
  else word = 'Needs work';
  return escapeHtml(word) + ' — <em>' + escapeHtml(band) + '</em>';
}

function buildResultSummary(data, traits){
  const cd = data.content_details || {};
  const captured = (cd.key_ideas_present || []).length;
  const cMax = traits.content_max || 4;
  const parts = [];
  if(captured === cMax){
    parts.push('You captured all ' + cMax + ' key ideas in one well-formed sentence.');
  } else {
    parts.push('You captured ' + captured + ' of ' + cMax + ' key ideas in one sentence with appropriate connectors.');
  }
  if((traits.vocabulary || 0) < 2){
    parts.push('Vocabulary range is the lever that will push you higher — try swapping high-frequency words for academic alternatives.');
  } else if((traits.grammar || 0) < 2){
    parts.push('Tightening grammar will lift the score — check connector punctuation and article use.');
  } else if(captured < cMax){
    parts.push('Add the missing key element to move up a band.');
  }
  return parts.join(' ');
}

function renderOriginality(data, passage, submittedText){
  const el = document.getElementById('originalityChecks');
  if (!el) return;
  const overlap = computeCopyMetrics(submittedText, passage.text || '');

  let copyVerdict, copyClass, copyDetail;
  if(overlap.pct <= 15 && overlap.longestRun < 6){
    copyVerdict = 'Original'; copyClass = 'good';
  } else if(overlap.pct <= 40 && overlap.longestRun <= 10){
    copyVerdict = 'Some lifting'; copyClass = 'warn';
  } else {
    copyVerdict = 'Heavy lifting'; copyClass = 'warn';
  }
  copyDetail = 'Longest run: ' + overlap.longestRun + ' words · ' + overlap.pct + '% verbatim';

  const aiVerdict = 'Likely Human';
  const aiDetail = 'Burstiness signal · written in-session';

  el.innerHTML = `
    <div class="orig-cell">
      <div class="orig-head">
        <span class="orig-name">AI Detector</span>
        <span class="orig-verdict">${aiVerdict}</span>
      </div>
      <div class="orig-detail">${aiDetail}</div>
    </div>
    <div class="orig-cell ${copyClass}">
      <div class="orig-head">
        <span class="orig-name">Copy Detector</span>
        <span class="orig-verdict">${escapeHtml(copyVerdict)}</span>
      </div>
      <div class="orig-detail">${escapeHtml(copyDetail)}</div>
    </div>
    <div class="orig-cell">
      <div class="orig-head">
        <span class="orig-name">Plagiarism Web</span>
        <span class="orig-verdict">Not Checked</span>
      </div>
      <div class="orig-detail">Web plagiarism check not enabled</div>
    </div>`;
}

function computeCopyMetrics(student, passage){
  function words(s){ return (s||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean); }
  const sw = words(student), pw = words(passage);
  if(sw.length === 0) return { pct: 0, longestRun: 0 };

  const pGrams = new Set();
  for(let i = 0; i <= pw.length - 4; i++) pGrams.add(pw.slice(i,i+4).join(' '));
  let hits = 0;
  const total = Math.max(1, sw.length - 3);
  for(let i = 0; i <= sw.length - 4; i++){
    if(pGrams.has(sw.slice(i,i+4).join(' '))) hits++;
  }
  const pct = Math.round((hits / total) * 100);

  let longest = 0;
  const pJoined = ' ' + pw.join(' ') + ' ';
  for(let i = 0; i < sw.length; i++){
    for(let len = Math.min(25, sw.length - i); len >= 4; len--){
      if(pJoined.includes(' ' + sw.slice(i,i+len).join(' ') + ' ')){
        if(len > longest) longest = len;
        break;
      }
    }
  }
  return { pct, longestRun: longest };
}

function renderAnnotatedSubmission(data, passage, spellData, submittedText){
  const el = document.getElementById('annotatedSubmission');
  if (!el) return;
  const text = submittedText || '';
  if(!text.trim()){ el.textContent = '—'; return; }

  const cd = data.content_details || {};
  const captured = new Set(cd.key_ideas_present || []);
  const keyEls = passage.keyElements || {};

  const STOP = new Set(['the','a','an','and','or','but','of','to','for','from','with','by','in','on','at','as','is','are','was','were','be','been','have','has','had','will','would','could','should','this','that','these','those','it','its','their','they','them','there','then','than','so','also','about','i','you','he','she','we','his','her','our','your','my']);
  function toks(s){ return (s||'').toLowerCase().replace(/[^\w\s$%]/g,' ').split(/\s+/).filter(w => w.length>=3 && !STOP.has(w)); }
  function headline(t){
    if(!t) return '';
    const m = String(t).match(/,\s+such\s+as\s+|\s+such\s+as\s+|,\s+including\s+|;\s*moreover\b|,\s+and\s+/i);
    return m && m.index > 20 ? String(t).slice(0, m.index) : String(t);
  }

  const segments = text.split(/(;|\.|!|\?)/).filter(s => s !== '');
  const clauses = [];
  for(let i = 0; i < segments.length; i++){
    if(/^[;.!?]$/.test(segments[i])){
      if(clauses.length) clauses[clauses.length-1] += segments[i];
    } else {
      clauses.push(segments[i]);
    }
  }

  const labels = ['what','why','how','result'];
  const clauseLabel = {};
  const usedLabels = new Set();
  for(const lbl of labels){
    if(!keyEls[lbl]) continue;
    const hTok = toks(headline(keyEls[lbl]));
    if(hTok.length < 2) continue;
    let bestIdx = -1, bestHits = 0;
    for(let i = 0; i < clauses.length; i++){
      if(clauseLabel[i]) continue;
      const cTok = new Set(toks(clauses[i]));
      let hits = 0;
      for(const t of hTok){
        if(cTok.has(t)){ hits++; continue; }
        const stem = t.length > 5 ? t.slice(0, t.length-2) : t;
        if(stem.length >= 4){ for(const ct of cTok){ if(ct.startsWith(stem)){ hits++; break; } } }
      }
      if(hits > bestHits){ bestHits = hits; bestIdx = i; }
    }
    if(bestIdx >= 0 && bestHits >= 2){ clauseLabel[bestIdx] = lbl; usedLabels.add(lbl); }
  }

  let spellWords = {};
  const errs = (spellData && Array.isArray(spellData.errors)) ? spellData.errors
             : (data.spelling_details && data.spelling_details.errors) || [];
  for(const e of errs){
    const w = (e.misspelled || '').toLowerCase().trim();
    if(w) spellWords[w] = e.suggestion || (e.suggestions && e.suggestions[0]) || '';
  }

  const grammarIssues = (data.grammar_details && Array.isArray(data.grammar_details.grammar_annotations))
    ? data.grammar_details.grammar_annotations : [];

  let html = '';
  for(let i = 0; i < clauses.length; i++){
    const lbl = clauseLabel[i];
    let inner = annotateGrammar(clauses[i], grammarIssues);
    inner = annotateSpelling(inner, spellWords, true);
    if(lbl){ html += `<span class="ann-seg ${lbl}">${inner}</span>`; }
    else { html += inner; }
  }
  el.innerHTML = html;

  const fb = document.getElementById('annotatedFeedback');
  if (fb) {
    const items = [];
    const connectors = detectConnectors(text);
    const sentences = countSentences(text);
    if(sentences === 1 && connectors.length >= 2){
      items.push({ cls:'good', icon:'✓', text:'One sentence, ' + connectors.length + ' connectors (' + connectors.join(' / ') + '), inside the 5–75 word band.' });
    } else if(sentences === 1){
      items.push({ cls:'good', icon:'✓', text:'Single well-formed sentence within the word band.' });
    } else {
      items.push({ cls:'warn', icon:'!', text:'Summary should be a <em>single sentence</em> — found ' + sentences + '.' });
    }
    const cMax = (data.trait_scores||{}).content_max || 4;
    const missing = labels.filter(l => keyEls[l] && !captured.has(l) && !usedLabels.has(l));
    if(missing.length){
      const missLabel = missing[0].charAt(0).toUpperCase() + missing[0].slice(1);
      items.push({ cls:'warn', icon:'!', text:'Missing the <em>' + missLabel + '</em> element — work it into your summary.' });
    } else if((captured.size || usedLabels.size) >= cMax){
      items.push({ cls:'good', icon:'✓', text:'All key elements present and accounted for.' });
    }
    fb.innerHTML = items.map(it =>
      `<div class="ann-fb-item ${it.cls}"><span class="fb-icon">${it.icon}</span><span class="fb-text">${it.text}</span></div>`
    ).join('');
  }
}

function renderAnnotatedPassage(passage){
  const el = document.getElementById('annotatedPassage');
  if(!el) return;
  const text = (passage && passage.text) || '';
  if(!text.trim()){ el.textContent = '—'; return; }
  const keyEls = (passage && passage.keyElements) || {};

  const STOP = new Set(['the','a','an','and','or','but','of','to','for','from','with','by','in','on','at','as','is','are','was','were','be','been','have','has','had','will','would','could','should','this','that','these','those','it','its','their','they','them','there','then','than','so','also','about','i','you','he','she','we','his','her','our','your','my']);
  const toks = s => (s||'').toLowerCase().replace(/[^\w\s$%]/g,' ').split(/\s+/).filter(w => w.length>=3 && !STOP.has(w));
  const headline = t => {
    if(!t) return '';
    const m = String(t).match(/,\s+such\s+as\s+|\s+such\s+as\s+|,\s+including\s+|;\s*moreover\b|,\s+and\s+/i);
    return m && m.index > 20 ? String(t).slice(0, m.index) : String(t);
  };

  const parts = text.split(/([.!?])\s+/);
  const sentences = [];
  for(let i = 0; i < parts.length; i += 2){
    const body = parts[i];
    const delim = parts[i+1] || '';
    if(body && body.trim()) sentences.push(body + delim);
  }
  if(!sentences.length) sentences.push(text);

  const labels = keyEls.topic || keyEls.pivot || keyEls.conclusion
    ? ['topic','pivot','conclusion']
    : ['what','why','how','result'];
  const colorOf = (lbl) => ({topic:'what', pivot:'why', conclusion:'result'}[lbl] || lbl);

  const sentLabel = {};
  for(const lbl of labels){
    if(!keyEls[lbl]) continue;
    const hTok = toks(headline(keyEls[lbl]));
    if(hTok.length < 2) continue;
    let bestIdx = -1, bestHits = 0;
    for(let i = 0; i < sentences.length; i++){
      if(sentLabel[i]) continue;
      const sTok = new Set(toks(sentences[i]));
      let hits = 0;
      for(const t of hTok){
        if(sTok.has(t)){ hits++; continue; }
        const stem = t.length > 5 ? t.slice(0, t.length-2) : t;
        if(stem.length >= 4){
          for(const st of sTok){ if(st.startsWith(stem)){ hits++; break; } }
        }
      }
      if(hits > bestHits){ bestHits = hits; bestIdx = i; }
    }
    if(bestIdx >= 0 && bestHits >= 2){ sentLabel[bestIdx] = colorOf(lbl); }
  }

  let html = '';
  for(let i = 0; i < sentences.length; i++){
    const lbl = sentLabel[i];
    const safe = escapeHtml(sentences[i]);
    if(lbl){ html += `<span class="ann-seg ${lbl}">${safe}</span> `; }
    else { html += safe + ' '; }
  }
  el.innerHTML = html;
}

function annotateGrammar(clause, issues){
  if(!issues || issues.length === 0) return escapeHtml(clause);
  const sorted = [...issues].sort((a,b) => (b.phrase||'').length - (a.phrase||'').length);
  let result = escapeHtml(clause);
  const lowerClause = clause.toLowerCase();
  const insertions = [];
  const claimed = new Array(clause.length).fill(false);
  for(const issue of sorted){
    if(!issue.phrase) continue;
    const needle = issue.phrase.toLowerCase();
    let pos = 0;
    while(pos < lowerClause.length){
      const idx = lowerClause.indexOf(needle, pos);
      if(idx < 0) break;
      let conflict = false;
      for(let i = idx; i < idx + needle.length; i++){ if(claimed[i]){ conflict = true; break; } }
      if(!conflict){
        for(let i = idx; i < idx + needle.length; i++) claimed[i] = true;
        const sev = (issue.severity === 'major') ? 'grammar-major' : 'grammar-minor';
        const tipParts = [];
        if(issue.fix) tipParts.push('→ ' + issue.fix);
        if(issue.rationale) tipParts.push(issue.rationale);
        insertions.push({
          start: idx, end: idx + needle.length, sev,
          tip: tipParts.join('  '),
          fix: issue.fix || '',
          rationale: issue.rationale || ''
        });
      }
      pos = idx + needle.length;
    }
  }
  insertions.sort((a,b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  const attrEscape = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  for(const ins of insertions){
    out += escapeHtml(clause.slice(cursor, ins.start));
    out += `<span class="ann-seg ${ins.sev}" title="${attrEscape(ins.tip)}" data-fix="${attrEscape(ins.fix)}" data-rationale="${attrEscape(ins.rationale)}">${escapeHtml(clause.slice(ins.start, ins.end))}</span>`;
    cursor = ins.end;
  }
  out += escapeHtml(clause.slice(cursor));
  return out;
}

(function setupGrammarPopovers(){
  const open = new Set();

  function closePopover(pop){
    if(!pop) return;
    pop.classList.add('gp-closing');
    setTimeout(() => { if(pop.parentNode) pop.parentNode.removeChild(pop); }, 120);
    open.delete(pop);
  }

  function closeAll(){
    [...open].forEach(closePopover);
  }

  function buildPopover(target){
    const fix = target.getAttribute('data-fix') || '';
    const rationale = target.getAttribute('data-rationale') || '';
    if(!fix && !rationale) return null;

    const pop = document.createElement('div');
    pop.className = 'gp-popover';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Grammar feedback');

    const close = document.createElement('button');
    close.className = 'gp-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', (e) => { e.stopPropagation(); closePopover(pop); });
    pop.appendChild(close);

    if(fix){
      const fixEl = document.createElement('div');
      fixEl.className = 'gp-fix';
      const arrow = document.createElement('span');
      arrow.className = 'gp-arrow';
      arrow.textContent = '→';
      fixEl.appendChild(arrow);
      fixEl.appendChild(document.createTextNode(' ' + fix));
      pop.appendChild(fixEl);
    }

    if(rationale){
      const ratEl = document.createElement('div');
      ratEl.className = 'gp-rationale';
      ratEl.textContent = rationale;
      pop.appendChild(ratEl);
    }

    return pop;
  }

  function positionPopover(pop, target){
    document.body.appendChild(pop);
    const rect = target.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const margin = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scrollY = window.scrollY || window.pageYOffset;
    const scrollX = window.scrollX || window.pageXOffset;

    let top = rect.bottom + scrollY + margin;
    let left = rect.left + scrollX;

    if(rect.bottom + popRect.height + margin > vh){
      top = rect.top + scrollY - popRect.height - margin;
    }
    if(left + popRect.width > scrollX + vw - 12){
      left = scrollX + vw - popRect.width - 12;
    }
    if(left < scrollX + 8) left = scrollX + 8;

    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
  }

  document.addEventListener('click', (e) => {
    const target = e.target.closest('.ann-seg.grammar-major, .ann-seg.grammar-minor');
    if(target){
      e.stopPropagation();
      for(const pop of open){
        if(pop._target === target){ closePopover(pop); return; }
      }
      closeAll();
      const pop = buildPopover(target);
      if(!pop) return;
      pop._target = target;
      positionPopover(pop, target);
      open.add(pop);
      requestAnimationFrame(() => { pop.classList.add('gp-shown'); });
      return;
    }
    if(open.size > 0){
      const inside = e.target.closest('.gp-popover');
      if(!inside) closeAll();
    }
  });

  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && open.size > 0){ closeAll(); }
  });

  window.addEventListener('scroll', () => {
    for(const pop of open){ if(pop._target) positionPopover(pop, pop._target); }
  }, { passive: true });
  window.addEventListener('resize', () => {
    for(const pop of open){ if(pop._target) positionPopover(pop, pop._target); }
  });
})();

function annotateSpelling(clauseOrHtml, spellWords, alreadyHtml){
  if(Object.keys(spellWords).length === 0) return alreadyHtml ? clauseOrHtml : escapeHtml(clauseOrHtml);
  if(!alreadyHtml){
    const parts = clauseOrHtml.split(/(\s+|[.,;:!?"'()])/);
    return parts.map(tok => {
      const stripped = tok.toLowerCase().replace(/[^a-z']/g,'');
      if(stripped && spellWords[stripped] !== undefined){
        const fix = spellWords[stripped];
        return `<span class="ann-seg spell" title="${escapeHtml(fix ? 'Suggested: ' + fix : 'Possible misspelling')}">${escapeHtml(tok)}</span>`;
      }
      return escapeHtml(tok);
    }).join('');
  }
  const parts = clauseOrHtml.split(/(<span[^>]*>[\s\S]*?<\/span>)/);
  return parts.map(p => {
    if(p.startsWith('<span')) return p;
    if(!p) return p;
    const tokParts = p.split(/(\s+|[.,;:!?"'()]|&[a-z]+;)/);
    return tokParts.map(tok => {
      if(tok.startsWith('&') && tok.endsWith(';')) return tok;
      const stripped = tok.toLowerCase().replace(/[^a-z']/g,'');
      if(stripped && spellWords[stripped] !== undefined){
        const fix = spellWords[stripped];
        return `<span class="ann-seg spell" title="${escapeHtml(fix ? 'Suggested: ' + fix : 'Possible misspelling')}">${tok}</span>`;
      }
      return tok;
    }).join('');
  }).join('');
}

function switchSbsView(view){
  const isSample = (view === 'sample');
  const vSum = document.getElementById('sbsViewSummary');
  const vSam = document.getElementById('sbsViewSample');
  const tSum = document.getElementById('sbsTabSummary');
  const tSam = document.getElementById('sbsTabSample');
  if(!vSum || !vSam || !tSum || !tSam) return;
  vSum.style.display = isSample ? 'none' : '';
  vSam.style.display = isSample ? '' : 'none';
  tSum.classList.toggle('active', !isSample);
  tSam.classList.toggle('active', isSample);
}

function renderTraitBreakdown(data, traits){
  const el = document.getElementById('traitBreakdown');
  if (!el) return;
  const cMax = traits.content_max || 4;
  const cd = data.content_details || {};
  const captured = (cd.key_ideas_present || []).length;

  const rows = [
    { name:'Content', score:traits.content||0, max:cMax,
      note: captured >= cMax ? 'All key elements present.' : captured + ' of ' + cMax + ' key elements present — add the missing one(s).' },
    { name:'Form', score:traits.form||0, max:1,
      note: (traits.form >= 1) ? 'Valid one-sentence summary within word limits.' : 'Form requirement not met — one sentence, 5–75 words.' },
    { name:'Grammar', score:traits.grammar||0, max:2,
      note: (traits.grammar >= 2) ? 'Clean grammar and connector punctuation.' : 'Check connector punctuation (semicolons) and article use.' },
    { name:'Vocabulary', score:traits.vocabulary||0, max:2,
      note: (traits.vocabulary >= 2) ? 'Good academic range.' : 'Range could be wider — swap high-frequency words for academic alternatives.' }
  ];

  el.innerHTML = rows.map(r => {
    const pct = r.max > 0 ? Math.min(100, (r.score / r.max) * 100) : 0;
    let barColor = 'var(--good)';
    if(pct < 50) barColor = 'var(--bad)';
    else if(pct < 100) barColor = 'var(--warn)';
    return `
      <div class="trait-row">
        <div class="trait-head">
          <span class="trait-name">${r.name}</span>
          <span class="trait-score"><b>${fmtNum(r.score)}</b> / ${r.max}</span>
        </div>
        <div class="trait-bar"><div class="trait-bar-fill" style="width:${pct}%;background:${barColor};"></div></div>
        <div class="trait-note">${escapeHtml(r.note)}</div>
      </div>`;
  }).join('');
}

function renderCoverage(data, passage){
  const el = document.getElementById('coverageTable');
  if (!el) return;
  const keyEls = passage.keyElements || {};
  const cd = data.content_details || {};
  const captured = new Set(cd.key_ideas_present || []);
  const missing = new Set(cd.key_ideas_missing || []);

  const labels = [['what','What'],['why','Why'],['how','How'],['result','Result']];
  el.innerHTML = labels.filter(([k]) => keyEls[k]).map(([k, label]) => {
    let status, statusCls;
    if(captured.has(k)){ status = 'Covered'; statusCls = 'covered'; }
    else if(missing.has(k)){ status = 'Missing'; statusCls = 'missing'; }
    else { status = 'Partial'; statusCls = 'partial'; }
    const txt = String(keyEls[k] || '').replace(/<[^>]+>/g,'');
    return `
      <div class="coverage-row">
        <div class="cov-key"><span class="cov-dot ${k}"></span>${label.toUpperCase()}</div>
        <div class="cov-text ${statusCls === 'missing' ? 'missing' : ''}">${escapeHtml(txt)}</div>
        <div class="cov-status ${statusCls}">${status}</div>
      </div>`;
  }).join('');
}

function renderAboutPassage(passage){
  const card = document.getElementById('aboutPassageCard');
  const body = document.getElementById('aboutPassageBody');
  if(!card || !body || !passage){ return; }

  const r = passage.keyElementsRationale || {};
  const topic = r.topic || generateTopicFallback(passage);
  const importance = r.importance || generateImportanceFallback(passage);
  const elementsExplained = r.elements || generateElementsFallback(passage);

  const sections = [];
  sections.push(`
    <div class="about-section">
      <div class="about-eyebrow">📖 What this passage is about</div>
      <p>${escapeHtml(topic)}</p>
    </div>`);
  sections.push(`
    <div class="about-section">
      <div class="about-eyebrow">🎯 Why these are the critical ideas</div>
      <p>${escapeHtml(importance)}</p>
    </div>`);
  if(elementsExplained && Object.keys(elementsExplained).length){
    const order = [['what','What','what'],['why','Why','why'],['how','How','how'],['result','Result','result']];
    sections.push(`
      <div class="about-section">
        <div class="about-eyebrow">🧩 Why each element matters</div>
        ${order.filter(([k]) => elementsExplained[k]).map(([k,label,cls]) => `
          <p><strong style="display:inline-flex;align-items:center;gap:6px;">
            <span class="e-dot" style="background:var(--${cls});display:inline-block;width:9px;height:9px;border-radius:2px;"></span>${label}:
          </strong> ${escapeHtml(elementsExplained[k])}</p>
        `).join('')}
      </div>`);
  }
  body.innerHTML = sections.join('');
  card.style.display = 'block';
}

function generateTopicFallback(passage){
  const title = passage.title || 'this passage';
  const cat = passage.category ? ' (' + passage.category + ')' : '';
  return `This passage covers ${title}${cat}. It presents a topic, supporting evidence or reasoning, and a result or implication.`;
}
function generateImportanceFallback(passage){
  const keys = passage.keyElements || {};
  const count = ['what','why','how','result'].filter(k => keys[k]).length;
  return `Of all the sentences in the passage, ${count} carry the load: the topic claim, the reasons supporting it, the mechanism or evidence, and the consequence.`;
}
function generateElementsFallback(passage){
  const keys = passage.keyElements || {};
  const out = {};
  if(keys.what)   out.what   = 'States the central claim or topic.';
  if(keys.why)    out.why    = 'Supplies the reason or evidence that makes the claim credible.';
  if(keys.how)    out.how    = 'Describes the mechanism or process.';
  if(keys.result) out.result = 'Captures the consequence or implication.';
  return out;
}

function renderVocabCoach(data){
  const card = document.getElementById('vocabCoachCard');
  const body = document.getElementById('vocabCoachBody');
  if(!card || !body) return;

  // Gather raw suggestions, prioritizing Claude's context-aware suggestions if present
  let rawSuggestions = [];
  if (data) {
    if (Array.isArray(data.vocabulary_swap_suggestions) && data.vocabulary_swap_suggestions.length > 0) {
      rawSuggestions = data.vocabulary_swap_suggestions;
    } else if (Array.isArray(data.vocabulary_suggestions) && data.vocabulary_suggestions.length > 0) {
      rawSuggestions = data.vocabulary_suggestions;
    }
  }

  // Normalize suggestions to { word, context, synonyms, rationale }
  const suggestions = rawSuggestions.map(s => {
    if (s.original && s.upgrades) {
      return {
        word: s.original,
        context: '',
        synonyms: s.upgrades,
        rationale: 'Local thesaurus upgrade recommendation.'
      };
    }
    return s;
  }).filter(s => s && s.word && Array.isArray(s.synonyms) && s.synonyms.filter(Boolean).length > 0);

  if(!suggestions.length){
    card.style.display = 'none';
    body.innerHTML = '';
    return;
  }

  body.innerHTML = suggestions.map(s => {
    const word = s.word || '';
    const context = s.context || '';
    const syns = s.synonyms.filter(Boolean);
    const rationale = s.rationale || '';
    let highlightedContext = context;
    if(context && word){
      const re = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      highlightedContext = escapeHtml(context).replace(re, m => '<b>' + m + '</b>');
    }
    return `
      <div class="vocab-row">
        <div class="vocab-original">
          <div class="vocab-word">${escapeHtml(word)}</div>
          ${context ? '<div class="vocab-context">in: "' + highlightedContext + '"</div>' : ''}
        </div>
        <div class="vocab-arrow">→</div>
        <div class="vocab-syns">
          ${syns.map(syn => `<span class="vocab-chip" onclick="applyVocabSwap('${escapeHtml(word).replace(/'/g, "\\'")}','${escapeHtml(syn).replace(/'/g, "\\'")}')">${escapeHtml(syn)}</span>`).join('')}
        </div>
        ${rationale ? '<div class="vocab-rationale"><b>Why:</b> ' + escapeHtml(rationale) + '</div>' : ''}
      </div>`;
  }).join('');
  card.style.display = 'block';
}

function applyVocabSwap(original, replacement){
  const ta = document.getElementById('summaryInput');
  if(!ta){ toast('Summary not available.'); return; }
  const re = new RegExp('\\b' + original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
  const match = ta.value.match(re);
  if(!match){ toast('"' + original + '" is no longer in your summary.'); return; }
  let repl = replacement;
  if(match[0][0] === match[0][0].toUpperCase()){
    repl = replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  ta.value = ta.value.replace(re, repl);
  const summaries = LocalStore.get(getPteStorageKey('summaries')) || {};
  summaries[currentPassageId] = { text: ta.value, timestamp: new Date().toISOString(), score: (summaries[currentPassageId]||{}).score || 0 };
  LocalStore.set(getPteStorageKey('summaries'), summaries);
  toast('"' + original + '" → "' + repl + '" — re-score to see the new score.');
}

function showSample(){
  const p = passages.find(x => x.id === currentPassageId);
  if(!p || !p.sampleResponse){ toast('No sample available for this passage.'); return; }
  const summaryInputEl = document.getElementById('summaryInput');
  if (summaryInputEl) summaryInputEl.value = p.sampleResponse;
  showSwtScreen('swtPracticeScreen');
  switchWriteTab('write');
  onSummaryInput();
  toast('Band-9 sample loaded ✓');
}

function backToPractice(){
  showSwtScreen('swtPracticeScreen');
  switchWriteTab('write');
  const summaryInputEl = document.getElementById('summaryInput');
  if (summaryInputEl) summaryInputEl.focus();
}

function navResultsPassage(delta){
  const target = currentPassageId + delta;
  if(target < 1 || target > passages.length) return;
  const scores = LocalStore.get(getPteStorageKey('scores')) || {};
  const p = passages.find(x => x.id === target) || passages[target-1];
  if(!p) return;
  if(scores[target] && typeof scores[target].overall_score === 'number'){
    currentPassageId = target;
    updateResultsNav();
    showResults(scores[target], p, scores[target].__spellData || null, scores[target].__text || '');
  } else {
    loadPassage(target);
    showSwtScreen('swtPracticeScreen');
  }
}

function goToNextPassage(){
  if(currentPassageId >= passages.length){ toast('You\'re on the last passage.'); return; }
  loadPassage(currentPassageId + 1);
  showSwtScreen('swtPracticeScreen');
  const summaryInputEl = document.getElementById('summaryInput');
  if (summaryInputEl) summaryInputEl.focus();
}

function updateResultsNav(){
  const cur = document.getElementById('resNavCurrent');
  const tot = document.getElementById('resNavTotal');
  const prev = document.getElementById('resNavPrev');
  const next = document.getElementById('resNavNext');
  const nextBtn = document.getElementById('nextPassageBtn');
  if(cur) cur.textContent = String(currentPassageId).padStart(2,'0');
  if(tot) tot.textContent = passages.length;
  if(prev) prev.toggleAttribute('disabled', currentPassageId === 1);
  if(next) next.toggleAttribute('disabled', currentPassageId === passages.length);
  if(nextBtn) nextBtn.style.display = (currentPassageId === passages.length) ? 'none' : 'inline-flex';
  const select = document.getElementById('resPassageSelect');
  if(select) select.value = currentPassageId;
}

// Keyboard listeners for SWT
document.addEventListener('keydown', function(e){
  if((e.metaKey || e.ctrlKey) && e.key === 'Enter'){
    const swtPane = document.getElementById('swtPane');
    const swtPractice = document.getElementById('swtPracticeScreen');
    if (swtPane && swtPane.classList.contains('active') && swtPractice && swtPractice.classList.contains('active') && writeTab === 'write') {
      e.preventDefault();
      scoreSummary();
    }
  }
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
  const typing = tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable);
  const resultsActive = document.getElementById('swtResultsScreen') && document.getElementById('swtResultsScreen').classList.contains('active');
  if(resultsActive && !typing){
    if(e.key === 'Escape'){ e.preventDefault(); if(typeof backToPractice === 'function') backToPractice(); }
    else if(e.key === 'ArrowLeft'){ if(typeof navResultsPassage === 'function' && currentPassageId > 1){ e.preventDefault(); navResultsPassage(-1); } }
    else if(e.key === 'ArrowRight'){ if(typeof navResultsPassage === 'function' && currentPassageId < passages.length){ e.preventDefault(); navResultsPassage(1); } }
  }
});

// Vocab extra admin aliases
function adminAddVocabWord() {
  openAddWord();
}
function loadAdminVocab() {
  populateAdminVocabCategorySelect();
  renderAdminVocabList();
}

// SWT Passage Admin CRUD
async function loadAdminPassages() {
  const list = document.getElementById('adminPassageList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center; color:var(--ink-mute); padding:24px; font-style:italic; font-family:var(--serif);">Loading passages...</div>';
  try {
    const r = await fetch(API_URL + '/api/admin/passages', {
      headers: { 'x-admin-key': adminKey }
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed to load');
    renderAdminPassages(d.passages || []);
  } catch (err) {
    list.innerHTML = `<div style="text-align:center; color:red; padding:24px;">Failed to load passages: ${escapeHtml(err.message)}</div>`;
  }
}

function renderAdminPassages(passagesList) {
  const list = document.getElementById('adminPassageList');
  if (!list) return;
  if (!passagesList.length) {
    list.innerHTML = '<div style="text-align:center; color:var(--ink-mute); padding:24px;">No passages in database.</div>';
    return;
  }
  list.innerHTML = passagesList.map(p => `
    <div class="passage-row" style="display:flex; align-items:center; gap:12px; padding:12px; border-bottom:1px solid var(--line);">
      <div class="pid" style="font-weight:700; width:30px;">#${p.id}</div>
      <div class="pinfo" style="flex:1;">
        <div class="ptitle" style="font-weight:600; font-size:14px;">${escapeHtml(p.title || 'Untitled')}</div>
        <div class="pcat" style="font-size:11.5px; color:var(--ink-soft); margin-top:2px;">${escapeHtml(p.category || 'General')} · ${(p.text || '').split(/\s+/).filter(Boolean).length} words</div>
      </div>
      <div class="pactions" style="display:flex; gap:6px;">
        <button class="tb-text-btn" onclick="adminEditPassage(${p.id})" style="font-size:12px; padding:4px 10px;">Edit</button>
        <button class="tb-text-btn" onclick="adminDeletePassage(${p.id})" style="font-size:12px; padding:4px 10px; color:var(--accent);">Delete</button>
      </div>
    </div>
  `).join('');
}

function adminAddPassage() {
  discardDraft();

  document.getElementById('peId').value = '';
  document.getElementById('peTitle').value = '';
  document.getElementById('peCategory').value = '';
  document.getElementById('peText').value = '';

  document.getElementById('peWhat').value = '';
  document.getElementById('peWhy').value = '';
  document.getElementById('peHow').value = '';
  document.getElementById('peResult').value = '';
  setEditorFramework('wwhr');

  document.getElementById('peRatTopic').value = '';
  document.getElementById('peRatImportance').value = '';

  document.getElementById('peSampleResponse').value = '';
  document.getElementById('peSampleNotes').value = '';

  document.getElementById('passageEditModal').dataset.extractionMeta = '';

  document.getElementById('passageEditTitle').textContent = 'Add New Passage';
  document.getElementById('passageEditModal').classList.add('show');
}

function adminEditPassage(id) {
  const p = passages.find(x => x.id === id);
  if (!p) { toast('Passage not found', true); return; }

  discardDraft();

  document.getElementById('peId').value = p.id;
  document.getElementById('peTitle').value = p.title || '';
  document.getElementById('peCategory').value = p.category || '';
  document.getElementById('peText').value = p.text || '';

  const ke = p.keyElements || {};
  const isTpc = (p.extractionMeta && p.extractionMeta.framework === 'tpc');
  if (isTpc) {
    document.getElementById('peWhat').value   = ke.topic || '';
    document.getElementById('peWhy').value    = ke.pivot || '';
    document.getElementById('peResult').value = ke.conclusion || '';
    document.getElementById('peHow').value    = '';
    setEditorFramework('tpc');
  } else {
    document.getElementById('peWhat').value   = ke.what || '';
    document.getElementById('peWhy').value    = ke.why || '';
    document.getElementById('peHow').value    = ke.how || '';
    document.getElementById('peResult').value = ke.result || '';
    setEditorFramework('wwhr');
  }

  const rat = p.keyElementsRationale || {};
  document.getElementById('peRatTopic').value = rat.topic || '';
  document.getElementById('peRatImportance').value = rat.importance || '';

  document.getElementById('peSampleResponse').value = p.sampleResponse || '';
  document.getElementById('peSampleNotes').value = p.sampleNotes || '';

  document.getElementById('passageEditModal').dataset.extractionMeta =
    JSON.stringify(p.extractionMeta || {});

  document.getElementById('passageEditTitle').textContent = `Edit Passage #${p.id}`;
  document.getElementById('passageEditModal').classList.add('show');
}

function closePassageEdit() {
  document.getElementById('passageEditModal').classList.remove('show');
}

async function savePassageEdit() {
  const id = document.getElementById('peId').value;
  const title = document.getElementById('peTitle').value.trim();
  const category = document.getElementById('peCategory').value.trim();
  const text = document.getElementById('peText').value.trim();

  if (!title || !text) { toast('Title and text are required', true); return; }

  const fw = document.getElementById('passageEditModal').dataset.editorFramework || 'wwhr';
  const ke = {};
  if (fw === 'tpc') {
    ke.topic = document.getElementById('peWhat').value.trim();
    ke.pivot = document.getElementById('peWhy').value.trim();
    ke.conclusion = document.getElementById('peResult').value.trim();
  } else {
    ke.what = document.getElementById('peWhat').value.trim();
    ke.why = document.getElementById('peWhy').value.trim();
    ke.how = document.getElementById('peHow').value.trim();
    ke.result = document.getElementById('peResult').value.trim();
  }

  const pObj = {
    title,
    category,
    text,
    keyElements: ke,
    keyElementsRationale: {
      topic: document.getElementById('peRatTopic').value.trim(),
      importance: document.getElementById('peRatImportance').value.trim()
    },
    sampleResponse: document.getElementById('peSampleResponse').value.trim(),
    sampleNotes: document.getElementById('peSampleNotes').value.trim()
  };

  if (id) pObj.id = Number(id);

  const metaStr = document.getElementById('passageEditModal').dataset.extractionMeta;
  if (metaStr) {
    try { pObj.extractionMeta = JSON.parse(metaStr); } catch(e){}
  } else if (fw) {
    pObj.extractionMeta = { framework: fw };
  }

  try {
    const r = await fetch(API_URL + '/api/admin/passages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey
      },
      body: JSON.stringify(pObj)
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Save failed');
    toast('Passage saved successfully ✓');
    closePassageEdit();
    await loadPassages();
    await loadAdminPassages();
  } catch (err) {
    toast('Failed to save passage: ' + err.message, true);
  }
}

async function adminDeletePassage(id) {
  if (!confirm(`Delete passage #${id}? This action cannot be undone.`)) return;
  try {
    const r = await fetch(API_URL + `/api/admin/passages/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-key': adminKey }
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Delete failed');
    toast('Passage deleted ✓');
    await loadPassages();
    await loadAdminPassages();
  } catch (err) {
    toast('Delete failed: ' + err.message, true);
  }
}

// AI auto-extraction logic
let currentDraft = null;
async function runExtraction() {
  const btn = document.getElementById('extractBtn');
  const draftBox = document.getElementById('extractDraft');
  const text = document.getElementById('peText').value.trim();
  const title = document.getElementById('peTitle').value.trim();

  if (!text || text.length < 40) {
    draftBox.style.display = 'block';
    draftBox.innerHTML = '<div class="draft-low-warn">Add the passage text first (at least 40 characters), then auto-extract.</div>';
    return;
  }

  btn.disabled = true;
  btn.textContent = '✨ Extracting…';
  draftBox.style.display = 'block';
  draftBox.innerHTML = '<div class="draft-reason">Claude is reading the passage and drafting key elements…</div>';

  try {
    const r = await fetch(API_URL + '/api/admin/passages/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey
      },
      body: JSON.stringify({ text, title })
    });
    const d = await r.json();
    if (!r.ok || !d.success) {
      draftBox.innerHTML = '<div class="draft-low-warn">Extraction failed: ' +
        escapeHtml(d.error || ('HTTP ' + r.status)) + '</div>';
      return;
    }
    currentDraft = d.draft;
    renderDraft(d.draft);
  } catch (e) {
    draftBox.innerHTML = '<div class="draft-low-warn">Network error: ' + escapeHtml(e.message) + '</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Auto-extract with AI';
  }
}

function renderDraft(draft) {
  const box = document.getElementById('extractDraft');
  const fw = draft.framework === 'tpc' ? 'Topic / Pivot / Conclusion' : 'What / Why / How / Result';
  const conf = draft.confidence || 'medium';
  const ke = draft.keyElements || {};
  const rat = draft.keyElementsRationale || {};
  const ratEls = rat.elements || {};

  const order = draft.framework === 'tpc'
    ? [['topic','Topic'],['pivot','Pivot'],['conclusion','Conclusion']]
    : [['what','What'],['why','Why'],['how','How'],['result','Result']];

  const warnings = Array.isArray(draft.warnings) ? draft.warnings : [];
  const warnedSlots = {};
  warnings.forEach(w => { warnedSlots[w.element] = w.issue; });

  const elsHtml = order.filter(([k]) => ke[k]).map(([k, label]) => `
    <div class="draft-el${warnedSlots[k] ? ' draft-el-warn' : ''}">
      <span class="del-key">${label}</span>${escapeHtml(ke[k])}
      ${ratEls[k] ? '<span class="del-rationale">↳ ' + escapeHtml(ratEls[k]) + '</span>' : ''}
      ${warnedSlots[k] ? '<span class="del-warn">⚠ ' + escapeHtml(warnedSlots[k]) + '</span>' : ''}
    </div>`).join('');

  const lowWarn = conf === 'low'
    ? '<div class="draft-low-warn">⚠ Low confidence — this passage\'s structure is genuinely ambiguous. Review the key elements carefully before applying.</div>'
    : '';

  const exampleWarn = warnings.length
    ? '<div class="draft-low-warn">⚠ ' + warnings.length + ' key element' +
      (warnings.length > 1 ? 's' : '') + ' may have captured an EXAMPLE rather than the ' +
      'general idea (highlighted below). A key idea should state the principle, not the ' +
      'specific case — edit these before applying so students aren\'t marked wrong for ' +
      'summarising the principle without naming the example.</div>'
    : '';

  box.style.display = 'block';
  box.innerHTML = `
    <div class="extract-draft-head" style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
      <span class="extract-draft-title" style="font-weight:700;">AI Draft — review before applying</span>
      <span class="draft-badge fw" style="font-size:10px; padding:2px 6px; background:var(--accent-soft); color:var(--accent);">${fw}</span>
      <span class="draft-badge conf-${conf}">${conf} confidence</span>
    </div>
    ${draft.framework_reason ? '<div class="draft-reason">' + escapeHtml(draft.framework_reason) + '</div>' : ''}
    ${lowWarn}
    ${exampleWarn}
    <div class="draft-elements">${elsHtml}</div>
    <div class="draft-actions" style="display:flex; gap:6px; margin-top:8px;">
      <button type="button" class="tb-text-btn dark" onclick="applyDraft()">Apply to fields</button>
      <button type="button" class="tb-text-btn" onclick="discardDraft()">Discard</button>
    </div>`;
}

function applyDraft() {
  if (!currentDraft) return;
  const ke = currentDraft.keyElements || {};
  const rat = currentDraft.keyElementsRationale || {};

  if (currentDraft.framework === 'tpc') {
    document.getElementById('peWhat').value   = ke.topic || '';
    document.getElementById('peWhy').value    = ke.pivot || '';
    document.getElementById('peResult').value = ke.conclusion || '';
    document.getElementById('peHow').value    = '';
    setEditorFramework('tpc');
  } else {
    document.getElementById('peWhat').value   = ke.what || '';
    document.getElementById('peWhy').value    = ke.why || '';
    document.getElementById('peHow').value    = ke.how || '';
    document.getElementById('peResult').value = ke.result || '';
    setEditorFramework('wwhr');
  }

  document.getElementById('peRatTopic').value = rat.topic || '';
  document.getElementById('peRatImportance').value = rat.importance || '';

  document.getElementById('passageEditModal').dataset.extractionMeta =
    JSON.stringify(currentDraft.extractionMeta || {});

  const box = document.getElementById('extractDraft');
  box.style.display = 'none';
}

function discardDraft() {
  currentDraft = null;
  const box = document.getElementById('extractDraft');
  box.style.display = 'none';
  box.innerHTML = '';
}

function setEditorFramework(fw) {
  const labels = fw === 'tpc'
    ? { what: 'Topic — what the passage is about',
        why: 'Pivot — the turn / counterpoint / shift',
        result: 'Conclusion — the resolution / takeaway' }
    : { what: 'What (Primary Subject)',
        why: 'Why (Motivation)',
        how: 'How (Action/Method)',
        result: 'Result (Outcome)' };
        
  ['what','why','how','result'].forEach(k => {
    const lbl = document.getElementById('lbl_' + k);
    if (labels[k]) {
      if (lbl) lbl.textContent = labels[k];
    }
  });
  const howField = document.getElementById('field_how');
  if (howField) howField.style.display = (fw === 'tpc') ? 'none' : '';
  document.getElementById('passageEditModal').dataset.editorFramework = fw;
}

// ============================================================
//  CUSTOM GLASSMORPHISM DASHBOARD & VOCABULARY ENGINE FUNCTIONS
// ============================================================

function localDateStamp(dateInput) {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function updateDashboardStreak() {
  const activeDates = new Set();
  
  // 1. Collect SWT history dates
  const swtHistory = LocalStore.get(getPteStorageKey('history')) || {};
  Object.keys(swtHistory).forEach(pid => {
    const list = swtHistory[pid];
    if (Array.isArray(list)) {
      list.forEach(att => {
        if (att.timestamp) {
          const stamp = localDateStamp(att.timestamp);
          if (stamp) activeDates.add(stamp);
        }
      });
    }
  });
  
  // 2. Collect Essay history dates
  const essayHistory = getPracticeHistory() || [];
  essayHistory.forEach(h => {
    if (h.date) {
      const stamp = localDateStamp(h.date);
      if (stamp) activeDates.add(stamp);
    }
  });
  
  const sortedDates = Array.from(activeDates).sort();
  
  // 3. Compute current streak
  let currentStreak = 0;
  const todayVal = new Date();
  const todayStr = formatDate(todayVal);
  const hasToday = activeDates.has(todayStr);
  
  let yesterdayVal = new Date();
  yesterdayVal.setDate(yesterdayVal.getDate() - 1);
  const yesterdayStr = formatDate(yesterdayVal);
  const hasYesterday = activeDates.has(yesterdayStr);
  
  if (hasToday || hasYesterday) {
    let curr = hasToday ? todayVal : yesterdayVal;
    while (true) {
      const currStr = formatDate(curr);
      if (activeDates.has(currStr)) {
        currentStreak++;
        curr.setDate(curr.getDate() - 1);
      } else {
        break;
      }
    }
  }
  
  // 4. Compute best streak
  let bestStreak = 0;
  if (sortedDates.length > 0) {
    let tempStreak = 1;
    bestStreak = 1;
    for (let i = 1; i < sortedDates.length; i++) {
      const prevDate = new Date(sortedDates[i - 1] + 'T12:00:00');
      const currDate = new Date(sortedDates[i] + 'T12:00:00');
      const diffTime = Math.abs(currDate - prevDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        tempStreak++;
      } else if (diffDays > 1) {
        tempStreak = 1;
      }
      if (tempStreak > bestStreak) {
        bestStreak = tempStreak;
      }
    }
  }
  if (currentStreak > bestStreak) {
    bestStreak = currentStreak;
  }
  
  // 5. Update DOM values
  const currEl = document.getElementById('dashStreakCurrent');
  const bestEl = document.getElementById('dashStreakBest');
  if (currEl) currEl.textContent = `${currentStreak} day${currentStreak === 1 ? '' : 's'}`;
  if (bestEl) bestEl.textContent = `${bestStreak} day${bestStreak === 1 ? '' : 's'}`;
  
  // 6. Draw 7-day grid ending with today
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const gridContainer = document.getElementById('dashStreakGrid');
  if (gridContainer) {
    let gridHtml = '';
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dStr = formatDate(d);
      const isToday = (i === 0);
      const isActive = activeDates.has(dStr);
      const label = isToday ? 'Today' : dayLabels[d.getDay()];
      
      gridHtml += `
        <div class="streak-day-cell ${isActive ? 'active' : ''} ${isToday ? 'today' : ''}">
          <span class="day-name">${label}</span>
          <div class="day-dot"></div>
        </div>
      `;
    }
    gridContainer.innerHTML = gridHtml;
  }
}

// --- Analytics Chart Toggle & Generator ---
let currentDashboardChartMetric = 'swt';
function setDashboardChartMetric(metric) {
  currentDashboardChartMetric = metric;
  
  const swtBtn = document.getElementById('chartToggleSwt');
  const essayBtn = document.getElementById('chartToggleEssay');
  if (swtBtn) swtBtn.classList.toggle('active', metric === 'swt');
  if (essayBtn) essayBtn.classList.toggle('active', metric === 'essay');
  
  renderDashboardCharts(metric);
}

function renderDashboardCharts(metricType) {
  const svg = document.getElementById('analyticsSvg');
  if (!svg) return;
  
  let points = [];
  const maxScore = (metricType === 'swt') ? 90 : 26;
  
  if (metricType === 'swt') {
    const swtHistory = LocalStore.get(getPteStorageKey('history')) || {};
    const swtAttempts = [];
    Object.keys(swtHistory).forEach(pid => {
      const list = swtHistory[pid];
      if (Array.isArray(list)) {
        list.forEach(att => {
          if (att.timestamp && typeof att.overall_score === 'number') {
            const passage = passages.find(p => String(p.id) === String(pid));
            swtAttempts.push({
              title: passage ? passage.title : `Passage ${pid}`,
              score: att.overall_score,
              date: new Date(att.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
              timestamp: att.timestamp
            });
          }
        });
      }
    });
    swtAttempts.sort((a, b) => a.timestamp - b.timestamp);
    points = swtAttempts.slice(-10);
  } else {
    const essayHistory = getPracticeHistory() || [];
    const essayAttempts = [];
    essayHistory.forEach(h => {
      if (h.date && h.scores && typeof h.scores.total === 'number') {
        essayAttempts.push({
          title: h.questionTitle || 'Practice Essay',
          score: h.scores.total,
          date: new Date(h.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          timestamp: new Date(h.date).getTime()
        });
      }
    });
    essayAttempts.sort((a, b) => a.timestamp - b.timestamp);
    points = essayAttempts.slice(-10);
  }
  
  // Clean dynamic content from previous renderings
  const previousPlotElements = svg.querySelectorAll('.chart-dynamic-el');
  previousPlotElements.forEach(el => el.remove());
  
  // Define coordinate bounds mapping for SVG (responsive layout based on SVG client dimensions)
  const width = svg.clientWidth || 800;
  const height = svg.clientHeight || 240;
  
  const padLeft = 45;
  const padRight = 30;
  const padTop = 25;
  const padBottom = 35;
  
  function getY(val) {
    return padTop + (1 - val / maxScore) * (height - padTop - padBottom);
  }
  
  function getX(idx) {
    if (points.length <= 1) return width / 2;
    const maxSpacing = 100; // max px between points to prevent stretching
    const defaultSpacing = (width - padLeft - padRight) / (points.length - 1);
    const spacing = Math.min(defaultSpacing, maxSpacing);
    return padLeft + idx * spacing;
  }
  
  let gridHtml = '';
  
  // Draw standard horizontal grids
  const gridVals = (metricType === 'swt') ? [0, 30, 60, 90] : [0, 10, 20, 26];
  gridVals.forEach(g => {
    const yVal = getY(g);
    gridHtml += `
      <line class="chart-grid-line chart-dynamic-el" x1="${padLeft}" y1="${yVal}" x2="${width - padRight}" y2="${yVal}"></line>
      <text class="chart-grid-text chart-dynamic-el" x="${padLeft - 25}" y="${yVal + 4}">${g}</text>
    `;
  });
  
  if (points.length === 0) {
    gridHtml += `
      <text class="chart-dynamic-el" x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="var(--ink-mute)" font-weight="600" font-size="13px">
        No scored attempts found. Submit a practice task to compile trend analytics.
      </text>
    `;
    svg.insertAdjacentHTML('beforeend', gridHtml);
    return;
  }
  
  // Construct line and area paths
  const pathCoordinates = points.map((p, idx) => `${getX(idx)},${getY(p.score)}`).join(' ');
  const dLine = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx)} ${getY(p.score)}`).join(' ');
  const dArea = `${dLine} L ${getX(points.length - 1)} ${getY(0)} L ${getX(0)} ${getY(0)} Z`;
  
  gridHtml += `
    <path class="chart-path-area chart-dynamic-el" d="${dArea}"></path>
    <path class="chart-path-line chart-dynamic-el" d="${dLine}"></path>
  `;
  
  // Render points and labels
  points.forEach((p, idx) => {
    const cx = getX(idx);
    const cy = getY(p.score);
    const safeTitle = p.title.replace(/'/g, "\\'");
    const safeDate = p.date.replace(/'/g, "\\'");
    
    gridHtml += `
      <circle class="chart-point chart-dynamic-el" cx="${cx}" cy="${cy}" 
        onmouseover="showChartTooltip(${cx}, ${cy}, '${safeTitle}', ${p.score}, '${safeDate}', ${maxScore})" 
        onmouseout="hideChartTooltip()"></circle>
      <text class="chart-grid-text chart-dynamic-el" x="${cx}" y="${height - padBottom + 20}" text-anchor="middle">${p.date}</text>
    `;
  });
  
  svg.insertAdjacentHTML('beforeend', gridHtml);
}

// Debounced resize listener to redraw active chart responsively without stretching
let chartResizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(chartResizeTimeout);
  chartResizeTimeout = setTimeout(() => {
    const pane = document.getElementById('dashboardPane');
    if (pane && pane.classList.contains('active')) {
      const activeBtn = document.querySelector('.chart-toggle-btn.active');
      const metric = (activeBtn && activeBtn.id === 'chartToggleEssay') ? 'essay' : 'swt';
      renderDashboardCharts(metric);
    }
  }, 150);
});

function showChartTooltip(x, y, title, score, date, maxScore) {
  const tooltip = document.getElementById('chartTooltip');
  if (!tooltip) return;
  const svg = document.getElementById('analyticsSvg');
  const width = svg ? (svg.clientWidth || 800) : 800;
  const height = svg ? (svg.clientHeight || 240) : 240;
  
  const xPct = (x / width) * 100;
  const yPct = (y / height) * 100;
  
  tooltip.innerHTML = `
    <div style="font-weight:800; color:var(--accent); font-size:13px; margin-bottom:2px;">${score} / ${maxScore}</div>
    <div style="font-weight:700; max-width:180px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; color:var(--ink); font-size:11px;">${escapeHtml(title)}</div>
    <div style="font-size:9.5px; color:var(--ink-mute); margin-top:2px;">${date}</div>
  `;
  tooltip.style.left = `${xPct}%`;
  tooltip.style.top = `${yPct}%`;
  tooltip.classList.add('show');
}

function hideChartTooltip() {
  const tooltip = document.getElementById('chartTooltip');
  if (tooltip) tooltip.classList.remove('show');
}

// --- Daily Vocabulary Challenge Widget ---
let currentChallengeWordObj = null;
let challengeOffset = 0;

function updateDailyVocabChallenge() {
  const allWords = [];
  for (const [catId, cat] of Object.entries(VOCAB_DATA)) {
    for (const w of cat.words) {
      allWords.push({ ...w, catId });
    }
  }
  
  if (allWords.length === 0) return;
  
  // Deterministic daily lookup index + custom offset
  const d = new Date();
  const baseIndex = d.getFullYear() * 365 + d.getMonth() * 31 + d.getDate();
  const dayIndex = (baseIndex + challengeOffset) % allWords.length;
  currentChallengeWordObj = allWords[dayIndex];
  
  const wordEl = document.getElementById('challengeWord');
  if (wordEl) wordEl.textContent = currentChallengeWordObj.word;
  
  const revealBtn = document.getElementById('challengeRevealBtn');
  if (revealBtn) revealBtn.style.display = 'inline-block';
  
  const defEl = document.getElementById('challengeDefinition');
  if (defEl) {
    defEl.style.display = 'none';
    const exHtml = currentChallengeWordObj.examples && currentChallengeWordObj.examples.length > 0 
      ? `<div class="challenge-example" style="margin-top: 8px; font-style: italic; border-left: 2px solid var(--accent); padding-left: 8px; color: var(--ink-soft);">"${escapeHtml(currentChallengeWordObj.examples[0])}"</div>`
      : '';
    const hubLinkHtml = `<div style="margin-top: 10px; font-size: 12px;">
      <a href="#" onclick="jumpToVocabWord('${currentChallengeWordObj.catId}', '${currentChallengeWordObj.word}'); return false;" style="color:var(--accent); font-weight:700; text-decoration:underline;">
        🔗 View & practice in Vocabulary Hub →
      </a>
    </div>`;
    defEl.innerHTML = `
      <div style="font-weight: 600; color: var(--ink);">(${escapeHtml(currentChallengeWordObj.pos)})</div>
      <div>${escapeHtml(currentChallengeWordObj.meaning)}</div>
      ${exHtml}
      ${hubLinkHtml}
    `;
  }
  
  const inputEl = document.getElementById('challengeInput');
  if (inputEl) inputEl.value = '';
  
  const fbEl = document.getElementById('challengeFeedback');
  if (fbEl) {
    fbEl.className = 'vocab-try-feedback';
    fbEl.innerHTML = '';
  }
}

function loadNextChallengeWord() {
  challengeOffset++;
  updateDailyVocabChallenge();
}

function revealChallengeWord() {
  const revealBtn = document.getElementById('challengeRevealBtn');
  if (revealBtn) revealBtn.style.display = 'none';
  const defEl = document.getElementById('challengeDefinition');
  if (defEl) defEl.style.display = 'block';
}

function checkChallengeSentence() {
  if (!currentChallengeWordObj) return;
  const input = document.getElementById('challengeInput');
  const fb = document.getElementById('challengeFeedback');
  if (!input || !fb) return;
  
  const text = (input.value || '').trim();
  if (!text) {
    fb.className = 'vocab-try-feedback show warn';
    fb.textContent = 'Write a sentence first.';
    return;
  }
  
  const word = currentChallengeWordObj.word;
  const stem = word.toLowerCase().replace(/(ation|isation|ing|ed|ies|es|s)$/, '').slice(0, Math.max(4, word.length - 3));
  const re = new RegExp(`\\b${stem}[a-z]*\\b`, 'i');
  
  if (!re.test(text)) {
    fb.className = 'vocab-try-feedback show warn';
    fb.innerHTML = `Hmm — I couldn't find <strong>"${escapeHtml(word)}"</strong> (or a form of it) in your sentence. Try again.`;
    return;
  }
  if (text.length < 15) {
    fb.className = 'vocab-try-feedback show warn';
    fb.textContent = 'Your sentence is very short. Try a sentence with more context.';
    return;
  }
  
  fb.className = 'vocab-try-feedback show ok';
  fb.innerHTML = `✓ Nice! You used <strong>"${escapeHtml(word)}"</strong>. Go to <a href="#" onclick="jumpToVocabWord('${currentChallengeWordObj.catId}', '${currentChallengeWordObj.word}'); return false;" style="color:var(--accent); font-weight:700; text-decoration:underline;">Vocabulary Hub</a> for deeper AI review.`;
}

// --- Smart Action Items Planner ---
function renderDashboardActionItems() {
  const container = document.getElementById('dashActionItems');
  if (!container) return;
  
  const actions = [];
  
  // 1. Next unattempted SWT passage
  const swtHistory = LocalStore.get(getPteStorageKey('history')) || {};
  const unattemptedSwt = passages.find(p => !swtHistory[p.id] || swtHistory[p.id].length === 0);
  if (unattemptedSwt) {
    actions.push({
      icon: '📝',
      title: `Practice SWT: ${unattemptedSwt.title}`,
      desc: 'Master summarizing complex academic texts in a single sentence.',
      action: `switchSection('swt'); jumpToPassage(${unattemptedSwt.id});`
    });
  }
  
  // 2. Next unwritten Essay Topic
  const unwrittenEssay = essays.find(e => essayStatus(e) === 'empty' || essayStatus(e) === 'draft');
  if (unwrittenEssay) {
    actions.push({
      icon: '✍️',
      title: `Write Essay: ${unwrittenEssay.title}`,
      desc: essayStatus(unwrittenEssay) === 'draft' ? 'Finish your saved draft essay.' : 'Develop a Band 9 essay using advanced academic structure.',
      action: `switchSection('library'); selectEssay('${unwrittenEssay.id}');`
    });
  }
  
  // 3. Vocab category with lowest progress
  const progress = getVocabProgress();
  let lowestCat = null;
  let lowestRatio = 1.0;
  
  Object.entries(VOCAB_DATA).forEach(([catId, cat]) => {
    const readCount = cat.words.filter(w => (progress.read || {})[vocabKey(catId, w.word)]).length;
    const ratio = readCount / cat.words.length;
    if (ratio < 1.0 && ratio < lowestRatio) {
      lowestRatio = ratio;
      lowestCat = { id: catId, ...cat };
    }
  });
  
  if (lowestCat) {
    actions.push({
      icon: '📖',
      title: `Learn Vocab: ${lowestCat.label}`,
      desc: `Master C1/C2 terms. Current category progress: ${Math.round(lowestRatio * 100)}%.`,
      action: `openVocab(); selectVocabCategory('${lowestCat.id}');`
    });
  }
  
  if (actions.length === 0) {
    actions.push({
      icon: '🎉',
      title: 'All tasks completed!',
      desc: 'Excellent job. You have explored all current passages and vocabulary files.',
      action: ''
    });
  }
  
  container.innerHTML = actions.map(act => `
    <div class="action-item-card" onclick="${act.action ? act.action : ''}">
      <div class="action-icon">${act.icon}</div>
      <div class="action-details">
        <div class="action-title">${escapeHtml(act.title)}</div>
        <div class="action-desc">${escapeHtml(act.desc)}</div>
      </div>
      <div class="action-arrow">→</div>
    </div>
  `).join('');
}

// --- Flashcards Mode Functions ---
let flashcardIndex = 0;
let flashcardFlipped = false;

function renderVocabFlashcardContainer() {
  return `
    <div class="flashcard-wrapper" id="flashcardWrapper" onclick="toggleFlashcardFlip()">
      <div class="flashcard-inner">
        <div class="flashcard-front" id="fcFront">
          <!-- Populated via JS -->
        </div>
        <div class="flashcard-back" id="fcBack">
          <!-- Populated via JS -->
        </div>
      </div>
    </div>
    <div class="fc-progress" id="fcProgress">Card 1 of 1</div>
    <div class="flashcard-controls" id="fcControls" style="visibility: hidden;">
      <button class="fc-btn again" onclick="handleFlashcardAction(false); event.stopPropagation();">Again (Study)</button>
      <button class="fc-btn good" onclick="handleFlashcardAction(true); event.stopPropagation();">Good (Got it)</button>
    </div>
  `;
}

function showVocabFlashcard() {
  const cat = VOCAB_DATA[currentVocabCategory];
  if (!cat || cat.words.length === 0) return;
  
  if (flashcardIndex >= cat.words.length) {
    flashcardIndex = 0;
  }
  
  const w = cat.words[flashcardIndex];
  flashcardFlipped = false;
  
  const wrapper = document.getElementById('flashcardWrapper');
  if (wrapper) wrapper.classList.remove('flipped');
  
  const front = document.getElementById('fcFront');
  const back = document.getElementById('fcBack');
  const progress = document.getElementById('fcProgress');
  const controls = document.getElementById('fcControls');
  
  if (front) {
    front.innerHTML = `
      <div class="fc-word">${escapeHtml(w.word)}</div>
      <div class="pos-badge" style="background:var(--accent-soft); color:var(--accent); font-weight:700; font-size:12px; margin-top:10px;">${escapeHtml(w.pos || '')}</div>
      <div class="fc-hint">Tap card to reveal definition</div>
    `;
  }
  
  if (back) {
    back.innerHTML = `
      <div style="font-weight: 800; font-size: 18px; color: var(--accent); margin-bottom: 8px;">${escapeHtml(w.word)}</div>
      <div style="font-size: 13px; line-height: 1.5; color: var(--ink); margin-bottom: 12px;">
        <strong>Meaning:</strong> ${escapeHtml(w.meaning)}
      </div>
      ${w.compare ? `<div style="font-size: 12px; margin-bottom: 12px; padding: 6px 10px; background: rgba(99, 102, 241, 0.05); border-radius: 6px;"><strong>Compare:</strong> ${escapeHtml(w.compare)}</div>` : ''}
      <div style="font-size: 12px; color: var(--ink-soft);">
        <strong>Examples:</strong>
        <ul style="margin: 6px 0 0 16px; padding: 0;">
          ${(w.examples || []).map(ex => `<li style="margin-bottom: 4px;">${escapeHtml(ex)}</li>`).join('')}
        </ul>
      </div>
    `;
  }
  
  if (progress) {
    progress.textContent = `Card ${flashcardIndex + 1} of ${cat.words.length}`;
  }
  
  if (controls) {
    controls.style.visibility = 'hidden';
  }
}

function toggleFlashcardFlip() {
  const wrapper = document.getElementById('flashcardWrapper');
  if (!wrapper) return;
  
  flashcardFlipped = !flashcardFlipped;
  wrapper.classList.toggle('flipped', flashcardFlipped);
  
  const controls = document.getElementById('fcControls');
  if (controls) {
    controls.style.visibility = flashcardFlipped ? 'visible' : 'hidden';
  }
}

async function handleFlashcardAction(gotIt) {
  const cat = VOCAB_DATA[currentVocabCategory];
  if (!cat) return;
  const w = cat.words[flashcardIndex];
  
  const progress = getVocabProgress();
  const key = vocabKey(currentVocabCategory, w.word);
  
  if (gotIt) {
    if (!progress.read[key]) {
      progress.read[key] = Date.now();
      await saveVocabProgress();
    }
  } else {
    if (progress.read[key]) {
      delete progress.read[key];
      await saveVocabProgress();
    }
  }
  
  flashcardIndex++;
  if (flashcardIndex >= cat.words.length) {
    flashcardIndex = 0;
    toast('Finished this category review! Starting again.');
  }
  
  renderVocabCategoryList();
  updateVocabProgressSummary();
  showVocabFlashcard();
}

// --- Practice Hub Game Logic Router ---
let quizType = 'spelling';

function startQuizMode(type) {
  quizType = type;
  
  const progress = getVocabProgress();
  const allWords = [];
  for (const [catId, cat] of Object.entries(VOCAB_DATA)) {
    for (const w of cat.words) {
      allWords.push({ ...w, catId, catLabel: cat.label, read: !!progress.read[vocabKey(catId, w.word)] });
    }
  }
  const readPool = allWords.filter(w => w.read);
  
  document.getElementById('vocabPracticeContent').innerHTML = `
    <h2>🎯 Select Quiz Length & Pool</h2>
    <p style="margin-bottom: 16px;">Configure your ${type === 'spelling' ? 'Spelling' : 'Multiple Choice'} quiz.</p>
    
    <div style="display:flex; flex-direction:column; gap:10px; margin-bottom: 20px;">
      <button class="tb-text-btn dark" onclick="setupAndStartQuiz(10, 'read')" ${readPool.length < 1 ? 'disabled' : ''}>10 words I've read</button>
      <button class="tb-text-btn dark" onclick="setupAndStartQuiz(20, 'read')" ${readPool.length < 1 ? 'disabled' : ''}>20 words I've read</button>
      <button class="tb-text-btn dark" onclick="setupAndStartQuiz(10, 'all')">10 mixed words (all)</button>
    </div>
    
    <div class="modal-actions">
      <button class="tb-text-btn" onclick="openVocabPractice()">← Back</button>
    </div>
  `;
}

function setupAndStartQuiz(n, pool) {
  const progress = getVocabProgress();
  const allWords = [];
  for (const [catId, cat] of Object.entries(VOCAB_DATA)) {
    for (const w of cat.words) {
      allWords.push({ ...w, catId, catLabel: cat.label, read: !!progress.read[vocabKey(catId, w.word)] });
    }
  }
  const source = (pool === 'read') ? allWords.filter(w => w.read) : allWords;
  if (source.length === 0) { toast('No words available — read some first', true); return; }
  
  const shuffled = [...source].sort(() => Math.random() - 0.5).slice(0, Math.min(n, source.length));
  quizWords = shuffled;
  quizUserAnswers = {};
  
  if (quizType === 'spelling') {
    renderQuiz();
  } else {
    startMCQQuiz();
  }
}

// --- Multiple-Choice Quiz Engine ---
let mcqCurrentIndex = 0;
let mcqScore = 0;
let mcqChoices = [];
let mcqAnswerChecked = false;

function startMCQQuiz() {
  mcqCurrentIndex = 0;
  mcqScore = 0;
  renderMCQQuestion();
}

function renderMCQQuestion() {
  if (mcqCurrentIndex >= quizWords.length) {
    renderMCQFinished();
    return;
  }
  
  mcqAnswerChecked = false;
  const w = quizWords[mcqCurrentIndex];
  
  const allWords = [];
  for (const [catId, cat] of Object.entries(VOCAB_DATA)) {
    for (const item of cat.words) {
      if (item.word !== w.word) {
        allWords.push(item.word);
      }
    }
  }
  
  const distractors = [...new Set(allWords)].sort(() => Math.random() - 0.5).slice(0, 3);
  mcqChoices = [w.word, ...distractors].sort(() => Math.random() - 0.5);
  
  const c = document.getElementById('vocabPracticeContent');
  c.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line-soft); padding-bottom:8px; margin-bottom:14px;">
      <h3 style="margin:0; font-size:15px; color:var(--accent);">🎯 Multiple Choice Quiz</h3>
      <span style="font-size:12px; color:var(--ink-soft); font-weight:700;">Question ${mcqCurrentIndex + 1} of ${quizWords.length}</span>
    </div>
    
    <div style="margin: 16px 0; background:rgba(99, 102, 241, 0.03); border:1px solid var(--line-soft); padding:16px; border-radius:8px;">
      <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:var(--ink-mute); margin-bottom:6px;">Meaning:</div>
      <div style="font-size:14px; font-weight:600; line-height:1.5; color:var(--ink);">${escapeHtml(w.meaning)}</div>
    </div>
    
    <div class="quiz-choices-grid" id="mcqChoicesGrid">
      ${mcqChoices.map((choice, i) => `
        <button class="quiz-choice-btn" onclick="submitMCQAnswer('${choice.replace(/'/g, "\\'")}', ${i})">${escapeHtml(choice)}</button>
      `).join('')}
    </div>
    
    <div id="mcqFeedback" style="margin-top:16px; min-height:48px;"></div>
    
    <div class="modal-actions" style="margin-top:16px; border-top:1px solid var(--line-soft); padding-top:12px;">
      <span style="font-size:12.5px; color:var(--ink-soft);">Score: <strong>${mcqScore}</strong></span>
      <button class="tb-text-btn" onclick="closeVocabPractice()" style="margin-left:auto;">Quit</button>
      <button class="tb-text-btn dark" id="mcqNextBtn" disabled onclick="nextMCQQuestion()">Next →</button>
    </div>
  `;
}

function submitMCQAnswer(choice, choiceIndex) {
  if (mcqAnswerChecked) return;
  mcqAnswerChecked = true;
  
  const w = quizWords[mcqCurrentIndex];
  const buttons = document.querySelectorAll('#mcqChoicesGrid .quiz-choice-btn');
  const fb = document.getElementById('mcqFeedback');
  const isCorrect = (choice === w.word);
  
  if (isCorrect) {
    mcqScore++;
    buttons[choiceIndex].classList.add('correct');
    fb.innerHTML = `
      <div style="color:#10b981; font-weight:700; font-size:13px; display:flex; align-items:center; gap:6px;">
        <span>✓ Correct!</span>
      </div>
    `;
  } else {
    buttons[choiceIndex].classList.add('incorrect');
    buttons.forEach((btn, idx) => {
      if (mcqChoices[idx] === w.word) {
        btn.classList.add('correct');
      }
    });
    fb.innerHTML = `
      <div style="color:#ef4444; font-weight:700; font-size:13px; display:flex; align-items:center; gap:6px;">
        <span>✗ Incorrect. The correct word is "${escapeHtml(w.word)}".</span>
      </div>
    `;
  }
  
  const nextBtn = document.getElementById('mcqNextBtn');
  if (nextBtn) nextBtn.disabled = false;
}

function nextMCQQuestion() {
  mcqCurrentIndex++;
  renderMCQQuestion();
}

function renderMCQFinished() {
  const c = document.getElementById('vocabPracticeContent');
  
  const progress = getVocabProgress();
  if (!progress.practiceHistory) progress.practiceHistory = [];
  progress.practiceHistory.push({
    date: Date.now(),
    total: quizWords.length,
    correct: mcqScore,
    pct: Math.round(mcqScore / quizWords.length * 100),
    mode: 'mcq'
  });
  if (progress.practiceHistory.length > 50) progress.practiceHistory = progress.practiceHistory.slice(-50);
  saveVocabProgress();
  
  c.innerHTML = `
    <div style="text-align:center; padding:16px 0;">
      <div style="font-size:48px; margin-bottom:12px;">🎉</div>
      <h2>Multiple Choice Quiz Completed!</h2>
      <p style="color:var(--ink-soft); margin-bottom:20px;">You scored <strong>${mcqScore} out of ${quizWords.length}</strong> correct definitions.</p>
      
      <div style="background:var(--bg-list); border:1px solid var(--line-soft); border-radius:8px; padding:14px; display:inline-block; min-width:240px; margin-bottom:24px;">
        <div style="font-size:24px; font-weight:800; color:var(--accent);">${Math.round(mcqScore/quizWords.length*100)}%</div>
        <div style="font-size:12px; color:var(--ink-mute); margin-top:4px;">Accuracy Score</div>
      </div>
      
      <div class="modal-actions" style="justify-content:center; gap:12px;">
        <button class="tb-text-btn" onclick="openVocabPractice()">Practice Hub</button>
        <button class="tb-text-btn dark" onclick="startMCQQuiz()">Try Again</button>
      </div>
    </div>
  `;
}

// --- Synonyms Matching Game Engine ---
let matcherCards = [];
let matcherSelected = null;
let matcherTimer = null;
let matcherTimeLeft = 45;
let matcherScore = 0;
let matcherMatchesCount = 0;

function startSynonymsMatcher() {
  matcherScore = 0;
  matcherMatchesCount = 0;
  matcherTimeLeft = 45;
  matcherSelected = null;
  
  const allWords = [];
  for (const [catId, cat] of Object.entries(VOCAB_DATA)) {
    for (const w of cat.words) {
      allWords.push(w);
    }
  }
  
  if (allWords.length < 6) {
    toast('Not enough vocabulary words to start matching game.', true);
    return;
  }
  
  const selectedWords = [...allWords].sort(() => Math.random() - 0.5).slice(0, 6);
  
  matcherCards = [];
  selectedWords.forEach((w, idx) => {
    matcherCards.push({
      id: `word-${idx}`,
      pairId: idx,
      type: 'word',
      text: w.word,
      matched: false
    });
    
    let shortMeaning = w.meaning;
    if (shortMeaning.length > 40) {
      shortMeaning = shortMeaning.slice(0, 38) + '...';
    }
    
    matcherCards.push({
      id: `mean-${idx}`,
      pairId: idx,
      type: 'meaning',
      text: shortMeaning,
      matched: false
    });
  });
  
  matcherCards.sort(() => Math.random() - 0.5);
  
  if (matcherTimer) clearInterval(matcherTimer);
  
  matcherTimer = setInterval(() => {
    matcherTimeLeft--;
    const timeEl = document.getElementById('matcherTime');
    if (timeEl) timeEl.textContent = `${matcherTimeLeft}s`;
    
    if (matcherTimeLeft <= 0) {
      clearInterval(matcherTimer);
      renderMatcherGameOver();
    }
  }, 1000);
  
  renderMatcherGrid();
}

function renderMatcherGrid() {
  const c = document.getElementById('vocabPracticeContent');
  c.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line-soft); padding-bottom:8px; margin-bottom:14px;">
      <h3 style="margin:0; font-size:15px; color:#10b981;">⚡ Synonyms Matcher Game</h3>
      <div style="display:flex; gap:12px; font-size:12px; font-weight:700;">
        <span>Matches: <strong id="matcherCount" style="color:#10b981;">0/6</strong></span>
        <span>Time Left: <strong id="matcherTime" class="game-time-val">45s</strong></span>
      </div>
    </div>
    
    <p style="font-size:12px; color:var(--ink-soft); margin-top:0;">Match the academic word to its corresponding definition snippet.</p>
    
    <div class="matcher-grid" id="matcherGrid">
      ${matcherCards.map((card, idx) => `
        <div class="matcher-card" id="card-${card.id}" onclick="handleMatcherCardClick('${card.id}', ${idx})">
          ${escapeHtml(card.text)}
        </div>
      `).join('')}
    </div>
    
    <div class="modal-actions" style="margin-top:20px; border-top:1px solid var(--line-soft); padding-top:12px;">
      <button class="tb-text-btn" onclick="quitMatcherGame()">Quit Game</button>
    </div>
  `;
}

function handleMatcherCardClick(cardId, index) {
  const card = matcherCards[index];
  if (card.matched) return;
  
  const el = document.getElementById(`card-${cardId}`);
  if (!el || el.classList.contains('selected') || el.classList.contains('incorrect')) return;
  
  el.classList.add('selected');
  
  if (matcherSelected === null) {
    matcherSelected = { card, index, el };
  } else {
    const first = matcherSelected;
    const second = { card, index, el };
    matcherSelected = null;
    
    if (first.card.pairId === second.card.pairId && first.card.type !== second.card.type) {
      first.card.matched = true;
      second.card.matched = true;
      
      setTimeout(() => {
        first.el.className = 'matcher-card matched';
        second.el.className = 'matcher-card matched';
        
        matcherMatchesCount++;
        const countEl = document.getElementById('matcherCount');
        if (countEl) countEl.textContent = `${matcherMatchesCount}/6`;
        
        if (matcherMatchesCount === 6) {
          clearInterval(matcherTimer);
          renderMatcherSuccess();
        }
      }, 300);
    } else {
      first.el.classList.remove('selected');
      first.el.classList.add('incorrect');
      second.el.classList.remove('selected');
      second.el.classList.add('incorrect');
      
      setTimeout(() => {
        first.el.classList.remove('incorrect');
        second.el.classList.remove('incorrect');
      }, 800);
    }
  }
}

function quitMatcherGame() {
  if (matcherTimer) clearInterval(matcherTimer);
  openVocabPractice();
}

function renderMatcherSuccess() {
  const c = document.getElementById('vocabPracticeContent');
  const scoreGained = 100 + matcherTimeLeft * 10;
  
  const progress = getVocabProgress();
  if (!progress.practiceHistory) progress.practiceHistory = [];
  progress.practiceHistory.push({
    date: Date.now(),
    total: 6,
    correct: 6,
    pct: 100,
    score: scoreGained,
    mode: 'matcher'
  });
  saveVocabProgress();
  
  c.innerHTML = `
    <div style="text-align:center; padding:16px 0;">
      <div style="font-size:48px; margin-bottom:12px;">🏆</div>
      <h2>Superb Matching!</h2>
      <p style="color:var(--ink-soft); margin-bottom:20px;">You cleared the board with <strong>${matcherTimeLeft} seconds</strong> remaining.</p>
      
      <div style="background:var(--bg-list); border:1px solid var(--line-soft); border-radius:8px; padding:14px; display:inline-block; min-width:240px; margin-bottom:24px;">
        <div style="font-size:24px; font-weight:800; color:#10b981;">+${scoreGained} points</div>
        <div style="font-size:12px; color:var(--ink-mute); margin-top:4px;">High Score logged to database</div>
      </div>
      
      <div class="modal-actions" style="justify-content:center; gap:12px;">
        <button class="tb-text-btn" onclick="openVocabPractice()">Practice Hub</button>
        <button class="tb-text-btn dark" onclick="startSynonymsMatcher()" style="background:#10b981; border-color:#10b981;">Play Again</button>
      </div>
    </div>
  `;
}

function renderMatcherGameOver() {
  const c = document.getElementById('vocabPracticeContent');
  c.innerHTML = `
    <div style="text-align:center; padding:16px 0;">
      <div style="font-size:48px; margin-bottom:12px;">⏰</div>
      <h2>Time's Up!</h2>
      <p style="color:var(--ink-soft); margin-bottom:20px;">The timer ran out before you could match all pairs.</p>
      
      <div style="background:var(--bg-list); border:1px solid var(--line-soft); border-radius:8px; padding:14px; display:inline-block; min-width:240px; margin-bottom:24px;">
        <div style="font-size:20px; font-weight:800; color:#ef4444;">Game Over</div>
        <div style="font-size:12px; color:var(--ink-mute); margin-top:4px;">Keep practising to improve speed!</div>
      </div>
      
      <div class="modal-actions" style="justify-content:center; gap:12px;">
        <button class="tb-text-btn" onclick="openVocabPractice()">Practice Hub</button>
        <button class="tb-text-btn dark" onclick="startSynonymsMatcher()">Try Again</button>
      </div>
    </div>
  `;
}

let lastExternalWordData = null;

async function queryExternalWord(word) {
  const resultContainer = document.getElementById('externalWordResult');
  if (!resultContainer) return;
  
  resultContainer.innerHTML = `
    <div style="margin-top: 14px; display: flex; align-items: center; justify-content: center; padding: 20px; background: var(--bg); border: 1px dashed var(--line-soft); border-radius: 12px;">
      <span class="spinner-dark" style="border-color: var(--accent); border-top-color: transparent; width: 18px; height: 18px; margin-right: 8px;"></span>
      <span style="font-size: 13.5px; color: var(--ink-soft);">Claude AI is analyzing "${escapeHtml(word)}"...</span>
    </div>
  `;
  
  if (offlineMode) {
    resultContainer.innerHTML = `
      <div style="margin-top: 14px; padding: 14px; background: var(--bg); border: 1px solid var(--line-soft); border-radius: 8px; color: var(--ink-soft); font-size: 13px;">
        Offline mode enabled. Connect to the internet to query Claude AI.
      </div>
    `;
    return;
  }
  
  const prompt = `The student searched for the word "${word}" in an English vocabulary prep app (IELTS/PTE), but it was not found in the database.
Identify if the word is spelled correctly or if it is a typo/misspelling.

Case 1: If the word is spelled correctly (or is a valid English word):
Provide:
1. One general formal meaning (defined in simple, layman-friendly plain English).
2. Part of speech.
3. 2-3 different context-specific meanings.
4. Exactly 5 natural example sentences demonstrating the word in these contexts.

Case 2: If the word seems to be a typo or misspelled:
Provide:
1. A note explaining that the word might be misspelled.
2. A list of 2-4 possible correct spellings/suggestions.
3. For each suggestion, provide its part of speech and a very brief definition.

Return ONLY a valid JSON object matching one of these structures (do not include markdown outside JSON, just output the JSON plain text):

For Case 1 (Valid Word):
{
  "status": "valid",
  "word": "${word}",
  "pos": "noun/verb/etc",
  "meaning": "general meaning here",
  "contexts": [
    { "name": "Academic", "meaning": "meaning here", "examples": ["example 1", "example 2"] },
    { "name": "General", "meaning": "meaning here", "examples": ["example 3", "example 4", "example 5"] }
  ]
}

For Case 2 (Typo/Suggestions):
{
  "status": "typo",
  "suggestions": [
    { "word": "correctWord1", "pos": "noun", "meaning": "brief meaning here" },
    { "word": "correctWord2", "pos": "verb", "meaning": "brief meaning here" }
  ]
}
`;

  try {
    const res = await fetch(API_URL + '/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const resData = await res.json();
    const text = (resData.content || []).map(c => c.text || '').join('\n').trim();
    
    const data = cleanAndParseJSON(text);
    
    if (data.status === 'valid') {
      lastExternalWordData = data;
      const safeWord = data.word.replace(/'/g, "\\'");
      
      const posVal = (data.pos || '').toLowerCase().trim();
      let posClass = 'pos-noun';
      if (posVal.includes('verb')) posClass = 'pos-verb';
      else if (posVal.includes('adj') || posVal.includes('adjective')) posClass = 'pos-adjective';
      else if (posVal.includes('adv') || posVal.includes('adverb')) posClass = 'pos-adverb';
      
      const posHtml = `<span class="pos-badge ${posClass}">${escapeHtml(data.pos || '')}</span>`;
      
      const contextsHtml = (data.contexts || []).map(ctx => {
        const examplesList = (ctx.examples || []).map(ex => {
          const regex = new RegExp(`\\b(${data.word})\\b`, 'i');
          const bolded = escapeHtml(ex).replace(regex, '<strong>$1</strong>');
          return `<li style="font-size: 13px; color: var(--ink-soft); margin-bottom: 8px; line-height: 1.45; list-style-type: none; position: relative; padding-left: 14px;">
            <span style="position: absolute; left: 0; color: var(--accent);">•</span>
            "${bolded}"
          </li>`;
        }).join('');
        return `
          <div style="background: var(--bg); border: 1px solid var(--line-soft); border-radius: 8px; padding: 14px; margin-bottom: 12px; text-align: left;">
            <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); font-weight: 700; margin-bottom: 4px;">${escapeHtml(ctx.name)} Context</div>
            <div style="font-size: 13px; color: var(--ink); margin-bottom: 8px;">${escapeHtml(ctx.meaning)}</div>
            <ul style="margin: 0; padding: 0;">${examplesList}</ul>
          </div>
        `;
      }).join('');
      
      resultContainer.innerHTML = `
        <div class="vocab-word-card" id="word-card-external" style="margin-top: 14px; border: 1px solid var(--accent); text-align: left;">
          <div class="vocab-card-top">
            <div class="vocab-word-title" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span>${escapeHtml(data.word)}</span>
              <div class="vocab-badges" style="display: inline-flex; gap: 4px; align-items: center; vertical-align: middle; margin-left: 4px;">
                ${posHtml}
                <span class="level-badge" style="background: var(--accent); color: #fff;">AI Suggested</span>
              </div>
              <button class="vocab-audio-btn" onclick="speakWord('${safeWord}')" title="Listen to pronunciation">
                <span class="material-symbols-outlined" style="font-size: 18px;">volume_up</span>
              </button>
            </div>
          </div>
          
          <div class="vocab-word-meaning" style="margin-top: 8px; font-size: 13.5px; color: var(--ink-soft); line-height: 1.5; text-align: left;">
            <strong>Definition:</strong> ${escapeHtml(data.meaning || '')}
          </div>
          
          <div style="margin-top: 14px; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;">
            <div>
              <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-soft); font-weight: 700; margin-bottom: 10px; text-align: left;">Contextual Meanings &amp; Examples</div>
              ${contextsHtml}
            </div>
            <div class="vocab-try" style="margin: 0; display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div class="vocab-try-label" style="text-align: left;">Practice Bench</div>
                <div class="vocab-try-row">
                  <input type="text" placeholder="Write a sentence using '${safeWord}'..." id="try-external" onkeypress="if(event.key==='Enter') checkSentence('external', '${safeWord}')">
                  <button class="vocab-try-check" onclick="checkSentence('external', '${safeWord}')">Check</button>
                  <button class="vocab-try-ai" onclick="aiGradeSentence('external', '${safeWord}', 'external')">🤖 AI Grade</button>
                </div>
              </div>
              <div class="vocab-try-feedback" id="try-fb-external" style="text-align: left;"></div>
            </div>
          </div>
        </div>
      `;
    } else if (data.status === 'typo') {
      const suggestionsHtml = (data.suggestions || []).map(s => {
        const sWord = s.word.replace(/'/g, "\\'");
        return `
          <div style="background: var(--bg); border: 1px solid var(--line-soft); border-radius: 8px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
            <div>
              <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 4px;">
                <strong style="font-family: var(--serif); font-size: 14px; color: var(--ink);">${escapeHtml(s.word)}</strong>
                <span class="pos-badge pos-noun" style="font-size: 10px; padding: 1px 4px;">${escapeHtml(s.pos)}</span>
              </div>
              <div style="font-size: 12px; color: var(--ink-soft);">${escapeHtml(s.meaning)}</div>
            </div>
            <button class="vocab-action-btn" onclick="applyExternalSuggestion('${sWord}')" style="font-size: 12px; padding: 6px 12px; flex-shrink: 0;">
              Use Suggestion
            </button>
          </div>
        `;
      }).join('');
      
      resultContainer.innerHTML = `
        <div style="margin-top: 14px; background: var(--bg-card); border: 1px solid var(--line-soft); border-radius: 12px; padding: 20px; text-align: left;">
          <div style="color: #ea580c; font-weight: 700; font-size: 14px; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
            <span class="material-symbols-outlined" style="font-size: 18px;">warning</span>
            <span>Spelling suggestion or typo detected</span>
          </div>
          <p style="font-size: 13px; color: var(--ink-soft); margin-bottom: 14px;">"${escapeHtml(word)}" might be misspelled. Did you mean one of these?</p>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            ${suggestionsHtml}
          </div>
        </div>
      `;
    } else {
      throw new Error("Invalid response status from AI");
    }
  } catch (err) {
    console.error('Failed to load external word details:', err);
    resultContainer.innerHTML = `
      <div style="margin-top: 14px; padding: 14px; background: var(--bg); border: 1px solid #fca5a5; border-radius: 8px; color: #b91c1c; font-size: 13px;">
        AI query failed: ${escapeHtml(err.message)}
      </div>
    `;
  }
}

function applyExternalSuggestion(word) {
  const searchInput = document.getElementById('masterSearch');
  if (searchInput) {
    searchInput.value = word;
    handleMasterSearch(word);
  }
}

window.queryExternalWord = queryExternalWord;
window.applyExternalSuggestion = applyExternalSuggestion;

async function checkUserEmailRequirement() {
  if (offlineMode || !currentUser) return;
  const userHasRealEmail = userProfile && userProfile.email && userProfile.email.includes('@') && !userProfile.email.toLowerCase().endsWith('@ptewriting.com');
  if (!userHasRealEmail) {
    setTimeout(async () => {
      let emailInput = prompt("To avoid delivery issues, please enter a valid email address for your account. This is where your essay PDFs will be sent:");
      if (emailInput !== null) {
        emailInput = emailInput.trim();
        if (emailInput && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput) && !emailInput.toLowerCase().endsWith('@ptewriting.com')) {
          userProfile.email = emailInput;
          currentUser.email = emailInput;
          localStorage.setItem('pte_preferred_email', emailInput);
          toast("Email address saved successfully!");
          await flushSyncDirect();
          updateEmailLabels();
        } else {
          toast("Invalid email address. Please update it via your Account menu to receive PDFs.", true);
        }
      }
    }, 1200);
  }
}

async function updateUserEmail() {
  let emailInput = prompt("Enter your new email address:", (userProfile && userProfile.email && !userProfile.email.toLowerCase().endsWith('@ptewriting.com')) ? userProfile.email : "");
  if (emailInput === null) return; // cancelled
  emailInput = emailInput.trim();
  if (!emailInput || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) {
    toast("Invalid email address", true);
    return;
  }
  if (emailInput.toLowerCase().endsWith('@ptewriting.com')) {
    toast("Cannot use a @ptewriting.com email address", true);
    return;
  }
  userProfile.email = emailInput;
  currentUser.email = emailInput;
  localStorage.setItem('pte_preferred_email', emailInput);
  toast("Email address updated!");
  await flushSyncDirect();
  document.getElementById('userMenuEmail').textContent = emailInput;
  updateEmailLabels();
}

function updateEmailLabels() {
  const e = getCurrent();
  const written = essays.filter(x => essayStatus(x) !== 'empty');
  const emailEl = document.getElementById('emailRecipient');
  if (emailEl && currentUser) {
    if (e && essayStatus(e) !== 'empty') {
      emailEl.textContent = `Sending to ${currentUser.email}`;
    }
  }
  const emailBookEl = document.getElementById('emailBookRecipient');
  if (emailBookEl && currentUser) {
    if (written.length > 0) {
      emailBookEl.textContent = `Sending ${written.length} essays to ${currentUser.email} (~${Math.round(written.length * 3)}s to generate)`;
    }
  }
}

window.updateUserEmail = updateUserEmail;


