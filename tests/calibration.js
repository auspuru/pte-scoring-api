'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const passages = JSON.parse(fs.readFileSync(path.join(root, 'passages.json'), 'utf8'));
const port = 3199;
const base = `http://127.0.0.1:${port}`;
const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'pte-calibration-'));

function checkStudentAdminEntryRemoved() {
  const client = fs.readFileSync(path.join(root, 'public', 'index.js'), 'utf8');
  assert(client.includes('STUDENT PORTAL — ADMIN ENTRY REMOVED'), 'Admin-entry removal guard is missing');
  assert(/function isAdmin\(\)\s*\{\s*return false;\s*\}/.test(client), 'Student client can still enable admin mode');
  assert(!/adminBtn\.style\.display\s*=\s*['"]['"]/.test(client), 'Student client can still reveal the admin navigation control');
}

const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'development',
    RAILWAY_VOLUME_MOUNT_PATH: tempData,
    DISABLE_EXTERNAL_SPELLCHECK: '1',
    SKIP_PUPPETEER_WARMUP: '1',
    ANTHROPIC_API_KEY: ''
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverLog = '';
server.stdout.on('data', chunk => { serverLog += chunk.toString(); });
server.stderr.on('data', chunk => { serverLog += chunk.toString(); });

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch (_) {}
    await sleep(200);
  }
  throw new Error(`Server did not become ready.\n${serverLog}`);
}

async function grade(passage, text) {
  const res = await fetch(`${base}/api/grade`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      type: 'swt',
      prompt: passage.text,
      keyPoints: passage.keyElements,
      passageId: passage.id
    })
  });
  if (!res.ok) throw new Error(`Grade request failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  checkStudentAdminEntryRemoved();
  console.log('PASS  Student-facing admin entry removed');
  await waitForServer();
  let failed = false;
  const calibrationPassages = passages.filter(p => p.officialCalibration);

  console.log('Provisional offline checks for existing user benchmarks');
  for (const passage of calibrationPassages) {
    const result = await grade(passage, passage.officialCalibration.response);
    // Without the semantic provider, word overlap cannot certify complete
    // relationships. Keep these checks for form/grammar and provisional status;
    // the full-score policy is exercised in swt-scoring-policy.test.js.
    const ok = result.band !== 'Band 9'
      && result.trait_scores?.content <= 3
      && result.trait_scores?.form === 1
      && result.trait_scores?.grammar === 2
      && result.score_provisional === true
      && result.scoring_criteria?.profile === 'Content 4 + Form 1 + Grammar 2 + Vocabulary 2';
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${passage.id}. ${passage.title}: ${result.band}, PTE ${result.overall_score}, raw ${result.raw_score}`);
    if (!ok) {
      failed = true;
      console.log(JSON.stringify({ traits: result.trait_scores, content: result.content_details, grammar: result.grammar_details }, null, 2));
    }
  }

  const tourism = passages.find(p => p.id === 8);
  const controls = [
    {
      name: 'Off-topic control',
      text: 'The internet is useful for students because it provides information and entertainment; therefore, schools should provide computers to everyone.',
      pass: r => r.band !== 'Band 9' && r.trait_scores?.content === 0
    },
    {
      name: 'One-idea control',
      text: 'Travel and tourism contributes greatly to global GDP and employment.',
      pass: r => r.band !== 'Band 9' && r.trait_scores?.content < 4
    },
    {
      name: 'No-semicolon full-content control',
      text: 'Travel and tourism contributes substantially to global GDP and employment while providing opportunities for women, minorities and young people, supporting environmental conservation and local culture, and offering comparatively low start-up and operating costs.',
      pass: r => r.trait_scores?.grammar === 2 && r.score_provisional === true && r.trait_scores?.content <= 3
    }
  ];

  console.log('\nNegative and structure controls');
  for (const control of controls) {
    const result = await grade(tourism, control.text);
    const ok = control.pass(result);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${control.name}: ${result.band}, Content ${result.trait_scores?.content}/4, Grammar ${result.trait_scores?.grammar}/2`);
    if (!ok) failed = true;
  }

  if (failed) process.exitCode = 1;
}

main()
  .catch(err => {
    console.error(err.stack || err);
    process.exitCode = 1;
  })
  .finally(() => {
    server.kill('SIGTERM');
    try { fs.rmSync(tempData, { recursive: true, force: true }); } catch (_) {}
  });
