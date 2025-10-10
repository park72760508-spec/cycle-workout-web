export const connectedDevices={trainer:null,heartRate:null,powerMeter:null};
export let usePowerMeterPreferred=true;
export const liveData={power:0,cadence:0,heartRate:0,targetPower:0};
let onLiveUpdate=null;
export function setOnLiveUpdate(cb){onLiveUpdate=cb;}
export async function connectTrainer(){
  try{
    window.showConnectionStatus?.(True);
  }catch(e){}
}
export async function connectHeartRate(){ alert('심박계 연결은 실제 환경에서 테스트하세요 (HTTPS + Web Bluetooth)'); }
export async function connectPowerMeter(){ alert('파워미터 연결은 실제 환경에서 테스트하세요 (HTTPS + Web Bluetooth)'); }
