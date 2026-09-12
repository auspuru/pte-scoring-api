'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run during npm ci so a deployment cannot ship truncated JavaScript or JSON.
function validatePublicAssets(directory) {
  const checked = [];
  function visit(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) { visit(file); continue; }
      if (!entry.isFile() || !/\.(js|json)$/.test(entry.name)) continue;
      const source = fs.readFileSync(file, 'utf8');
      try {
        if (entry.name.endsWith('.json')) JSON.parse(source);
        else new vm.Script(source, { filename: file });
      } catch (error) {
        throw new Error('Invalid public asset ' + path.relative(directory, file) + ': ' + error.message);
      }
      checked.push(path.relative(directory, file));
    }
  }
  visit(directory);
  for (const required of ['index.js', 'reading-bank.json']) {
    if (!checked.includes(required)) throw new Error('Missing public asset: ' + required);
  }
  return checked;
}

if (require.main === module) {
  const checked = validatePublicAssets(path.join(__dirname, '..', 'public'));
  console.log('Validated ' + checked.length + ' public JavaScript and JSON assets.');
}
module.exports = { validatePublicAssets };
