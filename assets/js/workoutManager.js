import { calcWorkoutTSS } from './utils.js';
export async function loadWorkouts(){
  const dummy=[{workout_id:'SST_MCT14',workout_name:'SST_MCT(14)',total_duration:5520,avg_intensity:78,segments:[
    {segment_order:1,segment_type:'웜업',description:'80RPM FTP 60%',ftp_percent:60,duration_sec:20,target_rpm:80},
    {segment_order:2,segment_type:'인터벌',description:'FTP 88%',ftp_percent:88,duration_sec:30,target_rpm:90},
    {segment_order:3,segment_type:'휴식',description:'FTP 50%',ftp_percent:50,duration_sec:10,target_rpm:75},
    {segment_order:4,segment_type:'인터벌',description:'FTP 92%',ftp_percent:92,duration_sec:60,target_rpm:90},
    {segment_order:5,segment_type:'쿨다운',description:'FTP 45%',ftp_percent:45,duration_sec:10,target_rpm:70}
  ]}];
  displayWorkouts(dummy);
}
export function displayWorkouts(ws){
  const list=document.getElementById('workoutList');list.innerHTML='';
  ws.forEach(w=>{const d=document.createElement('div');d.className='card workout-card';d.onclick=()=>selectWorkout(w);
    const dur=Math.floor(w.total_duration/60);const tss=calcWorkoutTSS(w);
    d.innerHTML=`<div class="workout-header"><div class="workout-title">${w.workout_name}</div><div class="workout-duration">${dur}분</div></div>
    <div style="margin:15px 0;"><div style="font-size:14px; color: var(--gray-color);">평균: ${w.avg_intensity}% FTP | TSS: ${tss}</div></div>`;
    list.appendChild(d);});
}
export function selectWorkout(w){window.currentWorkout=w;window.showScreen('trainingReadyScreen');}
