(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SpeakingStartCue=api;})(typeof globalThis==='undefined'?this:globalThis,function(){
  'use strict';
  const DURATION_MS=300;
  function create(env){
    let context,active;const used=new Set();
    function unlock(){
      try{const Context=env.AudioContext||env.webkitAudioContext;if(!Context)return;context ||= new Context();context.resume?.()?.catch?.(()=>{});}catch{}
    }
    function cancel(){
      const previous=active;active=null;if(!previous)return;
      env.clearTimeout?.(previous.timer);try{previous.tone.stop();}catch{}try{previous.tone.disconnect();previous.gain.disconnect();}catch{}
    }
    function play(key,complete){
      if(active?.key===key)return;
      if(used.has(key)){complete();return;}used.add(key);cancel();
      if(!context||context.state!=='running'||typeof env.setTimeout!=='function'){complete();return;}
      try{
        const tone=context.createOscillator(),gain=context.createGain(),at=context.currentTime;
        tone.type='sine';tone.frequency.value=1000;gain.gain.value=.06;
        gain.gain.setValueAtTime?.(0,at);gain.gain.linearRampToValueAtTime?.(.06,at+.01);
        gain.gain.setValueAtTime?.(.06,at+.1);gain.gain.linearRampToValueAtTime?.(0,at+.12);
        tone.connect(gain);gain.connect(context.destination);tone.start(at);tone.stop(at+.12);
        const pending={key,tone,gain};active=pending;
        pending.timer=env.setTimeout(()=>{if(active!==pending)return;cancel();complete();},DURATION_MS);
      }catch{cancel();complete();}
    }
    function close(){cancel();try{context?.close?.()?.catch?.(()=>{});}catch{}context=null;}
    return{unlock,play,cancel,close};
  }
  return{create,DURATION_MS};
});
