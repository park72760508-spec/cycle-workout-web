
// ===== 데이터 및 설정 =====
const GAS_WEB_APP_URL =
  'https://script.google.com/macros/s/AKfycbwp6v4zwoRi0qQekKQZr4bCs8s2wUolHtLNKgq_uX8pIHck1XllibKgzCZ64w6Z7Wrw/exec';

// 오프라인(백엔드 장애 시) 샘플 사용자·워크아웃
const SAMPLE_USERS = [
  { user_id: 'U1', name: '박지성', contact: '010-1234-5678', ftp: 242, weight: 56 },
  { user_id: 'U2', name: '박선호', contact: '010-9876-5432', ftp: 200, weight: 70 },
];

const SAMPLE_WORKOUTS = [
  {
    workout_id: 'SST_MCT14',
    workout_name: 'SST_MCT(14)',
    total_duration: 5520, // 92분
    avg_intensity: 78,
    segments: [
      { segment_order: 1, segment_type: '웜업', description: '80RPM FTP 60%', ftp_percent: 60, duration_sec: 20, target_rpm: 80 },
      { segment_order: 2, segment_type: '인터벌', description: 'FTP 88%', ftp_percent: 88, duration_sec: 30, target_rpm: 90 },
      { segment_order: 3, segment_type: '휴식', description: 'FTP 50%', ftp_percent: 50, duration_sec: 10, target_rpm: 75 },
      { segment_order: 4, segment_type: '인터벌', description: 'FTP 92%', ftp_percent: 92, duration_sec: 60, target_rpm: 90 },
      { segment_order: 5, segment_type: '쿨다운', description: 'FTP 45%', ftp_percent: 45, duration_sec: 10, target_rpm: 70 },
    ],
  },
];

// 전역 상태(모듈 간 공유)
const STATE = {
  currentScreen: 'connectionScreen',
  connected: { trainer: null, heartRate: null, powerMeter: null },
  usePowerMeterPreferred: true,
  currentUser: null,
  currentWorkout: null,
  trainingSession: {
    sessionId: null,
    isRunning: false,
    isPaused: false,
    startTime: null,
    currentSegment: 0,
    segments: [],
    segmentStartTime: null,
    data: { power: [], cadence: [], heartRate: [], time: [] },
  },
  liveData: { power: 0, cadence: 0, heartRate: 0, targetPower: 0 },
  flags: {
    isSegmentChanging: false,
    countdownActive: false,
    segmentCountdownStarted: false,
  },
  audioCtx: null,
};
