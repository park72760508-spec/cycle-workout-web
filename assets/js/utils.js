export function pad2(n){return String(n).padStart(2,'0');}
export function average(arr){return arr?.length?arr.reduce((a,b)=>a+b,0)/arr.length:0;}
export function calcWorkoutTSS(workout){let t=0;(workout.segments||[]).forEach(s=>{const f=(s.ftp_percent||0)/100;const h=(s.duration_sec||0)/3600;t+=h*f*f*100;});return Math.round(t);}