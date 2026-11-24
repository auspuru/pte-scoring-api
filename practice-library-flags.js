'use strict';

const catalogue = require('./public/practice-catalogue');
const { createTextMatcher, maskPassageBlanks, passagePreview } = require('./public/practice-studio');
const { validPassageId } = require('./swt-exam-reports');

const reading = catalogue.readingLibraries(require('./public/reading-bank.json'));
const speaking = require('./content/speaking-bank').questions;
const additionalEssaySeeds = new Set(['seed_35', 'seed_36']);
const ids = new Map();
const searchableQuestions = new Map();
function registerText(task, id, fields, preview) {
  const text = fields.flat().filter(value => typeof value === 'string' && value.trim());
  if (!text.length) return;
  if (!searchableQuestions.has(task)) searchableQuestions.set(task, []);
  searchableQuestions.get(task).push({ id: String(id), text, preview });
}
function register(task, id) {
  if (!ids.has(task)) ids.set(task, new Set());
  ids.get(task).add(String(id));
}
for (const library of reading) {
  const route = ['hcs', 'hiw'].includes(library.id) ? 'listening-' + library.id + '-bank' : 'reading-' + library.id;
  for (const question of library.questions) register(route, question.uid);
}
for (const question of speaking) {
  const route = 'speaking-' + question.type;
  register(route, question.id);
  if (question.type === 'di') {
    const image = question.visual || {};
    registerText(route, question.id, [question.title, question.topic, image.title, image.subtitle,
      image.description, image.labels, image.columns, image.steps]);
  } else {
    const preview = ['ra', 'rts'].includes(question.type) ? question.text : null;
    registerText(route, question.id, [question.text], preview);
  }
}
for (const question of require('./writing-lab').individualQuestions) {
  const route = { sst: 'spoken-text', wfd: 'dictation' }[question.type] || 'listening-' + question.type;
  register(route, question.id);
  const preview = question.passage ? maskPassageBlanks(question.passage) : question.prompt;
  registerText(route, question.id, [question.text, question.prompt, question.passage, question.choices], preview);
}

const flagsSql = `
  SELECT question_id,
    (COUNT(*) FILTER (WHERE kind = 'report'))::integer AS reports,
    BOOL_OR(kind = 'report' AND username = $2) AS reported,
    BOOL_OR(kind = 'bookmark' AND username = $2) AS bookmarked
  FROM practice_question_flags
  WHERE task = $1 AND (kind = 'report' OR username = $2)
    AND ($3::text IS NULL OR question_id = $3)
  GROUP BY question_id`;
const swtSql = `
  SELECT passage_id::text AS question_id, COUNT(*)::integer AS reports,
    BOOL_OR(username = $1) AS reported
  FROM swt_exam_question_reports
  WHERE ($2::integer IS NULL OR passage_id = $2)
  GROUP BY passage_id`;

async function readFlags(pool, task, user, questionId = null) {
  const { rows } = await pool.query(flagsSql, [task, user, questionId]);
  const questions = Object.create(null);
  for (const row of rows) {
    questions[row.question_id] = { count: row.reports, reported: row.reported, bookmarked: row.bookmarked };
  }
  if (task === 'swt') {
    const result = await pool.query(swtSql, [user, questionId]);
    for (const row of result.rows) {
      questions[row.question_id] = { ...questions[row.question_id], count: row.reports, reported: row.reported };
    }
  }
  return questions;
}

async function writeFlag(pool, task, user, questionId, kind, enabled) {
  if (task === 'swt' && kind === 'report') {
    if (enabled) {
      await pool.query('INSERT INTO swt_exam_question_reports (username, passage_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user, questionId]);
    } else {
      await pool.query('DELETE FROM swt_exam_question_reports WHERE username = $1 AND passage_id = $2', [user, questionId]);
    }
  } else {
    const args = [task, kind, questionId, user];
    if (enabled) {
      await pool.query('INSERT INTO practice_question_flags (task, kind, question_id, username) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', args);
    } else {
      await pool.query('DELETE FROM practice_question_flags WHERE task = $1 AND kind = $2 AND question_id = $3 AND username = $4', args);
    }
  }
  return (await readFlags(pool, task, user, questionId))[questionId] || { count: 0 };
}

function installPracticeLibraryFlags(app, { pool, verifyToken, getAccount, speakingAllowed, getPassage, essaySeedCount, rateLimiter }) {
  const authorize = async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const task = req.params.task;
    if (!ids.has(task) && task !== 'swt' && task !== 'practice') return res.status(404).json({ error: 'Unknown practice task.' });
    const username = verifyToken(req.get('x-session-token') || '');
    if (!username) return res.status(401).json({ error: 'Please sign in to access your practice list.' });
    try {
      const account = await getAccount(username);
      if (!account || account.blocked || (task.startsWith('speaking-') && !await speakingAllowed(username))) {
        return res.status(403).json({ error: 'This practice list is unavailable for your account.' });
      }
      req.practiceFlagUser = username;
      next();
    } catch {
      return res.status(503).json({ error: 'Account verification is unavailable.' });
    }
  };
  const search = (req, res) => {
    const value = req.method === 'POST' ? req.body?.q : req.query.q;
    const query = typeof value === 'string' ? value.trim() : '';
    const matches = [];
    const previews = Object.create(null);
    if (query && query.length <= 12000) {
      const { rank } = createTextMatcher(query);
      for (const item of searchableQuestions.get(req.params.task) || []) {
        if (!item.text.some(text => rank(text, false))) continue;
        matches.push(item.id);
        if (req.method === 'POST' && item.preview) {
          previews[item.id] = passagePreview(item.preview, query, 'Read full prompt');
        }
      }
    }
    res.json(req.method === 'POST' ? { matches, previews } : { matches });
  };
  app.get('/api/practice-library/:task/transcript-search', authorize, search);
  app.post('/api/practice-library/:task/transcript-search', authorize, search);
  const requirePool = (req, res, next) => {
    if (!pool) return res.status(503).json({ error: 'Revision and exam reports are unavailable.' });
    next();
  };
  const route = '/api/practice-library/:task/flags';
  app.get(route, authorize, requirePool, async (req, res) => {
    try {
      res.json({ username: req.practiceFlagUser, questions: await readFlags(pool, req.params.task, req.practiceFlagUser) });
    } catch {
      res.status(503).json({ error: 'Could not load revision and exam reports.' });
    }
  });
  const middleware = rateLimiter ? [authorize, requirePool, rateLimiter] : [authorize, requirePool];
  app.put(route, ...middleware, async (req, res) => {
    const task = req.params.task;
    const { questionId, kind, enabled } = req.body || {};
    if (typeof questionId !== 'string' || !/^[\w:.~-]{1,180}$/.test(questionId) || !['report', 'bookmark'].includes(kind) || typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Invalid question update.' });
    }
    try {
      let known;
      if (task === 'swt') {
        const id = validPassageId(questionId);
        known = id !== null && String(id) === questionId && await getPassage(id);
      } else if (task === 'practice') {
        const seed = /^seed_(0|[1-9]\d*)$/.exec(questionId);
        known = kind === 'bookmark' || additionalEssaySeeds.has(questionId) ||
          (!!seed && Number(seed[1]) < essaySeedCount);
      } else {
        known = ids.get(task).has(questionId);
      }
      if (!known) return res.status(404).json({ error: 'Question not found.' });
      res.json(await writeFlag(pool, task, req.practiceFlagUser, questionId, kind, enabled));
    } catch {
      res.status(503).json({ error: 'Could not save the update. Please retry.' });
    }
  });
}

module.exports = { installPracticeLibraryFlags, readFlags, writeFlag };
