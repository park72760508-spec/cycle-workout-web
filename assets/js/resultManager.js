import { trainingSession } from './training.js';
import { average } from './utils.js';
export function completeCurrentSegment(){}
export function nextSegment(){}
export function completeTraining(){
  trainingSession.isRunning=false;
  const avgP=average(trainingSession.data.power), maxP=trainingSession.data.power.length?Math.max(...trainingSession.data.power):0, avgHR=average(trainingSession.data.heartRate);
  const durH=(Date.now()-trainingSession.startTime)/3600000; const calories=Math.round(avgP*durH*3.6);
  document.getElementById('finalAchievement').textContent='100%';
  document.getElementById('workoutCompletedName').textContent=`${window.currentWorkout?.workout_name||'Workout'} - ${Math.floor(durH*60)}분 완주`;
  document.getElementById('resultAvgPower').textContent=Math.round(avgP);
  document.getElementById('resultMaxPower').textContent=Math.round(maxP);
  document.getElementById('resultAvgHR').textContent=Math.round(avgHR);
  document.getElementById('resultCalories').textContent=calories;
  window.showScreen('resultScreen');
}
export function requestAIAnalysis(){}
export function saveResult(){alert('훈련 결과가 저장되었습니다!');}
export function shareResult(){alert('공유하기는 실제 브라우저에서 동작합니다.');}
