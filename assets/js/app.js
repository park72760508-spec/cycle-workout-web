import * as BT from './bluetooth.js';
import * as UI from './ui.js';
import * as UM from './userManager.js';
import * as WM from './workoutManager.js';
import * as TR from './training.js';
import * as RM from './resultManager.js';

window.GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwp6v4zwoRi0qQekKQZr4bCs8s2wUolHtLNKgq_uX8pIHck1XllibKgzCZ64w6Z7Wrw/exec';

window.showScreen = UI.showScreen;
window.showConnectionStatus = UI.showConnectionStatus;
window.updateDevicesList = UI.updateDevicesList;
window.proceedToProfile = UI.proceedToProfile;
window.updateTrainingDisplay = UI.updateTrainingDisplay;
window.showWorkoutPreview = UI.showWorkoutPreview;
window.createTimeline = UI.createTimeline;
window.updateSegmentDisplay = UI.updateSegmentDisplay;
window.updateTimelineSegment = UI.updateTimelineSegment;
window.updateSegmentTimer = UI.updateSegmentTimer;
window.getPlanTotalDurationMs = UI.getPlanTotalDurationMs;
window.colorizeLapPower = UI.colorizeLapPower;
window.checkSegmentProgress = UI.checkSegmentProgress;

window.connectTrainer = BT.connectTrainer;
window.connectHeartRate = BT.connectHeartRate;
window.connectPowerMeter = BT.connectPowerMeter;
window.liveData = BT.liveData;

window.loadUsers = UM.loadUsers;
window.displayUsers = UM.displayUsers;
window.showAddUserForm = UM.showAddUserForm;
window.cancelAddUser = UM.cancelAddUser;
window.saveNewUser = UM.saveNewUser;
window.selectUser = UM.selectUser;
window.showUserInfo = UM.showUserInfo;

window.loadWorkouts = WM.loadWorkouts;
window.displayWorkouts = WM.displayWorkouts;
window.selectWorkout = WM.selectWorkout;

window.initializeTraining = TR.initTraining;
window.showCountdown = TR.showCountdown;
window.startTraining = TR.startTraining;
window.updateTargetPower = TR.updateTargetPower;

window.completeCurrentSegment = RM.completeCurrentSegment;
window.nextSegment = RM.nextSegment;
window.completeTraining = RM.completeTraining;
window.requestAIAnalysis = RM.requestAIAnalysis;
window.saveResult = RM.saveResult;
window.shareResult = RM.shareResult;

window.startWorkoutTraining = ()=> UI.showScreen('trainingScreen') || TR.initTraining();
window.backToWorkoutSelection = ()=> UI.showScreen('workoutScreen');

window.togglePause = ()=>{ TR.trainingSession.isPaused = !TR.trainingSession.isPaused; const el=document.getElementById('pauseIcon'); if(el) el.textContent = TR.trainingSession.isPaused ? '▶️' : '⏸️'; };
window.skipSegment = ()=>{ if(confirm('현재 구간을 건너뛰시겠습니까?')){ RM.completeCurrentSegment(); RM.nextSegment(); } };
window.stopTraining = ()=>{ if(confirm('정말 훈련을 중단하시겠습니까?')){ TR.trainingSession.isRunning=false; RM.completeTraining(); } };

document.addEventListener('DOMContentLoaded', ()=>{
  if(!navigator.bluetooth){
    console.log('Web Bluetooth is not available in this environment.');
  }
  if(location.protocol!=='https:' && location.hostname!=='localhost'){
    console.log('HTTPS is required for Web Bluetooth.');
  }
});
