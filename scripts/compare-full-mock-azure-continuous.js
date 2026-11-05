'use strict';

const { Pool } = require('pg');
const { digest } = require('../full-mock/paper');
const { buildReport, recordingBytes } = require('../full-mock/report');
const { uuid } = require('../full-mock/store');
const continuous = require('../azure-continuous-delivery');

async function main() {
  const [username, id, mode, ...extra] = process.argv.slice(2);
  if (!username || !uuid(id) || !['--inventory', '--send'].includes(mode) || extra.length) {
    throw Error('Usage: node scripts/compare-full-mock-azure-continuous.js <username> <attempt UUID> --inventory|--send');
  }
  const connectionString = process.env.PGURL || process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
  if (!connectionString) throw Error('The portal database must be connected through the runtime environment.');
  if (mode === '--send' && !continuous.configuration().ready) {
    throw Error('The runtime must have the Azure Speech key and endpoint or region configured.');
  }
  const isLocal = /(\blocalhost\b|127\.0\.0\.1|@\/|host=\/)/.test(connectionString);
  const sslDisabled = process.env.PGSSL === 'disable' || (isLocal && process.env.PGSSL !== 'require');
  const pool = new Pool({ connectionString, ssl: sslDisabled ? false : { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const { rows: [record] } = await pool.query(
      'SELECT paper,state FROM full_mock_attempts WHERE id=$1 AND username=$2', [id, username]
    );
    if (!record || record.state.status !== 'submitted' || digest(record.paper) !== record.state.paperHash) {
      throw Error('A verified submitted attempt for that account is required.');
    }
    const report = buildReport(record.paper, record.state);
    for (const [index, candidate] of record.paper.questions.entries()) {
      const { id: questionId, type } = candidate.question;
      if (!['ra', 'rs', 'di', 'rl', 'asq', 'sgd', 'rts'].includes(type)) continue;
      const response = record.state.responses[index + 1];
      const item = report.items[index];
      const row = { question: index + 1, questionId, type, publishedStatus: item?.status ?? null,
        previous: { pronunciation: item?.scores?.pronunciation ?? null, fluency: item?.scores?.fluency ?? null } };
      const saved = response?.segments.filter(segment => !segment.cancelled) || [];
      if (!saved.length) { console.log(JSON.stringify({ ...row, status: 'no-recording' })); continue; }
      for (const [segmentIndex, segment] of saved.entries()) {
        const entry = { ...row, recording: segmentIndex + 1, diagnosticOnly: type === 'asq' };
        let audio;
        try {
          audio = await recordingBytes(username, id, response, segment.id, async (owner, attempt, segmentId, sequence) => {
            const { rows: [chunk] } = await pool.query(
              'SELECT c.sha256,c.mime,c.payload AS bytes FROM full_mock_audio_chunks c JOIN full_mock_attempts a ON a.id=c.attempt_id WHERE a.id=$1 AND a.username=$2 AND c.segment_id=$3 AND c.sequence=$4',
              [attempt, owner, segmentId, sequence]
            );
            return chunk;
          });
        } catch (error) {
          if (!error.status) throw error;
          console.log(JSON.stringify({ ...entry, status: 'recording-unavailable' }));
          continue;
        }
        if (mode === '--inventory') {
          console.log(JSON.stringify({ ...entry, status: 'verified' }));
          continue;
        }
        try {
          const result = await continuous.assessRecording({ mime: audio.mime, data: audio.bytes.toString('base64') });
          console.log(JSON.stringify({ ...entry, status: 'assessed', result }));
        } catch (error) {
          console.log(JSON.stringify({ ...entry, status: error.uncertain ? 'confirmation-pending' : 'not-assessed' }));
          if (error.uncertain) throw Error('Stopped after an unconfirmed Azure request. Keep the earlier results before resuming.');
        }
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  // Do not print database/provider payloads or connection details.
  console.error(error.code ? 'The comparison could not complete in the connected runtime.' : error.message);
  process.exitCode = 1;
});
