'use strict';

// Brisbane is UTC+10 year-round. Date-only access includes the entire expiry day.
const TIME_ZONE = 'Australia/Brisbane';
function date(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') throw Error('Use a valid date from 1900 onwards.');
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) throw Error('Use a valid calendar date.');
  return value;
}
function validate(startsOn, expiresOn) {
  const accessStartsOn = date(startsOn), accessExpiresOn = date(expiresOn);
  if (accessStartsOn && accessExpiresOn && accessExpiresOn < accessStartsOn) throw Error('Expiry date must be on or after the start date.');
  return { accessStartsOn, accessExpiresOn };
}
function state(account, now = Date.now()) {
  const startsOn = account?.accessStartsOn || null, expiresOn = account?.accessExpiresOn || null;
  const today = new Date(now + 10*60*60*1000).toISOString().slice(0,10);
  return { startsOn, expiresOn, timeZone:TIME_ZONE, status:expiresOn && today > expiresOn ? 'expired' : startsOn && today < startsOn ? 'scheduled' : 'active' };
}
function denial(account, now) {
  const access = state(account, now);
  if (access.status === 'active') return null;
  const value = access.status === 'expired' ? access.expiresOn : access.startsOn;
  const label = new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z'));
  return { code:'PORTAL_ACCESS_'+access.status.toUpperCase(), portalAccess:access,
    error:access.status === 'expired' ? 'Your portal access expired on '+label+' (Brisbane time). Contact IPT Brisbane to renew.' : 'Your portal access starts on '+label+' (Brisbane time).' };
}
module.exports = { validate, state, denial };
