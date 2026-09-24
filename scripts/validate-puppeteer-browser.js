'use strict';

const fs = require('fs');
const puppeteer = require('puppeteer');

async function main() {
  const executable = await puppeteer.executablePath();
  if (!executable || !fs.existsSync(executable)) {
    throw new Error(`Puppeteer browser executable is missing: ${executable || 'unresolved'}`);
  }
  console.log(`Puppeteer browser verified: ${executable}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
