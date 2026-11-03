'use strict';
const key=value=>typeof value==='string'?value.trim().toLowerCase():'';
function conflict(){return Object.assign(new Error('An account already uses this email address. Sign in or use Forgot password.'),{status:409,code:'EMAIL_IN_USE'});}
function availableJson(data,email,username){
 if(Object.entries(data.accounts||{}).some(([uid])=>uid!==username&&key(data.users?.[uid]?.email)===key(email)))throw conflict();
}
async function lock(client,email){await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['pte-account-email:'+key(email)]);}
async function availablePostgres(client,email,username){
 const {rows}=await client.query("SELECT a.username FROM accounts a JOIN user_data u ON u.username=a.username WHERE lower(btrim(u.data->>'email'))=$1 AND a.username<>$2 LIMIT 1",[key(email),username]);
 if(rows.length)throw conflict();
}
module.exports={key,availableJson,lock,availablePostgres};
