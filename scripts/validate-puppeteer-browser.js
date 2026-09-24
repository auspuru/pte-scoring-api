'use strict';

const fs = require('fs');
const puppeteer = require('puppeteer');

const executable = puppeteer.executablePath();
if (!executable || !fs.existsSync(executable)) {
  throw new Error(`Puppeteer browser executable is missing: ${executable || 'unresolved'}`);
}

console.log(`Puppeteer browser verified: ${executable}`);
