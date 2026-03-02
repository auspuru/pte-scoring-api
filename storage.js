/**
 * PTE SWT Practice Portal - Storage Module
 * Per-user namespaced storage — each username gets isolated keys.
 * Auth keys (password hash, secret question) are separate from data keys.
 */

// ── Auth key helpers (mirrors index_v2.html) ─────────────────────────────────
const AuthKeys = {
  password:   u => 'pte_auth_'  + u.toLowerCase().trim(),
  secretQ:    u => 'pte_sqq_'   + u.toLowerCase().trim(),
  secretA:    u => 'pte_sq_'    + u.toLowerCase().trim(),
  lastUser:   ()  => 'pte_user_id'
};

// ── Per-user data key factory ─────────────────────────────────────────────────
function getUserKeys(userId) {
  const u = (userId || 'default').toLowerCase().trim();
  return {
    ATTEMPTED: `pte_${u}_attempted`,
    SCORES:    `pte_${u}_scores`,
    SUMMARIES: `pte_${u}_summaries`,
    HISTORY:   `pte_${u}_history`,
    SETTINGS:  `pte_${u}_settings`
  };
}

// ── Storage module ────────────────────────────────────────────────────────────
const Storage = {
  _userId: null,
  _keys: null,

  /**
   * Must be called after the user logs in.
   * All subsequent operations use this user's namespace.
   */
  init(userId) {
    if (!userId) throw new Error('Storage.init() requires a userId');
    this._userId = userId;
    this._keys   = getUserKeys(userId);
    console.log(`✅ Storage initialized for user: ${userId}`);
  },

  // Guard — throws if init() hasn't been called
  _requireUser() {
    if (!this._userId || !this._keys) {
      throw new Error('Storage not initialized. Call Storage.init(userId) after login.');
    }
  },

  // ── Attempt saving ──────────────────────────────────────────────────────────
  saveAttempt(passageId, summaryText, scoreData) {
    this._requireUser();

    // Update attempted list
    const attempted = this.getAttempted();
    if (!attempted.includes(passageId)) {
      attempted.push(passageId);
      localStorage.setItem(this._keys.ATTEMPTED, JSON.stringify(attempted));
    }

    // Save latest summary
    const summaries = this.getSummaries();
    summaries[passageId] = {
      text:      summaryText,
      timestamp: new Date().toISOString(),
      score:     scoreData?.overall_score || 0
    };
    localStorage.setItem(this._keys.SUMMARIES, JSON.stringify(summaries));

    // Save detailed score
    if (scoreData) {
      const scores = this.getScores();
      scores[passageId] = { ...scoreData, timestamp: new Date().toISOString() };
      localStorage.setItem(this._keys.SCORES, JSON.stringify(scores));
    }

    // Append to history (newest first, max 10 per passage)
    const history = this.getHistory();
    if (!history[passageId]) history[passageId] = [];
    history[passageId].unshift({
      text:            summaryText,
      timestamp:       new Date().toISOString(),
      overall_score:   scoreData?.overall_score   || 0,
      band:            scoreData?.band             || 'Band 5',
      trait_scores:    scoreData?.trait_scores     || {},
      word_count:      scoreData?.word_count       || 0,
      feedback:        scoreData?.feedback         || '',
      content_details: scoreData?.content_details  || {}
    });
    if (history[passageId].length > 10) history[passageId] = history[passageId].slice(0, 10);
    localStorage.setItem(this._keys.HISTORY, JSON.stringify(history));

    return true;
  },

  // ── Getters ─────────────────────────────────────────────────────────────────
  getAttempted() {
    this._requireUser();
    try { return JSON.parse(localStorage.getItem(this._keys.ATTEMPTED)) || []; }
    catch { return []; }
  },

  getSummaries() {
    this._requireUser();
    try { return JSON.parse(localStorage.getItem(this._keys.SUMMARIES)) || {}; }
    catch { return {}; }
  },

  getScores() {
    this._requireUser();
    try { return JSON.parse(localStorage.getItem(this._keys.SCORES)) || {}; }
    catch { return {}; }
  },

  getHistory() {
    this._requireUser();
    try { return JSON.parse(localStorage.getItem(this._keys.HISTORY)) || {}; }
    catch { return {}; }
  },

  getPassageData(passageId) {
    this._requireUser();
    return {
      summary:   this.getSummaries()[passageId]  || null,
      score:     this.getScores()[passageId]      || null,
      history:   this.getHistory()[passageId]     || [],
      attempted: this.getAttempted().includes(passageId)
    };
  },

  // ── Progress statistics ─────────────────────────────────────────────────────
  getProgress(totalPassages = 36) {
    this._requireUser();
    const attempted = this.getAttempted();
    const history   = this.getHistory();

    let totalScore = 0;
    let count      = 0;
    let bestBand   = 'Band 5';
    const bandOrder = ['Band 5','Band 6','Band 6.5','Band 7','Band 7.5','Band 8','Band 9'];

    Object.values(history).forEach(attempts => {
      if (!Array.isArray(attempts)) return;
      attempts.forEach(a => {
        if (a.overall_score !== undefined) { totalScore += a.overall_score; count++; }
        if (a.band && bandOrder.indexOf(a.band) > bandOrder.indexOf(bestBand)) bestBand = a.band;
      });
    });

    return {
      completed:    attempted.length,
      total:        totalPassages,
      percentage:   Math.round((attempted.length / totalPassages) * 100),
      averageScore: count > 0 ? Math.round(totalScore / count) : 0,
      bestBand,
      bandDistribution: this._calculateBands(history)
    };
  },

  _calculateBands(history) {
    const bands = { 'Band 5': 0, 'Band 6': 0, 'Band 6.5': 0, 'Band 7': 0, 'Band 7.5': 0, 'Band 8': 0, 'Band 9': 0 };
    Object.values(history).forEach(attempts => {
      if (!Array.isArray(attempts)) return;
      attempts.forEach(a => {
        if (a.band && bands[a.band] !== undefined) bands[a.band]++;
      });
    });
    return bands;
  },

  // ── Settings ────────────────────────────────────────────────────────────────
  saveSettings(settings) {
    this._requireUser();
    localStorage.setItem(this._keys.SETTINGS, JSON.stringify(settings));
  },

  getSettings() {
    this._requireUser();
    try { return JSON.parse(localStorage.getItem(this._keys.SETTINGS)) || {}; }
    catch { return {}; }
  },

  // ── Export / Import ─────────────────────────────────────────────────────────
  exportData() {
    this._requireUser();
    return JSON.stringify({
      userId:    this._userId,
      attempted: this.getAttempted(),
      summaries: this.getSummaries(),
      scores:    this.getScores(),
      history:   this.getHistory(),
      exportedAt: new Date().toISOString()
    }, null, 2);
  },

  importData(jsonString) {
    this._requireUser();
    try {
      const data = JSON.parse(jsonString);
      if (data.attempted) localStorage.setItem(this._keys.ATTEMPTED, JSON.stringify(data.attempted));
      if (data.summaries) localStorage.setItem(this._keys.SUMMARIES, JSON.stringify(data.summaries));
      if (data.scores)    localStorage.setItem(this._keys.SCORES,    JSON.stringify(data.scores));
      if (data.history)   localStorage.setItem(this._keys.HISTORY,   JSON.stringify(data.history));
      return true;
    } catch (e) {
      console.error('Import failed:', e);
      return false;
    }
  },

  // ── Clear current user's data only ─────────────────────────────────────────
  clearUserData() {
    this._requireUser();
    Object.values(this._keys).forEach(key => localStorage.removeItem(key));
    console.log(`🗑️ Cleared all data for user: ${this._userId}`);
  },

  // ── Auth helpers (static — no user context needed) ──────────────────────────
  auth: {
    async _hash(str) {
      const enc = new TextEncoder().encode(str);
      const buf = await crypto.subtle.digest('SHA-256', enc);
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
    },

    userExists(username) {
      return localStorage.getItem(AuthKeys.password(username)) !== null;
    },

    async register(username, password, secretQ, secretA) {
      const pwHash = await this._hash(password);
      localStorage.setItem(AuthKeys.password(username), pwHash);
      if (secretQ && secretA) {
        const aHash = await this._hash(secretA.toLowerCase().trim());
        localStorage.setItem(AuthKeys.secretQ(username), secretQ);
        localStorage.setItem(AuthKeys.secretA(username), aHash);
      }
      localStorage.setItem(AuthKeys.lastUser(), username);
    },

    async verifyPassword(username, password) {
      const stored = localStorage.getItem(AuthKeys.password(username));
      if (!stored) return false;
      return stored === await this._hash(password);
    },

    async verifySecretAnswer(username, answer) {
      const stored = localStorage.getItem(AuthKeys.secretA(username));
      if (!stored) return false;
      return stored === await this._hash(answer.toLowerCase().trim());
    },

    getSecretQuestion(username) {
      const key = localStorage.getItem(AuthKeys.secretQ(username));
      const map = {
        pet:    "What was the name of your first pet?",
        school: "What primary school did you attend?",
        city:   "What city were you born in?",
        mother: "What is your mother's maiden name?",
        food:   "What is your favourite food?",
        friend: "What was your childhood best friend's name?"
      };
      return key ? (map[key] || key) : null;
    },

    async resetPassword(username, newPassword) {
      const pwHash = await this._hash(newPassword);
      localStorage.setItem(AuthKeys.password(username), pwHash);
    },

    getLastUser() {
      return localStorage.getItem(AuthKeys.lastUser()) || '';
    }
  }
};

// Make available globally
window.PTEStorage = Storage;
