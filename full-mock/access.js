'use strict';
const canonical = value => String(value || '').trim().toLowerCase();
function previewUsers(value = '') {
  const users = String(value).split(',').map(canonical).filter(Boolean);
  if (users.some(user => !/^[a-z0-9][a-z0-9._@-]{0,253}$/.test(user))) throw Error('Full Mock preview access requires exact usernames.');
  return [...new Set(users)];
}
const everyoneEnabled = value => value === true || value === 'true';
function createPreviewAccess({ users = '', all = process.env.FULL_MOCK_PREVIEW_ALL, verifyImpersonation = () => null } = {}) {
  const allowed = new Set(previewUsers(users));
  return ({ account, uid, token }) => {
    const user = canonical(uid);
    if (!account || account.blocked || !user) return false;
    return account.role === 'admin' || everyoneEnabled(all) || allowed.has(user) || canonical(verifyImpersonation(token)) === user;
  };
}
async function checkPreviewAccounts(users, query, { all = false } = {}) {
  if (everyoneEnabled(all)) {
    await query('SELECT 1 FROM accounts LIMIT 0');
    return { mode:'all-signed-in', database:'verified' };
  }
  if (!users.length) return { configured:0, verified:0 };
  const { rows } = await query('SELECT username, blocked FROM accounts WHERE username = ANY($1::text[])', [users]);
  const found = new Map(rows.map(row => [canonical(row.username), row]));
  if (users.some(user => !found.has(user) || found.get(user).blocked)) throw Error('A configured Full Mock preview account is missing or blocked.');
  return { configured:users.length, verified:users.length };
}
module.exports = { previewUsers, createPreviewAccess, checkPreviewAccounts, everyoneEnabled };
