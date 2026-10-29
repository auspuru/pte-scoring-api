'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { definition } = require('../full-mock/authoring');
const { hash } = require('../full-mock/audit');
const { render } = require('../speaking-visuals');
const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'content/full-mock/visual-manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
for (const question of definition().filter(q => q.type === 'di')) {
  const svg = render(question.visual).replace('viewBox=', 'width="730" height="500" viewBox='), digest = hash(svg);
  const relative = 'content/full-mock/assets/' + digest + '.svg';
  const file = path.join(root, relative);
  if (manifest[question.id] && manifest[question.id].sha256 !== digest) throw Error('Visual changed; create a new version: ' + question.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, svg, { flag: 'wx' });
  if (hash(fs.readFileSync(file)) !== digest) throw Error('Visual bytes changed: ' + question.id);
  manifest[question.id] = { path: relative, sha256: digest, width: 730, height: 500,
    sourceFingerprint: hash(JSON.stringify(question.visual)), kind: question.visual.kind };
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('Five original Full Mock visuals generated with pinned source data.');
