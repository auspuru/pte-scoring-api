'use strict';

const { createServer } = require('node:http');

const phase = process.env.PTE_DB_CUTOVER_PHASE || '';
const match = /^maintenance-(\d{4}-\d{2}-\d{2})$/.exec(phase);
if (!match) {
  throw new Error('A dated database cutover phase is required');
}

const server = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/api/ready') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ready: true, mode: 'pte-db-maintenance-' + match[1] }));
    return;
  }

  res.writeHead(503, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Retry-After': '600',
  });
  res.end('The IPT Brisbane PTE portal is briefly down for scheduled maintenance. Please try again in a few minutes.');
});

server.listen(Number(process.env.PORT || 8080), '::', () => {
  console.log('PTE_DB_MAINTENANCE_ACTIVE');
});
