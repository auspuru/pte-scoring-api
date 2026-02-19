// Simple file-based storage for PTE grading attempts
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const ATTEMPTS_FILE = path.join(DATA_DIR, 'attempts.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize attempts file if it doesn't exist
if (!fs.existsSync(ATTEMPTS_FILE)) {
  fs.writeFileSync(ATTEMPTS_FILE, JSON.stringify([]));
}

function readAttempts() {
  try {
    const data = fs.readFileSync(ATTEMPTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading attempts:', error);
    return [];
  }
}

function writeAttempts(attempts) {
  try {
    fs.writeFileSync(ATTEMPTS_FILE, JSON.stringify(attempts, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing attempts:', error);
    return false;
  }
}

module.exports = {
  // Save a new grading attempt
  saveAttempt: function(attemptData) {
    const attempts = readAttempts();
    const newAttempt = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      timestamp: new Date().toISOString(),
      ...attemptData
    };
    attempts.push(newAttempt);
    writeAttempts(attempts);
    return newAttempt;
  },

  // Get all attempts for a specific session/user
  getUserHistory: function(sessionId) {
    const attempts = readAttempts();
    return attempts
      .filter(a => a.sessionId === sessionId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  // Get all attempts (admin/debug)
  getAllAttempts: function() {
    return readAttempts();
  },

  // Get a single attempt by ID
  getAttemptById: function(id) {
    const attempts = readAttempts();
    return attempts.find(a => a.id === id);
  },

  // Delete old attempts (cleanup)
  deleteOldAttempts: function(daysToKeep = 30) {
    const attempts = readAttempts();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    const filtered = attempts.filter(a => new Date(a.timestamp) > cutoffDate);
    writeAttempts(filtered);
    return attempts.length - filtered.length;
  }
};
