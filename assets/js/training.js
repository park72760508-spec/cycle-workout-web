import { connectedDevices, liveData, setOnLiveUpdate } from './bluetooth.js';
import { average, pad2 } from './utils.js';
export const trainingSession={sessionId:null,isRunning:false,isPaused:false,startTime:null,currentSegment:0,segments:[],segmentStartTime:null,data:{power:[],cadence:[],heartRate:[],time:[]}};
export function initTraining(){
  trainingSession.sessionId='S'+Date.now();trainingSession.isRunning=false;trainingSession.isPaused=false;
  trainingSession.startTime=null;trainingSession.currentSegment=0;trainingSession.segmentStartTime=null;
  window.updateTrainingDisplay?.();window.createTimeline?.();window.updateSegmentDisplay?.();
  window.showCountdown?.(5,startTraining);
}
export function startTraining(){trainingSession.isRunning=true;trainingSession.startTime=Date.now();trainingSession.segmentStartTime=Date.now();updateTrainingTimer();}
export function updateTargetPower(){}
export function updateTrainingTimer(){const t=setInterval(()=>{if(!trainingSession.isRunning){clearInterval(t);return;}if(trainingSession.isPaused)return;const e=Date.now()-trainingSession.startTime;const m=Math.floor(e/60000),s=Math.floor((e%60000)/1000);const el=document.getElementById('elapsedTime');if(el)el.textContent=`${pad2(m)}:${pad2(s)}`;},1000);}