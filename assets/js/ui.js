import { connectedDevices, liveData } from './bluetooth.js';
import { calcWorkoutTSS, average } from './utils.js';
import { trainingSession } from './training.js';
export function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');}
export function showConnectionStatus(show){const el=document.getElementById('connectionStatus');if(!el)return;el.classList.toggle('hidden',!show);}
export function updateDevicesList(){}
export function proceedToProfile(){showScreen('profileScreen');}
export function updateTrainingDisplay(){document.getElementById('currentPowerValue').textContent=Math.round(liveData.power||0);}
export function showWorkoutPreview(){}
export function createTimeline(){}
export function updateSegmentDisplay(){}
export function updateTimelineSegment(){} 
export function updateSegmentTimer(){}
export function getPlanTotalDurationMs(){return 0;}
export function colorizeLapPower(){} 
export function checkSegmentProgress(){}