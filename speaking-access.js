'use strict';
const allowed=user=>['pppp','mehakbir1','mahabir1','mahdis'].includes(String(user||'').trim().toLowerCase());
function gate(verify){return (req,res,next)=>{let user;try{user=verify(req.headers['x-session-token']||'');}catch{}res.set('Cache-Control','no-store');if(!user)return res.status(401).json({error:'Please sign in to your practice account.'});if(!allowed(user))return res.status(403).json({error:'Speaking is not available for this account.'});next();};}
module.exports={allowed,gate};
