'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compare } = require('../full-mock/validation');
function main(args = process.argv.slice(2)) {
  if (args.length > 1) throw Error('Usage: compare-full-mock-benchmarks.js [consented-anonymous-dataset.json]');
  let dataset; try { dataset = JSON.parse(fs.readFileSync(args[0] || path.join(__dirname, '../content/full-mock/benchmark-template.json'), 'utf8')); } catch { throw Error('The benchmark dataset could not be read.'); }
  return compare(dataset);
}
if (require.main === module) { try { console.log(JSON.stringify(main(), null, 2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { main };
