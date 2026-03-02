/**
 * PTE SWT Practice Portal - Storage Module
 * Handles local persistence of user progress, scores, and summaries
 */

const STORAGE_KEYS = {
  ATTEMPTED: 'pte_attempted_passages',
  SCORES: 'pte_passage_scores',
  SUMMARIES: 'pte_user_summaries',
  PROGRESS: 'pte_overall_progress',
  SETTINGS: 'pte_user_settings'
};

const Storage = {
  // Initialize storage
  init() {
    if (!localStorage.getItem(STORAGE_KEYS.ATTEMPTED)) {
      localStorage.setItem(STORAGE_KEYS.ATTEMPTED, JSON.stringify([]));
    }
    if (!localStorage.getItem(STORAGE_KEYS.SCORES)) {
      localStorage.setItem(STORAGE_KEYS.SCORES, JSON.stringify({}));
    }
    if (!localStorage.getItem(STORAGE_KEYS.SUMMARIES)) {
      localStorage.setItem(STORAGE_KEYS.SUMMARIES, JSON.stringify({}));
    }
    console.log('✅ Storage initialized');
  },

  // Save a passage attempt
  saveAttempt(passageId, summaryText, scoreData) {
    const attempted = this.getAttempted();
    if (!attempted.includes(passageId)) {
      attempted.push(passageId);
      localStorage.setItem(STORAGE_KEYS.ATTEMPTED, JSON.stringify(attempted));
    }

    // Save summary
    const summaries = this.getSummaries();
    summaries[passageId] = {
      text: summaryText,
      timestamp: new Date().toISOString(),
      score: scoreData?.overall_score || 0
    };
    localStorage.setItem(STORAGE_KEYS.SUMMARIES, JSON.stringify(summaries));

    // Save detailed score
    if (scoreData) {
      const scores = this.getScores();
      scores[passageId] = {
        ...scoreData,
        timestamp: new Date().toISOString()
      };
      localStorage.setItem(STORAGE_KEYS.SCORES, JSON.stringify(scores));
    }

    return true;
  },

  // Get attempted passage IDs
  getAttempted() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.ATTEMPTED)) || [];
    } catch {
      return [];
    }
  },

  // Get all saved summaries
  getSummaries() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.SUMMARIES)) || {};
    } catch {
      return {};
    }
  },

  // Get score history
  getScores() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.SCORES)) || {};
    } catch {
      return {};
    }
  },

  // Get specific passage data
  getPassageData(passageId) {
    const summaries = this.getSummaries();
    const scores = this.getScores();
    return {
      summary: summaries[passageId] || null,
      score: scores[passageId] || null,
      attempted: this.getAttempted().includes(passageId)
    };
  },

  // Get progress statistics
  getProgress(totalPassages = 36) {
    const attempted = this.getAttempted();
    const scores = this.getScores();
    
    let totalScore = 0;
    let count = 0;
    
    Object.values(scores).forEach(s => {
      if (s.overall_score) {
        totalScore += s.overall_score;
        count++;
      }
    });

    return {
      completed: attempted.length,
      total: totalPassages,
      percentage: Math.round((attempted.length / totalPassages) * 100),
      averageScore: count > 0 ? Math.round(totalScore / count) : 0,
      bandDistribution: this._calculateBands(scores)
    };
  },

  // Calculate band distribution
  _calculateBands(scores) {
    const bands = { 'Band 5': 0, 'Band 6': 0, 'Band 7': 0, 'Band 8': 0, 'Band 9': 0 };
    Object.values(scores).forEach(s => {
      if (s.band && bands[s.band] !== undefined) {
        bands[s.band]++;
      }
    });
    return bands;
  },

  // Clear all data
  clearAll() {
    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
    this.init();
  },

  // Export data as JSON (for backup)
  exportData() {
    return JSON.stringify({
      attempted: this.getAttempted(),
      summaries: this.getSummaries(),
      scores: this.getScores(),
      exportedAt: new Date().toISOString()
    }, null, 2);
  },

  // Import data from JSON
  importData(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (data.attempted) localStorage.setItem(STORAGE_KEYS.ATTEMPTED, JSON.stringify(data.attempted));
      if (data.summaries) localStorage.setItem(STORAGE_KEYS.SUMMARIES, JSON.stringify(data.summaries));
      if (data.scores) localStorage.setItem(STORAGE_KEYS.SCORES, JSON.stringify(data.scores));
      return true;
    } catch (e) {
      console.error('Import failed:', e);
      return false;
    }
  },

  // Save user settings
  saveSettings(settings) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  },

  // Get user settings
  getSettings() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)) || {};
    } catch {
      return {};
    }
  }
};

// Auto-init when loaded
Storage.init();

// Make available globally
window.PTEStorage = Storage;
