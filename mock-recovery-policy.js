'use strict';
// A finite retry budget, persisted with each assessment rather than each process.
const DELAYS=Object.freeze([30000,120000,600000,1800000,7200000,21600000,43200000,86400000]);
function failure(error={}) {
  const code=error.httpStatus||error.providerStatus||error.status||error.code||'provider';
  const uncertain=!!error.uncertain||/timeout|abort|apiconnection/i.test(error.name||'')||['ETIMEDOUT','ECONNRESET'].includes(code);
  const blocked=uncertain||[400,401,403,404,409,413,422].includes(Number(code))||['insufficient_quota','billing_hard_limit_reached','invalid_api_key'].includes(code)||['insufficient_quota','billing_hard_limit_reached','invalid_api_key'].includes(error.code);
  return {code:typeof code==='number'||/^[a-zA-Z0-9_:-]{1,80}$/.test(String(code))?code:'provider',uncertain,blocked};
}
function retryState(error,attempts,at) {
  const reason=failure(error),delay=DELAYS[attempts-1];
  return {...reason,attempts,status:reason.blocked?'held':delay===undefined?'exhausted':'retry_wait',...(delay===undefined||reason.blocked?{}:{nextAt:at+delay})};
}
module.exports={DELAYS,failure,retryState};
