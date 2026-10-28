'use strict';
module.exports=function install(env){
  const tones=[],contexts=[],timers=new Map();let serial=0;
  const now=()=>env.Date.now();
  env.setTimeout=(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:now()+ms});return id;};
  env.clearTimeout=id=>timers.delete(id);
  class AudioContext{
    constructor(){this.state='suspended';this.destination={};contexts.push(this);}
    get currentTime(){return now()/1000;}
    resume(){if(env.rejectCueResume)return Promise.reject(Error('Audio blocked'));this.state='running';return Promise.resolve();}
    close(){this.state='closed';return Promise.resolve();}
    createOscillator(){const tone={frequency:{value:0},connect(){},disconnect(){},start(at){this.startedAt=at;tones.push(this);},stop(at=this.currentTime){tone.stoppedAt=Math.min(tone.stoppedAt??Infinity,at??now()/1000);}};return tone;}
    createGain(){return{gain:{value:0,setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}
    createMediaStreamSource(){return{connect(){}};}
    createAnalyser(){return{fftSize:256,getByteTimeDomainData(data){data.fill(128);}};}
  }
  env.AudioContext=AudioContext;
  return{tones,contexts,run(){for(const [id,timer]of [...timers])if(timer.at<=now()){timers.delete(id);timer.fn();}}};
};
