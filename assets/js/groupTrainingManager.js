// Updated: 2025-11-16 12:30 (KST) - Change header auto-stamped per edit
// Updated: 2025-11-16 12:45 (KST) - Show all participants' BLE status; admin start button placement
// Updated: 2025-11-17 15:02 (KST) - 다른 사용자 상태 동기화 개선 (블루투스 상태, 메트릭 실시간 반영)

/* ==========================================================
   groupTrainingManager.js - 그룹 훈련 전용 관리 모듈
   기존 모듈들과 일관성을 유지하면서 그룹 훈련 기능 구현
========================================================== */
// ========== 모듈 중복 로딩 방지 ==========
if (window.groupTrainingManagerLoaded) {
  console.warn('⚠️ groupTrainingManager.js가 이미 로드되었습니다. 중복 로딩을 방지합니다.');
} else {
  window.groupTrainingManagerLoaded = true;



// ========== 전역 변수 초기화 ==========
window.groupTrainingManager = window.groupTrainingManager || {};


// 그룹 훈련 상태 관리 (전역으로 노출)
window.groupTrainingState = window.groupTrainingState || {
  currentRoom: null,
  isAdmin: false,
  isManager: false,
  participants: [],
  roomCode: null,
  syncInterval: null,
  managerInterval: null,
  isConnected: false,
  lastSyncTime: null,
  countdownStarted: false,  // 카운트다운 시작 여부 (중복 방지)
  adminCountdownInitiated: false,  // 관리자가 카운트다운을 시작했는지 여부 (중복 방지)
  readyOverrides: {},
  adminParticipationMode: 'monitor',
  trainingStartSignaled: false,
  timelineSnapshot: null,
  monitoringTimelineInterval: null
};

// 로컬 변수로도 참조 유지 (기존 코드 호환성)
let groupTrainingState = window.groupTrainingState;

const ADMIN_MODE_STORAGE_KEY = 'groupTrainingAdminMode';
if (typeof localStorage !== 'undefined') {
  try {
    const storedMode = localStorage.getItem(ADMIN_MODE_STORAGE_KEY);
    if (storedMode === 'participate' || storedMode === 'monitor') {
      groupTrainingState.adminParticipationMode = storedMode;
    }
  } catch (e) {
    console.warn('관리자 모드 설정을 불러오지 못했습니다:', e?.message || e);
  }
}

const READY_OVERRIDE_TTL = 300000; // 백엔드 동기화 지연 시 최대 5분 동안 로컬 상태 유지 (자동 리셋 방지)
const GROUP_COUNTDOWN_SECONDS = 10; // 그룹 훈련 카운트다운 기본 10초
const ADMIN_MODE_MONITOR = 'monitor';
const ADMIN_MODE_PARTICIPATE = 'participate';

// 준비 상태를 구글 쉬트에 반영하기 위한 대기열
const pendingReadyPersistMap = new Map();
let readyPersistTimer = null;

function sanitizeParticipantForPersistence(participant = {}) {
  const id = participant.id ?? participant.participantId ?? participant.userId ?? '';
  const name = participant.name ?? participant.participantName ?? participant.userName ?? '';
  const role = participant.role ?? 'participant';
  const joinedAt = participant.joinedAt ?? participant.joined_at ?? participant.createdAt ?? new Date().toISOString();
  return {
    id,
    participantId: participant.participantId ?? id,
    userId: participant.userId ?? id,
    name: String(name),
    participantName: String(participant.participantName ?? name),
    role,
    ready: !!participant.ready,
    isReady: !!participant.isReady,
    readyState: participant.readyState ?? (participant.ready ? 'ready' : 'waiting'),
    readyStatus: participant.readyStatus ?? (participant.ready ? 'ready' : 'waiting'),
    readyUpdatedAt: participant.readyUpdatedAt ?? null,
    joinedAt,
    ftp: participant.ftp ?? null,
    weight: participant.weight ?? null,
    gender: participant.gender ?? null,
    bike: participant.bike ?? null,
    status: participant.status ?? null
  };
}

function queueReadyStatePersist(participantId, ready) {
  if (!participantId) return;
  pendingReadyPersistMap.set(String(participantId), !!ready);
  if (readyPersistTimer) return;
  readyPersistTimer = setTimeout(flushReadyStatePersist, 1500);
}

async function flushReadyStatePersist() {
  readyPersistTimer = null;
  if (!groupTrainingState.roomCode || !groupTrainingState.currentRoom) {
    pendingReadyPersistMap.clear();
    return;
  }
  if (!pendingReadyPersistMap.size) {
    return;
  }

  const room = groupTrainingState.currentRoom;
  const updatedRoomParticipants = Array.isArray(room.participants) ? room.participants.map(participant => {
    const pid = getParticipantIdentifier(participant);
    if (!pid || !pendingReadyPersistMap.has(pid)) {
      return participant;
    }
    const readyValue = pendingReadyPersistMap.get(pid);
    return {
      ...participant,
      ready: !!readyValue,
      isReady: !!readyValue
    };
  }) : [];

  const payload = {
    participants: updatedRoomParticipants
  };

  pendingReadyPersistMap.clear();

  try {
    let success = false;
    if (typeof apiUpdateRoom === 'function') {
      const res = await apiUpdateRoom(groupTrainingState.roomCode, payload);
      success = !!(res && res.success);
    } else if (typeof updateRoomOnBackend === 'function') {
      success = await updateRoomOnBackend({
        ...room,
        participants: updatedRoomParticipants
      });
    }

    if (!success) {
      console.warn('준비 상태 저장 실패: apiUpdateRoom 응답 실패');
    } else {
      if (Array.isArray(room.participants)) {
        room.participants = updatedRoomParticipants;
      }
      console.log('✅ 준비 상태가 GroupTrainingRooms 쉬트에 반영되었습니다');
    }
  } catch (err) {
    console.warn('준비 상태 저장 중 오류:', err?.message || err);
  }
}

async function fetchLatestRoomState(roomCode) {
  if (!roomCode) return null;
  try {
    const latest = await getRoomByCode(roomCode);
    if (latest && !latest.__roomDeleted) {
      return latest;
    }
  } catch (error) {
    console.warn('fetchLatestRoomState 실패:', error?.message || error);
  }
  return null;
}

function parseBooleanLike(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return undefined;
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (['true', '1', 'ready', 'prepared', 'complete', 'completed', '완료', '준비완료', 'ok', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'waiting', 'pending', 'notready', '대기', '대기중', 'no', 'n'].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function coerceParticipantsArray(rawParticipants) {
  if (rawParticipants === undefined || rawParticipants === null) {
    return [];
  }

  if (Array.isArray(rawParticipants)) {
    return rawParticipants;
  }

  if (typeof rawParticipants === 'string') {
    try {
      let parsed = JSON.parse(rawParticipants);
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          // keep as string if double parsing fails
        }
      }
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn('ParticipantsData JSON 파싱 실패:', error);
      return [];
    }
  }

  if (typeof rawParticipants === 'object') {
    return Array.isArray(rawParticipants.data)
      ? rawParticipants.data
      : Object.values(rawParticipants);
  }

  return [];
}

function normalizeParticipantReady(participant) {
  if (!participant || typeof participant !== 'object') {
    return participant;
  }

  const normalized = { ...participant };
  const normalizedId = getParticipantIdentifier(participant);
  if (normalizedId) {
    normalized.id = normalizedId;
    if (!normalized.participantId) {
      normalized.participantId = normalizedId;
    }
  }

  const readyCandidates = [
    participant.ready,
    participant.isReady,
    participant.Ready,
    participant.IsReady,
    participant.readyState,
    participant.ReadyState,
    participant.state,
    participant.State,
    participant.status
  ];

  let readyValue;
  for (const candidate of readyCandidates) {
    const parsed = parseBooleanLike(candidate);
    if (parsed !== undefined) {
      readyValue = parsed;
      break;
    }
  }

  if (readyValue === undefined && typeof participant.status === 'string') {
    const status = participant.status.trim().toLowerCase();
    if (['ready', 'prepared', 'active', 'confirmed'].includes(status)) {
      readyValue = true;
    } else if (['waiting', 'pending', 'idle', 'requested'].includes(status)) {
      readyValue = false;
    }
  }

  if (readyValue === undefined) {
    readyValue = false;
  }

  normalized.ready = readyValue;
  normalized.isReady = readyValue;

  if (!normalized.joinedAt) {
    normalized.joinedAt = participant.joined_at || participant.JoinedAt || participant.createdAt || new Date().toISOString();
  }

  return normalized;
}

function normalizeParticipantsArray(rawParticipants) {
  const array = coerceParticipantsArray(rawParticipants);
  return array.map(normalizeParticipantReady);
}

function normalizeRoomParticipantsInPlace(room) {
  if (!room || typeof room !== 'object') {
    return [];
  }
  const normalized = normalizeParticipantsArray(room.participants || room.ParticipantsData || []);
  room.participants = normalized;
  room.ParticipantsData = normalized;
  return normalized;
}

/**
 * 참가자 라이브 데이터 객체(payload 포함)를 평탄화
 */
function expandLiveParticipantData(liveItem) {
  if (!liveItem || typeof liveItem !== 'object') {
    return {};
  }
  const expanded = { ...liveItem };
  if (typeof liveItem.payload === 'string') {
    try {
      const payloadObj = JSON.parse(liveItem.payload);
      expanded._payload = payloadObj;
      Object.entries(payloadObj).forEach(([key, value]) => {
        if (expanded[key] === undefined) {
          expanded[key] = value;
        }
      });
    } catch (err) {
      console.warn('라이브 데이터 payload 파싱 실패:', err?.message || err);
    }
  }
  return expanded;
}

function getParticipantIdentifier(participant) {
  if (!participant) return '';
  const id = participant.id ?? participant.participantId ?? participant.userId;
  return id !== undefined && id !== null ? String(id) : '';
}

function getRawReadyValue(participant) {
  if (!participant) return undefined;
  const fieldsToCheck = [
    participant.ready,
    participant.isReady,
    participant.Ready,
    participant.IsReady,
    participant.readyState,
    participant.ReadyState,
    participant.state,
    participant.State,
    participant.status,
    participant.readyStatus
  ];

  for (const field of fieldsToCheck) {
    const parsed = parseBooleanLike(field);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function getReadyOverride(participantId) {
  if (!participantId || !groupTrainingState.readyOverrides) return null;
  const override = groupTrainingState.readyOverrides[participantId];
  if (!override) return null;
  // TTL이 null이면 무제한 유지 (서버 동기화 완료 시에만 제거)
  if (override.expiresAt !== null && override.expiresAt && override.expiresAt <= Date.now()) {
    delete groupTrainingState.readyOverrides[participantId];
    return null;
  }
  return override;
}

function setReadyOverride(participantId, ready) {
  if (!participantId) return;
  if (!groupTrainingState.readyOverrides) {
    groupTrainingState.readyOverrides = {};
  }
  // TTL을 무제한으로 설정하여 자동 리셋 방지 (서버 동기화 완료 시에만 제거)
  groupTrainingState.readyOverrides[participantId] = {
    ready: !!ready,
    expiresAt: null // TTL 무제한 (서버 동기화 완료 시에만 제거)
  };
}

function clearReadyOverride(participantId) {
  if (!participantId || !groupTrainingState.readyOverrides) return;
  if (groupTrainingState.readyOverrides[participantId]) {
    delete groupTrainingState.readyOverrides[participantId];
  }
}

function isParticipantReady(participant) {
  if (!participant) return false;
  const participantId = getParticipantIdentifier(participant);
  
  // 서버 데이터의 ready 상태를 우선 확인
  const rawReady = getRawReadyValue(participant);
  
  // 서버에 준비 상태가 있으면 서버 데이터 우선 적용
  if (rawReady !== undefined && rawReady !== null) {
    // 로컬 오버라이드가 있고 서버 상태와 다르면 오버라이드 확인
    const override = getReadyOverride(participantId);
    if (override && override.ready !== rawReady) {
      // 서버 동기화 지연 가능성이 있으므로 오버라이드 우선 적용
      // 단, 서버 상태가 true이고 오버라이드가 false인 경우는 서버 우선
      if (rawReady === true && override.ready === false) {
        // 서버에서 준비완료로 확인되면 서버 우선 (다른 사용자가 변경한 경우)
        return true;
      }
      // 그 외에는 오버라이드 우선 (로컬에서 변경한 경우)
      return !!override.ready;
    }
    return !!rawReady;
  }
  
  // 서버에 준비 상태가 없으면 로컬 오버라이드 확인
  const override = getReadyOverride(participantId);
  if (override) {
    return !!override.ready;
  }
  
  return false;
}

function countReadyParticipants(participants = []) {
  if (!Array.isArray(participants)) return 0;
  return participants.reduce((count, participant) => {
    return count + (isParticipantReady(participant) ? 1 : 0);
  }, 0);
}

function getAdminParticipationMode() {
  return groupTrainingState.adminParticipationMode === ADMIN_MODE_PARTICIPATE
    ? ADMIN_MODE_PARTICIPATE
    : ADMIN_MODE_MONITOR;
}

function isAdminMonitoringOnly() {
  // 관리자 모니터링 전용 모드 제거
  // 관리자도 일반 참가자처럼 준비완료 상태를 가져야 함
  return false;
}

function shouldAutoStartLocalTraining() {
  // 모든 사용자(관리자/일반 참가자)가 준비완료 상태를 확인해야 함
  const room = groupTrainingState.currentRoom;
  if (!room || !Array.isArray(room.participants)) {
    return false;
  }
  
  const currentUserId = window.currentUser?.id || '';
  const myParticipant = room.participants.find(p => {
    const pId = p.id || p.participantId || p.userId;
    return String(pId) === String(currentUserId);
  });
  
  if (!myParticipant) {
    // 참가자 목록에 없으면 모니터링 모드
    return false;
  }
  
  // 자신의 준비완료 상태 확인 (관리자/일반 참가자 모두)
  const isReady = isParticipantReady(myParticipant);
  
  // 준비완료 상태에 따라 반환
  // - 준비완료: true (훈련 화면으로 전환)
  // - 준비완료 아님: false (모니터링 상태 유지, 대기실 화면 유지)
  return isReady;
}

function isTrainingScreenActive() {
  const trainingScreen = document.getElementById('trainingScreen');
  if (!trainingScreen) return false;
  return !trainingScreen.classList.contains('hidden');
}

function showWaitingScreen() {
  const waitingScreen = document.getElementById('groupWaitingScreen');
  if (waitingScreen) {
    waitingScreen.classList.remove('hidden');
    waitingScreen.classList.add('active');
  }
  if (typeof showScreen === 'function') {
    showScreen('groupWaitingScreen');
  }
}

function persistAdminMode(mode) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ADMIN_MODE_STORAGE_KEY, mode);
  } catch (error) {
    console.warn('관리자 모드 설정 저장 실패:', error?.message || error);
  }
}

// 관리자 모드 선택 기능 제거됨
// 관리자도 일반 참가자처럼 준비완료 상태를 가져야 함
// 아래 함수들은 더 이상 사용되지 않지만 호환성을 위해 유지

async function handleAdminModeChange(nextMode) {
  // 더 이상 사용되지 않음 - 관리자도 준비완료 상태 기준으로 동작
  console.warn('handleAdminModeChange는 더 이상 사용되지 않습니다');
  updateStartButtonState();
}

function updateAdminModeUI() {
  // 더 이상 사용되지 않음 - 내부 제어 블록이 제거됨
  // 빈 함수로 유지 (호환성)
}

function bindAdminModeSelector(container) {
  // 더 이상 사용되지 않음 - 내부 제어 블록이 제거됨
  // 빈 함수로 유지 (호환성)
}

function synchronizeTrainingClock(trainingStartTime) {
  if (!trainingStartTime || !window.trainingState) return;
  const startMs = new Date(trainingStartTime).getTime();
  if (!Number.isFinite(startMs)) return;
  
  const ts = window.trainingState;
  if (!ts.isRunning) return;
  
  const targetElapsed = Math.max(0, (Date.now() - startMs) / 1000);
  const currentElapsed = Number(ts.elapsedSec) || 0;
  const drift = targetElapsed - currentElapsed;
  
  if (!Number.isFinite(drift) || Math.abs(drift) < 0.25) {
    return;
  }
  
  const maxStep = 0.75;
  const adjustment = Math.max(Math.min(drift, maxStep), -maxStep);
  
  ts.elapsedSec = Math.max(0, currentElapsed + adjustment);
  if (typeof ts.segElapsedSec === 'number') {
    ts.segElapsedSec = Math.max(0, ts.segElapsedSec + adjustment);
  }
  ts.workoutStartMs = startMs;
}

function getActiveWorkoutSegments(workout = window.currentWorkout) {
  if (workout && Array.isArray(workout.segments)) {
    return workout.segments;
  }
  return [];
}

function formatDuration(sec) {
  const value = Number(sec || 0);
  if (!Number.isFinite(value) || value <= 0) return '-';
  const minutes = Math.floor(value / 60).toString().padStart(2, '0');
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatTimer(sec) {
  const value = Number(sec);
  if (!Number.isFinite(value) || value < 0) return '00:00:00';
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  // 항상 00:00:00 형식으로 반환
  return [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    seconds.toString().padStart(2, '0')
  ].join(':');
}

function computeServerTimelineSnapshot(room, options = {}) {
  if (!room) return null;

  const workout = options.workout || window.currentWorkout || {};
  const segments = getActiveWorkoutSegments(workout);
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();

  const roomStatus = room.status || room.Status || 'waiting';
  const trainingStartIso = room.trainingStartTime || room.TrainingStartTime || room.startedAt || null;
  const countdownEndIso = room.countdownEndTime || room.CountdownEndTime || null;

  const trainingStartMs = trainingStartIso ? new Date(trainingStartIso).getTime() : null;
  const countdownEndMs = countdownEndIso ? new Date(countdownEndIso).getTime() : null;

  // 이전 스냅샷 확인 (훈련 중 상태 유지용)
  const previousSnapshot = groupTrainingState.timelineSnapshot;
  const wasTraining = previousSnapshot && previousSnapshot.phase === 'training';
  const previousTimelineEpochMs = previousSnapshot?.timelineEpochMs;

  const totalDurationSec = segments.reduce((sum, seg) => {
    const raw = Number(seg?.duration_sec ?? seg?.duration ?? 0);
    return sum + (Number.isFinite(raw) && raw > 0 ? raw : 0);
  }, 0);

  let phase = 'idle';
  let timelineEpochMs = null;
  let countdownRemainingSec = null;

  // 훈련 중이었던 경우, 방 상태나 trainingStartTime이 일시적으로 없어도 training 상태 유지
  if (wasTraining && Number.isFinite(previousTimelineEpochMs)) {
    // 이전 훈련 시작 시간이 유효하면, 훈련이 계속 진행 중인 것으로 간주
    timelineEpochMs = previousTimelineEpochMs;
    const elapsedSinceStart = (nowMs - previousTimelineEpochMs) / 1000;
    
    // 총 시간 내에 있으면 훈련 중으로 유지
    if (elapsedSinceStart >= 0 && (!Number.isFinite(totalDurationSec) || elapsedSinceStart <= totalDurationSec + 10)) {
      phase = 'training';
    }
  }

  // 방 상태나 시간 기반으로 phase 결정 (기존 로직)
  if (roomStatus === 'starting' && Number.isFinite(countdownEndMs) && nowMs <= countdownEndMs) {
    phase = 'countdown';
    countdownRemainingSec = Math.max(0, Math.ceil((countdownEndMs - nowMs) / 1000));
  }

  if (Number.isFinite(trainingStartMs)) {
    if (nowMs >= trainingStartMs) {
      phase = 'training';
      timelineEpochMs = trainingStartMs;
    } else if (!Number.isFinite(countdownRemainingSec)) {
      phase = 'countdown';
      countdownRemainingSec = Math.max(0, Math.ceil((trainingStartMs - nowMs) / 1000));
    }
  }
  
  // 방 상태가 'training'이면 무조건 training phase로 설정
  if (roomStatus === 'training') {
    phase = 'training';
    if (!Number.isFinite(timelineEpochMs) && Number.isFinite(trainingStartMs)) {
      timelineEpochMs = trainingStartMs;
    } else if (!Number.isFinite(timelineEpochMs) && Number.isFinite(previousTimelineEpochMs)) {
      timelineEpochMs = previousTimelineEpochMs;
    }
  }

  let elapsedSec = 0;
  if (phase === 'training' && Number.isFinite(timelineEpochMs)) {
    elapsedSec = Math.max(0, (nowMs - timelineEpochMs) / 1000);
    if (Number.isFinite(totalDurationSec) && totalDurationSec > 0) {
      elapsedSec = Math.min(elapsedSec, totalDurationSec);
    }
  }

  let segmentIndex = -1;
  let segmentElapsedSec = null;
  let segmentRemainingSec = null;
  let segmentStartSec = null;

  if (phase === 'training' && segments.length > 0) {
    let cursor = 0;
    for (let i = 0; i < segments.length; i++) {
      const dur = Math.max(0, Number(segments[i]?.duration_sec ?? segments[i]?.duration ?? 0) || 0);
      const end = cursor + dur;
      if (elapsedSec < end || i === segments.length - 1) {
        segmentIndex = i;
        segmentStartSec = cursor;
        segmentElapsedSec = Math.max(0, elapsedSec - cursor);
        segmentRemainingSec = Math.max(0, end - elapsedSec);
        break;
      }
      cursor = end;
    }
  }

  return {
    status: roomStatus,
    phase,
    timelineEpochMs,
    countdownTargetMs: countdownEndMs || (phase === 'countdown' ? trainingStartMs : null),
    countdownRemainingSec: Number.isFinite(countdownRemainingSec) ? countdownRemainingSec : null,
    elapsedSec,
    totalDurationSec,
    segmentIndex,
    segmentElapsedSec,
    segmentRemainingSec,
    segmentStartSec,
    computedAtMs: nowMs,
    hasSegments: segments.length > 0
  };
}

function updateTimelineSnapshot(room, options = {}) {
  const previousSnapshot = groupTrainingState.timelineSnapshot;
  const wasTraining = previousSnapshot && previousSnapshot.phase === 'training';
  
  const snapshot = computeServerTimelineSnapshot(room || groupTrainingState.currentRoom, {
    workout: options.workout || window.currentWorkout,
    nowMs: options.nowMs
  });
  
  // 스냅샷이 null이거나 유효하지 않으면 이전 스냅샷 유지 (초기화 방지)
  if (!snapshot || !snapshot.phase) {
    return previousSnapshot || null;
  }
  
  // 훈련 중이었는데 새로운 스냅샷이 'idle'로 변경된 경우, 이전 training 상태 유지
  if (wasTraining && snapshot.phase === 'idle' && previousSnapshot) {
    // 이전 스냅샷의 시간 기반으로 계속 진행
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const previousTimelineEpochMs = previousSnapshot.timelineEpochMs;
    
    if (Number.isFinite(previousTimelineEpochMs)) {
      // 이전 스냅샷의 경과 시간을 기반으로 새로운 스냅샷 생성
      const elapsedSec = Math.max(0, (nowMs - previousTimelineEpochMs) / 1000);
      const workout = options.workout || window.currentWorkout || {};
      const segments = getActiveWorkoutSegments(workout);
      
      let segmentIndex = -1;
      let segmentElapsedSec = null;
      let segmentRemainingSec = null;
      let segmentStartSec = null;
      
      if (segments.length > 0) {
        let cursor = 0;
        const totalDurationSec = segments.reduce((sum, seg) => {
          const raw = Number(seg?.duration_sec ?? seg?.duration ?? 0);
          return sum + (Number.isFinite(raw) && raw > 0 ? raw : 0);
        }, 0);
        
        for (let i = 0; i < segments.length; i++) {
          const dur = Math.max(0, Number(segments[i]?.duration_sec ?? segments[i]?.duration ?? 0) || 0);
          const end = cursor + dur;
          if (elapsedSec < end || i === segments.length - 1) {
            segmentIndex = i;
            segmentStartSec = cursor;
            segmentElapsedSec = Math.max(0, elapsedSec - cursor);
            segmentRemainingSec = Math.max(0, end - elapsedSec);
            break;
          }
          cursor = end;
        }
        
        // training 상태 유지된 스냅샷 생성
        const preservedSnapshot = {
          ...previousSnapshot,
          phase: 'training',
          elapsedSec,
          segmentIndex,
          segmentElapsedSec,
          segmentRemainingSec,
          segmentStartSec,
          computedAtMs: nowMs,
          status: room?.status || room?.Status || 'training'
        };
        
        groupTrainingState.timelineSnapshot = preservedSnapshot;
        return preservedSnapshot;
      }
    }
    
    // 이전 스냅샷 그대로 반환
    return previousSnapshot;
  }
  
  // 정상적인 스냅샷이면 저장하고 반환
  if (snapshot && snapshot.phase) {
    groupTrainingState.timelineSnapshot = snapshot;
    return snapshot;
  }
  
  return previousSnapshot || null;
}

function applyTimelineSnapshotToTrainingState(snapshot) {
  if (!snapshot || snapshot.phase !== 'training') return;
  window.trainingState = window.trainingState || {};
  const ts = window.trainingState;

  if (Number.isFinite(snapshot.timelineEpochMs)) {
    ts.workoutStartMs = snapshot.timelineEpochMs;
  }
  if (Number.isFinite(snapshot.elapsedSec)) {
    ts.elapsedSec = snapshot.elapsedSec;
  }
  if (Number.isFinite(snapshot.segmentIndex) && snapshot.segmentIndex >= 0) {
    ts.segIndex = snapshot.segmentIndex;
    if (Number.isFinite(snapshot.segmentElapsedSec)) {
      ts.segElapsedSec = snapshot.segmentElapsedSec;
    }
  }
  ts.isRunning = true;
  ts.lastServerSnapshot = snapshot;
}

function syncMonitoringLoopWithSnapshot(snapshot) {
  const shouldMonitor = snapshot
    && (snapshot.phase === 'training' || snapshot.phase === 'countdown')
    && !shouldAutoStartLocalTraining();
  if (shouldMonitor) {
    startMonitoringTimelineLoop();
  } else {
    stopMonitoringTimelineLoop();
  }
}

function startMonitoringTimelineLoop() {
  if (groupTrainingState.monitoringTimelineInterval) return;
  const tick = () => {
    const room = groupTrainingState.currentRoom;
    if (!room) return;
    const snapshot = updateTimelineSnapshot(room);
    if (!snapshot) return;

    if (snapshot.phase === 'training' || snapshot.phase === 'countdown') {
      if (!shouldAutoStartLocalTraining()) {
        // 모니터링 모드: 타임라인 스냅샷을 기반으로 세그먼트 상태 업데이트
        if (snapshot.phase === 'training') {
          applyTimelineSnapshotToTrainingState(snapshot);
          
          // 세그먼트 전환 로직: 세그먼트 인덱스가 변경되었는지 확인
          const ts = window.trainingState || {};
          const w = window.currentWorkout;
          
          if (Number.isFinite(snapshot.segmentIndex) && snapshot.segmentIndex >= 0 && w) {
            const currentSegIndex = ts.segIndex || 0;
            const newSegIndex = snapshot.segmentIndex;
            
            // 세그먼트가 변경된 경우 타겟 적용 및 UI 업데이트
            if (newSegIndex !== currentSegIndex && newSegIndex < w.segments.length) {
              console.log(`모니터링 모드: 세그먼트 ${newSegIndex + 1}로 전환`);
              if (typeof applySegmentTarget === 'function') {
                applySegmentTarget(newSegIndex);
              }
              // 세그먼트 전환 추적 변수 업데이트
              ts._lastProcessedSegIndex = newSegIndex;
              // 세그먼트 경과 시간 초기화
              ts.segElapsedSec = snapshot.segmentElapsedSec || 0;
              // 세그먼트 전환 시 카운트다운 상태 초기화 (다음 세그먼트에도 카운트다운이 동작하도록)
              if (!ts._countdownFired) {
                ts._countdownFired = {};
              }
              // 이전 세그먼트의 카운트다운 상태는 유지하고, 새 세그먼트를 위한 초기화는 자동으로 됨
              // (세그먼트 인덱스별로 관리되므로 각 세그먼트마다 독립적으로 동작)
            }
            
            // 세그먼트 종료 6초 전 카운트다운 체크 (모니터링 모드)
            // 각 세그먼트마다 독립적으로 카운트다운이 동작하도록 개선
            if (Number.isFinite(snapshot.segmentRemainingSec) && snapshot.segmentRemainingSec > 0) {
              const remainingSec = snapshot.segmentRemainingSec;
              const nextSeg = (newSegIndex < w.segments.length - 1) ? w.segments[newSegIndex + 1] : null;
              
              // 6초 전부터 카운트다운 시작 (5, 4, 3, 2, 1, 0)
              // 각 세그먼트별로 카운트다운이 정상적으로 동작하도록 개선
              if (remainingSec <= 6 && remainingSec > 0 && nextSeg) {
                const key = String(newSegIndex);
                ts._countdownFired = ts._countdownFired || {};
                const firedMap = ts._countdownFired[key] || {};
                
                // 현재 남은 시간에 해당하는 카운트다운 숫자 계산
                // 6.0~5.1초: 5 표시, 5.0~4.1초: 4 표시, ..., 1.0~0.1초: 0 표시
                const countdownNumber = Math.max(0, Math.ceil(remainingSec) - 1);
                
                if (countdownNumber >= 0 && countdownNumber <= 5) {
                  // 각 숫자별로 한 번만 표시되도록 체크
                  if (!firedMap[countdownNumber]) {
                    // 카운트다운 표시 로그 (디버깅용)
                    console.log(`모니터링 모드: 세그먼트 ${newSegIndex + 1} 종료 ${countdownNumber + 1}초 전 (다음: ${nextSeg.label || nextSeg.segment_type || '세그먼트'})`);
                    firedMap[countdownNumber] = true;
                    ts._countdownFired[key] = firedMap;
                  }
                }
              }
            }
          }
        }
        
        requestAnimationFrame(() => {
          try {
            renderWaitingHeaderSegmentTable();
            // UI 업데이트
            if (typeof updateTimeUI === 'function') {
              updateTimeUI();
            }
            if (typeof updateSegmentBarTick === 'function') {
              updateSegmentBarTick();
            }
            if (typeof updateTimelineByTime === 'function') {
              updateTimelineByTime();
            }
          } catch (error) {
            console.warn('monitoringTimelineLoop 렌더링 실패:', error);
          }
        });
      }
    } else {
      stopMonitoringTimelineLoop();
    }
  };

  tick();
  groupTrainingState.monitoringTimelineInterval = setInterval(tick, 1000);
}

function stopMonitoringTimelineLoop() {
  if (groupTrainingState.monitoringTimelineInterval) {
    clearInterval(groupTrainingState.monitoringTimelineInterval);
    groupTrainingState.monitoringTimelineInterval = null;
  }
}

function triggerCountdownOverlay(options) {
  const opts = typeof options === 'number' ? { seconds: options } : (options || {});
  const seconds = Number.isFinite(opts.seconds) ? opts.seconds : GROUP_COUNTDOWN_SECONDS;

  // 관리자가 카운트다운을 시작한 경우는 항상 표시
  // 참가자도 카운트다운을 볼 수 있어야 함 (준비완료 상태와 관계없이)
  // 단, 관리자가 모니터링 모드이고 카운트다운을 시작하지 않은 경우에만 제외
  const currentUser = window.currentUser || {};
  const isAdminUser = groupTrainingState.isAdmin || 
                     currentUser.grade === '1' || 
                     currentUser.grade === 1 ||
                     (typeof getViewerGrade === 'function' && getViewerGrade() === '1');
  
  // 관리자가 카운트다운을 시작했거나, 참가자인 경우 카운트다운 표시
  if (groupTrainingState.adminCountdownInitiated || !isAdminUser) {
    if (groupTrainingState.isAdmin || typeof showParticipantCountdown !== 'function') {
      return showGroupCountdownOverlay(opts);
    }
    return Promise.resolve(showParticipantCountdown(seconds));
  }
  
  // 관리자 모니터링 모드이고 카운트다운을 시작하지 않은 경우에만 제외
  if (!shouldAutoStartLocalTraining()) {
    console.log('관리자 모니터링 모드 - 카운트다운을 표시하지 않습니다');
    return Promise.resolve();
  }
  
  if (groupTrainingState.isAdmin || typeof showParticipantCountdown !== 'function') {
    return showGroupCountdownOverlay(opts);
  }
  return Promise.resolve(showParticipantCountdown(seconds));
}



// 마이크 상태 관리
let microphoneState = {
  isActive: false,
  mediaStream: null,
  audioContext: null,
  analyser: null,
  mediaRecorder: null,
  recordingChunks: [],
  audioChunkInterval: null,
  lastChunkId: 0
};

// 참가자 오디오 재생 상태 관리
let participantAudioState = {
  isListening: false,
  audioCheckInterval: null,
  lastReceivedChunkId: 0,
  audioQueue: []
};

// ========== 기본 유틸리티 함수들 ==========
/**
 * 고유 ID 생성 함수
 */
function generateId(prefix = 'id') {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${randomStr}`;
}

/**
 * 6자리 랜덤 방 코드 생성
 */
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 현재 시간 문자열 생성
 */
function getCurrentTimeString() {
  return new Date().toISOString();
}

/**
 * WorldTimeAPI에서 시간 가져오기 (한국 시간대)
 */
let worldTimeOffset = null; // 서버 시간과 로컬 시간의 차이 (밀리초) - 하위 호환성 유지
let worldTimeBase = null; // 구글 타임존 API에서 받은 서버 시간 (기준 시간)
let worldTimeSyncLocalTime = null; // 동기화 시점의 로컬 시간 (기준 시간)
let worldTimeInitialized = false;
let worldTimeSyncInterval = null; // 동기화 인터벌 (1회만 실행)
let worldTimeSyncAttempted = false; // 동기화 시도 여부
let worldTimeSyncRetryTimeout = null; // 재시도 타임아웃
let worldTimeErrorCount = 0; // 연속 실패 횟수
let lastWorldTimeError = 0; // 마지막 에러 발생 시간
let currentTimeApiIndex = 0; // 현재 사용 중인 API 인덱스
let worldTimeSyncCompleted = false; // 20초 후 동기화 완료 여부 (더 이상 동기화 안 함)

// 구글 타임존 API 키
const GOOGLE_TIMEZONE_API_KEY = 'AIzaSyAv2S_3hfPhEIv6CI2ZtwGKMIdOuV6a_OA';

// 서울의 위도/경도
const SEOUL_LATITUDE = 37.5665;
const SEOUL_LONGITUDE = 126.9780;

// 여러 시간 API 엔드포인트 (순차적으로 시도)
const TIME_APIS = [
  {
    name: 'Google Time Zone API',
    url: (timestamp) => {
      // 구글 타임존 API는 동적 URL 생성 필요
      return `https://maps.googleapis.com/maps/api/timezone/json?location=${SEOUL_LATITUDE},${SEOUL_LONGITUDE}&timestamp=${timestamp}&key=${GOOGLE_TIMEZONE_API_KEY}`;
    },
    parser: (data, requestTimestamp) => {
      // 구글 타임존 API 응답 처리
      if (data.status !== 'OK') {
        throw new Error(`Google Time Zone API error: ${data.status}`);
      }
      
      // UTC 타임스탬프를 밀리초로 변환
      const utcTime = new Date(requestTimestamp * 1000);
      
      // 오프셋 계산 (초 단위)
      // 서울은 UTC+9이므로 rawOffset은 32400초 (9시간)
      const totalOffsetSeconds = data.rawOffset + (data.dstOffset || 0);
      
      // 서울 시간 = UTC 시간 + 오프셋
      // 예: UTC 11:47:13 + 9시간 = 서울 20:47:13
      // Date 객체는 UTC 기준으로 저장되므로:
      // UTC 시간을 그대로 저장하고, formatTime에서 getUTCHours() + 오프셋을 적용
      // 예: UTC 11:47:13 저장 → formatTime에서 11 + 9 = 20:47:13 표시
      
      // UTC 시간을 그대로 저장 (formatTime에서 오프셋 적용)
      const seoulTimeAsUTC = utcTime;
      
      console.log('구글 타임존 API 시간 계산:', {
        requestTimestamp,
        utcTime: utcTime.toISOString(),
        utcHours: utcTime.getUTCHours(),
        rawOffset: data.rawOffset,
        dstOffset: data.dstOffset || 0,
        totalOffsetSeconds: totalOffsetSeconds,
        totalOffsetHours: totalOffsetSeconds / 3600,
        seoulTimeAsUTC: seoulTimeAsUTC.toISOString(),
        seoulTimeUTCHours: seoulTimeAsUTC.getUTCHours(),
        expectedSeoulHours: (seoulTimeAsUTC.getUTCHours() + 9) % 24,
        seoulTimeFormatted: formatTime(seoulTimeAsUTC)
      });
      
      return seoulTimeAsUTC;
    },
    requiresTimestamp: true // 타임스탬프가 필요한 API
  },
  {
    name: 'TimeAPI.io',
    url: 'https://timeapi.io/api/Time/current/zone?timeZone=Asia/Seoul',
    parser: (data) => new Date(data.dateTime),
    requiresTimestamp: false
  },
  {
    name: 'WorldTimeAPI (백업)',
    url: 'https://worldtimeapi.org/api/timezone/Asia/Seoul',
    parser: (data) => new Date(data.datetime),
    requiresTimestamp: false
  }
];

/**
 * 단일 시간 API 호출 시도
 */
async function tryFetchTimeFromAPI(api, timeout = 5000, requestTimestamp = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    // 구글 타임존 API는 타임스탬프가 필요
    if (api.requiresTimestamp) {
      // 타임스탬프가 없으면 현재 UTC 타임스탬프 사용
      if (!requestTimestamp) {
        requestTimestamp = Math.floor(Date.now() / 1000); // 초 단위
      }
    }
    
    // URL 생성 (함수인 경우 호출)
    const apiUrl = typeof api.url === 'function' 
      ? api.url(requestTimestamp || Math.floor(Date.now() / 1000))
      : api.url;
    
    // User-Agent 헤더 추가 (일부 서버에서 요구)
    const response = await fetch(apiUrl, {
      signal: controller.signal,
      cache: 'no-cache',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      mode: 'cors',
      credentials: 'omit' // 쿠키 전송 방지
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    // 구글 타임존 API는 타임스탬프를 파서에 전달
    const serverTime = api.requiresTimestamp 
      ? api.parser(data, requestTimestamp)
      : api.parser(data);
    
    if (!serverTime || isNaN(serverTime.getTime())) {
      throw new Error('Invalid time data received');
    }
    
    return serverTime;
  } catch (error) {
    clearTimeout(timeoutId);
    // 에러 타입 구분
    if (error.name === 'AbortError') {
      error.apiName = api.name;
      error.errorType = 'TIMEOUT';
    } else if (error.message && error.message.includes('Failed to fetch')) {
      error.apiName = api.name;
      error.errorType = 'NETWORK_ERROR';
    } else if (error.message && error.message.includes('CORS')) {
      error.apiName = api.name;
      error.errorType = 'CORS_ERROR';
    } else if (error.message && error.message.includes('Google Time Zone API error')) {
      error.apiName = api.name;
      error.errorType = 'API_ERROR';
    }
    throw error;
  }
}

/**
 * Google Time Zone API만 사용하여 시간 가져오기
 */
async function fetchWorldTime() {
  const localTime = new Date();
  let lastError = null;
  
  // Google Time Zone API만 사용 (인덱스 0)
  const googleTimeZoneAPI = TIME_APIS[0];
  
  try {
    // 구글 타임존 API는 현재 UTC 타임스탬프 필요
    const requestTimestamp = Math.floor(Date.now() / 1000);
    
    const serverTime = await tryFetchTimeFromAPI(googleTimeZoneAPI, 5000, requestTimestamp); // 5초 타임아웃
    
    // 구글 타임존 API에서 받은 서버 시간을 직접 저장 (서울 시간)
    worldTimeBase = serverTime;
    worldTimeSyncLocalTime = localTime.getTime(); // 동기화 시점의 로컬 시간 저장
    
    // 하위 호환성을 위한 오프셋 계산 (기존 로직 유지)
    const newOffset = serverTime.getTime() - localTime.getTime();
    const previousOffset = worldTimeOffset;
    worldTimeOffset = newOffset;
    worldTimeInitialized = true;
    worldTimeErrorCount = 0; // 성공 시 에러 카운트 리셋
    currentTimeApiIndex = 0; // Google Time Zone API만 사용
    
    // 오프셋 변화량 계산 (디버깅용)
    const offsetChange = previousOffset !== null ? (newOffset - previousOffset) : 0;
    
    // 첫 동기화이거나 오프셋이 크게 변경된 경우에만 로그 출력
    if (previousOffset === null || Math.abs(offsetChange) > 1000) {
      console.log(`✅ ${googleTimeZoneAPI.name} 시간 동기화 완료:`, {
        api: googleTimeZoneAPI.name,
        serverTime: serverTime.toISOString(),
        serverTimeLocal: serverTime.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
        localTime: localTime.toISOString(),
        offset: worldTimeOffset,
        offsetSeconds: Math.round(worldTimeOffset / 1000),
        offsetChange: offsetChange !== 0 ? `${offsetChange > 0 ? '+' : ''}${Math.round(offsetChange / 1000)}초` : '변화 없음'
      });
    }
    
    return serverTime;
  } catch (error) {
    lastError = error;
    // Google Time Zone API 실패 시 에러만 기록 (다른 API로 폴백하지 않음)
    console.warn('⚠️ Google Time Zone API 실패:', error);
  }
  
  // 모든 API 실패
  worldTimeErrorCount++;
  const now = Date.now();
  
    // 에러 로그는 1분에 한 번만 출력 (상세 정보 포함)
    if (now - lastWorldTimeError > 60000 || worldTimeErrorCount === 1) {
      const errorType = lastError?.errorType || 'UNKNOWN';
      const apiName = lastError?.apiName || '알 수 없음';
      
      if (errorType === 'TIMEOUT') {
        console.warn(`⚠️ ${apiName} 타임아웃 (5초 초과)`);
      } else if (errorType === 'NETWORK_ERROR') {
        console.warn(`⚠️ ${apiName} 네트워크 오류 (연결 실패 또는 ERR_CONNECTION_RESET)`);
        console.warn('   → 가능한 원인: 방화벽, 프록시, 네트워크 정책, API 서버 장애');
      } else if (errorType === 'CORS_ERROR') {
        console.warn(`⚠️ ${apiName} CORS 오류 (브라우저 정책 위반)`);
      } else {
        console.warn(`⚠️ ${apiName} 실패:`, lastError?.message || '알 수 없는 오류');
      }
      lastWorldTimeError = now;
    }
  
  // 실패 시 이전 오프셋 유지 (있는 경우) 또는 0으로 설정
  if (worldTimeOffset === null) {
    worldTimeOffset = 0;
    worldTimeInitialized = true;
    console.log('ℹ️ 로컬 시간 사용 (모든 시간 API 동기화 실패)');
  }
  
  return new Date();
}

/**
 * 동기화된 현재 시간 가져오기 (서울 시간)
 */
function getSyncedTime() {
  if (!worldTimeInitialized) {
    // 아직 초기화되지 않았으면 로컬 시간 반환
    return new Date();
  }
  
  // 구글 타임존 API에서 받은 서버 시간을 기준으로 계산
  if (worldTimeBase && worldTimeSyncLocalTime !== null) {
    // 서버 시간(서울 시간) + (현재 로컬 시간 - 동기화 시점 로컬 시간) = 현재 서울 시간
    const elapsedSinceSync = Date.now() - worldTimeSyncLocalTime;
    const currentSeoulTime = new Date(worldTimeBase.getTime() + elapsedSinceSync);
    
    // 디버깅: 주기적으로 시간 확인 (10초마다, 첫 번째 호출 시)
    const elapsedSeconds = Math.floor(elapsedSinceSync / 1000);
    if (elapsedSeconds % 10 === 0 || elapsedSeconds < 2) {
      const formattedTime = formatTime(currentSeoulTime);
      console.log('현재 시간 계산:', {
        worldTimeBase: worldTimeBase.toISOString(),
        worldTimeBaseFormatted: formatTime(worldTimeBase),
        elapsedSinceSync: elapsedSeconds + '초',
        currentSeoulTime: currentSeoulTime.toISOString(),
        currentSeoulTimeFormatted: formattedTime,
        currentSeoulTimeUTCHours: currentSeoulTime.getUTCHours(),
        expectedSeoulHours: (currentSeoulTime.getUTCHours() + 9) % 24
      });
    }
    
    return currentSeoulTime;
  }
  
  // 하위 호환성: 기존 오프셋 방식 사용
  return new Date(Date.now() + (worldTimeOffset || 0));
}

let lastCreatedAtSyncAppliedAt = 0;
let clockSyncFlashTimeout = null;

function parseRoomTimestampForClock(value) {
  if (!value) return null;
  
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  
  if (typeof value === 'number') {
    const numericDate = new Date(value);
    return isNaN(numericDate.getTime()) ? null : numericDate;
  }
  
  const str = String(value).trim();
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }
  
  const timeMatch = /^(\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(str);
  if (timeMatch) {
    const [, hh, mm, ss] = timeMatch;
    const base = getSyncedTime();
    const seeded = new Date(base.getTime());
    seeded.setHours(parseInt(hh, 10), parseInt(mm, 10), parseInt(ss, 10), 0);
    return seeded;
  }
  
  return null;
}

function flashClockSyncIndicator(duration = 2000) {
  const clockElement = document.getElementById('groupTrainingClock');
  if (!clockElement) return;
  
  clockElement.classList.add('clock-sync-alert');
  if (clockSyncFlashTimeout) {
    clearTimeout(clockSyncFlashTimeout);
  }
  clockSyncFlashTimeout = setTimeout(() => {
    clockElement.classList.remove('clock-sync-alert');
  }, duration);
}

function handleCreatedAtClockSync(createdAtDate, diffMs) {
  if (!createdAtDate || typeof diffMs !== 'number' || diffMs <= 0) {
    return;
  }
  
  const now = Date.now();
  if (now - lastCreatedAtSyncAppliedAt < 20000) {
    return;
  }
  
  const referenceTime = new Date(createdAtDate.getTime());
  worldTimeBase = referenceTime;
  worldTimeSyncLocalTime = Date.now();
  worldTimeOffset = referenceTime.getTime() - worldTimeSyncLocalTime;
  worldTimeInitialized = true;
  lastCreatedAtSyncAppliedAt = now;
  
  flashClockSyncIndicator();
  const clockElement = document.getElementById('groupTrainingClock');
  if (clockElement) {
    updateClockSimple(clockElement, getSyncedTime());
  }
  
  console.log('⏱️ CreatedAt 기반 시간 보정 적용', {
    createdAtISO: referenceTime.toISOString(),
    diffMs,
    diffSeconds: Math.round(diffMs / 1000)
  });
}

function formatToKstIsoString(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return '';
  }
  
  const KST_OFFSET_MINUTES = 9 * 60;
  const kstTime = new Date(date.getTime() + KST_OFFSET_MINUTES * 60 * 1000);
  const isoWithoutZ = kstTime.toISOString().replace('Z', '');
  const offsetSign = '+';
  const offsetHours = String(Math.floor(KST_OFFSET_MINUTES / 60)).padStart(2, '0');
  const offsetMinutes = String(KST_OFFSET_MINUTES % 60).padStart(2, '0');
  return `${isoWithoutZ}${offsetSign}${offsetHours}:${offsetMinutes}`;
}

/**
 * 시간을 HH:MM:SS 형식으로 포맷 (서울 시간대 기준)
 * Date 객체는 UTC 기준으로 저장되므로, 서울 시간을 표시하려면 UTC 시간에 9시간을 더해야 함
 */
function formatTime(date) {
  // Date 객체의 UTC 시간을 가져와서 서울 오프셋(9시간)을 더함
  // worldTimeBase가 이미 서울 시간으로 계산되어 있으므로, UTC 시간에 9시간을 더하면 서울 시간
  let hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  
  // 서울은 UTC+9이므로 9시간 추가
  hours = (hours + 9) % 24;
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// 각 자리수의 마지막 값 추적 (정확한 변경 감지)
if (typeof window.clockDigitValues === 'undefined') {
  window.clockDigitValues = new Map();
}

/**
 * 시계를 간단한 텍스트로 업데이트 (초 단위 변경)
 */
function updateClockSimple(clockElement, newTime) {
  if (!clockElement) return;
  
  const timeStr = formatTime(newTime);
  
  // 시계 구조가 있으면 제거하고 간단한 텍스트로 변경
  if (clockElement.querySelector('.clock-digits')) {
    clockElement.innerHTML = timeStr;
  } else {
    // 기존 텍스트 업데이트
    clockElement.textContent = timeStr;
  }
}

/**
 * 시계를 숫자 스크롤 효과로 업데이트 (사용 안 함)
 */
function updateClockWithScroll(clockElement, newTime) {
  if (!clockElement) return;
  
  const timeStr = formatTime(newTime);
  const timeParts = timeStr.split(':');
  const [hours, minutes, seconds] = timeParts;
  
  // 시계 구조가 없으면 생성 (한 번만)
  if (!clockElement.querySelector('.clock-digits')) {
    // 기존 텍스트 내용 제거하고 구조 생성
    clockElement.innerHTML = '';
    clockElement.innerHTML = `
      <div class="clock-digits">
        <div class="clock-digit" data-index="0">
          <div class="digit-container">
            <span class="digit-value">${hours[0]}</span>
          </div>
        </div>
        <div class="clock-digit" data-index="1">
          <div class="digit-container">
            <span class="digit-value">${hours[1]}</span>
          </div>
        </div>
        <span class="clock-separator">:</span>
        <div class="clock-digit" data-index="2">
          <div class="digit-container">
            <span class="digit-value">${minutes[0]}</span>
          </div>
        </div>
        <div class="clock-digit" data-index="3">
          <div class="digit-container">
            <span class="digit-value">${minutes[1]}</span>
          </div>
        </div>
        <span class="clock-separator">:</span>
        <div class="clock-digit" data-index="4">
          <div class="digit-container">
            <span class="digit-value">${seconds[0]}</span>
          </div>
        </div>
        <div class="clock-digit" data-index="5">
          <div class="digit-container">
            <span class="digit-value">${seconds[1]}</span>
          </div>
        </div>
      </div>
    `;
    return;
  }
  
  // 각 자리수 업데이트
  const digitElements = clockElement.querySelectorAll('.clock-digit');
  const digits = [hours[0], hours[1], minutes[0], minutes[1], seconds[0], seconds[1]];
  
  digitElements.forEach((digitEl, index) => {
    const digitContainer = digitEl.querySelector('.digit-container');
    const newValue = digits[index];
    const digitKey = `${clockElement.id || 'clock'}_${index}`; // 고유 키 생성
    
    // 마지막 값 가져오기 (없으면 null)
    const lastValue = window.clockDigitValues.get(digitKey);
    
    // 숫자가 변경되었는지 확인 (마지막 값과 비교)
    if (lastValue === newValue) {
      // 값이 변경되지 않았으면 스킵
      return;
    }
    
    // 마지막 값 업데이트
    window.clockDigitValues.set(digitKey, newValue);
    
    // 모든 digit-value 요소 가져오기
    const allValues = Array.from(digitContainer.querySelectorAll('.digit-value'));
    
    // 현재 표시 중인 값 찾기: digit-old가 아니고, transform이 translateY(0)이거나 없는 것
    let currentValueEl = null;
    
    // 먼저 digit-old가 아니고 transform이 translateY(0)인 요소 찾기
    for (const el of allValues) {
      const transform = el.style.transform || '';
      const isOld = el.classList.contains('digit-old');
      if (!isOld && (transform === '' || transform === 'translateY(0)' || transform.includes('translateY(0)'))) {
        currentValueEl = el;
        break;
      }
    }
    
    // 찾지 못했으면 digit-old가 아닌 첫 번째 요소 사용
    if (!currentValueEl) {
      currentValueEl = allValues.find(el => !el.classList.contains('digit-old'));
    }
    
    // 여전히 없으면 첫 번째 요소 사용 (애니메이션 중일 수 있음)
    if (!currentValueEl && allValues.length > 0) {
      currentValueEl = allValues[0];
    }
    
    // 숫자가 변경되었을 때만 스크롤 효과 적용
    if (currentValueEl || !lastValue) {
      // 기존 애니메이션 중인 digit-old 요소들 즉시 정리 (중복 방지)
      allValues.forEach(el => {
        if (el.classList.contains('digit-old')) {
          el.remove();
        }
      });
      
      // 현재 값이 있으면 old 클래스 추가
      if (currentValueEl) {
        currentValueEl.classList.add('digit-old');
      }
      
      // 새 값 요소 생성 (아래에 위치)
      const newValueEl = document.createElement('span');
      newValueEl.className = 'digit-value digit-new';
      newValueEl.textContent = newValue;
      newValueEl.style.transform = 'translateY(100%)'; // 초기 위치: 아래
      digitContainer.appendChild(newValueEl);
      
      // 애니메이션 시작 (즉시 실행)
      requestAnimationFrame(() => {
        // 애니메이션 시작
        if (currentValueEl) {
          currentValueEl.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
          currentValueEl.style.transform = 'translateY(-100%)';
        }
        newValueEl.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        newValueEl.style.transform = 'translateY(0)';
      });
      
      // 애니메이션 완료 후 정리 (300ms 후)
      setTimeout(() => {
        if (currentValueEl && currentValueEl.parentNode) {
          currentValueEl.remove();
        }
        if (newValueEl && newValueEl.parentNode) {
          newValueEl.classList.remove('digit-new');
          newValueEl.style.transform = 'translateY(0)';
          newValueEl.style.transition = '';
        }
      }, 300);
    } else if (!currentValueEl) {
      // 현재 값이 없으면 즉시 표시 (초기화 시)
      const newValueEl = document.createElement('span');
      newValueEl.className = 'digit-value';
      newValueEl.textContent = newValue;
      newValueEl.style.transform = 'translateY(0)';
      digitContainer.appendChild(newValueEl);
    }
  });
}

/**
 * 시계 업데이트 함수
 */
let clockUpdateInterval = null;

function startClock() {
  // 기존 인터벌 제거
  if (clockUpdateInterval) {
    clearInterval(clockUpdateInterval);
  }
  if (worldTimeSyncInterval) {
    clearTimeout(worldTimeSyncInterval);
    worldTimeSyncInterval = null;
  }
  
  // 시계 요소 찾기
  const clockElement = document.getElementById('groupTrainingClock');
  if (!clockElement) {
    console.warn('시계 요소를 찾을 수 없습니다.');
    return;
  }
  
  // 최초 1회 시간 동기화 (즉시) - Google Time Zone API만 사용
  if (!worldTimeInitialized) {
    fetchWorldTime().then(() => {
      // 동기화 후 즉시 업데이트
      const syncedTime = getSyncedTime();
      updateClockSimple(clockElement, syncedTime);
    });
  } else {
    // 이미 초기화되었으면 즉시 업데이트
    const syncedTime = getSyncedTime();
    updateClockSimple(clockElement, syncedTime);
  }
  
  // 20초 후 동기화는 아직 완료되지 않았을 때만 실행
  // (새로 시작할 때는 플래그 리셋하지 않음 - 한 번 완료되면 더 이상 동기화 안 함)
  
  // 1초마다 시계 업데이트 (간단한 텍스트 업데이트)
  clockUpdateInterval = setInterval(() => {
    const syncedTime = getSyncedTime();
    updateClockSimple(clockElement, syncedTime);
  }, 1000);
  
  // 동기화 함수 (1회만 실행, 20초 후)
  const syncTime = async () => {
    // 이미 시도했거나 동기화가 완료되었으면 종료
    if (worldTimeSyncAttempted || worldTimeSyncCompleted) {
      return;
    }
    
    worldTimeSyncAttempted = true;
    console.log('🔄 Google Time Zone API 시간 동기화 시작 (20초 후)...');
    
    try {
      await fetchWorldTime();
      
      // 동기화 후 즉시 시계 업데이트
      const syncedTime = getSyncedTime();
      if (clockElement) {
        updateClockSimple(clockElement, syncedTime);
      }
      
      // 동기화 완료 플래그 설정 (더 이상 동기화 안 함)
      worldTimeSyncCompleted = true;
      console.log('✅ Google Time Zone API 시간 동기화 완료 (더 이상 동기화하지 않음)');
      
      // 타임아웃 정리 (setTimeout이므로 clearTimeout 사용)
      if (worldTimeSyncInterval) {
        clearTimeout(worldTimeSyncInterval);
        worldTimeSyncInterval = null;
      }
    } catch (error) {
      // 실패 시 10초 후 재시도 1회
      console.warn('⚠️ Google Time Zone API 시간 동기화 실패, 10초 후 재시도...');
      
      worldTimeSyncRetryTimeout = setTimeout(async () => {
        try {
          await fetchWorldTime();
          
          const syncedTime = getSyncedTime();
          if (clockElement) {
            updateClockSimple(clockElement, syncedTime);
          }
          
          // 동기화 완료 플래그 설정 (더 이상 동기화 안 함)
          worldTimeSyncCompleted = true;
          console.log('✅ Google Time Zone API 시간 동기화 재시도 완료 (더 이상 동기화하지 않음)');
        } catch (retryError) {
          console.warn('⚠️ Google Time Zone API 시간 동기화 재시도 실패, 로컬 시간 사용');
          // 실패해도 동기화 완료 플래그 설정하여 더 이상 시도하지 않음
          worldTimeSyncCompleted = true;
        }
        
        worldTimeSyncRetryTimeout = null;
      }, 10000); // 10초 후 재시도
    }
  };
  
  // 20초 후 첫 동기화 시작 (1회만)
  if (!worldTimeSyncCompleted) {
    worldTimeSyncInterval = setTimeout(syncTime, 20000);
  }
  
  console.log('✅ 시계 시작 (1초 업데이트, Google Time Zone API만 사용, 20초 후 1회 동기화 후 종료)');
}

function stopClock() {
  if (clockUpdateInterval) {
    clearInterval(clockUpdateInterval);
    clockUpdateInterval = null;
  }
  if (worldTimeSyncInterval) {
    clearInterval(worldTimeSyncInterval);
    worldTimeSyncInterval = null;
  }
  console.log('⏹️ 시계 정지');
}

   
/**
 * 백엔드에서 받아온 방 데이터를 일관된 형태로 변환
 */
function normalizeRoomData(raw) {
  if (!raw || typeof raw !== 'object') return null;

  try {
    const participantsRaw = raw.ParticipantsData ?? raw.participants ?? [];
    const participants = normalizeParticipantsArray(participantsRaw);

    return {
      id: raw.ID || raw.id || raw.roomId || '',
      code: raw.Code || raw.code || raw.roomCode || '',
      name: raw.Name || raw.roomName || raw.name || '',
      workoutId: raw.WorkoutId || raw.workoutId || raw.workoutID || raw.workout_id || '',
      adminId: raw.AdminId || raw.adminId || raw.adminID || raw.AdminID || '',
      adminName: raw.AdminName || raw.adminName || '',
      maxParticipants: Number(raw.MaxParticipants || raw.maxParticipants || 0) || 0,
      status: raw.Status || raw.status || 'waiting',
      createdAt: raw.CreatedAt || raw.createdAt || null,
      updatedAt: raw.UpdatedAt || raw.updatedAt || null,
      startedAt: raw.StartedAt || raw.startedAt || null,
      trainingStartTime: raw.TrainingStartTime || raw.trainingStartTime || null,
      countdownStartTime: raw.CountdownStartTime || raw.countdownStartTime || null,
      countdownEndTime: raw.CountdownEndTime || raw.countdownEndTime || null,
      participants,
      settings: (() => {
        const s = raw.Settings || raw.settings;
        if (!s) return {};
        if (typeof s === 'string') {
          try {
            return JSON.parse(s);
          } catch {
            return {};
          }
        }
        return s;
      })(),
      ParticipantsData: participants
    };
  } catch (error) {
    console.warn('normalizeRoomData 실패:', error);
    return null;
  }
}

function getCurrentRoomCode(room = groupTrainingState.currentRoom) {
  if (!room) {
    return groupTrainingState.roomCode || '';
  }
  return room.code || room.roomCode || groupTrainingState.roomCode || '';
}

   
const SAFEGET_SUPPRESSED_IDS = ['readyToggleBtn', 'startGroupTrainingBtn'];

/**
 * 안전한 요소 접근
 */
function safeGet(id) {
  const element = document.getElementById(id);
  if (!element) {
    if (id === 'roomWorkoutSelect') {
      console.log(`🔍 ${id} 요소를 찾는 중... (동적 생성 예정)`);
    } else if (!SAFEGET_SUPPRESSED_IDS.includes(id)) {
      console.warn(`Element not found: ${id}`);
    }
  }
  return element;
}


/**
 * 필수 HTML 요소들이 있는지 확인하고 없으면 생성
 */
function ensureRequiredElements() {
  const requiredElements = [
    {
      id: 'roomNameInput',
      parent: 'adminSection',
      html: '<input type="text" id="roomNameInput" class="form-control" placeholder="방 이름을 입력하세요" maxlength="20">'
    },
    {
      id: 'maxParticipants', 
      parent: 'adminSection',
      html: `<select id="maxParticipants" class="form-control">
        <option value="2">2명</option>
        <option value="4" selected>4명</option>
        <option value="6">6명</option>
        <option value="8">8명</option>
        <option value="10">10명</option>
        <option value="20">20명</option>
      </select>`
    }
  ];
  
  requiredElements.forEach(({ id, parent, html }) => {
    if (!safeGet(id)) {
      const parentEl = safeGet(parent);
      if (parentEl) {
        const wrapper = document.createElement('div');
        wrapper.className = 'form-group';
        wrapper.innerHTML = html;
        parentEl.appendChild(wrapper);
        console.log(`✅ ${id} 요소가 생성되었습니다`);
      }
    }
  });
}


   
/**
 * 토스트 메시지 표시
 */
function showToast(message, type = 'info') {
  const toast = safeGet('toast');
  if (!toast) {
    if (typeof window.showToast === 'function') {
      window.showToast(message);
    } else {
      console.log(`[${type}] ${message}`);
    }
    return;
  }
  
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ========== JSONP API 연동 함수들 ==========

/**
 * JSONP 요청 함수 (workoutManager 방식 적용)
 */
function jsonpRequest(url, params = {}) {
  return new Promise((resolve, reject) => {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      reject(new Error('유효하지 않은 URL입니다.'));
      return;
    }
    
    const callbackName = 'jsonp_callback_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    const script = document.createElement('script');
    let isResolved = false;
    
    console.log('그룹훈련 JSONP request to:', url, 'with params:', params);
    
    window[callbackName] = function(data) {
      if (isResolved) return;
      isResolved = true;
      
      console.log('그룹훈련 JSONP response received:', data);
      cleanup();
      resolve(data);
    };
    
    function cleanup() {
      try {
        if (window[callbackName]) {
          delete window[callbackName];
        }
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
      } catch (e) {
        console.warn('JSONP cleanup warning:', e);
      }
    }
    
    script.onerror = function() {
      if (isResolved) return;
      isResolved = true;
      
      console.error('그룹훈련 JSONP script loading failed');
      cleanup();
      reject(new Error('네트워크 연결 오류'));
    };
    
    try {
      // 안전한 파라미터 인코딩
      const urlParts = [];
      Object.keys(params).forEach(key => {
        if (params[key] !== null && params[key] !== undefined) {
          const value = String(params[key]);
          urlParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
        }
      });
      
      // callback 파라미터 추가
      urlParts.push(`callback=${encodeURIComponent(callbackName)}`);
      
      const finalUrl = `${url}?${urlParts.join('&')}`;
      script.src = finalUrl;
      
      document.head.appendChild(script);
      
      // 타임아웃 설정 (30초)
      setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          reject(new Error('요청 시간 초과'));
        }
      }, 30000);
      
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/**
 * 재시도가 포함된 JSONP 요청
 */
async function jsonpRequestWithRetry(url, params = {}, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`그룹훈련 API 요청 시도 ${attempt}/${maxRetries}`);
      const result = await jsonpRequest(url, params);
      return result;
    } catch (error) {
      lastError = error;
      console.warn(`그룹훈련 API 요청 ${attempt}회 실패:`, error.message);
      
      if (attempt < maxRetries) {
        // 재시도 전 대기 (1초 * 시도 횟수)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  
  throw lastError;
}


// ========== 그룹 훈련 API 함수들 ==========

/**
 * 그룹 훈련방 생성 API 호출
 */
async function apiCreateRoom(roomData) {
  if (!roomData || typeof roomData !== 'object') {
    return { success: false, error: '유효하지 않은 방 데이터입니다.' };
  }
  
  try {
    const params = {
      action: 'createRoom',
      roomName: String(roomData.roomName || ''),
      maxParticipants: Number(roomData.maxParticipants) || 10,
      workoutId: String(roomData.workoutId || ''),
      adminId: String(roomData.adminId || ''),
      adminName: String(roomData.adminName || '')
    };
    
    console.log('방 생성 요청:', params);
    return await jsonpRequestWithRetry(window.GAS_URL, params);
  } catch (error) {
    console.error('apiCreateRoom 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 그룹 훈련방 조회
 */
async function apiGetRoom(roomCode) {
  if (!roomCode) {
    console.error('❌ apiGetRoom: 방 코드 누락');
    return { success: false, error: '방 코드가 필요합니다.' };
  }
  
  if (!window.GAS_URL) {
    console.error('❌ apiGetRoom: GAS_URL이 설정되지 않았습니다');
    return { success: false, error: '서버 URL이 설정되지 않았습니다.' };
  }
  
  try {
    const params = { 
      action: 'getRoom', 
      roomCode: String(roomCode).toUpperCase().trim()
    };
    
    console.log('📡 apiGetRoom 요청:', params);
    
    const result = await jsonpRequest(window.GAS_URL, params);
    
    console.log('📡 apiGetRoom 응답:', result);
    
    return result;
  } catch (error) {
    console.error('❌ apiGetRoom 실패:', error);
    console.error('오류 스택:', error.stack);
    
    // 네트워크 오류인지 확인
    const isNetworkError = error.message?.includes('네트워크') || 
                          error.message?.includes('Network') ||
                          error.message?.includes('연결') ||
                          error.message?.includes('시간 초과') || // timeout을 네트워크 오류로 간주
                          error.message === '네트워크 연결 오류';
    
    return { 
      success: false, 
      error: isNetworkError ? 'NETWORK_ERROR' : (error.message || '방 정보를 가져오는 중 오류가 발생했습니다.')
    };
  }
}

/**
 * 그룹 훈련방 참가
 */
async function apiJoinRoom(roomCode, participantData) {
  if (!roomCode || !participantData) {
    console.error('❌ apiJoinRoom: 필수 파라미터 누락', { roomCode, participantData });
    return { success: false, error: '방 코드와 참가자 데이터가 필요합니다.' };
  }
  
  if (!window.GAS_URL) {
    console.error('❌ apiJoinRoom: GAS_URL이 설정되지 않았습니다');
    return { success: false, error: '서버 URL이 설정되지 않았습니다.' };
  }
  
  try {
    const params = {
      action: 'joinRoom',
      roomCode: String(roomCode).toUpperCase().trim(),
      participantId: String(participantData.participantId || '').trim(),
      participantName: String(participantData.participantName || '참가자').trim()
    };
    
    console.log('📡 apiJoinRoom 요청:', params);
    
    const result = await jsonpRequest(window.GAS_URL, params);
    
    console.log('📡 apiJoinRoom 응답:', result);
    
    return result;
  } catch (error) {
    console.error('❌ apiJoinRoom 실패:', error);
    console.error('오류 스택:', error.stack);
    return { 
      success: false, 
      error: error.message || '방 참가 요청 중 오류가 발생했습니다.' 
    };
  }
}

/**
 * 그룹 훈련방 나가기
 */
async function apiLeaveRoom(roomCode, participantId) {
  if (!roomCode || !participantId) {
    return { success: false, error: '방 코드와 참가자 ID가 필요합니다.' };
  }

  try {
    return await jsonpRequestWithRetry(window.GAS_URL, {
      action: 'leaveRoom',
      roomCode: String(roomCode),
      participantId: String(participantId)
    });
  } catch (error) {
    console.error('apiLeaveRoom 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 참가자 실시간 데이터 저장
 */
async function apiSaveParticipantLiveData(roomCode, participantId, liveData) {
  if (!roomCode || !participantId || !liveData) {
    return { success: false, error: '필수 파라미터가 누락되었습니다.' };
  }
  
  if (!window.GAS_URL) {
    return { success: false, error: '서버 URL이 설정되지 않았습니다.' };
  }
  
  try {
    const params = {
      action: 'saveParticipantLiveData',
      roomCode: String(roomCode).toUpperCase().trim(),
      participantId: String(participantId).trim(),
      power: Number(liveData.power || 0),
      heartRate: Number(liveData.heartRate || 0),
      cadence: Number(liveData.cadence || 0),
      progress: Number(liveData.progress || 0),
      timestamp: String(liveData.timestamp || new Date().toISOString())
    };
    
    console.log('📡 실시간 데이터 전송:', params);
    
    const result = await jsonpRequest(window.GAS_URL, params);
    
    return result;
  } catch (error) {
    console.error('❌ apiSaveParticipantLiveData 실패:', error);
    return { 
      success: false, 
      error: error.message || '실시간 데이터 저장 중 오류가 발생했습니다.' 
    };
  }
}

/**
 * 그룹 훈련방 업데이트
 */
async function apiUpdateRoom(roomCode, data = {}) {
  if (!roomCode) {
    return { success: false, error: '방 코드가 필요합니다.' };
  }

  try {
    const payload = {
      action: 'updateGroupRoom',
      roomCode: String(roomCode)
    };

    let participantsJson = null;

    Object.entries(data).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (key === 'participants' && Array.isArray(value)) {
        const sanitizedParticipants = value.map(sanitizeParticipantForPersistence);
        participantsJson = JSON.stringify(sanitizedParticipants);
        payload.participants = participantsJson;
        payload.ParticipantsData = participantsJson;
        return;
      }
      if (typeof value === 'object') {
        payload[key] = JSON.stringify(value);
      } else {
        payload[key] = String(value);
      }
    });

    return await jsonpRequestWithRetry(window.GAS_URL, payload);
  } catch (error) {
    console.error('apiUpdateRoom 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 워크아웃 목록 조회 API
 */
/**
 * 워크아웃 목록 조회 API (개선된 버전)
 */
async function apiGetWorkouts() {
  try {
    if (!window.GAS_URL) {
      console.warn('GAS_URL이 설정되지 않았습니다. 기본 워크아웃 사용');
      return { 
        success: true, 
        items: getDefaultWorkouts() 
      };
    }
    
    console.log('워크아웃 목록 API 요청 시작');
    const result = await jsonpRequest(window.GAS_URL, { action: 'listWorkouts' });
    
    // API 응답 검증 및 정규화
    if (result && result.success) {
      console.log('API 응답 성공:', result);
      
      // 워크아웃 데이터가 있는지 확인
      let workouts = result.items || result.workouts || result.data || [];
      
      if (Array.isArray(workouts) && workouts.length > 0) {
        return { success: true, items: workouts };
      } else {
        console.warn('API에서 워크아웃 데이터가 없음. 기본 워크아웃 사용');
        return { success: true, items: getDefaultWorkouts() };
      }
    } else {
      console.warn('API 응답 실패 또는 성공하지 않음:', result);
      return { success: true, items: getDefaultWorkouts() };
    }
  } catch (error) {
    console.error('apiGetWorkouts 실패:', error);
    console.log('기본 워크아웃 목록으로 대체');
    return { success: true, items: getDefaultWorkouts() };
  }
}


/**
 * 즉시 중복 워크아웃 선택 요소 제거 (개선된 버전)
 */
function removeDuplicateWorkoutSelectsNow() {
  console.log('🧹 즉시 중복 워크아웃 선택 요소 제거 실행');
  
  const adminSection = document.getElementById('adminSection');
  if (!adminSection) {
    console.warn('adminSection을 찾을 수 없습니다');
    return;
  }
  
  try {
    // 모든 select 요소들 찾기
    const allSelects = adminSection.querySelectorAll('select');
    const workoutSelects = [];
    
    // 워크아웃 관련 select들만 필터링
    allSelects.forEach(select => {
      const hasWorkoutOptions = Array.from(select.options).some(option => 
        option.textContent.includes('SST') || 
        option.textContent.includes('Zone') || 
        option.textContent.includes('Sweet') ||
        option.textContent.includes('Threshold') ||
        option.textContent.includes('Vo2max') ||
        option.textContent.includes('워크아웃')
      );
      
      const hasWorkoutAttribute = 
        (select.id && select.id.includes('workout')) || 
        (select.name && select.name.includes('workout')) ||
        (select.className && select.className.includes('workout'));
      
      if (hasWorkoutOptions || hasWorkoutAttribute) {
        workoutSelects.push(select);
      }
    });
    
    console.log(`🔍 워크아웃 선택 요소 ${workoutSelects.length}개 발견`);
    
    // 첫 번째만 남기고 나머지 제거
    if (workoutSelects.length > 1) {
      for (let i = 1; i < workoutSelects.length; i++) {
        const selectToRemove = workoutSelects[i];
        
        // 부모 요소들 중에서 form-group, input-group 등을 찾아 제거
        let parentToRemove = selectToRemove.parentElement;
        
        // 적절한 부모 요소 찾기
        while (parentToRemove && !parentToRemove.classList.contains('form-group') && 
               !parentToRemove.classList.contains('input-group') && 
               !parentToRemove.classList.contains('field-group') &&
               parentToRemove !== adminSection) {
          parentToRemove = parentToRemove.parentElement;
        }
        
        if (parentToRemove && parentToRemove !== adminSection) {
          parentToRemove.remove();
          console.log(`✅ 중복 워크아웃 선택 그룹 제거됨 (${i}번째)`);
        } else {
          selectToRemove.remove();
          console.log(`✅ 중복 워크아웃 선택 요소 제거됨 (${i}번째)`);
        }
      }
      
      // 남은 첫 번째 요소의 ID 설정
      if (workoutSelects[0]) {
        workoutSelects[0].id = 'roomWorkoutSelect';
        console.log('✅ 첫 번째 워크아웃 선택 요소를 roomWorkoutSelect로 설정');
      }
    } else if (workoutSelects.length === 1) {
      // 하나만 있으면 ID만 설정
      workoutSelects[0].id = 'roomWorkoutSelect';
      console.log('✅ 워크아웃 선택 요소 ID를 roomWorkoutSelect로 설정');
    }
    
  } catch (error) {
    console.error('❌ 워크아웃 요소 제거 중 오류:', error);
  }
}
   



/**
 * 관리자 섹션 초기화 (간단하고 안전한 버전)
 */
async function initializeAdminSection() {
  console.log('🎯 관리자 섹션 초기화 시작');
  
  try {
    // 즉시 중복 제거
    removeDuplicateWorkoutSelectsNow();
    
    // 워크아웃 목록 로드
    setTimeout(async () => {
      try {
        await loadWorkoutsForRoom();
      } catch (error) {
        console.error('워크아웃 로드 중 오류:', error);
      }
    }, 100);
    
    console.log('✅ 관리자 섹션 초기화 완료');
    
  } catch (error) {
    console.error('❌ 관리자 섹션 초기화 중 오류:', error);
  }
}

/**
 * 워크아웃 관련 요소들 정리 (중복 제거)
 */
async function cleanupWorkoutElements(adminSection) {
  console.log('🧹 워크아웃 요소 정리 시작');
  
  // 가능한 모든 워크아웃 선택 요소들 찾기
  const workoutSelectors = [
    '#roomWorkoutSelect',
    'select[name*="workout"]',
    'select[id*="workout"]', 
    'select[class*="workout"]',
    'select[data-type="workout"]'
  ];
  
  let foundElements = [];
  
  workoutSelectors.forEach(selector => {
    const elements = adminSection.querySelectorAll(selector);
    elements.forEach(el => {
      if (!foundElements.includes(el)) {
        foundElements.push(el);
      }
    });
  });
  
  console.log(`🔍 발견된 워크아웃 관련 요소: ${foundElements.length}개`);
  
  // 중복 요소들 제거 (첫 번째 것만 남김)
  if (foundElements.length > 1) {
    for (let i = 1; i < foundElements.length; i++) {
      const elementToRemove = foundElements[i];
      console.log(`🗑️ 중복 요소 제거: ${elementToRemove.id || elementToRemove.className || 'unnamed'}`);
      
      // 부모 form-group도 함께 제거
      const parentGroup = elementToRemove.closest('.form-group, .input-group, .field-group');
      if (parentGroup) {
        parentGroup.remove();
      } else {
        elementToRemove.remove();
      }
    }
  }
  
  // 라벨 중복도 확인 및 제거
  // 라벨 중복도 확인 및 제거
const allLabels = adminSection.querySelectorAll('label');
const workoutLabels = Array.from(allLabels).filter(label => 
  label.getAttribute('for') && label.getAttribute('for').includes('workout') ||
  label.textContent.includes('훈련') || 
  label.textContent.includes('종목')
);
  if (workoutLabels.length > 1) {
    for (let i = 1; i < workoutLabels.length; i++) {
      const labelToRemove = workoutLabels[i];
      const parentGroup = labelToRemove.closest('.form-group, .input-group, .field-group');
      if (parentGroup && !parentGroup.querySelector('select')) {
        parentGroup.remove();
        console.log('🗑️ 중복 라벨 그룹 제거');
      }
    }
  }
  
  console.log('✅ 워크아웃 요소 정리 완료');
}

/**
 * 단일 워크아웃 선택 요소 확보
 */
function ensureSingleWorkoutSelect(adminSection) {
  // 남은 워크아웃 선택 요소 찾기
  let workoutSelect = adminSection.querySelector(
    '#roomWorkoutSelect, select[name*="workout"], select[id*="workout"]'
  );
  
  if (workoutSelect) {
    // 기존 요소가 있으면 ID 설정하고 사용
    workoutSelect.id = 'roomWorkoutSelect';
    console.log('✅ 기존 워크아웃 선택 요소 재사용');
    return workoutSelect;
  }
  
  // 요소가 없으면 새로 생성하지 말고 에러 리포트
  console.warn('❌ 워크아웃 선택 요소가 완전히 사라졌습니다. HTML 구조를 확인해주세요.');
  return null;
}







   
// ========== 그룹훈련 워크아웃 API 함수들 ==========

/**
 * 그룹훈련용 워크아웃 목록 조회
 */
async function apiGetGroupWorkouts() {
  try {
    if (!window.GAS_URL) {
      console.warn('GAS_URL이 설정되지 않았습니다.');
      return { success: false, error: 'GAS_URL이 설정되지 않았습니다.' };
    }
    return await jsonpRequest(window.GAS_URL, { action: 'listGroupWorkouts' });
  } catch (error) {
    console.error('apiGetGroupWorkouts 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 그룹훈련용 워크아웃 단일 조회
 */
async function apiGetGroupWorkout(id) {
  if (!id) {
    return { success: false, error: '워크아웃 ID가 필요합니다.' };
  }
  
  try {
    return await jsonpRequest(window.GAS_URL, { 
      action: 'getGroupWorkout', 
      id: String(id) 
    });
  } catch (error) {
    console.error('apiGetGroupWorkout 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 그룹훈련용 워크아웃 생성
 */
async function apiCreateGroupWorkout(workoutData) {
  console.log('=== 그룹훈련 워크아웃 생성 시작 ===');
  console.log('워크아웃 데이터:', workoutData);
  
  if (!workoutData || typeof workoutData !== 'object') {
    return { success: false, error: '유효하지 않은 워크아웃 데이터입니다.' };
  }
  
  try {
    const params = {
      action: 'createGroupWorkout',
      title: String(workoutData.title || ''),
      description: String(workoutData.description || ''),
      author: String(workoutData.author || ''),
      duration: Number(workoutData.duration) || 60,
      difficulty: String(workoutData.difficulty || 'medium'),
      category: String(workoutData.category || 'general'),
      maxParticipants: Number(workoutData.maxParticipants) || 20,
      status: String(workoutData.status || 'active')
    };
    
    // 세그먼트 데이터가 있으면 추가
    if (workoutData.segments && Array.isArray(workoutData.segments)) {
      params.segments = JSON.stringify(workoutData.segments);
    }
    
    console.log('그룹훈련 워크아웃 생성 요청:', params);
    const result = await jsonpRequestWithRetry(window.GAS_URL, params);
    
    if (result && result.success) {
      console.log('✅ 그룹훈련 워크아웃 생성 성공:', result);
    } else {
      console.error('❌ 그룹훈련 워크아웃 생성 실패:', result);
    }
    
    return result;
  } catch (error) {
    console.error('apiCreateGroupWorkout 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 그룹훈련용 워크아웃 수정
 */
async function apiUpdateGroupWorkout(id, workoutData) {
  if (!id || !workoutData) {
    return { success: false, error: '워크아웃 ID와 데이터가 필요합니다.' };
  }
  
  const params = {
    action: 'updateGroupWorkout',
    id: String(id),
    title: String(workoutData.title || ''),
    description: String(workoutData.description || ''),
    author: String(workoutData.author || ''),
    duration: Number(workoutData.duration) || 60,
    difficulty: String(workoutData.difficulty || 'medium'),
    category: String(workoutData.category || 'general'),
    maxParticipants: Number(workoutData.maxParticipants) || 20,
    status: String(workoutData.status || 'active')
  };
  
  // 세그먼트 데이터가 있으면 추가
  if (workoutData.segments && Array.isArray(workoutData.segments)) {
    params.segments = JSON.stringify(workoutData.segments);
  }
  
  try {
    return await jsonpRequest(window.GAS_URL, params);
  } catch (error) {
    console.error('apiUpdateGroupWorkout 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 그룹훈련용 워크아웃 삭제
 */
async function apiDeleteGroupWorkout(id) {
  if (!id) {
    return { success: false, error: '워크아웃 ID가 필요합니다.' };
  }
  
  try {
    return await jsonpRequest(window.GAS_URL, { 
      action: 'deleteGroupWorkout', 
      id: String(id)
    });
  } catch (error) {
    console.error('apiDeleteGroupWorkout 실패:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 워크아웃 ID로 그룹방 조회
 */
async function getRoomsByWorkoutId(workoutId) {
  if (!workoutId) {
    return [];
  }
  
  try {
    if (!window.GAS_URL) {
      console.warn('GAS_URL이 설정되지 않았습니다.');
      return [];
    }
    
    const result = await jsonpRequest(window.GAS_URL, {
      action: 'listGroupRooms',
      workoutId: String(workoutId)
    });
    
    if (result && result.success) {
      return result.items || result.rooms || [];
    }
    
    return [];
  } catch (error) {
    console.error('getRoomsByWorkoutId 실패:', error);
    return [];
  }
}




// ========== 화면 전환 함수들 ==========

/**
 * 훈련 방식 선택 (기존 ready 화면에서 호출)
 */
async function selectTrainingMode(mode) {
  console.log('Training mode selected:', mode);
  
  if (mode === 'individual') {
    // 기존 개인 훈련 시작 로직
    if (typeof startTraining === 'function') {
      startTraining();
    } else {
      console.warn('startTraining function not found');
      showToast('개인 훈련 기능을 찾을 수 없습니다', 'error');
    }
  } else if (mode === 'group') {
    // 혹시 남아있는 그룹 훈련 모달이 있다면 즉시 제거
    const residualGroupModal = document.getElementById('groupTrainingModal');
    if (residualGroupModal) {
      residualGroupModal.remove();
    }

    // 이미 참가중인 그룹방이 있으면 즉시 그룹 대기실 화면으로 이동
    const existingRoom = groupTrainingState.currentRoom;
    const existingRoomCode = getCurrentRoomCode(existingRoom);
    if (existingRoomCode) {
      console.log('기존 그룹방 감지, 대기실로 바로 이동:', existingRoomCode);
      if (typeof showScreen === 'function') {
        showScreen('groupWaitingScreen');
      }
      if (typeof initializeWaitingRoom === 'function') {
        initializeWaitingRoom();
      }
      return;
    }

    // roomCode만 저장된 경우 자동 참가 시도
    if (!existingRoom && groupTrainingState.roomCode) {
      try {
        console.log('저장된 roomCode로 그룹방 자동 참가 시도:', groupTrainingState.roomCode);
        await joinRoomByCode(groupTrainingState.roomCode);
        return;
      } catch (autoJoinError) {
        console.warn('저장된 roomCode 자동 참가 실패:', autoJoinError);
      }
    }

    // 현재 워크아웃으로 생성된 그룹방이 있으면 자동 입장 (grade=1 관리자도 동일 동작)
    const grade = (typeof getViewerGrade === 'function') ? getViewerGrade() : '2';
    const currentWorkout = window.currentWorkout;
    
    if (currentWorkout && currentWorkout.id) {
      try {
        console.log('워크아웃으로 그룹방 자동 입장 시도:', currentWorkout.id);
        
        // 진행 중 표시
        if (typeof showLoading === 'function') {
          showLoading('그룹 훈련 입장 중입니다...');
        } else {
          showToast('그룹 훈련 입장 중입니다...', 'info');
        }
        
        // 워크아웃 ID로 그룹방 조회
        const rooms = await getRoomsByWorkoutId(currentWorkout.id);
        if (rooms && rooms.length > 0) {
          // 대기 중인 방 찾기
          const waitingRoom = rooms.find(r => 
            (r.status || r.Status || '').toLowerCase() === 'waiting'
          );
          
          if (waitingRoom) {
            const roomCode = waitingRoom.code || waitingRoom.Code;
            if (roomCode) {
              // 정원 체크
              normalizeRoomParticipantsInPlace(waitingRoom);
              const currentParticipants = Array.isArray(waitingRoom.participants) ? waitingRoom.participants.length : 0;
              const maxParticipants = Number(waitingRoom.maxParticipants || waitingRoom.MaxParticipants || 50) || 50;
              
              if (currentParticipants >= maxParticipants) {
                console.log('⚠️ 정원 초과로 자동 입장 불가:', { currentParticipants, maxParticipants });
                // 로딩 숨기기
                if (typeof hideLoading === 'function') {
                  hideLoading();
                }
                showToast('정원이 초과하여 입장할 수 없습니다.', 'error');
                // 다음 단계로 진행 (다른 방 찾기 또는 안내 메시지)
              } else {
                console.log('대기 중인 그룹방 발견, 자동 입장:', roomCode);
                // 바로 입장 (중간 화면 건너뛰기)
                await joinRoomByCode(roomCode);
                // 로딩 숨기기
                if (typeof hideLoading === 'function') {
                  hideLoading();
                }
                return;
              }
            }
          }
        }
        
        // 그룹방이 없거나 대기 중인 방이 없으면 모든 waiting 상태인 방 확인
        console.log('대기 중인 그룹방이 없습니다.');
        // 로딩 숨기기
        if (typeof hideLoading === 'function') {
          hideLoading();
        }
        
        // 모든 waiting 상태인 방 확인
        try {
          const waitingRooms = await getAllWaitingRooms();
          
          if (waitingRooms.length === 0) {
            // waiting 상태인 방이 없으면 메시지 표시하고 진행 막기
            showToast('그룹훈련방 생성이 되지 않았습니다.', 'error');
            console.log('⚠️ waiting 상태인 그룹훈련방이 없습니다.');
            return; // 진행 중단
          }
        } catch (error) {
          console.error('방 목록 확인 실패:', error);
          // 에러 발생 시에도 진행을 막지 않고 사용자에게 알림
          showToast('방 목록을 확인할 수 없습니다. 다시 시도해주세요.', 'warning');
          return; // 진행 중단
        }
        
        // waiting 상태인 방이 있으면 안내 메시지와 함께 그룹방 화면으로 이동
        showToast('현재 워크아웃으로 생성된 그룹방이 없습니다. 방 코드를 입력하거나 방 목록에서 선택하세요.', 'info');
        // 그룹방 화면으로 바로 이동 (참가자 역할 선택)
        if (typeof showScreen === 'function') {
          showScreen('groupRoomScreen');
        }
        if (typeof initializeGroupRoomScreen === 'function') {
          await initializeGroupRoomScreen();
        }
        // 참가자 역할 자동 선택
        if (typeof selectRole === 'function') {
          await selectRole('participant');
        }
      } catch (error) {
        console.error('그룹방 자동 입장 실패:', error);
        // 로딩 숨기기
        if (typeof hideLoading === 'function') {
          hideLoading();
        }
        showToast('그룹방 입장에 실패했습니다. 방 코드를 입력하거나 방 목록에서 선택하세요.', 'warning');
        // 그룹방 화면으로 바로 이동
        if (typeof showScreen === 'function') {
          showScreen('groupRoomScreen');
        }
        if (typeof initializeGroupRoomScreen === 'function') {
          await initializeGroupRoomScreen();
        }
        // 참가자 역할 자동 선택
        if (typeof selectRole === 'function') {
          await selectRole('participant');
        }
      }
    } else {
      // 워크아웃이 없으면 먼저 waiting 상태인 방이 있는지 확인
      try {
        const waitingRooms = await getAllWaitingRooms();
        
        if (waitingRooms.length === 0) {
          // waiting 상태인 방이 없으면 메시지 표시하고 진행 막기
          showToast('그룹훈련방 생성이 되지 않았습니다.', 'error');
          console.log('⚠️ waiting 상태인 그룹훈련방이 없습니다.');
          return; // 진행 중단
        }
      } catch (error) {
        console.error('방 목록 확인 실패:', error);
        // 에러 발생 시에도 진행을 막지 않고 사용자에게 알림
        showToast('방 목록을 확인할 수 없습니다. 다시 시도해주세요.', 'warning');
        return; // 진행 중단
      }
      
      // waiting 상태인 방이 있으면 그룹방 화면으로 이동
      if (typeof showScreen === 'function') {
        showScreen('groupRoomScreen');
      }
      if (typeof initializeGroupRoomScreen === 'function') {
        await initializeGroupRoomScreen();
      }
    }
  }
}

/**
 * 그룹 훈련 모드 선택 (신규 화면에서)
 */
function selectGroupMode(mode) {
  console.log('Group mode selected:', mode);
  
  if (mode === 'individual') {
    // 다시 개인 훈련으로
    showScreen('trainingReadyScreen');
    selectTrainingMode('individual');
  } else if (mode === 'group') {
    // 그룹 훈련 방 화면으로
    showScreen('groupRoomScreen');
    initializeGroupRoomScreen();
  }
}

/**
 * 역할 선택 (관리자/참가자)
 */
async function selectRole(role) {
  console.log(`🎭 역할 선택: ${role}`);

  // 매니저 모드에서 다른 역할로 전환 시 매니저 대시보드 업데이트 중지
  if (role !== 'manager') {
    stopManagerDashboardUpdates();
  }
  
  // 기존 선택 해제
  document.querySelectorAll('.role-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // 현재 선택 활성화
  const currentBtn = safeGet(`${role}RoleBtn`);
  if (currentBtn) {
    currentBtn.classList.add('active');
  }
  
  // 섹션 표시/숨김
  const sections = ['adminSection', 'participantSection', 'managerSection'];
  sections.forEach(sectionId => {
    const section = safeGet(sectionId);
    if (section) {
      if (sectionId === `${role}Section`) {
        section.classList.remove('hidden');
      } else {
        section.classList.add('hidden');
      }
    }
  });
  
  // 상태 업데이트
  groupTrainingState.isAdmin = (role === 'admin');
  groupTrainingState.isManager = (role === 'manager');
  
  // 관리자 선택 시 워크아웃 목록 로드
// 관리자 선택 시 워크아웃 목록 로드
  if (role === 'admin') {
    await initializeAdminSection();
  }
  
  // 참가자 선택 시 방 목록 로드
  if (role === 'participant') {
    setTimeout(async () => {
      console.log('🎯 참가자 모드 - 방 목록 자동 로드 시작');
      try {
        await initializeParticipantSection();
      } catch (error) {
        console.error('참가자 섹션 초기화 실패:', error);
      }
    }, 150);
  }

  if (role === 'manager') {
    try {
      await initializeManagerDashboard();
    } catch (error) {
      console.error('관리자 대시보드 초기화 실패:', error);
      if (typeof showToast === 'function') {
        showToast('관리자 대시보드를 불러오지 못했습니다', 'error');
      }
    }
  }
  
  if (typeof showToast === 'function') {
    const roleNames = {
      admin: '관리자',
      participant: '참가자', 
      manager: '슈퍼 관리자'
    };
    showToast(`${roleNames[role]} 모드로 전환되었습니다`);
  }
}

   
  
 



   
   
// ========== 관리자 기능들 ==========

/**
 * 그룹방 생성을 위한 워크아웃 목록 로드
 */
// 워크아웃 매니저와 동일한 데이터 검증 함수들 추가
function validateWorkoutDataForGroup(workout) {
  if (!workout || typeof workout !== 'object') return false;
  if (workout.id === null || workout.id === undefined) return false;
  return true;
}

function normalizeWorkoutDataForGroup(workout) {
  return {
    id: workout.id,
    title: String(workout.title || '제목 없음'),
    description: String(workout.description || ''),
    author: String(workout.author || '미상'),
    status: String(workout.status || '보이기'),
    total_seconds: Number(workout.total_seconds) || 3600, // 기본 60분
    publish_date: workout.publish_date || null,
    segments: Array.isArray(workout.segments) ? workout.segments : []
  };
}

/**
 * 그룹방 생성을 위한 워크아웃 목록 로드 (워크아웃 매니저 방식 적용)
 */
/**
 * 그룹 방용 워크아웃 목록 로드
 */
/**
 * 그룹 방용 워크아웃 목록 로드 (개선된 버전)
 */
async function loadWorkoutsForGroupRoom() {
  console.log('🎯 그룹 방용 워크아웃 목록 로드');
  
  // 여러 가능한 워크아웃 선택 요소 확인
  const possibleSelectors = ['roomWorkoutSelect', 'workoutSelect', 'adminWorkoutSelect'];
  let workoutSelect = null;
  
  for (const selector of possibleSelectors) {
    workoutSelect = safeGet(selector);
    if (workoutSelect) {
      console.log(`워크아웃 선택 요소 발견: ${selector}`);
      break;
    }
  }
  
  if (!workoutSelect) {
    console.warn('워크아웃 선택 요소를 찾을 수 없습니다. 기본 워크아웃 목록 사용');
    // 기본 워크아웃 목록 반환
    return getDefaultWorkouts();
  }
  
  try {
    // 로딩 표시
    workoutSelect.innerHTML = '<option value="">워크아웃 로딩 중...</option>';
    
    const result = await apiGetWorkouts();
    
    // API 응답 구조 개선된 처리
    let workouts = [];
    
    if (result && result.success) {
      // 다양한 응답 구조 지원
      if (result.items && Array.isArray(result.items)) {
        workouts = result.items;
      } else if (result.workouts && Array.isArray(result.workouts)) {
        workouts = result.workouts;
      } else if (result.data && Array.isArray(result.data)) {
        workouts = result.data;
      }
    }
    
    console.log('API 응답 워크아웃 목록:', workouts);
    
    if (workouts && workouts.length > 0) {
      const options = workouts.map(workout => {
        const id = workout.id || workout.workoutId || workout.key;
        const name = workout.name || workout.title || workout.workoutName || `워크아웃 ${id}`;
        return `<option value="${id}">${escapeHtml(name)}</option>`;
      }).join('');
      
      workoutSelect.innerHTML = `
        <option value="">워크아웃을 선택하세요</option>
        ${options}
      `;
      
      console.log(`✅ ${workouts.length}개의 워크아웃 로드 완료`);
    } else {
      console.warn('워크아웃 목록이 비어있음. 기본 워크아웃 사용');
      // 기본 워크아웃 목록 사용
      loadDefaultWorkouts(workoutSelect);
    }
  } catch (error) {
    console.error('워크아웃 목록 로드 실패:', error);
    console.log('기본 워크아웃 목록으로 대체');
    loadDefaultWorkouts(workoutSelect);
  }
}

/**
 * 기본 워크아웃 목록 로드 (대체 함수)
 */
function loadDefaultWorkouts(workoutSelect) {
  const defaultWorkouts = getDefaultWorkouts();
  
  if (workoutSelect && defaultWorkouts.length > 0) {
    const options = defaultWorkouts.map(workout => 
      `<option value="${workout.id}">${escapeHtml(workout.name)}</option>`
    ).join('');
    
    workoutSelect.innerHTML = `
      <option value="">워크아웃을 선택하세요</option>
      ${options}
    `;
    
    console.log(`✅ ${defaultWorkouts.length}개의 기본 워크아웃 로드 완료`);
  }
}





   
/**
 * 워크아웃 목록 로드 (방 생성용)
 */
/**
 * 그룹훈련용 워크아웃 목록 로드 (DB 연동 버전)
 */
async function loadWorkoutsForRoom() {
  // 여러 가능한 워크아웃 선택 요소 확인 및 동적 생성
  let select = safeGet('roomWorkoutSelect');
  
  if (!select) {
    // adminSection 내부에 select 요소가 있는지 확인
    const adminSection = safeGet('adminSection');
    if (adminSection) {
      select = adminSection.querySelector('select[name*="workout"], select[id*="workout"]');
    }
  }
  
  if (!select) {
    // 동적으로 select 요소 생성 및 삽입
    const targetContainer = safeGet('adminSection') || safeGet('createRoomForm') || document.body;
    if (targetContainer) {
      // 워크아웃 선택 컨테이너 생성
      const workoutContainer = document.createElement('div');
      workoutContainer.className = 'form-group';
      workoutContainer.innerHTML = `
        <label for="roomWorkoutSelect">훈련 종목 선택:</label>
        <select id="roomWorkoutSelect" class="form-control">
          <option value="">워크아웃을 선택하세요</option>
        </select>
      `;
      
      // 기존 요소 앞에 삽입하거나 끝에 추가
      const insertPoint = targetContainer.querySelector('.form-group, .btn-group') || null;
      if (insertPoint) {
        targetContainer.insertBefore(workoutContainer, insertPoint);
      } else {
        targetContainer.appendChild(workoutContainer);
      }
      
      select = safeGet('roomWorkoutSelect');
      console.log('✅ roomWorkoutSelect 요소를 동적으로 생성했습니다');
    }
  }
  
  if (!select) {
    console.warn('❌ roomWorkoutSelect 요소를 찾을 수 없고 생성할 수도 없습니다');
    return;
  }
  
  try {
    console.log('🔄 그룹 훈련용 워크아웃 DB 로딩 시작...');
    
    // 로딩 상태 표시
    select.innerHTML = '<option value="">워크아웃 로딩 중...</option>';
    select.disabled = true;
    
    // 1순위: DB에서 그룹훈련용 워크아웃 로드
    const result = await apiGetGroupWorkouts();
    
    if (result && result.success && result.workouts && result.workouts.length > 0) {
      console.log(`✅ DB에서 ${result.workouts.length}개 그룹훈련 워크아웃을 로드했습니다`);
      
      // 기본 옵션 설정
      select.innerHTML = '<option value="">워크아웃 선택...</option>';
      
      // DB에서 로드한 워크아웃들 추가
      result.workouts.forEach(workout => {
        const option = document.createElement('option');
        option.value = workout.id;
        option.textContent = `${workout.title} (${workout.duration || 60}분)`;
        option.dataset.description = workout.description || '';
        option.dataset.difficulty = workout.difficulty || 'medium';
        option.dataset.category = workout.category || 'general';
        option.dataset.maxParticipants = workout.maxParticipants || 20;
        select.appendChild(option);
      });
      
      select.disabled = false;
      console.log('✅ DB 워크아웃 옵션 로드 완료');
      return;
    }
    
    console.warn('⚠️ DB에서 그룹훈련 워크아웃을 찾을 수 없습니다. 대체 방법을 시도합니다.');
    
    // 2순위: training.js의 loadWorkoutOptions 함수 사용
    if (typeof loadWorkoutOptions === 'function') {
      await loadWorkoutOptions();
      console.log('✅ training.js loadWorkoutOptions으로 워크아웃 옵션이 로드되었습니다');
      
      // 로드 후 옵션 개수 확인
      const optionCount = select.options.length;
      if (optionCount <= 1) { // 기본 옵션만 있는 경우
        console.warn('⚠️ 워크아웃 옵션이 부족합니다. 추가 로딩을 시도합니다.');
        await fallbackWorkoutLoading(select);
      }
      select.disabled = false;
      return;
    }
    
    // 2순위: listWorkouts 함수 직접 사용
    if (typeof listWorkouts === 'function') {
      console.log('🔄 listWorkouts 함수로 워크아웃 로딩 시도...');
      try {
        const workouts = await Promise.resolve(listWorkouts());
        if (workouts && workouts.length > 0) {
          select.innerHTML = '<option value="">워크아웃 선택...</option>';
          workouts.forEach(workout => {
            const option = document.createElement('option');
            option.value = workout.id || workout.title;
            option.textContent = `${workout.title || workout.name} (${workout.duration || workout.estimatedDuration || '?'}분)`;
            option.dataset.description = workout.description || workout.summary || '';
            select.appendChild(option);
          });
          console.log(`✅ listWorkouts로 ${workouts.length}개 워크아웃을 로드했습니다`);
          return;
        }
      } catch (err) {
        console.error('❌ listWorkouts 호출 실패:', err);
      }
    }
    
    // 3순위: 폴백 워크아웃 로딩
    console.log('🔄 폴백 워크아웃 로딩...');
    await fallbackWorkoutLoading(select);
    
  } catch (error) {
    console.error('❌ 워크아웃 로딩 전체 실패:', error);
    // 최종 에러 시 기본 옵션이라도 제공
    select.innerHTML = `
      <option value="">워크아웃 선택...</option>
      <option value="basic-training">기본 훈련 (60분)</option>
    `;
  }
}

/**
 * 폴백 워크아웃 로딩 함수
 */
async function fallbackWorkoutLoading(select) {
  try {
    // getDefaultWorkouts 함수가 있다면 사용
    if (typeof getDefaultWorkouts === 'function') {
      const defaultWorkouts = getDefaultWorkouts();
      select.innerHTML = '<option value="">워크아웃 선택...</option>';
      defaultWorkouts.forEach(workout => {
        const option = document.createElement('option');
        option.value = workout.id;
        option.textContent = `${workout.name} (${workout.duration}분)`;
        option.dataset.description = workout.description || '';
        select.appendChild(option);
      });
      console.log(`✅ 기본 워크아웃 ${defaultWorkouts.length}개를 로드했습니다`);
    } else {
      // 최종 대안: 하드코딩된 기본 옵션
      select.innerHTML = `
        <option value="">워크아웃 선택...</option>
        <option value="basic-endurance">기본 지구력 훈련 (60분)</option>
        <option value="interval-training">인터벌 훈련 (45분)</option>
        <option value="recovery-ride">회복 라이딩 (30분)</option>
      `;
      console.log('✅ 하드코딩된 기본 워크아웃을 로드했습니다');
    }
  } catch (error) {
    console.error('❌ 폴백 워크아웃 로딩 실패:', error);
  }
}

/**
 * 워크아웃 선택 화면에서 그룹훈련방 생성 (grade=1 관리자용)
 */
async function createGroupRoomFromWorkout(workoutId, workoutTitle) {
  // 권한 확인
  const currentUser = window.currentUser;
  if (!currentUser || (currentUser.grade !== '1' && currentUser.grade !== 1)) {
    showToast('그룹훈련방 생성은 관리자만 가능합니다', 'error');
    return;
  }

  // 방 이름 입력 받기
  const roomName = prompt(`"${workoutTitle}" 워크아웃으로 그룹훈련방을 생성합니다.\n방 이름을 입력하세요:`, `${workoutTitle} 그룹훈련`);
  
  if (!roomName || !roomName.trim()) {
    return; // 취소 또는 빈 값
  }

  // 최대 참가자 수 선택
  const maxParticipants = prompt('최대 참가자 수를 입력하세요 (20~50명):', '20');
  const maxParticipantsNum = parseInt(maxParticipants) || 20;
  
  if (maxParticipantsNum < 20 || maxParticipantsNum > 50) {
    showToast('참가자 수는 20~50명 사이여야 합니다', 'error');
    return;
  }

  try {
    showToast('그룹훈련방을 생성 중입니다...', 'info');
    
    const roomCode = generateRoomCode();
    const roomData = {
      roomName: roomName.trim(),
      workoutId: String(workoutId),
      maxParticipants: maxParticipantsNum,
      adminId: currentUser.id || 'admin',
      adminName: currentUser.name || '관리자'
    };
    
    const result = await apiCreateRoom(roomData);
    
    if (result && result.success) {
      const createdRoom = result.room || result;
      groupTrainingState.currentRoom = normalizeRoomData(createdRoom);
      groupTrainingState.roomCode = createdRoom.roomCode || createdRoom.code || roomCode;
      groupTrainingState.isAdmin = true;
      
      showToast(`그룹훈련방 생성 완료! 방 코드: ${groupTrainingState.roomCode}`, 'success');
      
      // 대기실로 이동
      if (typeof showScreen === 'function') {
        showScreen('groupWaitingScreen');
      }
      if (typeof initializeWaitingRoom === 'function') {
        initializeWaitingRoom();
      }
    } else {
      throw new Error(result?.error || '방 생성 실패');
    }
  } catch (error) {
    console.error('그룹훈련방 생성 오류:', error);
    showToast('그룹훈련방 생성에 실패했습니다: ' + (error.message || '알 수 없는 오류'), 'error');
  }
}

/**
 * 그룹 훈련방 생성
 */
async function createGroupRoom() {
  const roomNameInput = safeGet('roomNameInput');
  let roomWorkoutSelect = safeGet('roomWorkoutSelect');
  const maxParticipantsSelect = safeGet('maxParticipants');
  
  // roomWorkoutSelect 요소가 없으면 워크아웃 로드 시도
  if (!roomWorkoutSelect) {
    console.log('🔄 roomWorkoutSelect 요소가 없어 워크아웃 목록을 먼저 로드합니다');
    await loadWorkoutsForRoom();
    roomWorkoutSelect = safeGet('roomWorkoutSelect');
  }
  
  const roomName = roomNameInput?.value?.trim();
  const workoutId = roomWorkoutSelect?.value;
  const maxParticipants = parseInt(maxParticipantsSelect?.value) || 4;
  
  if (!roomName) {
    showToast('방 이름을 입력해주세요', 'error');
    if (roomNameInput) roomNameInput.focus();
    return;
  }
  
  if (!workoutId) {
    showToast('훈련 종목을 선택해주세요', 'error');
    if (roomWorkoutSelect) roomWorkoutSelect.focus();
    return;
  }
  
  try {
    showToast('훈련방을 생성 중입니다...', 'info');
    
    // 입력 필드 비활성화 (중복 클릭 방지)
    if (roomNameInput) roomNameInput.disabled = true;
    if (roomWorkoutSelect) roomWorkoutSelect.disabled = true;
    if (maxParticipantsSelect) maxParticipantsSelect.disabled = true;
    
    const roomCode = generateRoomCode();
    const roomData = {
      code: roomCode,
      name: roomName,
      workoutId: workoutId,
      maxParticipants: maxParticipants,
      adminId: window.currentUser?.id || 'admin',
      adminName: window.currentUser?.name || '관리자',
      status: 'waiting',
      createdAt: new Date().toISOString(),
      participants: [{
        id: window.currentUser?.id || 'admin',
        name: window.currentUser?.name || '관리자',
        role: 'admin',
        ready: true,
        joinedAt: new Date().toISOString()
      }],
      settings: {
        allowSpectators: false,
        autoStart: false,
        voiceChat: true
      }
    };
    
    // 방 생성 시도
    const success = await createRoomOnBackend(roomData);
    
    if (success) {
      // 상태 업데이트
      groupTrainingState.currentRoom = roomData;
      groupTrainingState.roomCode = roomCode;
      groupTrainingState.isAdmin = true;
      
      showToast(`방 생성 완료! 코드: ${roomCode}`, 'success');
      
      // 대기실로 이동
      if (typeof showScreen === 'function') {
        showScreen('waitingRoomScreen');
      }
      if (typeof initializeWaitingRoom === 'function') {
        initializeWaitingRoom();
      }
      
    } else {
      throw new Error('방 생성에 실패했습니다');
    }
    
  } catch (error) {
    console.error('방 생성 중 오류:', error);
    showToast('방 생성에 실패했습니다: ' + (error.message || '알 수 없는 오류'), 'error');
    
  } finally {
    // 입력 필드 다시 활성화
    if (roomNameInput) roomNameInput.disabled = false;
    if (roomWorkoutSelect) roomWorkoutSelect.disabled = false;
    if (maxParticipantsSelect) maxParticipantsSelect.disabled = false;
  }
}

/**
 * 백엔드에 방 생성 (임시 구현)
 */

/**
 * 백엔드에서 방 생성
 */
async function createRoomOnBackend(roomData) {
  console.log('🔄 백엔드 방 생성 요청:', roomData);
  
  try {
    const result = await apiCreateRoom(roomData);
    
    if (result && result.success) {
      console.log('✅ 백엔드 방 생성 성공:', result);
      return result;
    } else {
      console.error('❌ 백엔드 방 생성 실패:', result);
      throw new Error(result?.error || '방 생성 실패');
    }
  } catch (error) {
    console.error('createRoomOnBackend 실패:', error);
    throw error;
  }
}



// ========== 참가자 기능들 ==========

/**
 * 방 목록 새로고침
 */
async function refreshRoomList() {
  const listContainer = safeGet('availableRoomsList');
  if (!listContainer) return;
  
  try {
    listContainer.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <p>방 목록을 불러오는 중...</p>
      </div>
    `;
    
    // 백엔드에서 방 목록 가져오기 (임시 구현)
    const rooms = await getRoomsFromBackend();
    
    if (rooms.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🏠</div>
          <div class="empty-state-title">참가 가능한 방이 없습니다</div>
          <div class="empty-state-description">관리자가 새로운 훈련방을 생성할 때까지 기다려주세요</div>
        </div>
      `;
      return;
    }
    
    listContainer.innerHTML = rooms.map(room => `
      <div class="room-card" onclick="joinRoomByCode('${room.code}')">
        <div class="room-header">
          <h4>${room.name}</h4>
          <span class="room-code">${room.code}</span>
        </div>
        <div class="room-details">
          <span class="room-workout">📋 ${room.workoutName || '워크아웃'}</span>
          <span class="room-participants">👥 ${room.participants.length}/${room.maxParticipants}</span>
        </div>
        <div class="room-admin">
          <span>관리자: ${room.adminName}</span>
        </div>
      </div>
    `).join('');
    
  } catch (error) {
    console.error('Error loading rooms:', error);
    listContainer.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">⚠️</div>
        <div class="error-state-title">방 목록을 불러올 수 없습니다</div>
        <button class="retry-button" onclick="refreshRoomList().catch(console.error)">다시 시도</button>
      </div>
    `;
  }
}

/**
 * 백엔드에서 방 목록 가져오기 (임시 구현)
 */
/**
 * 백엔드에서 모든 waiting 상태인 방 목록 가져오기 (정원 체크 없이)
 */
async function getAllWaitingRooms() {
  try {
    console.log('🔄 백엔드에서 모든 waiting 상태인 방 목록 조회 시작...');
    
    if (!window.GAS_URL) {
      throw new Error('GAS_URL이 설정되지 않았습니다.');
    }

    const result = await jsonpRequestWithRetry(window.GAS_URL, {
      action: 'listGroupRooms'
      // status 파라미터 없이 모든 방 조회
    });
    
    if (result && result.success) {
      console.log(`✅ 백엔드에서 방 목록 조회 성공: ${result.items?.length || 0}개`);
      
      // waiting 상태인 모든 방 필터링 (정원 체크 없이)
      const waitingRooms = (result.items || result.rooms || []).filter(room => {
        normalizeRoomParticipantsInPlace(room);
        const status = (room.status || room.Status || 'unknown').toLowerCase();
        return status === 'waiting';
      });
      
      console.log(`✅ waiting 상태인 방: ${waitingRooms.length}개`);
      return waitingRooms;
      
    } else {
      console.warn('백엔드 API 응답 실패:', result?.error || 'Unknown error');
      return [];
    }
    
  } catch (error) {
    console.error('백엔드 방 목록 조회 실패:', error);
    return [];
  }
}

/**
 * 백엔드에서 방 목록 가져오기 (JSONP 방식으로 수정)
 */
async function getRoomsFromBackend() {
  try {
    console.log('🔄 백엔드에서 방 목록 조회 시작...');
    
    if (!window.GAS_URL) {
      throw new Error('GAS_URL이 설정되지 않았습니다.');
    }

    const result = await jsonpRequestWithRetry(window.GAS_URL, {
      action: 'listGroupRooms',
      status: 'waiting'
    });
    
    if (result && result.success) {
      console.log(`✅ 백엔드에서 방 목록 조회 성공: ${result.items?.length || 0}개`);
      
      // 대기 중이고 자리가 있는 방들만 필터링
      const availableRooms = (result.items || result.rooms || []).filter(room => {
        normalizeRoomParticipantsInPlace(room);
        const status = (room.status || room.Status || 'unknown').toLowerCase();
        const participants = room.participants || [];
        const currentParticipants = participants.length;
        const maxParticipants = Number(room.maxParticipants || room.MaxParticipants || 10) || 10;
        
        return status === 'waiting' && currentParticipants < maxParticipants;
      });
      
      console.log(`✅ 참가 가능한 방: ${availableRooms.length}개`);
      return availableRooms;
      
    } else {
      console.warn('백엔드 API 응답 실패:', result?.error || 'Unknown error');
      return [];
    }
    
  } catch (error) {
    console.error('백엔드 방 목록 조회 실패:', error);
    return [];
  }
}

/**
 * 방 코드로 참가
 */
async function joinGroupRoom() {
  const roomCode = safeGet('roomCodeInput')?.value?.trim()?.toUpperCase();
  
  if (!roomCode) {
    showToast('방 코드를 입력해주세요', 'error');
    return;
  }
  
  if (roomCode.length !== 6) {
    showToast('방 코드는 6자리여야 합니다', 'error');
    return;
  }
  
  await joinRoomByCode(roomCode);
}

/**
 * 방 코드로 방 참가 실행
 */
async function joinRoomByCode(roomCode) {
  try {
    console.log('🚀 방 참가 시작:', roomCode);
    
    // 로딩 메시지 표시 (모달이 아닌 로딩 오버레이)
    let usedInlineOverlay = false;
    const ensureInlineLoadingOverlay = (message) => {
      // 간단한 인라인 로딩 오버레이 생성
      let overlay = document.getElementById('inlineLoadingOverlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'inlineLoadingOverlay';
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0,0,0,0.35)';
        overlay.style.zIndex = '9999';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.innerHTML = `
          <div style="background: #111; color: #fff; padding: 16px 20px; border-radius: 10px; display: flex; align-items: center; gap: 12px; box-shadow: 0 8px 20px rgba(0,0,0,0.4)">
            <div class="spinner" style="width: 22px; height: 22px; border: 3px solid rgba(255,255,255,0.25); border-top-color: #fff; border-radius: 50%; animation: spin 0.9s linear infinite;"></div>
            <span style="font-weight: 600;">${message || '처리 중...'}</span>
          </div>
          <style>
            @keyframes spin { to { transform: rotate(360deg); } }
          </style>
        `;
        document.body.appendChild(overlay);
      } else {
        const span = overlay.querySelector('span');
        if (span) span.textContent = message || '처리 중...';
      }
    };
    const removeInlineLoadingOverlay = () => {
      const overlay = document.getElementById('inlineLoadingOverlay');
      if (overlay) overlay.remove();
    };

    if (typeof showLoading === 'function') {
      showLoading('그룹 훈련 입장 중입니다...');
    } else {
      ensureInlineLoadingOverlay('그룹 훈련 입장 중입니다...');
      usedInlineOverlay = true;
    }
    
    // 사용자 정보 확인
    if (!window.currentUser || !window.currentUser.id) {
      const errorMsg = '로그인이 필요합니다. 사용자를 선택해주세요.';
      console.error('❌ 사용자 정보 없음');
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      showToast(errorMsg, 'error');
      return;
    }
    
    const participantId = window.currentUser.id;
    const participantName = window.currentUser.name || '참가자';
    console.log('👤 참가자 정보:', { participantId, participantName });
    
    // 백엔드에서 방 정보 확인
    console.log('📡 방 정보 조회 중...');
    const roomResponse = await apiGetRoom(roomCode);
    console.log('📡 방 정보 응답:', roomResponse);
    
    if (!roomResponse) {
      const errorMsg = '방 정보를 가져올 수 없습니다. 네트워크를 확인해주세요.';
      console.error('❌ 방 정보 응답 없음');
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      showToast(errorMsg, 'error');
      return;
    }
    
    if (!roomResponse.success) {
      const errorMsg = roomResponse.error || '방을 찾을 수 없습니다';
      console.error('❌ 방 조회 실패:', errorMsg);
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      showToast(errorMsg, 'error');
      return;
    }
    
    if (!roomResponse.item) {
      const errorMsg = '방 정보가 없습니다. 방 코드를 확인해주세요.';
      console.error('❌ 방 데이터 없음');
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      showToast(errorMsg, 'error');
      return;
    }

    console.log('🔄 방 데이터 정규화 중...');
    const room = normalizeRoomData(roomResponse.item);
    console.log('✅ 정규화된 방 데이터:', room);
    
    if (!room) {
      const errorMsg = '방 정보를 처리할 수 없습니다.';
      console.error('❌ 방 데이터 정규화 실패');
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      showToast(errorMsg, 'error');
      return;
    }

    // 방 상태 확인
    if (room.status !== 'waiting' && room.status !== 'starting') {
      const statusMsg = room.status === 'training' ? '이미 시작된 방입니다' :
                       room.status === 'finished' ? '이미 종료된 방입니다' :
                       room.status === 'closed' ? '닫힌 방입니다' :
                       '참가할 수 없는 상태입니다';
      console.error('❌ 방 상태 오류:', room.status);
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
       if (usedInlineOverlay) {
         removeInlineLoadingOverlay();
       }
      showToast(statusMsg, 'error');
      return;
    }

    // 참가자 수 확인 및 정원 체크
    normalizeRoomParticipantsInPlace(room);
    const currentParticipants = Array.isArray(room.participants) ? room.participants.length : 0;
    const maxParticipants = Number(room.maxParticipants || room.MaxParticipants || 50) || 50;
    
    // 정원 초과 체크
    if (currentParticipants >= maxParticipants) {
      const errorMsg = '정원이 초과하여 입장할 수 없습니다.';
      console.error('❌ 정원 초과:', { currentParticipants, maxParticipants });
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      showToast(errorMsg, 'error');
      return;
    }
    
    // 이미 참가한 사용자인지 확인
    const isAlreadyJoined = room.participants.some(p => {
      const pId = p.id || p.participantId || p.userId;
      return pId === participantId;
    });
    
    if (isAlreadyJoined) {
      console.log('ℹ️ 이미 참가한 방입니다. 대기실로 이동합니다.');
      
      // 로딩 숨기기
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      
      groupTrainingState.currentRoom = room;
      groupTrainingState.roomCode = roomCode;
      groupTrainingState.isAdmin = false;
      
      // 모달 닫기 (혹시 열려있다면)
      if (typeof closeJoinRoomModal === 'function') {
        closeJoinRoomModal();
      }
      const joinRoomModal = document.getElementById('joinRoomModal');
      if (joinRoomModal) {
        joinRoomModal.remove();
      }
      
      if (typeof showScreen === 'function') {
        showScreen('groupWaitingScreen');
      }
      if (typeof initializeWaitingRoom === 'function') {
        initializeWaitingRoom();
      }
      showToast('이미 참가한 방입니다', 'info');
      return;
    }

    // 방 참가 API 호출
    console.log('📡 방 참가 API 호출 중...');
    const joinResult = await apiJoinRoom(roomCode, {
      participantId,
      participantName
    });
    console.log('📡 방 참가 응답:', joinResult);

    if (!joinResult) {
      const errorMsg = '방 참가 요청에 응답이 없습니다. 네트워크를 확인해주세요.';
      console.error('❌ 방 참가 응답 없음');
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      showToast(errorMsg, 'error');
      return;
    }
    
    if (!joinResult.success) {
      // "Already joined" 오류인 경우 재접속으로 처리
      if (joinResult.error === 'Already joined' || joinResult.error?.includes('Already joined')) {
        console.log('ℹ️ 이미 참가한 방입니다. 기존 참가 정보로 재접속합니다.');
        
        // 로딩 숨기기
        if (typeof hideLoading === 'function') {
          hideLoading();
        }
        if (usedInlineOverlay) {
          removeInlineLoadingOverlay();
        }
        
        // 방 정보 새로고침
        const refreshedRoomRes = await apiGetRoom(roomCode);
        let refreshedRoom = null;
        if (refreshedRoomRes?.success && refreshedRoomRes.item) {
          refreshedRoom = normalizeRoomData(refreshedRoomRes.item);
        }
        
        // 상태 업데이트
        groupTrainingState.currentRoom = refreshedRoom || room;
        groupTrainingState.roomCode = roomCode;
        groupTrainingState.isAdmin = false;
        groupTrainingState.isManager = false;
        
        showToast('기존 참가 정보로 재접속했습니다', 'success');
        
        // 모달 닫기 (혹시 열려있다면)
        if (typeof closeJoinRoomModal === 'function') {
          closeJoinRoomModal();
        }
        const joinRoomModal = document.getElementById('joinRoomModal');
        if (joinRoomModal) {
          joinRoomModal.remove();
        }
        
        // 화면 전환
        if (typeof showScreen === 'function') {
          showScreen('groupWaitingScreen');
        }
        if (typeof initializeWaitingRoom === 'function') {
          initializeWaitingRoom();
        }
        return;
      }
      
      const errorMsg = joinResult.error || '방 참가에 실패했습니다';
      console.error('❌ 방 참가 실패:', errorMsg);
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      showToast(errorMsg, 'error');
      return;
    }
    
    // 이미 참가한 경우 (백엔드에서 alreadyJoined 플래그로 반환)
    if (joinResult.alreadyJoined) {
      console.log('ℹ️ 이미 참가한 방입니다. 기존 참가 정보로 재접속합니다.');
      
      // 로딩 숨기기
      if (typeof hideLoading === 'function') {
        hideLoading();
      }
      if (usedInlineOverlay) {
        removeInlineLoadingOverlay();
      }
      
      // 방 정보 새로고침
      const refreshedRoomRes = await apiGetRoom(roomCode);
      let refreshedRoom = null;
      if (refreshedRoomRes?.success && refreshedRoomRes.item) {
        refreshedRoom = normalizeRoomData(refreshedRoomRes.item);
      }
      
      // 상태 업데이트
      groupTrainingState.currentRoom = refreshedRoom || room;
      groupTrainingState.roomCode = roomCode;
      groupTrainingState.isAdmin = false;
      groupTrainingState.isManager = false;
      
      showToast('기존 참가 정보로 재접속했습니다', 'success');
      
      // 모달 닫기 (혹시 열려있다면)
      if (typeof closeJoinRoomModal === 'function') {
        closeJoinRoomModal();
      }
      const joinRoomModal = document.getElementById('joinRoomModal');
      if (joinRoomModal) {
        joinRoomModal.remove();
      }
      
      // 화면 전환
      if (typeof showScreen === 'function') {
        showScreen('groupWaitingScreen');
      }
      if (typeof initializeWaitingRoom === 'function') {
        initializeWaitingRoom();
      }
      return;
    }

    // 방 정보 새로고침
    console.log('🔄 방 정보 새로고침 중...');
    const refreshedRoomRes = await apiGetRoom(roomCode);
    console.log('📡 새로고침된 방 정보:', refreshedRoomRes);
    
    let refreshedRoom = null;
    if (refreshedRoomRes?.success && refreshedRoomRes.item) {
      refreshedRoom = normalizeRoomData(refreshedRoomRes.item);
    }
    
    // 상태 업데이트
    groupTrainingState.currentRoom = refreshedRoom || {
      ...room,
      participants: [...(room.participants || []), { 
        id: participantId,
        participantId: participantId,
        name: participantName,
        participantName: participantName,
        role: 'participant', 
        ready: false 
      }]
    };
    groupTrainingState.roomCode = roomCode;
    groupTrainingState.isAdmin = false;
    groupTrainingState.isManager = false;
    
    console.log('✅ 방 참가 완료. 상태:', groupTrainingState);
    
    // 로딩 숨기기
    if (typeof hideLoading === 'function') {
      hideLoading();
    }
    if (usedInlineOverlay) {
      removeInlineLoadingOverlay();
    }
    
    showToast('방에 참가했습니다!', 'success');
    
    // 모달 닫기 (훈련실 참가 모달 등 - 혹시 열려있다면)
    if (typeof closeJoinRoomModal === 'function') {
      closeJoinRoomModal();
    }
    // 다른 모달들도 닫기
    const joinRoomModal = document.getElementById('joinRoomModal');
    if (joinRoomModal) {
      joinRoomModal.remove();
    }
    // 그룹 훈련 모달도 닫기
    const groupTrainingModal = document.getElementById('groupTrainingModal');
    if (groupTrainingModal) {
      groupTrainingModal.remove();
    }
    
    // 화면 전환
    if (typeof showScreen === 'function') {
      showScreen('groupWaitingScreen');
    } else {
      console.warn('⚠️ showScreen 함수를 찾을 수 없습니다');
      const waitingScreen = document.getElementById('groupWaitingScreen');
      if (waitingScreen) {
        waitingScreen.classList.remove('hidden');
      }
    }
    
    // 대기실 초기화
    if (typeof initializeWaitingRoom === 'function') {
      initializeWaitingRoom();
    } else {
      console.warn('⚠️ initializeWaitingRoom 함수를 찾을 수 없습니다');
    }
    
  } catch (error) {
    console.error('❌ 방 참가 오류:', error);
    console.error('오류 스택:', error.stack);
    
    // 로딩 숨기기
    if (typeof hideLoading === 'function') {
      hideLoading();
    }
    // 인라인 오버레이 제거
    const overlay = document.getElementById('inlineLoadingOverlay');
    if (overlay) overlay.remove();
    
    let errorMessage = '방 참가에 실패했습니다';
    if (error.message) {
      errorMessage += ': ' + error.message;
    } else if (typeof error === 'string') {
      errorMessage += ': ' + error;
    }
    
    showToast(errorMessage, 'error');
  }
}

/**
 * 방 코드로 방 정보 가져오기 (임시 구현)
 */
async function getRoomByCode(roomCode) {
  if (!roomCode) return null;

  try {
    const response = await apiGetRoom(roomCode);
    
    // 네트워크 오류인 경우와 실제 방이 없는 경우를 구분
    if (!response) {
      // 응답 자체가 없는 경우 (네트워크 오류 가능성)
      throw new Error('NETWORK_ERROR');
    }
    
    if (response.success && response.item) {
      return normalizeRoomData(response.item);
    }
    
    // 네트워크 오류인 경우
    if (response.error === 'NETWORK_ERROR' || 
        response.error?.includes('네트워크') || 
        response.error?.includes('Network') ||
        response.error?.includes('연결') ||
        response.error?.includes('시간 초과')) {
      throw new Error('NETWORK_ERROR');
    }
    
    // 방이 실제로 없는 경우 (success: false이고 error가 'Room not found' 등)
    if (response.error && (response.error.includes('not found') || 
                          response.error.includes('찾을 수 없') ||
                          response.error.includes('Room not found'))) {
      return { __roomDeleted: true }; // 방이 실제로 삭제됨
    }
    
    // 기타 오류는 네트워크 오류로 간주하지 않고 null 반환 (재시도하지 않음)
    console.warn('⚠️ 알 수 없는 오류:', response.error);
    return null;
  } catch (error) {
    // 네트워크 오류인 경우 재throw하여 호출자가 구분할 수 있도록
    if (error.message === 'NETWORK_ERROR' || error.message?.includes('네트워크') || error.message?.includes('시간 초과')) {
      throw error;
    }
    console.error('Failed to get room:', error);
    return null;
  }
}




// ========== 대기실 기능들 ==========

/**
 * 그룹 훈련 제어 바 설정 (외부 제어 버튼 블록)
 */
function setupGroupTrainingControlBar() {
  const controlBar = document.getElementById('groupTrainingControlBar');
  if (!controlBar) {
    console.warn('groupTrainingControlBar 요소를 찾을 수 없습니다');
    return;
  }
  
  // 관리자 권한 확인
  const currentUser = window.currentUser || {};
  const isAdminUser = groupTrainingState.isAdmin || 
                     currentUser.grade === '1' || 
                     currentUser.grade === 1 ||
                     (typeof getViewerGrade === 'function' && getViewerGrade() === '1');
  
  if (!isAdminUser) {
    controlBar.classList.add('hidden');
    return;
  }
  
  // 관리자인 경우 제어 바 표시
  controlBar.classList.remove('hidden');
  
  // 버튼 이벤트 리스너 설정
  const skipBtn = document.getElementById('groupSkipSegmentBtn');
  const toggleBtn = document.getElementById('groupToggleTrainingBtn');
  const stopBtn = document.getElementById('groupStopTrainingBtn');
  
  // 건너뛰기 버튼: 훈련시작 후 세그먼트 건너뛰기 기능
  if (skipBtn && !skipBtn.dataset.bound) {
    skipBtn.dataset.bound = '1';
    skipBtn.onclick = () => {
      const ts = window.trainingState || {};
      if (!ts.isRunning) {
        showToast('훈련이 시작되지 않았습니다', 'warning');
        return;
      }
      if (typeof skipCurrentSegment === 'function') {
        skipCurrentSegment();
        showToast('세그먼트를 건너뛰었습니다', 'info');
      } else {
        console.error('skipCurrentSegment 함수를 찾을 수 없습니다');
        showToast('세그먼트 건너뛰기 기능을 사용할 수 없습니다', 'error');
      }
    };
  }
  
  // 시작/일시정지 버튼: 훈련 시작 동작, 일시정지 모양으로 변경
  if (toggleBtn && !toggleBtn.dataset.bound) {
    toggleBtn.dataset.bound = '1';
    toggleBtn.onclick = () => {
      const ts = window.trainingState || {};
      if (ts.isRunning) {
        // 훈련 중: 일시정지/재개 토글
        if (typeof togglePause === 'function') {
          togglePause();
          // 버튼 상태 업데이트
          setTimeout(() => {
            if (typeof updateStartButtonState === 'function') {
              updateStartButtonState();
            }
          }, 100);
        } else {
          console.error('togglePause 함수를 찾을 수 없습니다');
          showToast('일시정지 기능을 사용할 수 없습니다', 'error');
        }
      } else {
        // 훈련 시작 전: 훈련 시작
        if (typeof startGroupTrainingWithCountdown === 'function') {
          startGroupTrainingWithCountdown();
        } else {
          console.error('startGroupTrainingWithCountdown 함수를 찾을 수 없습니다');
          showToast('훈련 시작 기능을 사용할 수 없습니다', 'error');
        }
      }
    };
  }
  
  // 종료 버튼: 훈련종료, 훈련종료 전 정말 종료할지 확인 후 종료
  if (stopBtn && !stopBtn.dataset.bound) {
    stopBtn.dataset.bound = '1';
    stopBtn.onclick = () => {
      const ts = window.trainingState || {};
      if (!ts.isRunning) {
        showToast('훈련이 시작되지 않았습니다', 'warning');
        return;
      }
      
      // 정말 종료할지 확인
      if (confirm('정말 훈련을 종료하시겠습니까?\n\n종료하면 현재 진행 중인 훈련이 중단됩니다.')) {
        if (typeof stopSegmentLoop === 'function') {
          stopSegmentLoop();
          showToast('훈련이 종료되었습니다', 'info');
          // 버튼 상태 업데이트
          setTimeout(() => {
            if (typeof updateStartButtonState === 'function') {
              updateStartButtonState();
            }
          }, 100);
        } else {
          console.error('stopSegmentLoop 함수를 찾을 수 없습니다');
          showToast('훈련 종료 기능을 사용할 수 없습니다', 'error');
        }
      }
    };
  }
  
  // 마이크 버튼 이벤트 리스너 설정
  const micBtn = document.getElementById('groupMicrophoneBtn');
  if (micBtn && !micBtn.dataset.bound) {
    micBtn.dataset.bound = '1';
    micBtn.onclick = async () => {
      if (microphoneState.isActive) {
        await stopAdminMicrophone();
      } else {
        await startAdminMicrophone();
      }
    };
  }
  
  // 마이크 상태에 따라 버튼 업데이트
  updateAdminMicrophoneUI();
  
  // 버튼 상태 업데이트
  updateStartButtonState();
}

// ========== 관리자 마이크 음성 코칭 기능 ==========

/**
 * 관리자 마이크 시작 (실시간 음성 코칭)
 */
async function startAdminMicrophone() {
  try {
    if (!groupTrainingState.isAdmin) {
      showToast('관리자만 마이크를 사용할 수 있습니다', 'error');
      return;
    }
    
    if (!groupTrainingState.roomCode) {
      showToast('훈련방에 입장해야 합니다', 'error');
      return;
    }
    
    // 마이크 권한 요청
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000 // 음성 코칭에 적합한 샘플레이트
      }
    });
    
    microphoneState.mediaStream = stream;
    microphoneState.isActive = true;
    
    // 오디오 컨텍스트 생성 (음성 레벨 표시용)
    microphoneState.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    microphoneState.analyser = microphoneState.audioContext.createAnalyser();
    microphoneState.analyser.fftSize = 256;
    
    const source = microphoneState.audioContext.createMediaStreamSource(stream);
    source.connect(microphoneState.analyser);
    
    // MediaRecorder 초기화 (실시간 오디오 청크 녹음)
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
      ? 'audio/webm' 
      : MediaRecorder.isTypeSupported('audio/ogg') 
        ? 'audio/ogg' 
        : 'audio/webm'; // 기본값
    
    microphoneState.mediaRecorder = new MediaRecorder(stream, {
      mimeType: mimeType,
      audioBitsPerSecond: 128000
    });
    
    microphoneState.recordingChunks = [];
    microphoneState.lastChunkId = 0;
    
    // 오디오 데이터 수집
    microphoneState.mediaRecorder.ondataavailable = async (event) => {
      if (event.data && event.data.size > 0) {
        await sendAudioChunk(event.data);
      }
    };
    
    // 2초마다 오디오 청크 생성 및 전송
    microphoneState.mediaRecorder.start(2000);
    
    // UI 업데이트
    updateAdminMicrophoneUI();
    
    // 음성 레벨 표시 시작 (선택사항)
    startAudioLevelIndicator();
    
    showToast('🎤 마이크가 활성화되었습니다. 참가자들에게 음성 코칭을 시작합니다.', 'success');
    
    console.log('✅ 관리자 마이크 활성화 성공');
    
  } catch (error) {
    console.error('❌ 관리자 마이크 활성화 실패:', error);
    microphoneState.isActive = false;
    
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      showToast('마이크 권한이 필요합니다. 브라우저 설정에서 마이크 권한을 허용해주세요.', 'error');
    } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      showToast('마이크를 찾을 수 없습니다. 마이크가 연결되어 있는지 확인해주세요.', 'error');
    } else {
      showToast('마이크를 시작할 수 없습니다: ' + (error.message || '알 수 없는 오류'), 'error');
    }
  }
}

/**
 * 관리자 마이크 중지
 */
async function stopAdminMicrophone() {
  try {
    // MediaRecorder 중지
    if (microphoneState.mediaRecorder && microphoneState.mediaRecorder.state !== 'inactive') {
      microphoneState.mediaRecorder.stop();
      microphoneState.mediaRecorder = null;
    }
    
    // 오디오 청크 전송 인터벌 중지
    if (microphoneState.audioChunkInterval) {
      clearInterval(microphoneState.audioChunkInterval);
      microphoneState.audioChunkInterval = null;
    }
    
    // 음성 레벨 표시 중지
    stopAudioLevelIndicator();
    
    // 스트림 중지
    if (microphoneState.mediaStream) {
      microphoneState.mediaStream.getTracks().forEach(track => track.stop());
      microphoneState.mediaStream = null;
    }
    
    // 오디오 컨텍스트 종료
    if (microphoneState.audioContext) {
      await microphoneState.audioContext.close();
      microphoneState.audioContext = null;
      microphoneState.analyser = null;
    }
    
    microphoneState.isActive = false;
    microphoneState.recordingChunks = [];
    microphoneState.lastChunkId = 0;
    
    // UI 업데이트
    updateAdminMicrophoneUI();
    
    showToast('🎤 마이크가 비활성화되었습니다', 'info');
    
    console.log('⏹️ 관리자 마이크 비활성화 완료');
    
  } catch (error) {
    console.error('❌ 관리자 마이크 비활성화 오류:', error);
  }
}

/**
 * 오디오 청크 전송 (서버에 저장)
 */
async function sendAudioChunk(audioBlob) {
  try {
    if (!groupTrainingState.roomCode || !microphoneState.isActive) {
      return;
    }
    
    // 오디오 블롭을 base64로 변환
    const reader = new FileReader();
    const base64Audio = await new Promise((resolve, reject) => {
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1]; // data:audio/webm;base64, 부분 제거
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(audioBlob);
    });
    
    // 청크 ID 생성
    microphoneState.lastChunkId++;
    const chunkId = microphoneState.lastChunkId;
    const timestamp = Date.now();
    
    // 서버에 오디오 청크 저장 (Google Sheets를 통한 임시 저장)
    // 실제로는 실시간 스트리밍을 위한 별도 서버가 필요하지만, 
    // 현재 구조에서는 방 데이터에 최신 오디오 청크 정보만 저장
    const audioChunkData = {
      chunkId: chunkId,
      timestamp: timestamp,
      audioData: base64Audio,
      roomCode: groupTrainingState.roomCode,
      adminId: window.currentUser?.id || 'admin'
    };
    
    // 방 데이터에 최신 오디오 청크 정보 저장
    await apiUpdateRoom(groupTrainingState.roomCode, {
      lastAudioChunk: JSON.stringify(audioChunkData)
    });
    
    console.log(`📤 오디오 청크 전송: 청크 ID ${chunkId}, 크기: ${(audioBlob.size / 1024).toFixed(2)}KB`);
    
  } catch (error) {
    console.error('❌ 오디오 청크 전송 실패:', error);
  }
}

/**
 * 관리자 마이크 UI 업데이트
 */
function updateAdminMicrophoneUI() {
  const micBtn = document.getElementById('groupMicrophoneBtn');
  const micLabel = document.getElementById('microphoneLabel');
  
  if (micBtn) {
    if (microphoneState.isActive) {
      micBtn.classList.add('active');
      micBtn.title = '마이크 끄기 (음성 코칭 종료)';
      if (micLabel) {
        micLabel.textContent = '마이크 ON';
      }
    } else {
      micBtn.classList.remove('active');
      micBtn.title = '마이크 켜기 (음성 코칭 시작)';
      if (micLabel) {
        micLabel.textContent = '마이크';
      }
    }
  }
}

/**
 * 음성 레벨 표시 (선택사항)
 */
function startAudioLevelIndicator() {
  if (!microphoneState.analyser) return;
  
  const bufferLength = microphoneState.analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  function updateLevel() {
    if (!microphoneState.isActive || !microphoneState.analyser) {
      return;
    }
    
    microphoneState.analyser.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((sum, val) => sum + val, 0) / bufferLength;
    
    // 음성 레벨 표시 (선택사항 - UI에 표시하려면 추가)
    // const micBtn = document.getElementById('groupMicrophoneBtn');
    // if (micBtn) {
    //   const level = Math.min(100, (average / 255) * 100);
    //   micBtn.style.opacity = 0.5 + (level / 200);
    // }
    
    requestAnimationFrame(updateLevel);
  }
  
  updateLevel();
}

/**
 * 음성 레벨 표시 중지
 */
function stopAudioLevelIndicator() {
  // 레벨 표시 중지 로직 (필요 시 구현)
}

/**
 * 참가자 오디오 수신 시작 (관리자 음성 코칭 수신)
 */
function startParticipantAudioListening() {
  if (participantAudioState.isListening) {
    return; // 이미 수신 중
  }
  
  if (groupTrainingState.isAdmin) {
    return; // 관리자는 수신하지 않음
  }
  
  participantAudioState.isListening = true;
  participantAudioState.lastReceivedChunkId = 0;
  
  // 1초마다 새로운 오디오 청크 확인
  participantAudioState.audioCheckInterval = setInterval(async () => {
    const room = groupTrainingState.currentRoom;
    if (room) {
      await checkAndPlayAudioChunkFromRoom(room);
    }
  }, 1000);
  
  console.log('🎧 참가자 오디오 수신 시작');
}

/**
 * 참가자 오디오 수신 중지
 */
function stopParticipantAudioListening() {
  participantAudioState.isListening = false;
  
  if (participantAudioState.audioCheckInterval) {
    clearInterval(participantAudioState.audioCheckInterval);
    participantAudioState.audioCheckInterval = null;
  }
  
  // 오디오 큐 정리
  participantAudioState.audioQueue = [];
  
  console.log('🔇 참가자 오디오 수신 중지');
}

/**
 * 새로운 오디오 청크 확인 및 재생 (syncRoomData에서 호출)
 */
async function checkAndPlayAudioChunkFromRoom(room) {
  try {
    if (!room || !room.lastAudioChunk || !participantAudioState.isListening) {
      return;
    }
    
    let audioChunkData;
    try {
      audioChunkData = typeof room.lastAudioChunk === 'string' 
        ? JSON.parse(room.lastAudioChunk) 
        : room.lastAudioChunk;
    } catch (e) {
      console.warn('오디오 청크 데이터 파싱 실패:', e);
      return;
    }
    
    if (!audioChunkData || !audioChunkData.chunkId || !audioChunkData.audioData) {
      return;
    }
    
    // 이미 재생한 청크는 건너뛰기
    if (audioChunkData.chunkId <= participantAudioState.lastReceivedChunkId) {
      return;
    }
    
    // 새로운 청크 재생
    await playAudioChunk(audioChunkData);
    
    participantAudioState.lastReceivedChunkId = audioChunkData.chunkId;
    
  } catch (error) {
    console.error('❌ 오디오 청크 확인 오류:', error);
  }
}

/**
 * 오디오 청크 재생
 */
async function playAudioChunk(audioChunkData) {
  try {
    const { audioData, chunkId, timestamp } = audioChunkData;
    
    if (!audioData) {
      return;
    }
    
    // base64를 Blob으로 변환
    const byteCharacters = atob(audioData);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    
    // MIME 타입 결정
    const mimeType = 'audio/webm'; // 또는 audio/ogg 등
    const blob = new Blob([byteArray], { type: mimeType });
    const audioUrl = URL.createObjectURL(blob);
    
    // 오디오 재생
    const audio = new Audio(audioUrl);
    audio.volume = 1.0; // 볼륨 설정
    
    await new Promise((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        resolve();
      };
      audio.onerror = (error) => {
        URL.revokeObjectURL(audioUrl);
        console.error('오디오 재생 오류:', error);
        reject(error);
      };
      
      audio.play().catch(reject);
    });
    
    console.log(`🔊 오디오 청크 재생 완료: 청크 ID ${chunkId}`);
    
  } catch (error) {
    console.error('❌ 오디오 청크 재생 실패:', error);
  }
}

/**
 * 대기실 화면 초기화
 */
// 훈련 시작 시간 체크 인터벌
let trainingStartCheckInterval = null;
let countdownStarted = false; // 카운트다운 시작 여부
let trainingStartTimeFound = false; // 훈련 시작 시간을 찾았는지 여부
let countdownUpdateInterval = null; // 카운트다운 업데이트 인터벌
let waitingCountdownShown = false; // 대기실 전용 카운트다운 표시 여부

/**
 * 훈련 시작 시간 체크 및 카운트다운 시작
 */
async function checkTrainingStartTime() {
  try {
    const room = groupTrainingState.currentRoom;
    if (!room) return;
    
    const roomCode = getCurrentRoomCode(room);
    if (!roomCode) return;
    
    // 구글 시트에서 최신 방 정보 가져오기
    const latestRoom = await getRoomByCode(roomCode);
    if (!latestRoom) return;
    
    // 훈련 시작 시간 가져오기 (CreatedAt 또는 trainingStartTime)
    let trainingStartTimeRaw = latestRoom.createdAt || 
                                latestRoom.CreatedAt || 
                                latestRoom.trainingStartTime || 
                                latestRoom.TrainingStartTime;
    
    if (!trainingStartTimeRaw) {
      // 훈련 시작 시간이 아직 설정되지 않음
      if (!trainingStartTimeFound) {
        console.log('⏳ 훈련 시작 시간이 아직 설정되지 않음');
      }
      return;
    }
    
    // 훈련 시작 시간을 찾았으면 체크 인터벌 중지하고 카운트다운 업데이트 시작
    if (!trainingStartTimeFound) {
      trainingStartTimeFound = true;
      console.log('✅ 훈련 시작 시간 발견:', trainingStartTimeRaw);
      
      // 5초마다 체크하는 인터벌 중지
      if (trainingStartCheckInterval) {
        clearInterval(trainingStartCheckInterval);
        trainingStartCheckInterval = null;
      }
      
      // 1초마다 카운트다운 업데이트 시작
      if (countdownUpdateInterval) {
        clearInterval(countdownUpdateInterval);
      }
      countdownUpdateInterval = setInterval(() => {
        updateCountdownFromTrainingStartTime();
      }, 1000);
      
      // 즉시 한 번 실행
      updateCountdownFromTrainingStartTime();
      return;
    }
    
    // 시간 형식 변환 함수 (ISO 형식 또는 HH:MM:SS 형식 지원)
    const normalizeTrainingStartTime = (timeValue) => {
      if (!timeValue) return null;
      
      const timeStr = String(timeValue).trim();
      
      // 1. HH:MM:SS 형식인지 확인
      const timePattern = /^(\d{1,2}):(\d{1,2}):(\d{1,2})$/;
      if (timePattern.test(timeStr)) {
        return timeStr; // 이미 HH:MM:SS 형식
      }
      
      // 2. ISO 형식인지 확인 (예: 1899-12-30T13:44:43.000Z 또는 2025-11-23T20:34:00.000Z)
      const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      if (isoPattern.test(timeStr)) {
        try {
          const dateObj = new Date(timeStr);
          if (isNaN(dateObj.getTime())) {
            console.warn('⚠️ 잘못된 ISO 날짜 형식:', timeStr);
            return null;
          }
          
          // ISO 형식의 날짜를 서울 시간으로 변환하여 HH:MM:SS 형식으로 반환
          // ISO 형식은 UTC 시간이므로, 서울 시간(UTC+9)으로 변환
          const seoulHours = dateObj.getUTCHours();
          const seoulMinutes = dateObj.getUTCMinutes();
          const seoulSeconds = dateObj.getUTCSeconds();
          
          // 서울 시간으로 변환 (UTC+9)
          let seoulTimeHours = (seoulHours + 9) % 24;
          
          return `${String(seoulTimeHours).padStart(2, '0')}:${String(seoulMinutes).padStart(2, '0')}:${String(seoulSeconds).padStart(2, '0')}`;
        } catch (error) {
          console.warn('⚠️ ISO 날짜 파싱 실패:', timeStr, error);
          return null;
        }
      }
      
      // 3. 기타 형식은 경고 후 null 반환
      console.warn('⚠️ 지원하지 않는 시간 형식:', timeStr, '예상 형식: HH:MM:SS 또는 ISO 8601');
      return null;
    };
    
    // 시간 형식 정규화
    const trainingStartTimeStr = normalizeTrainingStartTime(trainingStartTimeRaw);
    
    if (!trainingStartTimeStr) {
      console.warn('⚠️ 훈련 시작 시간을 파싱할 수 없습니다:', trainingStartTimeRaw);
      return;
    }
    
    // HH:MM:SS 형식의 시간 문자열을 서울 시간 기준으로 파싱
    const currentDate = getSyncedTime(); // 서울 시간 기준 (UTC+9)
    
    // 현재 서울 시간 정보 추출 (formatTime은 서울 시간 반환)
    const currentTimeStr = formatTime(currentDate); // "HH:MM:SS" 형식
    const [currentHours, currentMinutes, currentSeconds] = currentTimeStr.split(':').map(Number);
    
    // 시간 문자열 파싱 (HH:MM:SS) - 서울 시간
    const timeParts = trainingStartTimeStr.split(':');
    if (timeParts.length !== 3) {
      console.warn('⚠️ 잘못된 시간 형식:', trainingStartTimeStr);
      return;
    }
    
    const trainingHours = parseInt(timeParts[0], 10);
    const trainingMinutes = parseInt(timeParts[1], 10);
    const trainingSeconds = parseInt(timeParts[2], 10);
    
    // 서울 시간 기준으로 초 단위 차이 계산 (HH:MM:SS 형식의 시간만 비교)
    // 예: 22:50:50 - 22:49:55 = 55초
    const currentTotalSeconds = currentHours * 3600 + currentMinutes * 60 + currentSeconds;
    const trainingTotalSeconds = trainingHours * 3600 + trainingMinutes * 60 + trainingSeconds;
    
    let secondsUntilStart = trainingTotalSeconds - currentTotalSeconds;
    
    // 디버깅: 시간 계산 로그 (상세)
    // 디버깅: 시간 계산 로그 (상세 - 초 단위까지 정확히)
    console.log('🔍 시간 계산 (checkTrainingStartTime) - 초 단위까지 정확히:', {
      현재시간_원본문자열: currentTimeStr,
      현재시간_파싱결과: `${currentHours}:${String(currentMinutes).padStart(2, '0')}:${String(currentSeconds).padStart(2, '0')}`,
      현재시간_시: currentHours,
      현재시간_분: currentMinutes,
      현재시간_초: currentSeconds,
      현재시간_초단위총합: currentTotalSeconds,
      훈련시작시간_원본문자열: trainingStartTimeStr,
      훈련시작시간_파싱결과: `${trainingHours}:${String(trainingMinutes).padStart(2, '0')}:${String(trainingSeconds).padStart(2, '0')}`,
      훈련시작시간_시: trainingHours,
      훈련시작시간_분: trainingMinutes,
      훈련시작시간_초: trainingSeconds,
      훈련시작시간_초단위총합: trainingTotalSeconds,
      차이_초_계산전: secondsUntilStart,
      차이_시분초: `${Math.floor(Math.abs(secondsUntilStart) / 3600)}:${String(Math.floor((Math.abs(secondsUntilStart) % 3600) / 60)).padStart(2, '0')}:${String(Math.abs(secondsUntilStart) % 60).padStart(2, '0')}`,
      차이_분초: `${Math.floor(Math.abs(secondsUntilStart) / 60)}:${String(Math.abs(secondsUntilStart) % 60).padStart(2, '0')}`,
      계산식: `${trainingTotalSeconds}초 - ${currentTotalSeconds}초 = ${secondsUntilStart}초`
    });
    
    // 만약 훈련 시작 시간이 이미 지났다면 (같은 날 내에서 시간이 지난 경우)
    // 음수인 경우만 처리 (예: 22:49:55에서 22:50:50까지는 양수이므로 그대로 사용)
    if (secondsUntilStart < 0) {
      // 같은 날 내에서 시간이 지난 경우, 다음날로 간주하지 않고 0으로 설정
      console.warn('⚠️ 훈련 시작 시간이 이미 지났습니다. 음수 차이:', secondsUntilStart, '초를 0으로 설정합니다.');
      secondsUntilStart = 0;
    }
    
    // 1시간(3600초) 이상 차이나면 계산 오류로 간주 (같은 날 훈련이므로 최대 1시간 이내여야 함)
    if (secondsUntilStart > 3600) {
      console.error('❌ 시간 계산 오류: 차이가 1시간을 초과합니다.', {
        차이_초: secondsUntilStart,
        차이_분: Math.floor(secondsUntilStart / 60),
        현재시간: currentTimeStr,
        훈련시작시간: trainingStartTimeStr
      });
      // 계산 오류 시 0으로 설정
      secondsUntilStart = 0;
    }
    
    // 디버깅: 시간 계산 상세 로그
    console.log('🔍 시간 계산 상세:', {
      현재시간_문자열: currentTimeStr,
      현재시간_초: currentTotalSeconds,
      훈련시작시간_문자열: trainingStartTimeStr,
      훈련시작시간_초: trainingTotalSeconds,
      차이_초: secondsUntilStart,
      차이_분초: `${Math.floor(secondsUntilStart / 60)}분 ${secondsUntilStart % 60}초`
    });
    
    // 현재 날짜 기준으로 훈련 시작 시간 Date 객체 생성 (비교용)
    const trainingStartDate = new Date(currentDate);
    trainingStartDate.setUTCHours(trainingHours - 9, trainingMinutes, trainingSeconds, 0); // 서울 시간을 UTC로 변환
    
    // 만약 훈련 시작 시간이 이미 지났다면 내일로 설정
    if (trainingStartDate.getTime() < currentDate.getTime()) {
      trainingStartDate.setUTCDate(trainingStartDate.getUTCDate() + 1);
    }
    
    // 현재 사용자의 준비 완료 상태 확인
    // LiveData 시트의 sts 칼럼이 "ready"인지 확인
    const currentUserId = window.currentUser?.id || '';
    let isReady = false;
    
    // 1. LiveData 시트에서 sts 칼럼 확인 (우선순위)
    try {
      if (typeof apiGetParticipantsLiveData === 'function') {
        const liveRes = await apiGetParticipantsLiveData(roomCode);
        const liveItems = Array.isArray(liveRes?.items) ? liveRes.items : [];
        const myLiveData = liveItems.find(item => {
          const pid = String(item.participantId || item.id || item.userId || '');
          return pid === String(currentUserId);
        });
        
        if (myLiveData && myLiveData.sts) {
          isReady = String(myLiveData.sts).toLowerCase().trim() === 'ready';
          console.log('📊 LiveData 시트에서 준비 상태 확인:', {
            participantId: currentUserId,
            sts: myLiveData.sts,
            isReady: isReady
          });
        }
      }
    } catch (error) {
      console.warn('⚠️ LiveData 시트 조회 실패, 참가자 정보로 확인:', error);
    }
    
    // 2. LiveData에서 확인되지 않으면 참가자 정보로 확인 (하위 호환성)
    if (!isReady) {
      const myParticipant = latestRoom.participants?.find(p => {
        const pId = p.id || p.participantId || p.userId;
        return String(pId) === String(currentUserId);
      });
      isReady = myParticipant ? isParticipantReady(myParticipant) : false;
    }
    
    console.log('⏰ 훈련 시작 시간 체크 (10초 주기):', {
      훈련시작시간: trainingStartTimeStr,
      현재시간: formatTime(currentDate),
      남은시간: `${Math.floor(secondsUntilStart / 60)}분 ${secondsUntilStart % 60}초`,
      남은초: secondsUntilStart,
      준비완료: isReady,
      훈련시작시간_Date: trainingStartDate.toISOString(),
      훈련시작시간_서울: formatTime(trainingStartDate)
    });
    
    // 훈련 시작 시간을 찾았으면, 이 함수는 더 이상 실행하지 않음
    // updateCountdownFromTrainingStartTime 함수가 1초마다 카운트다운을 업데이트함
  } catch (error) {
    console.error('훈련 시작 시간 체크 중 오류:', error);
  }
}

/**
 * 훈련 시작 시간을 기반으로 카운트다운 업데이트 (1초마다 호출)
 */
async function updateCountdownFromTrainingStartTime() {
  try {
    const room = groupTrainingState.currentRoom;
    if (!room) return;
    
    const roomCode = getCurrentRoomCode(room);
    if (!roomCode) return;
    
    // 최신 방 정보 가져오기
    const latestRoom = await getRoomByCode(roomCode);
    if (!latestRoom) return;
    
    const createdAtRaw = latestRoom.createdAt || latestRoom.CreatedAt || null;
    const createdAtDate = parseRoomTimestampForClock(createdAtRaw);
    // CreatedAt 기반 시계 동기화 제거: Google Time Zone API만 사용
    // handleCreatedAtClockSync(createdAtDate, createdAtDiffBeforeSync); // 제거됨
    const clockNow = getSyncedTime();
    // 훈련 시작 시간 가져오기 (CreatedAt 우선)
    let trainingStartTimeRaw = createdAtRaw || 
                                latestRoom.trainingStartTime || 
                                latestRoom.TrainingStartTime;
    
    if (!trainingStartTimeRaw) {
      return;
    }
    
    if (groupTrainingState.currentRoom) {
      groupTrainingState.currentRoom.trainingStartTime = trainingStartTimeRaw;
    }
    
    // 시간 형식 정규화 함수
    const normalizeTrainingStartTime = (timeValue) => {
      if (!timeValue) return null;
      
      const timeStr = String(timeValue).trim();
      
      // 1. HH:MM:SS 형식인지 확인
      const timePattern = /^(\d{1,2}):(\d{1,2}):(\d{1,2})$/;
      if (timePattern.test(timeStr)) {
        return timeStr;
      }
      
      // 2. ISO 형식인지 확인
      const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      if (isoPattern.test(timeStr)) {
        try {
          const dateObj = new Date(timeStr);
          if (isNaN(dateObj.getTime())) {
            return null;
          }
          
          const seoulHours = dateObj.getUTCHours();
          const seoulMinutes = dateObj.getUTCMinutes();
          const seoulSeconds = dateObj.getUTCSeconds();
          
          let seoulTimeHours = (seoulHours + 9) % 24;
          
          return `${String(seoulTimeHours).padStart(2, '0')}:${String(seoulMinutes).padStart(2, '0')}:${String(seoulSeconds).padStart(2, '0')}`;
        } catch (error) {
          return null;
        }
      }
      
      return null;
    };
    
    // 시간 형식 정규화
    const trainingStartTimeStr = normalizeTrainingStartTime(trainingStartTimeRaw);
    
    if (!trainingStartTimeStr) {
      return;
    }
    
    // 현재 시간 가져오기
    const currentDate = clockNow;
    const currentTimeStr = formatTime(currentDate);
    const [currentHours, currentMinutes, currentSeconds] = currentTimeStr.split(':').map(Number);
    
    // 훈련 시작 시간 파싱
    const timeParts = trainingStartTimeStr.split(':');
    if (timeParts.length !== 3) {
      return;
    }
    
    const trainingHours = parseInt(timeParts[0], 10);
    const trainingMinutes = parseInt(timeParts[1], 10);
    const trainingSeconds = parseInt(timeParts[2], 10);
    
    // 초 단위 차이 계산 (HH:MM:SS 형식의 시간만 비교)
    // 예: 22:50:50 - 22:49:55 = 55초
    const currentTotalSeconds = currentHours * 3600 + currentMinutes * 60 + currentSeconds;
    const trainingTotalSeconds = trainingHours * 3600 + trainingMinutes * 60 + trainingSeconds;
    
    let secondsUntilStart = trainingTotalSeconds - currentTotalSeconds;
    
    // 디버깅: 시간 계산 로그 (상세 - 초 단위까지 정확히)
    console.log('🔍 시간 계산 (updateCountdownFromTrainingStartTime) - 초 단위까지 정확히:', {
      현재시간_원본문자열: currentTimeStr,
      현재시간_파싱결과: `${currentHours}:${String(currentMinutes).padStart(2, '0')}:${String(currentSeconds).padStart(2, '0')}`,
      현재시간_시: currentHours,
      현재시간_분: currentMinutes,
      현재시간_초: currentSeconds,
      현재시간_초단위총합: currentTotalSeconds,
      훈련시작시간_원본문자열: trainingStartTimeStr,
      훈련시작시간_원본Raw: trainingStartTimeRaw,
      훈련시작시간_파싱결과: `${trainingHours}:${String(trainingMinutes).padStart(2, '0')}:${String(trainingSeconds).padStart(2, '0')}`,
      훈련시작시간_시: trainingHours,
      훈련시작시간_분: trainingMinutes,
      훈련시작시간_초: trainingSeconds,
      훈련시작시간_초단위총합: trainingTotalSeconds,
      차이_초_계산결과: secondsUntilStart,
      차이_시분초: `${Math.floor(secondsUntilStart / 3600)}:${String(Math.floor((secondsUntilStart % 3600) / 60)).padStart(2, '0')}:${String(secondsUntilStart % 60).padStart(2, '0')}`,
      차이_분초: `${Math.floor(secondsUntilStart / 60)}:${String(secondsUntilStart % 60).padStart(2, '0')}`,
      계산식: `${trainingTotalSeconds}초 - ${currentTotalSeconds}초 = ${secondsUntilStart}초`
    });
    
    // 만약 훈련 시작 시간이 이미 지났다면 (같은 날 내에서 시간이 지난 경우)
    // 음수인 경우만 처리 (예: 22:49:55에서 22:50:50까지는 양수이므로 그대로 사용)
    if (secondsUntilStart < 0) {
      // 같은 날 내에서 시간이 지난 경우, 다음날로 간주하지 않고 0으로 설정
      console.warn('⚠️ 훈련 시작 시간이 이미 지났습니다. 음수 차이:', secondsUntilStart, '초를 0으로 설정합니다.');
      secondsUntilStart = 0;
    }
    
    // 1시간(3600초) 이상 차이나면 계산 오류로 간주 (같은 날 훈련이므로 최대 1시간 이내여야 함)
    if (secondsUntilStart > 3600) {
      console.error('❌ 시간 계산 오류: 차이가 1시간을 초과합니다.', {
        차이_초: secondsUntilStart,
        차이_분: Math.floor(secondsUntilStart / 60),
        현재시간_원본: currentTimeStr,
        현재시간_파싱: `${currentHours}:${String(currentMinutes).padStart(2, '0')}:${String(currentSeconds).padStart(2, '0')}`,
        훈련시작시간_원본: trainingStartTimeStr,
        훈련시작시간_파싱: `${trainingHours}:${String(trainingMinutes).padStart(2, '0')}:${String(trainingSeconds).padStart(2, '0')}`,
        훈련시작시간_Raw: trainingStartTimeRaw
      });
      
      // 계산 오류 시 0으로 설정 (또는 재계산 시도)
      // 시간 파싱이 잘못되었을 가능성이 있으므로, 원본 값을 다시 확인
      secondsUntilStart = 0;
    }
    
    // 준비 완료 상태 확인
    const currentUserId = window.currentUser?.id || '';
    let isReady = false;
    
    // LiveData 시트에서 sts 칼럼 확인
    try {
      if (typeof apiGetParticipantsLiveData === 'function') {
        const liveRes = await apiGetParticipantsLiveData(roomCode);
        const liveItems = Array.isArray(liveRes?.items) ? liveRes.items : [];
        const myLiveData = liveItems.find(item => {
          const pid = String(item.participantId || item.id || item.userId || '');
          return pid === String(currentUserId);
        });
        
        if (myLiveData && myLiveData.sts) {
          isReady = String(myLiveData.sts).toLowerCase().trim() === 'ready';
        }
      }
    } catch (error) {
      // LiveData 조회 실패 시 참가자 정보로 확인
      const myParticipant = latestRoom.participants?.find(p => {
        const pId = p.id || p.participantId || p.userId;
        return String(pId) === String(currentUserId);
      });
      isReady = myParticipant ? isParticipantReady(myParticipant) : false;
    }
    
    // 준비되지 않은 사용자에게도 전역 카운트다운 표시 (훈련 시작 11초 전)
    if (!isReady && secondsUntilStart <= 11 && secondsUntilStart > 0 && !waitingCountdownShown) {
      waitingCountdownShown = true;
      startWaitingRoomCountdown(secondsUntilStart);
    }
    
    // 준비 완료된 사용자만 자동 훈련 시작 로직 실행
    if (isReady) {
      // 훈련 시작 시간 11초 전부터 10초 카운트다운 시작
      if (secondsUntilStart <= 11 && secondsUntilStart > 0 && !countdownStarted) {
        countdownStarted = true;
        console.log('🚀 훈련 시작 카운트다운 시작!', {
          남은초: secondsUntilStart,
          현재시간: currentTimeStr,
          훈련시작시간: trainingStartTimeStr
        });
        
        // 카운트다운 업데이트 인터벌 중지 (오버레이 카운트다운 시작)
        if (countdownUpdateInterval) {
          clearInterval(countdownUpdateInterval);
          countdownUpdateInterval = null;
        }
        
        const countdownSeconds = secondsUntilStart > 10 ? 10 : secondsUntilStart;
        startTrainingCountdown(countdownSeconds, { startTraining: true });
      } else if (secondsUntilStart <= 0 && !countdownStarted) {
        // 이미 시간이 지났으면 즉시 훈련 시작
        countdownStarted = true;
        if (countdownUpdateInterval) {
          clearInterval(countdownUpdateInterval);
          countdownUpdateInterval = null;
        }
        startLocalGroupTraining();
      }
    }
  } catch (error) {
    console.error('카운트다운 업데이트 중 오류:', error);
  }
}

/**
 * 훈련 시작까지 남은 시간 카운트다운 타이머 업데이트
 */

/**
 * 훈련 시작 카운트다운 시작
 */
function startTrainingCountdown(secondsUntilStart, options = {}) {
  const opts = typeof options === 'object' && options !== null ? options : {};
  const shouldStartTraining = opts.startTraining !== false;
  const overlayId = opts.overlayId || 'trainingStartCountdownOverlay';
  const messageText = opts.message || '훈련이 곧 시작됩니다!';
  const onComplete = typeof opts.onComplete === 'function' ? opts.onComplete : null;

  // 카운트다운 오버레이 표시
  let countdownOverlay = document.getElementById(overlayId);
  if (countdownOverlay) {
    countdownOverlay.remove();
  }
  
  countdownOverlay = document.createElement('div');
  countdownOverlay.id = overlayId;
  countdownOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    flex-direction: column;
    gap: 20px;
  `;
  
  const countdownNumber = document.createElement('div');
  countdownNumber.id = 'trainingStartCountdownNumber';
  countdownNumber.style.cssText = `
    font-size: 120px;
    font-weight: bold;
    color: #4cc9f0;
    text-shadow: 0 0 30px rgba(76, 201, 240, 0.8);
    font-family: 'Courier New', monospace;
  `;
  
  const countdownMessage = document.createElement('div');
  countdownMessage.style.cssText = `
    font-size: 24px;
    color: #fff;
    text-align: center;
  `;
  countdownMessage.textContent = messageText;
  
  countdownOverlay.appendChild(countdownNumber);
  countdownOverlay.appendChild(countdownMessage);
  document.body.appendChild(countdownOverlay);
  
  let countdown = secondsUntilStart;
  countdownNumber.textContent = countdown;
  
  const countdownInterval = setInterval(() => {
    countdown--;
    countdownNumber.textContent = countdown;
    
    if (countdown <= 0) {
      clearInterval(countdownInterval);
      countdownOverlay.remove();
      // 훈련 화면으로 전환
      if (shouldStartTraining) {
        startLocalGroupTraining();
      } else if (onComplete) {
        onComplete();
      }
    }
  }, 1000);
}

function startWaitingRoomCountdown(secondsUntilStart) {
  const countdownSeconds = secondsUntilStart > 10 ? 10 : secondsUntilStart;
  startTrainingCountdown(countdownSeconds, {
    startTraining: false,
    overlayId: 'waitingRoomCountdownOverlay',
    message: '훈련 시작까지',
    onComplete: () => {
      const overlay = document.getElementById('waitingRoomCountdownOverlay');
      if (overlay) {
        overlay.remove();
      }
    }
  });
}

/**
 * 로컬 훈련 시작 (훈련 화면 전환)
 */
function startLocalGroupTraining() {
  try {
    console.log('🚀 로컬 훈련 시작 - 훈련 화면으로 전환');
    
    // 훈련 시작 시간 체크 중지
    if (trainingStartCheckInterval) {
      clearInterval(trainingStartCheckInterval);
      trainingStartCheckInterval = null;
    }
    
    // 훈련 화면으로 전환
    if (typeof startGroupTrainingSession === 'function') {
      startGroupTrainingSession();
    } else if (typeof showScreen === 'function') {
      showScreen('trainingScreen');
      if (typeof startWorkoutTraining === 'function') {
        setTimeout(() => {
          startWorkoutTraining();
        }, 100);
      }
    }
  } catch (error) {
    console.error('로컬 훈련 시작 실패:', error);
    showToast('훈련 시작에 실패했습니다', 'error');
  }
}

async function initializeWaitingRoom() {
  const room = groupTrainingState.currentRoom;
  if (!room) {
    console.error('No current room found');
    return;
  }

  normalizeRoomParticipantsInPlace(room);
  
  // 상단 정보를 워크아웃 세그먼트 테이블로 렌더링 (시계 시작 포함)
  // startClock() 함수 내부에서 최초 1회 시간 동기화 및 20초마다 자동 동기화 처리
  renderWaitingHeaderSegmentTable();
  
  // 기존 체크 인터벌 정리
  if (trainingStartCheckInterval) {
    clearInterval(trainingStartCheckInterval);
    trainingStartCheckInterval = null;
  }
  if (countdownUpdateInterval) {
    clearInterval(countdownUpdateInterval);
    countdownUpdateInterval = null;
  }
  
  countdownStarted = false;
  trainingStartTimeFound = false;
  waitingCountdownShown = false;
  
  // 5초마다 훈련 시작 시간 체크 시작 (훈련 시작 시간을 찾을 때까지)
  trainingStartCheckInterval = setInterval(() => {
    checkTrainingStartTime();
  }, 5000); // 5초마다 체크
  
  // 즉시 한 번 체크
  setTimeout(() => {
    checkTrainingStartTime();
  }, 1000);
  
  // 관리자/참가자 컨트롤 표시
  // grade=1 사용자도 관리자로 인식
  const currentUser = window.currentUser || {};
  if (!groupTrainingState.isAdmin && (currentUser.grade === '1' || currentUser.grade === 1 || (typeof getViewerGrade === 'function' && getViewerGrade() === '1'))) {
    groupTrainingState.isAdmin = true;
    console.log('✅ grade=1 사용자를 관리자로 설정했습니다');
  }
  
  const adminControls = safeGet('adminControls');
  const participantControls = safeGet('participantControls');
  
  console.log('대기실 초기화 - 관리자 여부:', groupTrainingState.isAdmin, '사용자 grade:', currentUser.grade);
  console.log('adminControls 요소:', adminControls);
  console.log('participantControls 요소:', participantControls);
  
  if (adminControls) {
    adminControls.classList.add('hidden');
    adminControls.style.display = 'none';
    adminControls.innerHTML = '';
  }
  
  if (participantControls) {
    participantControls.classList.remove('hidden');
    participantControls.style.display = '';
    const inlineBtn = participantControls.querySelector('#startTrainingBtnInline');
    if (inlineBtn) {
      inlineBtn.remove();
    }
  }
  
  // 참가자 목록 업데이트 (기기 연결 상태 확인 포함)
  updateParticipantsList();
  setupGroupTrainingControlBar();
  
  // 참가자 오디오 수신 시작 (관리자 음성 코칭 수신)
  if (!groupTrainingState.isAdmin) {
    startParticipantAudioListening();
  }
  
  // 준비 완료 버튼 상태는 updateParticipantsList에서 기기 연결 상태를 확인하여 설정됨
  // 관리자도 일반 참가자처럼 준비완료 버튼을 사용할 수 있도록 설정
  const readyBtn = safeGet('readyToggleBtn');
  if (readyBtn) {
    // 현재 준비 상태 확인 (관리자 포함)
    const currentUserId = window.currentUser?.id || '';
    const myParticipant = room.participants.find(p => {
      const pId = p.id || p.participantId || p.userId;
      return String(pId) === String(currentUserId);
    });
    if (myParticipant) {
      const isReady = isParticipantReady(myParticipant);
      readyBtn.textContent = isReady ? '✅ 준비 완료' : '⏳ 준비 중';
      readyBtn.classList.toggle('ready', isReady);
    }
    
    // 기기 연결 상태 확인하여 버튼 활성/비활성화 (updateParticipantsList와 동일한 로직)
    const connectedDevices = window.connectedDevices || {};
    const hasTrainer = !!(connectedDevices.trainer && connectedDevices.trainer.device);
    const hasPowerMeter = !!(connectedDevices.powerMeter && connectedDevices.powerMeter.device);
    const hasHeartRate = !!(connectedDevices.heartRate && connectedDevices.heartRate.device);
    const hasBluetoothDevice = hasTrainer || hasPowerMeter || hasHeartRate;
    
    // 관리자도 일반 참가자처럼 준비완료 버튼 사용 가능
    readyBtn.disabled = !hasBluetoothDevice;
    if (!hasBluetoothDevice) {
      readyBtn.title = '블루투스 기기를 먼저 연결하세요 (트레이너, 파워미터, 심박계 중 하나 이상)';
    } else {
      readyBtn.title = '';
    }
  }
  
  // 대기실에서도 참가자 실시간 데이터 업로드 시작(관리자 포함)
  if (typeof startParticipantDataSync === 'function') {
    startParticipantDataSync();
  }
  
  // 시작 버튼 상태 즉시 업데이트
  updateStartButtonState();
  
  // 실시간 동기화 시작
  startRoomSync();
  
  // 워크아웃 정보 로드
  loadWorkoutInfo(room.workoutId);
  
  // 메트릭 주기적 갱신 타이머 시작 (1초마다 목록 갱신)
  if (window.participantMetricsUpdateInterval) {
    clearInterval(window.participantMetricsUpdateInterval);
    window.participantMetricsUpdateInterval = null;
  }
  
  // 이전 렌더링 상태를 저장하여 변경된 경우에만 DOM 업데이트 (전역 스코프로 이동)
  if (!window.lastRenderState) {
    window.lastRenderState = {
      elapsed: null,
      segmentIndex: null,
      segmentRemaining: null,
      participantsHash: null
    };
  }
  
  window.participantMetricsUpdateInterval = setInterval(() => {
    try {
      // 대기실 화면이 표시 중일 때만 갱신
      const screen = document.getElementById('groupWaitingScreen');
      if (screen && !screen.classList.contains('hidden')) {
        // 타임라인 스냅샷 업데이트 (경과 시간 및 세그먼트 진행 상황 반영)
        const room = groupTrainingState.currentRoom;
        if (room) {
          updateTimelineSnapshot(room);
          
          // 스냅샷 데이터로 변경 여부 확인
          const snapshot = groupTrainingState.timelineSnapshot;
          const currentElapsed = snapshot?.elapsedSec || 0;
          const currentSegIndex = snapshot?.segmentIndex || -1;
          const currentSegRemaining = snapshot?.segmentRemainingSec || null;
          
          // 참가자 목록 해시 생성 (변경 여부 확인용)
          const participantsHash = JSON.stringify(
            (room.participants || []).map(p => ({
              id: p.id || p.participantId,
              ready: p.ready || p.isReady,
              name: p.name || p.participantName
            }))
          );
          
          // 데이터 변경 여부 확인
          const hasChanged = 
            window.lastRenderState.elapsed !== currentElapsed ||
            window.lastRenderState.segmentIndex !== currentSegIndex ||
            window.lastRenderState.segmentRemaining !== currentSegRemaining ||
            window.lastRenderState.participantsHash !== participantsHash;
          
          if (hasChanged) {
            // 변경된 경우에만 업데이트
            updateParticipantsList();
            renderWaitingHeaderSegmentTable();
            
            // 상태 저장
            window.lastRenderState = {
              elapsed: currentElapsed,
              segmentIndex: currentSegIndex,
              segmentRemaining: currentSegRemaining,
              participantsHash: participantsHash
            };
          } else {
            // 변경되지 않은 경우 타이머 값만 업데이트 (DOM 재생성 없이)
            updateTimersOnly();
          }
        }
      }
    } catch (e) {
      console.warn('participantMetricsUpdateInterval 오류:', e);
    }
  }, 1000);
}

/**
 * 타이머 값만 업데이트 (DOM 재생성 없이)
 */
function updateTimersOnly() {
  try {
    const snapshot = groupTrainingState.timelineSnapshot;
    if (!snapshot) return;
    
    const phase = snapshot.phase || 'idle';
    const isTrainingStarted = phase === 'training';
    const elapsed = snapshot.elapsedSec || 0;
    const currentIdx = isTrainingStarted && snapshot.segmentIndex !== undefined
      ? snapshot.segmentIndex
      : -1;
    const currentSegRemaining = isTrainingStarted && snapshot
      ? (snapshot.segmentRemainingSec !== null && snapshot.segmentRemainingSec !== undefined ? snapshot.segmentRemainingSec : null)
      : null;
    const countdownRemainingSeconds = snapshot.countdownRemainingSec ?? null;
    
    const elapsedTimer = formatTimer(elapsed);
    const segmentTimerFormatted = isTrainingStarted
      ? (currentSegRemaining !== null ? formatTimer(currentSegRemaining) : '--:--')
      : (countdownRemainingSeconds !== null ? formatTimer(countdownRemainingSeconds) : '--:--');
    
    // 타이머 값만 업데이트 (요소가 존재하는 경우에만)
    const screen = document.getElementById('groupWaitingScreen');
    if (!screen) return;
    
    const roomInfoCard = screen.querySelector('.room-info.card');
    if (!roomInfoCard) return;
    
    // 경과 시간 타이머 업데이트
    const elapsedTimerValue = roomInfoCard.querySelector('.workout-timer.elapsed .timer-value');
    if (elapsedTimerValue) {
      elapsedTimerValue.textContent = elapsedTimer;
    }
    
    // 세그먼트 카운트다운 타이머 업데이트
    const segmentTimerValue = roomInfoCard.querySelector('.workout-timer.segment .timer-value');
    if (segmentTimerValue) {
      segmentTimerValue.textContent = segmentTimerFormatted;
    }
    
  } catch (e) {
    console.warn('updateTimersOnly 오류:', e);
  }
}

/**
 * 참가자 목록 업데이트
 */
function updateParticipantsList() {
  const room = groupTrainingState.currentRoom;
  if (!room) return;
  
  normalizeRoomParticipantsInPlace(room);
  
  const countEl = safeGet('participantCount');
  const maxCountEl = safeGet('maxParticipantCount');
  const listEl = safeGet('participantsList');
  
  if (countEl) countEl.textContent = room.participants.length;
  if (maxCountEl) maxCountEl.textContent = room.maxParticipants;
  
  if (listEl) {
    // 참가자 데이터 정규화 (다양한 필드명 지원)
    const normalizedParticipants = room.participants.map(p => {
      // 이름 필드 정규화
      const name = p.name || p.participantName || p.userName || p.displayName || '이름 없음';
      // ID 필드 정규화
      const id = p.id || p.participantId || p.userId || '';
      // 역할 정규화
      const role = p.role || 'participant';
      // 준비 상태 정규화
      const ready = isParticipantReady(p);
      // 참가 시간 정규화
      const joinedAt = p.joinedAt || p.joined_at || p.createdAt || new Date().toISOString();
      
      return {
        id,
        name: String(name),
        role,
        ready,
        joinedAt
      };
    });
    
    // 현재 사용자 ID 확인
    const currentUserId = window.currentUser?.id || '';
    const isCurrentUser = (participantId) => String(participantId) === String(currentUserId);
    
    // 블루투스 연결 상태 확인 함수
    const getBluetoothStatus = (participantId) => {
      // 1) 서버에 동기화된 참가자별 BLE 상태 우선 사용
      const serverParticipant = (room.participants || []).find(pp => {
        const pId = pp.id || pp.participantId || pp.userId;
        return String(pId) === String(participantId);
      }) || {};
      
      // 다양한 필드명 지원 (bluetoothStatus 우선, 그 다음 별칭 필드들)
      const serverBle = serverParticipant.bluetoothStatus || serverParticipant.ble || serverParticipant.devices || {};
      const sTrainer = !!(serverBle.trainer || 
                         serverBle.trainerConnected || 
                         serverParticipant.trainerConnected ||
                         serverBle.trainer_on);
      const sPower = !!(serverBle.powerMeter || 
                       serverBle.powerMeterConnected ||
                       serverBle.powerConnected || 
                       serverParticipant.powerConnected ||
                       serverParticipant.powerMeterConnected ||
                       serverBle.power || 
                       serverBle.power_on || 
                       serverBle.powerMeter_on);
      const sHr = !!(serverBle.heartRate || 
                    serverBle.heartRateConnected ||
                    serverBle.hrConnected || 
                    serverParticipant.hrConnected ||
                    serverParticipant.heartRateConnected ||
                    serverBle.hr || 
                    serverBle.hr_on || 
                    serverBle.bpm_on);

      // 2) 본인인 경우는 로컬 연결 상태로 보강
      if (isCurrentUser(participantId)) {
        const connectedDevices = window.connectedDevices || {};
        return {
          trainer: sTrainer || !!(connectedDevices.trainer && connectedDevices.trainer.device),
          powerMeter: sPower || !!(connectedDevices.powerMeter && connectedDevices.powerMeter.device),
          heartRate: sHr || !!(connectedDevices.heartRate && connectedDevices.heartRate.device)
        };
      }

      // 3) 타인인 경우 서버 동기화 값 표시 (없으면 false)
      const result = {
        trainer: sTrainer,
        powerMeter: sPower,
        heartRate: sHr
      };
      
      // 디버깅: 타인의 블루투스 상태 확인 (연결된 기기가 있을 때만)
      if (sTrainer || sPower || sHr) {
        console.log(`🔌 타인 ${serverParticipant.name || participantId} 블루투스 상태:`, result, '서버 데이터:', {
          bluetoothStatus: serverParticipant.bluetoothStatus,
          trainerConnected: serverParticipant.trainerConnected,
          powerMeterConnected: serverParticipant.powerMeterConnected,
          heartRateConnected: serverParticipant.heartRateConnected
        });
      }
      
      return result;
    };
    
    const pickNumber = (...values) => {
      for (const value of values) {
        const n = Number(value);
        if (Number.isFinite(n)) {
          return n;
        }
      }
      return null;
    };
    
    const workout = window.currentWorkout || null;
    const trainingState = window.trainingState || {};
    const currentSegIndex = Math.max(0, Number(trainingState.segIndex) || 0);
    const currentSegment = workout?.segments?.[currentSegIndex] || null;
    const getFtpPercent = (segment) => {
      if (!segment) return null;
      if (segment.ftp_percent !== undefined && segment.ftp_percent !== null) {
        return Number(segment.ftp_percent);
      }
      if (typeof window.getSegmentFtpPercent === 'function') {
        const pct = Number(window.getSegmentFtpPercent(segment));
        if (Number.isFinite(pct)) return pct;
      }
      if (segment.target_value !== undefined && segment.target_value !== null) {
        return Number(segment.target_value);
      }
      return null;
    };
    const currentSegmentFtpPercent = getFtpPercent(currentSegment);
    
    const tableRows = normalizedParticipants.map((p, index) => {
      const rowNumber = index + 1;
      const bluetoothStatus = getBluetoothStatus(p.id);
      const isMe = isCurrentUser(p.id);
      const ready = !!p.ready;
      
      const hasBluetoothDevice = isMe && (bluetoothStatus.trainer || bluetoothStatus.powerMeter || bluetoothStatus.heartRate);
      
      const deviceStatusIcons = `
        <span class="ble-icons" aria-label="기기 연결 상태">
          <span class="device-badge" title="심박계">
            <img src="assets/img/${bluetoothStatus.heartRate ? 'bpm_g.png' : 'bpm_i.png'}" alt="심박계" onerror="this.onerror=null; this.src='assets/img/bpm_i.png';" />
          </span>
          <span class="device-badge" title="파워미터">
            <img src="assets/img/${bluetoothStatus.powerMeter ? 'power_g.png' : 'power_i.png'}" alt="파워미터" onerror="this.onerror=null; this.src='assets/img/power_i.png';" />
          </span>
          <span class="device-badge" title="스마트 트레이너">
            <img src="assets/img/${bluetoothStatus.trainer ? 'trainer_g.png' : 'trainer_i.png'}" alt="스마트 트레이너" onerror="this.onerror=null; this.src='assets/img/trainer_i.png';" />
          </span>
        </span>
      `;

      const serverParticipant = (room.participants || []).find(pp => {
        const pId = pp.id || pp.participantId || pp.userId;
        return String(pId) === String(p.id);
      }) || {};
      const serverMetrics = serverParticipant.metrics || serverParticipant.live || serverParticipant.liveData || serverParticipant || {};
      const participantFtp = pickNumber(
        serverParticipant.ftp,
        serverParticipant.FTP,
        serverParticipant.userFtp,
        serverParticipant.profileFtp,
        serverParticipant.powerFtp,
        serverParticipant?.stats?.ftp
      );

      const liveData = (isMe ? (window.liveData || {}) : {});
      
      const computeTargetPower = () => {
        const direct = pickNumber(
          serverMetrics.segmentTargetPowerW,
          serverMetrics.targetPowerW,
          serverMetrics.segmentTargetPower,
          serverParticipant.targetPowerW,
          serverParticipant.segmentTargetPowerW,
          serverParticipant.liveData?.targetPower,
          serverParticipant.live?.targetPower
        );
        if (direct !== null) return direct;
        
        const ftpPercent = currentSegmentFtpPercent;
        if (!ftpPercent) {
          const fallback = pickNumber(
            trainingState.currentTargetPowerW,
            trainingState.targetPowerW,
            liveData.targetPower
          );
          return fallback;
        }
        
        if (isMe) {
          const ftp = pickNumber(window.currentUser?.ftp);
          if (ftp) return Math.round(ftp * ftpPercent / 100);
          const fromLive = pickNumber(liveData.targetPower);
          if (fromLive !== null) return fromLive;
        } else if (participantFtp) {
          return Math.round(participantFtp * ftpPercent / 100);
        }
        
        return null;
      };
      
      const targetPower = computeTargetPower();
      const avgPower = isMe
        ? pickNumber(liveData.avgPower, liveData.averagePower, serverMetrics.segmentAvgPowerW, serverMetrics.avgPower, serverMetrics.averagePower)
        : pickNumber(serverMetrics.segmentAvgPowerW, serverMetrics.avgPower, serverMetrics.averagePower, serverMetrics.segmentAvgPower, serverParticipant.liveData?.avgPower);
      const currentPower = isMe
        ? pickNumber(liveData.power, liveData.instantPower, liveData.watts, serverMetrics.currentPower)
        : pickNumber(serverMetrics.currentPower, serverMetrics.power, serverMetrics.currentPowerW, serverParticipant.liveData?.power);
      const heartRate = isMe
        ? pickNumber(liveData.heartRate, liveData.hr, liveData.bpm, serverMetrics.heartRate)
        : pickNumber(serverMetrics.heartRate, serverMetrics.hr, serverParticipant.liveData?.heartRate);
      const cadence = isMe
        ? pickNumber(liveData.cadence, liveData.rpm, serverMetrics.cadence)
        : pickNumber(serverMetrics.cadence, serverMetrics.rpm, serverParticipant.liveData?.cadence);
      const fmt = (v, unit) => {
        if (typeof v === 'number' && isFinite(v)) {
          return `${Math.round(v)}${unit ? `<span class="metric-unit">${unit}</span>` : ''}`;
        }
        return '-';
      };

      const readyStatusChip = `<span class="ready-chip ${ready ? 'ready' : 'not-ready'}">${ready ? '준비완료' : '준비중'}</span>`;
      const readyToggleInline = (isMe && hasBluetoothDevice) ? `
        <button class="btn btn-xs ready-toggle-inline ${ready ? 'ready' : ''}" 
                id="readyToggleBtn"
                onclick="toggleReady()">
          ${ready ? '✅ 준비완료' : '⏳ 준비하기'}
        </button>
      ` : (isMe ? `<span class="ready-hint">기기를 연결해주세요</span>` : '-');
      
      const isCurrentSegment = currentSegment && p.currentSegmentIndex !== undefined
        ? Number(p.currentSegmentIndex) === currentSegIndex
        : false;
      const rowClasses = [
        isMe ? 'current-user' : '',
        isCurrentSegment ? 'segment-active' : ''
      ].filter(Boolean).join(' ');

      return `
        <tr class="${rowClasses}">
          <td>${rowNumber}</td>
          <td class="participant-name-cell">
            <span class="participant-name-text">${escapeHtml(p.name)}${isMe ? ' (나)' : ''}</span>
          </td>
          <td>${deviceStatusIcons}</td>
          <td>${fmt(targetPower, '<span>W</span>')}</td>
          <td>${fmt(avgPower, '<span>W</span>')}</td>
          <td>${fmt(currentPower, '<span>W</span>')}</td>
          <td>${fmt(heartRate, '<span>bpm</span>')}</td>
          <td>${fmt(cadence, '<span>rpm</span>')}</td>
          <td>${readyStatusChip}</td>
          <td>${readyToggleInline}</td>
        </tr>
      `;
    }).join('') || `
      <tr>
        <td colspan="10" class="empty-state">참가자가 없습니다. 첫 번째로 참여해보세요!</td>
      </tr>
    `;

    // 스크롤 위치 보존: 업데이트 전 현재 스크롤 위치 저장
    const existingWrapper = listEl.querySelector('.participant-table-wrapper');
    const savedScrollLeft = existingWrapper ? existingWrapper.scrollLeft : 0;
    const savedScrollTop = existingWrapper ? existingWrapper.scrollTop : 0;
    
    listEl.innerHTML = `
      <div class="participant-table-wrapper">
        <table class="participant-table">
          <thead>
            <tr>
              <th>순번</th>
              <th>사용자명</th>
              <th>기기 연결</th>
              <th>목표값</th>
              <th>랩파워</th>
              <th>현재파워</th>
              <th>심박수</th>
              <th>케이던스</th>
              <th>상태</th>
              <th>동작</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>
    `;
    
    // 스크롤 위치 복원: 업데이트 후 저장된 스크롤 위치로 복원
    requestAnimationFrame(() => {
      const newWrapper = listEl.querySelector('.participant-table-wrapper');
      if (newWrapper) {
        newWrapper.scrollLeft = savedScrollLeft;
        newWrapper.scrollTop = savedScrollTop;
      }
    });
    
    // 참가자 목록 컨테이너 내부 제어 버튼 블록은 제거됨
    // 관리자도 일반 참가자처럼 준비완료 상태를 가져야 함
    // 기존 내부 제어 블록이 있다면 제거
    const participantsListContainer = listEl.parentElement;
    const adminControlsBlock = participantsListContainer?.querySelector('.admin-training-controls-block');
    if (adminControlsBlock) {
      adminControlsBlock.remove();
    }

    // 본인의 준비완료 버튼 상태 업데이트 (관리자 포함)
    // 관리자도 일반 참가자처럼 준비완료 상태를 가져야 함
    const readyBtn = safeGet('readyToggleBtn');
    if (readyBtn) {
      const myParticipant = normalizedParticipants.find(p => isCurrentUser(p.id));
      if (myParticipant) {
        // 트레이너, 파워미터, 심박계 중 하나 이상 연결되면 활성화
        // getBluetoothStatus와 동일한 로직 사용 (device 속성 확인)
        const connectedDevices = window.connectedDevices || {};
        const hasTrainer = !!(connectedDevices.trainer && connectedDevices.trainer.device);
        const hasPowerMeter = !!(connectedDevices.powerMeter && connectedDevices.powerMeter.device);
        const hasHeartRate = !!(connectedDevices.heartRate && connectedDevices.heartRate.device);
        const hasBluetoothDevice = hasTrainer || hasPowerMeter || hasHeartRate;
        
        console.log('기기 연결 상태 확인:', {
          trainer: hasTrainer,
          powerMeter: hasPowerMeter,
          heartRate: hasHeartRate,
          hasBluetoothDevice: hasBluetoothDevice,
          connectedDevices: connectedDevices
        });
        
        // 관리자도 일반 참가자처럼 준비완료 버튼 사용 가능
        readyBtn.disabled = !hasBluetoothDevice;
        if (!hasBluetoothDevice) {
          readyBtn.title = '블루투스 기기를 먼저 연결하세요 (트레이너, 파워미터, 심박계 중 하나 이상)';
        } else {
          readyBtn.title = '';
        }
      }
    }
  }
  
  // 시작 버튼 활성화 체크
  updateStartButtonState();
}

/**
 * 대기실 상단: 워크아웃 세그먼트 테이블 렌더링
 */
function renderWaitingHeaderSegmentTable() {
  try {
    const screen = document.getElementById('groupWaitingScreen');
    if (!screen) return;
    const roomInfoCard = screen.querySelector('.room-info.card');
    if (!roomInfoCard) return;

    if (!window.currentWorkout || !Array.isArray(window.currentWorkout.segments)) {
      console.warn('No workout segments available for waiting room table');
      return;
    }

    const workout = window.currentWorkout;
    const segments = workout.segments;
    const room = groupTrainingState.currentRoom || {};
    const roomStatus = room.status || room.Status || 'waiting';
    
    // 타임라인 스냅샷 업데이트 시도
    const newSnapshot = updateTimelineSnapshot(room, { workout });
    
    // 스냅샷이 null이거나 유효하지 않으면 이전 스냅샷 유지 (초기화 방지)
    const snapshot = (newSnapshot && newSnapshot.phase) 
      ? newSnapshot 
      : (groupTrainingState.timelineSnapshot || null);
    
    // 유효한 스냅샷이 있으면 저장
    if (snapshot && snapshot.phase) {
      groupTrainingState.timelineSnapshot = snapshot;
    }

    // 스냅샷이 없을 때는 기본값으로 처리 (초기화 방지)
    if (!snapshot) {
      console.warn('타임라인 스냅샷이 없습니다. 이전 값을 유지합니다.');
    }
    
    const phase = snapshot?.phase || 'idle';
    const isTrainingStarted = phase === 'training';
    const countdownRemainingSeconds = snapshot?.countdownRemainingSec ?? null;
    // 스냅샷이 있을 때만 경과 시간 표시, 없으면 이전 값 유지 또는 0
    const elapsed = snapshot && Number.isFinite(snapshot.elapsedSec) 
      ? snapshot.elapsedSec 
      : (snapshot?.elapsedSec ?? 0);
    const currentIdx = isTrainingStarted && snapshot && Number.isFinite(snapshot.segmentIndex)
      ? snapshot.segmentIndex
      : -1;
    const currentSegRemaining = isTrainingStarted && snapshot
      ? (Number.isFinite(snapshot.segmentRemainingSec) ? snapshot.segmentRemainingSec : null)
      : null;

    // 상단 타이틀 상태 업데이트 (훈련 시작 여부에 따라 문구 변경)
    const waitingTitleEl = document.getElementById('waitingRoomTitle');
    const waitingSubtitleEl = screen.querySelector('.subtitle');
    if (waitingTitleEl) {
      const titleStatusText = isTrainingStarted ? '훈련 진행중...' : '로딩중...';
      waitingTitleEl.textContent = `📱 훈련방: ${titleStatusText}`;
    }
    if (waitingSubtitleEl) {
      waitingSubtitleEl.textContent = isTrainingStarted
        ? '훈련이 진행되고 있습니다.'
        : '모든 참가자가 준비될 때까지 대기해주세요';
    }

    // normalizedSegments를 먼저 정의 (다른 로직에서 사용하기 전에)
    const normalizedSegments = segments.map((seg, idx) => ({
      seg,
      originalIndex: idx,
      label: seg.label || seg.name || seg.title || `세그먼트 ${idx + 1}`,
      type: (seg.segment_type || seg.type || '-').toString().toUpperCase(),
      ftp: Math.round(Number(
        seg.target_value ??
        seg.targetValue ??
        seg.target ??
        seg.target_power_w ??
        seg.targetPowerW ??
        seg.target_power ??
        seg.intensity ??
        0
      )),
      durationStr: formatDuration(seg.duration_sec ?? seg.duration)
    }));

    // 세그먼트 정보 계산 (normalizedSegments 정의 후)
    const currentSegmentInfo = currentIdx >= 0
      ? normalizedSegments.find(item => item.originalIndex === currentIdx)
      : null;
    const nextSegmentInfo = currentIdx >= 0
      ? normalizedSegments.find(item => item.originalIndex === currentIdx + 1)
      : (phase === 'countdown' ? normalizedSegments[0] : null);

    // 타이머 표시 포맷
    const elapsedTimer = formatTimer(elapsed);
    const segmentTimerFormatted = isTrainingStarted
      ? (currentSegRemaining !== null ? formatTimer(currentSegRemaining) : '--:--')
      : (countdownRemainingSeconds !== null ? formatTimer(countdownRemainingSeconds) : '--:--');

    // 서브텍스트 정보
    const elapsedSubtext = isTrainingStarted && currentSegmentInfo
      ? `${currentSegmentInfo.label} 진행 중`
      : (phase === 'countdown' && countdownRemainingSeconds !== null
        ? `시작까지 ${countdownRemainingSeconds}초`
        : '대기 중');

    // 세그먼트 서브텍스트 계산 (훈련 중에는 항상 유효한 정보 표시, 대기중 방지)
    let segmentSubtext = '대기 중';
    if (isTrainingStarted) {
      // 훈련 중: 다음 세그먼트가 있으면 다음 세그먼트 표시, 없으면 현재 세그먼트 또는 마지막 구간 표시
      if (nextSegmentInfo) {
        segmentSubtext = `다음: ${nextSegmentInfo.label}`;
      } else if (currentSegmentInfo) {
        segmentSubtext = `${currentSegmentInfo.label} 진행 중`;
      } else {
        segmentSubtext = '마지막 구간';
      }
    } else if (countdownRemainingSeconds !== null) {
      segmentSubtext = `시작까지 ${countdownRemainingSeconds}초`;
    }

    // 세그먼트 카운트다운 표시 로직 개선
    let segmentCountdownDisplay = segmentTimerFormatted;
    let segmentTimerClass = 'timer-value';

    if (isTrainingStarted && currentSegRemaining !== null && currentSegRemaining > 0) {
      // 세그먼트 종료 6초 전부터 5초 카운트다운 표시 (5, 4, 3, 2, 1, 0)
      if (currentSegRemaining <= 6 && nextSegmentInfo) {
        segmentTimerClass += ' is-countdown';
        // 6초일 때 5 표시, 5초일 때 4 표시, ..., 1초일 때 0 표시
        const countdownNumber = Math.max(0, Math.ceil(currentSegRemaining) - 1);
        segmentCountdownDisplay = countdownNumber.toString();
      }
    } else if (!isTrainingStarted && countdownRemainingSeconds !== null && countdownRemainingSeconds <= 11) {
      segmentTimerClass += ' is-countdown';
      segmentCountdownDisplay = Math.min(10, countdownRemainingSeconds).toString();
    }

    // 상태 표시
    const statusPillClass = isTrainingStarted
      ? 'is-live'
      : (phase === 'countdown' && countdownRemainingSeconds !== null ? 'is-countdown' : '');
    const statusPillLabel = phase === 'countdown' && countdownRemainingSeconds !== null
      ? `카운트다운 ${countdownRemainingSeconds}초`
      : (isTrainingStarted && currentIdx >= 0 ? `현재 ${currentIdx + 1}번째 구간` : '대기 중');

    let orderedSegments = normalizedSegments;
    if (isTrainingStarted && currentIdx >= 0) {
      orderedSegments = [
        ...normalizedSegments.slice(currentIdx),
        ...normalizedSegments.slice(0, currentIdx)
      ];
    }

    const tableRows = orderedSegments.map((item, orderIdx) => {
      const { seg, originalIndex, label, type, ftp, durationStr } = item;
      const isActive = isTrainingStarted && originalIndex === currentIdx;

      return `
        <tr class="${isActive ? 'active' : ''}">
          <td class="seg-col-index">
            <span class="seg-index-text">${String(originalIndex + 1).padStart(2, '0')}</span>
          </td>
          <td class="seg-col-label"><span class="seg-label">${escapeHtml(String(label))}</span></td>
          <td class="seg-col-type"><span class="seg-type">${type}</span></td>
          <td class="seg-col-ftp">${Number.isFinite(ftp) ? `${ftp}<small class="unit">%</small>` : '-'}</td>
          <td class="seg-col-duration">${durationStr}</td>
        </tr>
      `;
    }).join('');

    const workoutTitle = escapeHtml(String(workout.title || workout.name || '워크아웃'));

    // 시계 요소가 이미 있으면 보존 (리셋 방지)
    const existingClock = roomInfoCard.querySelector('#groupTrainingClock');
    const clockPreserved = existingClock && existingClock.querySelector('.clock-digits');
    let clockElement = null;
    
    if (clockPreserved) {
      // 시계 요소를 임시로 보존
      clockElement = existingClock.cloneNode(true);
    }

    // 스크롤 위치 보존: innerHTML 재생성 전에 현재 스크롤 위치 저장
    const existingWrapper = roomInfoCard.querySelector('.workout-table-wrapper');
    let preservedScrollTop = null;
    let preservedCurrentSegIndex = null;
    
    if (existingWrapper) {
      preservedScrollTop = existingWrapper.scrollTop;
      // 현재 활성 세그먼트 인덱스도 저장 (스크롤 계산용)
      const activeRow = existingWrapper.querySelector('tbody tr.active');
      if (activeRow) {
        const allRows = Array.from(existingWrapper.querySelectorAll('tbody tr'));
        preservedCurrentSegIndex = allRows.indexOf(activeRow);
      }
    }

    roomInfoCard.innerHTML = `
      <div class="workout-table-card">
        <div class="workout-table-head">
          <div class="workout-title">
            <span class="icon">📋</span>
            <div>
              <h3>${workoutTitle}</h3>
              <p>${segments.length || 0}개 세그먼트 • 실시간 진행 상황</p>
            </div>
          </div>
          <div class="workout-header-right">
            <div class="group-training-clock" id="groupTrainingClock"></div>
            <div class="workout-status-pill ${statusPillClass}">
              ${statusPillLabel}
            </div>
          </div>
        </div>
        <div class="workout-timers">
          <div class="workout-timer elapsed">
            <div class="timer-icon">⏱️</div>
            <div class="timer-content">
              <span class="timer-label">경과 시간</span>
              <span class="timer-value">${elapsedTimer}</span>
              <span class="timer-subtext">${escapeHtml(elapsedSubtext)}</span>
            </div>
          </div>
          <div class="workout-timer segment">
            <div class="timer-icon">⏳</div>
            <div class="timer-content">
              <span class="timer-label">세그먼트 카운트다운</span>
              <span class="${segmentTimerClass}">${segmentCountdownDisplay}</span>
              <span class="timer-subtext">${escapeHtml(segmentSubtext)}</span>
            </div>
          </div>
        </div>
        <div class="workout-table-wrapper">
          <table class="workout-table">
            <thead>
              <tr>
                <th class="col-index">#</th>
                <th class="col-label">세그먼트명</th>
                <th class="col-type">세그먼트 타입</th>
                <th class="col-ftp">FTP 강도</th>
                <th class="col-duration">시간</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows || '<tr><td colspan="5" class="empty-segment">등록된 세그먼트가 없습니다.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // 테이블 스크롤 설정 및 활성 세그먼트 추적
    requestAnimationFrame(() => {
      const wrapper = roomInfoCard.querySelector('.workout-table-wrapper');
      const rows = Array.from(wrapper?.querySelectorAll('tbody tr') || []);
      if (!wrapper || rows.length === 0) return;

      // 훈련 시작 전 스크롤 위치 보존을 위한 저장소 키
      const scrollStorageKey = `workoutTableScroll_${getCurrentRoomCode(room) || 'default'}`;
      
      // 저장된 스크롤 위치 읽기 (sessionStorage)
      let savedScrollTop = null;
      try {
        const saved = sessionStorage.getItem(scrollStorageKey);
        if (saved !== null) {
          savedScrollTop = Number(saved);
        }
      } catch (e) {
        console.warn('스크롤 위치 저장소 읽기 실패:', e);
      }

      // 스크롤바 깜빡임 방지: 고정 높이 설정 (변경하지 않음)
      const maxVisible = Math.min(3, rows.length);
      if (rows.length > maxVisible) {
        const rowHeight = rows[0].offsetHeight || 0;
        // 최초 1회만 설정하고 이후에는 변경하지 않음
        if (!wrapper.dataset.heightSet) {
          wrapper.style.maxHeight = `${rowHeight * maxVisible + 4}px`;
          wrapper.style.minHeight = `${rowHeight * maxVisible + 4}px`;
          wrapper.dataset.heightSet = 'true';
        }
      } else {
        // 행이 적어도 최소 높이 유지 (스크롤바 깜빡임 방지)
        if (!wrapper.dataset.heightSet) {
          const defaultHeight = 150; // 기본 높이
          wrapper.style.maxHeight = `${defaultHeight}px`;
          wrapper.style.minHeight = `${defaultHeight}px`;
          wrapper.dataset.heightSet = 'true';
        }
      }

      // 스크롤 위치 복원 (우선순위: 보존된 스크롤 > 저장된 스크롤 > 현재 세그먼트 기준)
      if (isTrainingStarted && currentIdx >= 0) {
        const lastAutoScrollIndex = Number(wrapper.dataset.lastAutoScrollIndex ?? '-1');
        const activeRow = wrapper.querySelector('tbody tr.active');

        if (activeRow && lastAutoScrollIndex !== currentIdx) {
          const rowTop = activeRow.offsetTop;
          const wrapperHeight = wrapper.clientHeight;
          const rowHeight = activeRow.offsetHeight;

          const targetScroll = Math.max(0, rowTop - (wrapperHeight / 2) + (rowHeight / 2));
          wrapper.scrollTop = targetScroll;
          wrapper.dataset.lastAutoScrollIndex = String(currentIdx);
        }

        const existingHandler = wrapper._scrollHandler;
        if (existingHandler) {
          wrapper.removeEventListener('scroll', existingHandler);
          delete wrapper._scrollHandler;
        }
      } else {
        wrapper.dataset.lastAutoScrollIndex = '-1';
        // 훈련 시작 전: 사용자가 스크롤한 위치 유지 (자동 복귀 없음)
        // 우선순위: 보존된 스크롤 > 저장된 스크롤 > 상단
        if (preservedScrollTop !== null && preservedScrollTop > 0) {
          wrapper.scrollTop = preservedScrollTop;
        } else if (savedScrollTop !== null && savedScrollTop > 0) {
          wrapper.scrollTop = savedScrollTop;
        }
        // 둘 다 없으면 스크롤 위치 변경하지 않음 (상단 유지)
      }

      // 사용자 스크롤 이벤트 감지하여 위치 저장 (훈련 시작 전에만)
      if (!isTrainingStarted) {
        // 기존 이벤트 리스너 제거 (중복 방지)
        const existingHandler = wrapper._scrollHandler;
        if (existingHandler) {
          wrapper.removeEventListener('scroll', existingHandler);
        }

        // 새로운 스크롤 핸들러 생성
        const handleScroll = () => {
          const scrollTop = wrapper.scrollTop;
          try {
            sessionStorage.setItem(scrollStorageKey, String(scrollTop));
          } catch (e) {
            console.warn('스크롤 위치 저장 실패:', e);
          }
        };

        // 핸들러 저장 및 이벤트 등록
        wrapper._scrollHandler = handleScroll;
        wrapper.addEventListener('scroll', handleScroll, { passive: true });
      }

      setupSegmentActiveOverlay(wrapper, isTrainingStarted && currentIdx >= 0);
    });
    
    // 시계 요소 복원 또는 시작
    if (clockPreserved && clockElement) {
      // 보존된 시계 요소 복원
      const newClockContainer = roomInfoCard.querySelector('#groupTrainingClock');
      if (newClockContainer && clockElement) {
        newClockContainer.innerHTML = clockElement.innerHTML;
        // 시계 업데이트만 수행 (리셋 방지)
        const syncedTime = getSyncedTime();
        updateClockSimple(newClockContainer, syncedTime);
      }
    } else {
      // 시계 시작 (요소가 생성된 후)
      setTimeout(() => {
        startClock();
      }, 100);
    }
  } catch (error) {
    console.warn('renderWaitingHeaderSegmentTable 오류:', error);
  }
}

function setupSegmentActiveOverlay(wrapper, shouldShowOverlay) {
  if (!wrapper) return;

  const handlerKey = '_segmentOverlayScrollHandler';
  const overlayClassName = 'segment-active-overlay';

  if (wrapper[handlerKey]) {
    wrapper.removeEventListener('scroll', wrapper[handlerKey]);
    wrapper[handlerKey] = null;
  }

  let overlay = wrapper.querySelector(`.${overlayClassName}`);

  if (!shouldShowOverlay) {
    if (overlay) {
      overlay.remove();
    }
    return;
  }

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = overlayClassName;
    wrapper.appendChild(overlay);
  }

  const syncOverlayPosition = () => {
    if (!overlay || !overlay.isConnected) return;
    const activeRow = wrapper.querySelector('tbody tr.active');
    if (!activeRow) {
      overlay.style.opacity = '0';
      return;
    }

    const rowHeight = activeRow.offsetHeight || 0;
    if (rowHeight <= 0) {
      overlay.style.opacity = '0';
      return;
    }

    const relativeTop = activeRow.offsetTop - wrapper.scrollTop;
    overlay.style.opacity = '1';
    overlay.style.transform = `translateY(${relativeTop}px)`;
    overlay.style.height = `${rowHeight}px`;
  };

  const handleScroll = () => syncOverlayPosition();
  wrapper[handlerKey] = handleScroll;
  wrapper.addEventListener('scroll', handleScroll, { passive: true });

  requestAnimationFrame(syncOverlayPosition);
}

/**
 * 백엔드에 방 데이터 업데이트 (임시 구현)
 */
async function updateRoomOnBackend(roomData) {
  if (!roomData || !roomData.code) {
    console.warn('updateRoomOnBackend: roomData.code가 필요합니다');
    return false;
  }

  try {
    const payload = {
      roomName: roomData.name || roomData.roomName || '',
      maxParticipants: roomData.maxParticipants,
      workoutId: roomData.workoutId || roomData.workoutID || '',
      status: roomData.status,
      participants: roomData.participants || [],
      settings: roomData.settings || {}
    };

    const result = await apiUpdateRoom(roomData.code, payload);
    return !!(result && result.success);
  } catch (error) {
    console.error('updateRoomOnBackend 실패:', error);
    return false;
  }
}



   
/**
 * 시작 버튼 상태 업데이트
 * 준비완료 상태를 기준으로 훈련 시작 가능 여부 판단 (관리자/일반 사용자 구분 없음)
 */
function updateStartButtonState() {
  const legacyStartBtn = document.getElementById('startGroupTrainingBtn');
  const groupControlBar = document.getElementById('groupTrainingControlBar');
  const groupToggleBtn = document.getElementById('groupToggleTrainingBtn');
  
  // 관리자 권한 확인
  const currentUser = window.currentUser || {};
  const isAdminUser = groupTrainingState.isAdmin || 
                     currentUser.grade === '1' || 
                     currentUser.grade === 1 ||
                     (typeof getViewerGrade === 'function' && getViewerGrade() === '1');
  
  if (!isAdminUser) {
    if (legacyStartBtn) {
      legacyStartBtn.style.display = 'none';
    }
    if (groupControlBar) {
      groupControlBar.classList.add('hidden');
    }
    return;
  }
  
  // 관리자인 경우 제어 바 표시
  if (groupControlBar) {
    groupControlBar.classList.remove('hidden');
  }
  
  if (legacyStartBtn) {
    legacyStartBtn.style.display = '';
  }
  
  const room = groupTrainingState.currentRoom;
  if (!room || !Array.isArray(room.participants)) {
    if (legacyStartBtn) {
      legacyStartBtn.disabled = true;
      legacyStartBtn.textContent = '⏳ 방 정보 로딩 중...';
      legacyStartBtn.title = '';
    }
    if (groupToggleBtn) {
      groupToggleBtn.disabled = true;
    }
    return;
  }
  
  // 준비완료 상태 기준으로 훈련 시작 가능 여부 판단
  const totalParticipants = room.participants.length;
  const readyCount = countReadyParticipants(room.participants);
  const hasParticipants = totalParticipants >= 1; // 최소 1명 이상
  const hasReadyParticipants = readyCount >= 1; // 최소 1명 이상 준비완료
  const canStart = hasParticipants && hasReadyParticipants;
  
  // 훈련 상태 확인
  const ts = window.trainingState || {};
  const isRunning = !!ts.isRunning;
  const isPaused = !!ts.paused;
  
  if (legacyStartBtn) {
    legacyStartBtn.disabled = !canStart || (isRunning && !isPaused);
    if (isRunning && !isPaused) {
      legacyStartBtn.style.display = 'none';
    } else {
      legacyStartBtn.style.display = '';
      legacyStartBtn.textContent = canStart
        ? `🚀 그룹 훈련 시작 (${readyCount}/${totalParticipants}명 준비완료)`
        : `👥 참가자 대기 중 (준비완료: ${readyCount}/${totalParticipants}명)`;
      legacyStartBtn.title = canStart
        ? `${readyCount}/${totalParticipants}명 준비완료 - 훈련 시작 가능`
        : `준비완료된 참가자가 필요합니다 (현재: ${readyCount}명)`;
    }
  }
  
  // 그룹 훈련 제어 바 버튼 상태 업데이트
  const skipBtn = document.getElementById('groupSkipSegmentBtn');
  const stopBtn = document.getElementById('groupStopTrainingBtn');
  
  if (groupToggleBtn) {
    if (isRunning) {
      groupToggleBtn.disabled = false;
      groupToggleBtn.classList.remove('play');
      groupToggleBtn.classList.add(isPaused ? 'play' : 'pause');
      groupToggleBtn.setAttribute('aria-label', isPaused ? '훈련 재개' : '훈련 일시정지');
    } else {
      groupToggleBtn.disabled = !canStart;
      groupToggleBtn.classList.remove('pause');
      groupToggleBtn.classList.add('play');
      groupToggleBtn.setAttribute('aria-label', canStart ? '훈련 시작' : '준비완료된 참가자 필요');
      groupToggleBtn.title = canStart
        ? `${readyCount}/${totalParticipants}명 준비완료 - 훈련 시작 가능`
        : `준비완료된 참가자가 필요합니다 (현재: ${readyCount}명)`;
    }
  }
  
  // 건너뛰기 버튼 상태 업데이트
  if (skipBtn) {
    skipBtn.disabled = !isRunning;
    skipBtn.title = isRunning ? '현재 세그먼트 건너뛰기' : '훈련이 시작되면 활성화됩니다';
  }
  
  // 종료 버튼 상태 업데이트
  if (stopBtn) {
    stopBtn.disabled = !isRunning;
    stopBtn.title = isRunning ? '훈련을 강제 종료합니다' : '훈련이 시작되면 활성화됩니다';
  }
}

/**
 * 워크아웃 정보 로드
 */
async function loadWorkoutInfo(workoutId) {
  try {
    if (typeof getWorkout === 'function') {
      const workout = await getWorkout(workoutId);
      const workoutEl = safeGet('currentRoomWorkout');
      if (workoutEl && workout) {
        workoutEl.textContent = workout.title;
      }
    }
  } catch (error) {
    console.error('Failed to load workout info:', error);
  }
}

// ========== 실시간 동기화 ==========

/**
 * 방 실시간 동기화 시작
 */
function startRoomSync() {
  if (groupTrainingState.syncInterval) {
    clearInterval(groupTrainingState.syncInterval);
  }
  
  groupTrainingState.syncInterval = setInterval(syncRoomData, 3000); // 3초마다
  groupTrainingState.isConnected = true;
}

/**
 * 방 실시간 동기화 중지
 */
function stopRoomSync() {
  if (groupTrainingState.syncInterval) {
    clearInterval(groupTrainingState.syncInterval);
    groupTrainingState.syncInterval = null;
  }
  
  // 훈련 시작 시간 체크 인터벌 정리
  if (trainingStartCheckInterval) {
    clearInterval(trainingStartCheckInterval);
    trainingStartCheckInterval = null;
  }
  countdownStarted = false;
  
  groupTrainingState.isConnected = false;
}

/**
 * 방 나가기 (조용히 - API 호출 실패 무시)
 */
async function leaveGroupRoomSilently() {
  try {
    // 동기화 인터벌 정리
    stopRoomSync();
    // 메트릭 인터벌 정리
    if (window.participantMetricsUpdateInterval) {
      clearInterval(window.participantMetricsUpdateInterval);
      window.participantMetricsUpdateInterval = null;
    }
    
    // 관리자 인터벌 정리
    if (groupTrainingState.managerInterval) {
      clearInterval(groupTrainingState.managerInterval);
      groupTrainingState.managerInterval = null;
    }
    
    // 훈련 시작 신호 확인 인터벌 정리
    if (window.trainingStartCheckInterval) {
      clearInterval(window.trainingStartCheckInterval);
      window.trainingStartCheckInterval = null;
    }
    
    // 방에서 참가자 제거 시도 (실패해도 무시)
    if (groupTrainingState.roomCode) {
      try {
        const userId = window.currentUser?.id || 'unknown';
        await apiLeaveRoom(groupTrainingState.roomCode, userId);
      } catch (error) {
        // 조용히 실패 처리
        console.log('방 나가기 API 호출 실패 (무시):', error.message);
      }
    }
    
    // 상태 초기화
    groupTrainingState.currentRoom = null;
    groupTrainingState.roomCode = null;
    groupTrainingState.isAdmin = false;
    groupTrainingState.isManager = false;
    
    // 화면 전환
    if (typeof showScreen === 'function') {
      showScreen('groupTrainingScreen');
    }
    
  } catch (error) {
    console.error('leaveGroupRoomSilently 오류:', error);
  }
}

/**
 * 방 데이터 동기화
 */
// 네트워크 오류 카운터 (연속 실패 추적)
let networkErrorCount = 0;
const MAX_NETWORK_ERRORS = 10; // 연속 10번 실패하면 동기화만 중지 (사용자는 방에 남음)

async function syncRoomData() {
  if (!groupTrainingState.roomCode) {
    // 방 코드가 없으면 동기화 중지
    stopRoomSync();
    return;
  }
  
  try {
    const latestRoom = await getRoomByCode(groupTrainingState.roomCode);
    
    // 성공적으로 방 정보를 가져온 경우 오류 카운터 리셋
    if (latestRoom && !latestRoom.__roomDeleted) {
      normalizeRoomParticipantsInPlace(latestRoom);
      networkErrorCount = 0;

      // 참가자 라이브 데이터 조회 후 병합(모든 참가자의 화면에 실시간 반영)
      let mergedRoom = latestRoom;
      try {
        if (typeof apiGetParticipantsLiveData === 'function') {
          const liveRes = await apiGetParticipantsLiveData(groupTrainingState.roomCode);
          const liveItems = Array.isArray(liveRes?.items) ? liveRes.items : [];
          
          // 디버깅: 라이브 데이터 수신 확인
          if (liveItems.length > 0) {
            console.log(`📊 라이브 데이터 수신: ${liveItems.length}명의 참가자 데이터`, liveItems);
          }
          
          if (Array.isArray(mergedRoom.participants) && liveItems.length > 0) {
            const idOf = (p) => String(p.id || p.participantId || p.userId || '');
            const liveById = {};
            liveItems.forEach(item => {
              const pid = String(item.participantId || item.id || item.userId || '');
              if (!pid) return;
              liveById[pid] = item;
            });
            mergedRoom.participants = mergedRoom.participants.map(p => {
              const pid = idOf(p);
              const live = liveById[pid];
              if (!live) return p;
              const liveData = expandLiveParticipantData(live);
              const originalReadyValue = parseBooleanLike(p.ready ?? p.isReady);
              
              // 블루투스 상태 병합 (다양한 필드명 지원)
              const bluetoothStatus = liveData.bluetoothStatus || {
                trainer: !!(liveData.trainerConnected || liveData.trainer || liveData.trainer_on),
                powerMeter: !!(liveData.powerMeterConnected || liveData.powerConnected || liveData.powerMeter || liveData.power || liveData.power_on || liveData.powerMeter_on),
                heartRate: !!(liveData.heartRateConnected || liveData.hrConnected || liveData.heartRate || liveData.hr || liveData.hr_on || liveData.bpm_on)
              };
              
              // 메트릭 병합 (다양한 필드명 지원)
              const metrics = {
                segmentTargetPowerW: liveData.segmentTargetPowerW ?? liveData.targetPowerW ?? liveData.segmentTargetPower ?? null,
                segmentAvgPowerW: liveData.segmentAvgPowerW ?? liveData.segmentAvgPower ?? null,
                currentPower: liveData.power ?? liveData.currentPowerW ?? liveData.currentPower ?? liveData.instantPower ?? null,
                avgPower: liveData.avgPower ?? liveData.overallAvgPowerW ?? liveData.averagePower ?? liveData.avgPowerW ?? null,
                heartRate: liveData.heartRate ?? liveData.hr ?? liveData.bpm ?? null,
                cadence: liveData.cadence ?? liveData.rpm ?? null,
                progress: liveData.progress ?? null,
                segmentIndex: liveData.segmentIndex ?? null
              };
              
              const resolveLiveReady = () => {
                // LiveData 시트의 sts 칼럼이 "ready"인지 확인 (최우선순위)
                if (liveData.sts && String(liveData.sts).toLowerCase().trim() === 'ready') {
                  return true;
                }
                
                // 기존 필드들도 확인 (하위 호환성)
                const candidates = [
                  liveData.ready,
                  liveData.isReady,
                  liveData.readyState,
                  liveData.ready_status,
                  liveData.readyFlag,
                  liveData.readyValue,
                  liveData.ready_value,
                  liveData.readyDeviceConnected,
                  liveData.readyDevice
                ];
                for (const candidate of candidates) {
                  const parsed = parseBooleanLike(candidate);
                  if (parsed !== undefined) {
                    return parsed;
                  }
                }
                return undefined;
              };
              
              const liveReady = resolveLiveReady();
              const liveReadyTimestamp = liveData.readyUpdatedAt || liveData.readyUpdated || liveData.ready_at || liveData.readyTimestamp || liveData.timestamp || null;
              const liveReadyTimeMs = liveReadyTimestamp ? Date.parse(liveReadyTimestamp) : null;
              const existingReadyTimeMs = p.readyUpdatedAt ? Date.parse(p.readyUpdatedAt) : null;
              const currentReady = parseBooleanLike(p.ready ?? p.isReady);

              const mergedParticipant = {
                ...p,
                bluetoothStatus,
                metrics,
                // 호환성을 위한 별칭 필드도 유지
                live: metrics,
                liveData: metrics
              };
              
              // 디버깅: 병합된 참가자 데이터 확인
              if (bluetoothStatus.trainer || bluetoothStatus.powerMeter || bluetoothStatus.heartRate) {
                console.log(`🔌 참가자 ${p.name} (${pid}) 블루투스 상태 병합:`, bluetoothStatus);
              }
              
              if (liveReady !== undefined) {
                const shouldApplyLiveReady = (
                  currentReady === undefined ||
                  currentReady === null ||
                  liveReady ||
                  (liveReadyTimeMs !== null && (!existingReadyTimeMs || liveReadyTimeMs >= existingReadyTimeMs))
                );
                
                if (shouldApplyLiveReady) {
                  mergedParticipant.ready = !!liveReady;
                  mergedParticipant.isReady = !!liveReady;
                  mergedParticipant.readyUpdatedAt = liveReadyTimestamp || mergedParticipant.readyUpdatedAt || liveData.timestamp || new Date().toISOString();
                  mergedParticipant.readySource = liveData.readySource || mergedParticipant.readySource || 'live';
                  mergedParticipant.readyDeterminedBy = liveData.readyDeterminedBy || mergedParticipant.readyDeterminedBy || 'live-data';
                  mergedParticipant.readyBroadcastedAt = liveData.readyBroadcastedAt || mergedParticipant.readyBroadcastedAt || null;

                  if (originalReadyValue !== mergedParticipant.ready) {
                    queueReadyStatePersist(pid, mergedParticipant.ready);
                  }
                }
              } else if (liveData.readyDeviceConnected !== undefined) {
                mergedParticipant.readyDeviceConnected = !!liveData.readyDeviceConnected;
              }
              
              return mergedParticipant;
            });
          }
        }
      } catch (mergeErr) {
        console.warn('라이브 데이터 병합 오류:', mergeErr?.message || mergeErr);
      }

      // 준비 상태 동기화: 서버 데이터를 우선 적용하되, 로컬 오버라이드가 있으면 확인
      // 서버에서 준비 상태가 제대로 저장되었는지 확인한 후에만 오버라이드 제거
      if (Array.isArray(mergedRoom.participants) && groupTrainingState.readyOverrides) {
        mergedRoom.participants = mergedRoom.participants.map(p => {
          const participantId = getParticipantIdentifier(p);
          if (!participantId) return p;
          const override = getReadyOverride(participantId);
          const rawReady = getRawReadyValue(p);
          
          // 서버에서 준비 상태가 있는 경우 서버 데이터를 우선 적용
          if (rawReady !== undefined && rawReady !== null) {
            // 서버 상태와 로컬 오버라이드가 일치하면 오버라이드 제거 (동기화 완료)
            if (override && rawReady === override.ready) {
              clearReadyOverride(participantId);
            }
            // 서버 데이터를 우선 적용 (ready와 isReady 모두 업데이트)
            return { ...p, ready: !!rawReady, isReady: !!rawReady };
          }
          
          // 서버에 준비 상태가 없고 로컬 오버라이드가 있으면 오버라이드 적용
          if (override) {
            return { ...p, ready: override.ready, isReady: override.ready };
          }
          
          // 둘 다 없으면 기본값 false
          return { ...p, ready: false, isReady: false };
        });
      } else if (Array.isArray(mergedRoom.participants)) {
        // 오버라이드가 없어도 서버 데이터의 ready 상태를 명시적으로 설정
        mergedRoom.participants = mergedRoom.participants.map(p => {
          const rawReady = getRawReadyValue(p);
          if (rawReady !== undefined && rawReady !== null) {
            return { ...p, ready: !!rawReady, isReady: !!rawReady };
          }
          return { ...p, ready: false, isReady: false };
        });
      }

      const previousRoomState = groupTrainingState.currentRoom;
      const previousStatus = previousRoomState?.status || previousRoomState?.Status || 'waiting';

      // 방 상태가 변경되었는지 확인
      const hasChanges = JSON.stringify(mergedRoom) !== JSON.stringify(previousRoomState);

      const timelineSnapshot = updateTimelineSnapshot(mergedRoom);
      syncMonitoringLoopWithSnapshot(timelineSnapshot);

      if (hasChanges) {
        groupTrainingState.currentRoom = mergedRoom;
        
        // 참가자 오디오 청크 확인 및 재생 (관리자가 아닌 경우)
        if (!groupTrainingState.isAdmin && participantAudioState.isListening) {
          checkAndPlayAudioChunkFromRoom(mergedRoom);
        }
        
        updateParticipantsList();
        
        if (window.groupTrainingHooks?.updateRoom) {
          window.groupTrainingHooks.updateRoom({
            ...mergedRoom,
            code: groupTrainingState.roomCode,
            isAdmin: !!groupTrainingState.isAdmin
          });
        }

        // 카운트다운/훈련 시작 상태 체크
        const roomStatus = mergedRoom.status || mergedRoom.Status || 'waiting';
        const countdownEndTime = mergedRoom.countdownEndTime || mergedRoom.CountdownEndTime;
        const wasStarting = previousStatus === 'starting';
        const isStarting = roomStatus === 'starting';
        
        // 참가자가 카운트다운 시작 신호를 감지한 경우 (중복 실행 방지)
        // 관리자가 이미 카운트다운을 시작한 경우는 제외 (중복 방지)
        if (isStarting && !wasStarting) {
          // 관리자가 이미 카운트다운을 시작한 경우는 서버 상태 변경으로 인한 중복 카운트다운 방지
          if (groupTrainingState.isAdmin && groupTrainingState.adminCountdownInitiated) {
            console.log('📢 관리자가 이미 카운트다운을 시작했으므로 중복 카운트다운 방지');
            // 관리자 카운트다운 플래그는 카운트다운이 완료되면 리셋됨 (showGroupCountdownOverlay 내부에서 처리)
          } else {
            // 참가자는 항상 카운트다운을 볼 수 있어야 함 (준비완료 상태와 관계없이)
            // 관리자가 카운트다운을 시작했다는 것은 훈련이 시작된다는 의미이므로
            console.log('📢 훈련 시작 카운트다운 감지됨 (모든 참가자)');
            
            // 카운트다운 종료 시간이 있으면 그 시간을 기준으로 카운트다운
            if (countdownEndTime) {
              const endTime = new Date(countdownEndTime).getTime();
              const now = Date.now();
              const remainingMs = Math.max(0, endTime - now);
              const remainingSeconds = Math.ceil(remainingMs / 1000);
              
              if (remainingSeconds > 0) {
                console.log(`⏱️ 카운트다운 시작: ${remainingSeconds}초 남음 (모든 참가자)`);
                // 모든 참가자 화면에 카운트다운 표시 (중복 방지를 위해 플래그 설정)
                if (!groupTrainingState.countdownStarted) {
                  groupTrainingState.countdownStarted = true;
                  Promise.resolve(triggerCountdownOverlay({
                    seconds: remainingSeconds,
                    targetEndTime: countdownEndTime
                  }))
                    .catch(err => console.warn('카운트다운 표시 실패:', err))
                    .finally(() => {
                      groupTrainingState.countdownStarted = false;
                    });
                }
              } else {
                // 카운트다운이 이미 끝났으면 바로 훈련 시작
                console.log('⏱️ 카운트다운 이미 종료됨, 즉시 훈련 시작');
                if (!groupTrainingState.countdownStarted) {
                  // 준비완료 상태와 관계없이 훈련 화면으로 전환
                  startLocalGroupTraining();
                }
              }
            } else {
              // 카운트다운 종료 시간이 없으면 기본 카운트다운
              console.log(`⏱️ 카운트다운 시작 (기본 ${GROUP_COUNTDOWN_SECONDS}초, 모든 참가자)`);
              if (!groupTrainingState.countdownStarted) {
                groupTrainingState.countdownStarted = true;
                Promise.resolve(triggerCountdownOverlay(GROUP_COUNTDOWN_SECONDS))
                  .catch(err => console.warn('카운트다운 표시 실패:', err))
                  .finally(() => {
                    groupTrainingState.countdownStarted = false;
                  });
              }
            }
          }
        
        // 훈련 상태 체크 (카운트다운 후)
        if (roomStatus === 'training') {
          const ts = window.trainingState || {};
          const currentUser = window.currentUser || {};
          const isAdminUser = groupTrainingState.isAdmin || 
                             currentUser.grade === '1' || 
                             currentUser.grade === 1 ||
                             (typeof getViewerGrade === 'function' && getViewerGrade() === '1');
          
          // 카운트다운이 완료되어 상태가 'training'으로 변경되었다는 것은
          // 관리자가 훈련을 시작했다는 의미이므로, 준비완료 상태와 관계없이
          // 일반 참가자는 훈련 화면으로 전환되어야 함
          if (!ts.isRunning) {
            const canAutoStart = shouldAutoStartLocalTraining();
            
            // 관리자가 모니터링 모드인 경우에만 모니터링 모드로 유지
            // 일반 참가자 또는 준비완료된 관리자는 훈련 화면으로 전환
            if (isAdminUser && !canAutoStart) {
              // 관리자 모니터링 모드 - 모니터링 모드 유지
              console.log('관리자 모니터링 모드 - 모니터링 모드 유지 (대기실 화면 유지)');
              showWaitingScreen();
            } else {
              // 일반 참가자 또는 준비완료된 관리자 - 훈련 화면으로 전환
              console.log('📢 훈련 시작 신호 감지됨 - 훈련 화면으로 전환');
              if (typeof startGroupTrainingSession === 'function') {
                startGroupTrainingSession();
              } else {
                startLocalGroupTraining();
              }
            }
          }
          
          const trainingStartTime = mergedRoom.trainingStartTime || mergedRoom.TrainingStartTime || mergedRoom.startedAt;
          synchronizeTrainingClock(trainingStartTime);
        } else if (roomStatus === 'waiting') {
          groupTrainingState.trainingStartSignaled = false;
        }
      } else {
        // 구조 변경이 없어도 라이브 데이터가 갱신될 수 있으므로 상태에 병합된 참가자만 반영하고 UI 갱신
        // 항상 UI를 갱신하여 실시간 데이터 반영 (블루투스 상태, 메트릭 등)
        if (groupTrainingState.currentRoom && mergedRoom?.participants) {
          groupTrainingState.currentRoom.participants = mergedRoom.participants;
          updateParticipantsList(); // 강제 UI 갱신
        } else if (mergedRoom?.participants) {
          // currentRoom이 없어도 participants만 있으면 UI 갱신
          if (!groupTrainingState.currentRoom) {
            groupTrainingState.currentRoom = mergedRoom;
          } else {
            groupTrainingState.currentRoom.participants = mergedRoom.participants;
          }
          updateParticipantsList();
        }
      }

      if (timelineSnapshot && timelineSnapshot.phase === 'training') {
        applyTimelineSnapshotToTrainingState(timelineSnapshot);
      }

      groupTrainingState.lastSyncTime = new Date();
    }
    
    // latestRoom이 삭제되었거나 null인 경우 처리
    if (latestRoom && latestRoom.__roomDeleted) {
      // 방이 실제로 삭제됨 → 동기화 중지 및 조용히 방 나가기
      networkErrorCount = 0;
      console.log('⚠️ 방이 삭제되었습니다. 동기화를 중지하고 방에서 나갑니다.');
      stopRoomSync();
      showToast('방이 삭제되었거나 찾을 수 없습니다', 'error');
      await leaveGroupRoomSilently();
      return;
    }
    
    if (!latestRoom) {
      // latestRoom이 null: 일시적/알 수 없는 오류 → 강제 퇴장 없이 다음 주기로 재시도
      console.warn('⚠️ 방 정보를 일시적으로 가져오지 못했습니다. 다음 동기화에서 재시도합니다.');
      return;
    }
  }

  } catch (error) {
    // 네트워크 오류인 경우
    if (error.message === 'NETWORK_ERROR' || error.message?.includes('네트워크')) {
      networkErrorCount++;
      console.warn(`⚠️ 네트워크 오류 발생 (${networkErrorCount}/${MAX_NETWORK_ERRORS}), 다음 동기화에서 재시도`);
      
      // 연속으로 여러 번 실패한 경우에도 사용자를 강제로 나가게 하지 않음
      // 단지 동기화만 중지하고 사용자는 방에 남아있도록 함
      if (networkErrorCount >= MAX_NETWORK_ERRORS) {
        console.error('❌ 네트워크 오류가 계속 발생합니다. 동기화를 중지합니다.');
        stopRoomSync();
        // 사용자에게 알림만 표시하고 방에서 나가게 하지 않음
        showToast('네트워크 연결이 불안정합니다. 연결이 복구되면 자동으로 재연결됩니다.', 'warning');
        // 사용자를 강제로 나가게 하지 않고, 동기화만 중지
        // 사용자는 방에 남아있고, 수동으로 나갈 수 있음
        // 네트워크가 복구되면 수동으로 동기화 재시작 가능
        return;
      }
      
      // 네트워크 오류는 일시적일 수 있으므로 계속 시도
      // 사용자에게 알림은 표시하지 않음 (너무 많은 알림 방지)
      // 조용히 재시도만 진행
      return;
    }
    
    // 기타 오류 (예상치 못한 오류)
    console.error('방 동기화 오류:', error);
    networkErrorCount = 0; // 네트워크 오류가 아니면 카운터 리셋
    // 예상치 못한 오류는 사용자에게 알림하지 않고 조용히 처리
    // 다음 동기화에서 재시도
  }
}



/**
 * 그룹 훈련방 나가기
 */
async function leaveGroupRoom() {
  try {
    console.log('🚪 그룹 훈련방에서 나가는 중...');
    
    // 동기화 인터벌 정리 (먼저 정리하여 중복 호출 방지)
    stopRoomSync();
    // 메트릭 인터벌 정리
    if (window.participantMetricsUpdateInterval) {
      clearInterval(window.participantMetricsUpdateInterval);
      window.participantMetricsUpdateInterval = null;
    }
    
    // 관리자 인터벌 정리
    if (groupTrainingState.managerInterval) {
      clearInterval(groupTrainingState.managerInterval);
      groupTrainingState.managerInterval = null;
    }

    stopMonitoringTimelineLoop();
    
    // 훈련 시작 신호 확인 인터벌 정리
    if (window.trainingStartCheckInterval) {
      clearInterval(window.trainingStartCheckInterval);
      window.trainingStartCheckInterval = null;
    }
    
    // 방에서 참가자 제거 (백엔드 업데이트)
    if (groupTrainingState.currentRoom && groupTrainingState.roomCode) {
      try {
        const userId = window.currentUser?.id || 'unknown';
        await apiLeaveRoom(groupTrainingState.roomCode, userId);
        console.log('✅ 방에서 성공적으로 나갔습니다');
      } catch (error) {
        console.error('❌ 방 나가기 중 백엔드 업데이트 실패:', error);
        // API 호출 실패는 무시하고 계속 진행
      }
    }
    
    // 상태 초기화
    groupTrainingState.currentRoom = null;
    groupTrainingState.roomCode = null;
    groupTrainingState.isAdmin = false;
    groupTrainingState.isManager = false;
    groupTrainingState.participants = [];
    groupTrainingState.isConnected = false;
    groupTrainingState.lastSyncTime = null;
    
    if (window.groupTrainingHooks?.endSession) {
      window.groupTrainingHooks.endSession();
    }
    
    // 화면 전환
    if (typeof showScreen === 'function') {
      showScreen('trainingModeScreen');
    } else {
      // 대체 방법: 그룹 화면들 숨기기
      const groupScreens = ['groupWaitingScreen', 'groupTrainingScreen'];
      groupScreens.forEach(screenId => {
        const screen = document.getElementById(screenId);
        if (screen) {
          screen.classList.add('hidden');
        }
      });
    }
    
    showToast('그룹 훈련방에서 나왔습니다', 'info');
    
  } catch (error) {
    console.error('❌ 방 나가기 중 오류:', error);
    showToast('방 나가기 중 오류가 발생했습니다', 'error');
  }
}




   
// 다음 블록에서 계속...

// ========== 내보내기 ==========
// 전역 함수들을 window 객체에 등록
window.selectTrainingMode = selectTrainingMode;
window.selectGroupMode = selectGroupMode;
window.selectRole = selectRole;
window.createGroupRoom = createGroupRoom;
window.joinGroupRoom = joinGroupRoom;
// leaveGroupRoom은 groupTrainingManager_part2.js에서 최종 등록됨
// window.leaveGroupRoom = leaveGroupRoom; // 주석 처리 - part2에서 등록

console.log('✅ Group Training Manager loaded');



// ========== 훈련방 관리자 기능들 (grade=1 전용) ==========

// 관리자 대시보드 초기화


async function initializeManagerDashboard() {
  console.log('Initializing manager dashboard');
  groupTrainingState.isManager = true;
  
  try {
    // 활성 훈련방 목록 로드
    await refreshActiveRooms();
    
    // 통계 업데이트
    await updateRoomStatistics();
    
    // 자동 새로고침 설정 (30초마다)
    if (groupTrainingState.managerInterval) {
      clearInterval(groupTrainingState.managerInterval);
    }
    
    groupTrainingState.managerInterval = setInterval(() => {
      if (groupTrainingState.isManager) {
        refreshActiveRooms();
        updateRoomStatistics();
      }
    }, 10000);
    
  } catch (error) {
    console.error('Failed to initialize manager dashboard:', error);
    showToast('관리자 대시보드 초기화에 실패했습니다', 'error');
  }
}

function stopManagerDashboardUpdates() {
  if (groupTrainingState.managerInterval) {
    clearInterval(groupTrainingState.managerInterval);
    groupTrainingState.managerInterval = null;
  }
  groupTrainingState.isManager = false;
}

/**
 * 활성 훈련방 목록 새로고침
 */
async function refreshActiveRooms() {
  const container = safeGet('activeRoomsList');
  if (!container) return;
  
  try {
    container.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <p>활성 훈련방을 불러오는 중...</p>
      </div>
    `;
    
    // 모든 상태의 방 목록 가져오기
    const allRooms = await getAllRoomsFromBackend();
    
    // 활성 방만 필터링 (waiting, training 상태)
    const activeRooms = allRooms.filter(room => {
      const status = (room.Status || room.status || '').toLowerCase();
      return status === 'waiting' || status === 'training';
    });
    
    if (activeRooms.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🏠</div>
          <div class="empty-state-title">활성 훈련방이 없습니다</div>
          <div class="empty-state-description">현재 진행 중인 훈련방이 없습니다</div>
        </div>
      `;
      return;
    }
    
    container.innerHTML = activeRooms.map(room => {
      const status = (room.Status || room.status || 'waiting').toLowerCase();
      const statusLabel = status === 'waiting'
        ? '⏳ 대기중'
        : status === 'training'
          ? '🟢 진행중'
          : '🔄 활성';
    normalizeRoomParticipantsInPlace(room);
    const participants = room.participants;
      const readyCount = participants.reduce((count, participant) => {
        return count + (isParticipantReady(participant) ? 1 : 0);
      }, 0);
      const participantTags = participants.length > 0
        ? participants.map(p => {
            const isReady = isParticipantReady(p);
            const name = escapeHtml(p.name || p.participantName || '이름 없음');
            const roleClass = p.role ? ` ${String(p.role).replace(/[^a-zA-Z0-9_-]/g, '')}` : '';
            const readinessClass = isReady ? ' ready' : ' waiting';
            const readinessIcon = isReady ? '🟢' : '⚪';
            const readinessLabel = isReady ? '준비 완료' : '대기 중';
            return `<span class="participant-tag${roleClass}${readinessClass}" title="${readinessLabel}">
              ${readinessIcon} ${name}
            </span>`;
          }).join('')
        : '<span class="empty-participants">참가자 없음</span>';

      return `
      <div class="active-room-card ${status}">
        <div class="room-header">
          <span class="room-name">${escapeHtml(room.Name || room.name || room.Code)}</span>
          <span class="room-status ${status}">
            ${statusLabel}
          </span>
        </div>
        
        <div class="room-details">
          <div><strong>방 코드:</strong> ${escapeHtml(room.Code)}</div>
          <div><strong>관리자:</strong> ${escapeHtml(room.AdminName || '미지정')}</div>
          <div><strong>참가자:</strong> ${participants.length}/${room.MaxParticipants || room.maxParticipants || '-'}명</div>
          <div><strong>준비 상태:</strong> ${readyCount}/${participants.length}명</div>
          <div class="room-created-at"><strong>생성시간:</strong> ${room.CreatedAt ? new Date(room.CreatedAt).toLocaleString() : '-'}</div>
        </div>
        
        <div class="room-participants">
          ${participantTags}
        </div>
        
        <div class="room-actions">
          <button class="room-action-btn monitor" onclick="monitorRoom('${room.Code}')">
            👁️ 모니터링
          </button>
          <button class="room-action-btn stop" onclick="forceStopRoom('${room.Code}')">
            🛑 강제 중단
          </button>
        </div>
      </div>`;
    }).join('');
    
  } catch (error) {
    console.error('Failed to refresh active rooms:', error);
    container.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">⚠️</div>
        <div class="error-state-title">활성 방 목록을 불러올 수 없습니다</div>
        <button class="retry-button" onclick="refreshActiveRooms()">다시 시도</button>
      </div>
    `;
  }
}

/**
 * 전체 방 목록 가져오기 (관리자용)
 */
async function getAllRoomsFromBackend() {
  try {
    const params = new URLSearchParams({
      action: 'listGroupRooms'
      // status 파라미터 없이 모든 방 조회
    });
    
    const scriptUrl = window.GAS_URL || window.APP_SCRIPT_URL || 'your-gas-deployment-url';
    const response = await fetch(`${scriptUrl}?${params.toString()}`);
    const result = await response.json();
    
    if (result.success) {
      const rooms = result.items || [];
      rooms.forEach(room => normalizeRoomParticipantsInPlace(room));
      return rooms;
    } else {
      console.error('Backend error:', result.error);
      return [];
    }
    
  } catch (error) {
    console.error('Failed to get all rooms from backend:', error);
    
    // Fallback: localStorage에서 조회
    try {
      const rooms = JSON.parse(localStorage.getItem('groupTrainingRooms') || '{}');
      return Object.values(rooms);
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError);
      return [];
    }
  }
}

/**
 * 훈련방 통계 업데이트
 */
async function updateRoomStatistics() {
  try {
    const allRooms = await getAllRoomsFromBackend();
    
    const totalRooms = allRooms.length;
    const activeRooms = allRooms.filter(r => r.Status === 'waiting' || r.Status === 'training').length;
    const trainingRooms = allRooms.filter(r => r.Status === 'training').length;
    const totalParticipants = allRooms.reduce((sum, room) => {
      const participants = normalizeParticipantsArray(room.ParticipantsData || room.participants || []);
      return sum + participants.length;
    }, 0);
    
    // UI 업데이트
    const totalEl = safeGet('totalRoomsCount');
    const activeEl = safeGet('activeRoomsCount');
    const participantsEl = safeGet('totalParticipantsCount');
    const trainingEl = safeGet('trainingRoomsCount');
    
    if (totalEl) totalEl.textContent = totalRooms;
    if (activeEl) activeEl.textContent = activeRooms;
    if (participantsEl) participantsEl.textContent = totalParticipants;
    if (trainingEl) trainingEl.textContent = trainingRooms;
    
  } catch (error) {
    console.error('Failed to update room statistics:', error);
  }
}

/**
 * 특정 방 모니터링
 */
async function monitorRoom(roomCode) {
  try {
    console.log('🎯 방 모니터링 시작:', roomCode);
    
    const room = await getRoomByCode(roomCode);
    if (!room) {
      showToast('방 정보를 찾을 수 없습니다', 'error');
      return;
    }
    
    // 방 데이터 정규화
    const normalizedRoom = normalizeRoomData(room);
    if (!normalizedRoom) {
      showToast('방 정보를 처리할 수 없습니다', 'error');
      return;
    }
    
    // 모니터링 모달 표시
    showRoomMonitoringModal(normalizedRoom, roomCode);
    
  } catch (error) {
    console.error('Failed to monitor room:', error);
    showToast('방 모니터링에 실패했습니다: ' + (error.message || '알 수 없는 오류'), 'error');
  }
}

/**
 * 방 모니터링 모달 표시
 */
function showRoomMonitoringModal(room, roomCode) {
  console.log('📊 모니터링 모달 표시:', room, roomCode);
  
  // 기존 모니터링 오버레이가 있으면 제거
  const existingOverlay = document.getElementById('roomMonitoringModal');
  if (existingOverlay) {
    existingOverlay.remove();
  }
  
  // 모니터링 모달 HTML 생성
  const modalHTML = `
    <div id="roomMonitoringModal" class="monitoring-modal">
      <div class="monitoring-modal-content">
        <div class="monitoring-modal-header">
          <div class="modal-header-info">
            <h2>🎯 방 모니터링</h2>
            <div class="room-info-summary">
              <span class="room-name">${escapeHtml(room.name || roomCode)}</span>
              <span class="room-code">코드: ${escapeHtml(roomCode)}</span>
            </div>
          </div>
          <button class="close-btn" onclick="closeRoomMonitoringModal()" title="닫기">✕</button>
        </div>
        
        <div class="monitoring-modal-body">
          <div class="room-status-section">
            <div class="status-item">
              <span class="status-label">상태:</span>
              <span class="status-value ${room.status}">
                ${room.status === 'waiting' ? '⏳ 대기중' : 
                  room.status === 'starting' ? '🚀 시작중' :
                  room.status === 'training' ? '🟢 훈련중' :
                  room.status === 'finished' ? '✅ 완료' :
                  room.status === 'closed' ? '🔴 종료' : '❓ 알 수 없음'}
              </span>
            </div>
            <div class="status-item">
              <span class="status-label">참가자:</span>
              <span class="status-value">${(room.participants || []).length}/${room.maxParticipants || 0}명</span>
            </div>
          </div>
          
          <div class="participants-monitoring-section">
            <h3>👥 참가자 모니터링</h3>
            <div id="roomMonitoringParticipantsList" class="monitoring-participants-list">
              ${renderMonitoringParticipants(room.participants || [])}
            </div>
          </div>
          
          ${room.status === 'waiting' || room.status === 'starting' ? `
          <div class="monitoring-controls-section">
            <h3>🚀 훈련 제어</h3>
            <div class="coaching-controls">
              <button class="btn btn-success" onclick="startTrainingFromMonitoring('${roomCode}')" id="startTrainingFromMonitoringBtn">
                🚀 훈련 시작
              </button>
              <button class="btn btn-secondary" onclick="refreshRoomMonitoring('${roomCode}')">
                🔄 새로고침
              </button>
            </div>
            <div class="training-requirements">
              <p class="requirements-text">
                <small>
                  ${countReadyParticipants(room.participants || [])}/${(room.participants || []).length}명 준비 완료
                </small>
              </p>
            </div>
          </div>
          ` : room.status === 'training' ? `
          <div class="monitoring-controls-section">
            <h3>🎤 코칭 제어</h3>
            <div class="coaching-controls">
              <button class="btn btn-primary" onclick="startRoomMonitoringCoaching('${roomCode}')">
                🎤 코칭 시작
              </button>
              <button class="btn btn-secondary" onclick="refreshRoomMonitoring('${roomCode}')">
                🔄 새로고침
              </button>
            </div>
          </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
  
  // 모달을 body에 추가
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  
  // 모달 표시
  const modal = document.getElementById('roomMonitoringModal');
  if (modal) {
    modal.style.display = 'flex';
    
    // 모달 배경 클릭 시 닫기
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeRoomMonitoringModal();
      }
    });
    
    // 주기적으로 참가자 목록 업데이트 (5초마다)
    if (window.roomMonitoringInterval) {
      clearInterval(window.roomMonitoringInterval);
    }
    
    window.roomMonitoringInterval = setInterval(async () => {
      await refreshRoomMonitoring(roomCode);
    }, 5000);
  }
  
  console.log('✅ 모니터링 모달 표시 완료');
}

/**
 * 모니터링 참가자 목록 렌더링
 */
function renderMonitoringParticipants(participants) {
  if (!participants || participants.length === 0) {
    return '<div class="empty-participants">참가자가 없습니다</div>';
  }
  
  // 현재 방 상태 확인 (훈련 중인지 여부)
  const room = groupTrainingState?.currentRoom || null;
  const isTraining = room?.status === 'training';
  
  return participants.map(p => {
    // 참가자 데이터 정규화
    const name = p.name || p.participantName || p.userName || '이름 없음';
    const id = p.id || p.participantId || '';
    const role = p.role || 'participant';
    const ready = isParticipantReady(p);
    
    // 상태에 따른 설명
    let statusText = '';
    let statusDescription = '';
    
    if (!ready) {
      // 비활성 상태: 준비 완료 버튼을 누르지 않은 상태
      statusText = '🔴 비활성';
      statusDescription = '대기 중 - 준비 완료 버튼을 누르지 않음';
    } else if (!isTraining) {
      // 준비 완료 상태: 준비는 했지만 훈련이 시작되지 않음
      statusText = '🟡 준비완료';
      statusDescription = '준비 완료 - 훈련 시작 대기 중';
    } else {
      // 활성 상태: 훈련 진행 중
      statusText = '🟢 활성';
      statusDescription = '훈련 진행 중';
    }
    
    // 실시간 데이터는 비동기로 가져오므로 여기서는 플레이스홀더 사용
    // 실제 데이터는 refreshRoomMonitoring에서 업데이트됨
    const liveData = {
      power: 0,
      heartRate: 0,
      cadence: 0,
      progress: 0
    };
    
    return `
      <div class="monitoring-participant-item" data-id="${id}">
        <div class="participant-header">
          <div class="participant-name-section">
            <span class="participant-name">${escapeHtml(name)}</span>
            <span class="participant-role-badge ${role}">
              ${role === 'admin' ? '🎯 관리자' : '🏃‍♂️ 참가자'}
            </span>
          </div>
          <span class="participant-status-indicator ${ready && isTraining ? 'ready' : 'not-ready'}" title="${statusDescription}">
            ${statusText}
          </span>
        </div>
        ${isTraining && ready ? `
        <div class="participant-metrics">
          <div class="metric-item">
            <span class="metric-label">파워</span>
            <span class="metric-value">${liveData.power || 0}W</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">심박</span>
            <span class="metric-value">${liveData.heartRate || 0}bpm</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">케이던스</span>
            <span class="metric-value">${liveData.cadence || 0}rpm</span>
          </div>
        </div>
        <div class="participant-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${liveData.progress || 0}%"></div>
          </div>
          <span class="progress-text">${liveData.progress || 0}% 완료</span>
        </div>
        ` : `
        <div class="participant-status-message">
          ${!ready ? 
            '<p class="status-info">⏳ 참가자가 준비 완료 버튼을 누르지 않았습니다.</p>' :
            '<p class="status-info">⏸️ 훈련이 시작되면 실시간 데이터가 표시됩니다.</p>'
          }
        </div>
        `}
      </div>
    `;
  }).join('');
}

/**
 * 방 모니터링 새로고침
 */
async function refreshRoomMonitoring(roomCode) {
  try {
    const room = await getRoomByCode(roomCode);
    if (!room) return;
    
    const normalizedRoom = normalizeRoomData(room);
    if (!normalizedRoom) return;
    
    // groupTrainingState에 방 정보 업데이트 (renderMonitoringParticipants에서 사용)
    if (window.groupTrainingState) {
      window.groupTrainingState.currentRoom = normalizedRoom;
    }
    
    // 훈련 중인 경우 참가자들의 실시간 데이터 가져오기
    if (normalizedRoom.status === 'training') {
      const participantsWithData = await Promise.all(
        (normalizedRoom.participants || []).map(async (p) => {
          const id = p.id || p.participantId || '';
          const ready = isParticipantReady(p);
          
          if (ready) {
            const liveData = await getParticipantLiveDataForRoom(id);
            return { ...p, liveData };
          }
          return { ...p, liveData: { power: 0, heartRate: 0, cadence: 0, progress: 0 } };
        })
      );
      normalizedRoom.participants = participantsWithData;
    }
    
    const participantsList = document.getElementById('roomMonitoringParticipantsList');
    if (participantsList) {
      participantsList.innerHTML = renderMonitoringParticipantsWithData(normalizedRoom.participants || [], normalizedRoom.status);
    }
    
    // 방 상태 업데이트
    const statusValue = document.querySelector('#roomMonitoringModal .status-value');
    if (statusValue) {
      const status = normalizedRoom.status;
      statusValue.className = `status-value ${status}`;
      statusValue.textContent = 
        status === 'waiting' ? '⏳ 대기중' : 
        status === 'starting' ? '🚀 시작중' :
        status === 'training' ? '🟢 훈련중' :
        status === 'finished' ? '✅ 완료' :
        status === 'closed' ? '🔴 종료' : '❓ 알 수 없음';
    }
    
    // 훈련 시작 버튼 상태 업데이트
    const startBtn = document.getElementById('startTrainingFromMonitoringBtn');
    if (startBtn) {
      const totalCount = (normalizedRoom.participants || []).length;
      const readyCount = countReadyParticipants(normalizedRoom.participants || []);
      startBtn.disabled = totalCount < 2 || normalizedRoom.status !== 'waiting';
      startBtn.title = `${readyCount}/${totalCount}명 준비 완료`;
    }
    
  } catch (error) {
    console.error('방 모니터링 새로고침 실패:', error);
  }
}

/**
 * 실시간 데이터가 포함된 참가자 목록 렌더링
 */
function renderMonitoringParticipantsWithData(participants, roomStatus) {
  if (!participants || participants.length === 0) {
    return '<div class="empty-participants">참가자가 없습니다</div>';
  }
  
  const isTraining = roomStatus === 'training';
  
  return participants.map(p => {
    const name = p.name || p.participantName || p.userName || '이름 없음';
    const id = p.id || p.participantId || '';
    const role = p.role || 'participant';
    const ready = isParticipantReady(p);
    const liveData = p.liveData || { power: 0, heartRate: 0, cadence: 0, progress: 0 };
    
    let statusText = '';
    let statusDescription = '';
    
    if (!ready) {
      statusText = '🔴 비활성';
      statusDescription = '대기 중 - 준비 완료 버튼을 누르지 않음';
    } else if (!isTraining) {
      statusText = '🟡 준비완료';
      statusDescription = '준비 완료 - 훈련 시작 대기 중';
    } else {
      statusText = '🟢 활성';
      statusDescription = '훈련 진행 중';
    }
    
    return `
      <div class="monitoring-participant-item" data-id="${id}">
        <div class="participant-header">
          <div class="participant-name-section">
            <span class="participant-name">${escapeHtml(name)}</span>
            <span class="participant-role-badge ${role}">
              ${role === 'admin' ? '🎯 관리자' : '🏃‍♂️ 참가자'}
            </span>
          </div>
          <span class="participant-status-indicator ${ready && isTraining ? 'ready' : 'not-ready'}" title="${statusDescription}">
            ${statusText}
          </span>
        </div>
        ${isTraining && ready ? `
        <div class="participant-metrics">
          <div class="metric-item">
            <span class="metric-label">파워</span>
            <span class="metric-value">${liveData.power || 0}W</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">심박</span>
            <span class="metric-value">${liveData.heartRate || 0}bpm</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">케이던스</span>
            <span class="metric-value">${liveData.cadence || 0}rpm</span>
          </div>
        </div>
        <div class="participant-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${liveData.progress || 0}%"></div>
          </div>
          <span class="progress-text">${liveData.progress || 0}% 완료</span>
        </div>
        ` : `
        <div class="participant-status-message">
          ${!ready ? 
            '<p class="status-info">⏳ 참가자가 준비 완료 버튼을 누르지 않았습니다.</p>' :
            '<p class="status-info">⏸️ 훈련이 시작되면 실시간 데이터가 표시됩니다.</p>'
          }
        </div>
        `}
      </div>
    `;
  }).join('');
}

/**
 * 방 모니터링 모달 닫기
 */
function closeRoomMonitoringModal() {
  const modal = document.getElementById('roomMonitoringModal');
  if (modal) {
    modal.remove();
  }
  
  // 인터벌 정리
  if (window.roomMonitoringInterval) {
    clearInterval(window.roomMonitoringInterval);
    window.roomMonitoringInterval = null;
  }
}

/**
 * 모니터링 화면에서 훈련 시작
 */
async function startTrainingFromMonitoring(roomCode) {
  try {
    console.log('🚀 모니터링 화면에서 훈련 시작:', roomCode);
    
    // 방 정보 확인
    const room = await getRoomByCode(roomCode);
    if (!room) {
      showToast('방 정보를 찾을 수 없습니다', 'error');
      return;
    }
    
    const normalizedRoom = normalizeRoomData(room);
    if (!normalizedRoom) {
      showToast('방 정보를 처리할 수 없습니다', 'error');
      return;
    }
    
    const participants = normalizedRoom.participants || [];
    const participantCount = participants.length;
    
    if (participantCount < 2) {
      showToast('최소 2명의 참가자가 필요합니다', 'error');
      return;
    }
    
    const readyCount = countReadyParticipants(participants);
    if (readyCount < participantCount) {
      showToast(`준비되지 않은 참가자가 있지만 훈련을 시작합니다 (${readyCount}/${participantCount})`, 'warning');
    }
    
    if (normalizedRoom.status !== 'waiting' && normalizedRoom.status !== 'starting') {
      showToast('이미 시작되었거나 종료된 방입니다', 'error');
      return;
    }
    
    // groupTrainingState 업데이트
    if (window.groupTrainingState) {
      window.groupTrainingState.currentRoom = normalizedRoom;
      window.groupTrainingState.roomCode = roomCode;
      window.groupTrainingState.isAdmin = true;
    }
    
    // 훈련 시작 시간 설정 (3초 후 시작 - 참가자들이 준비할 시간)
    const startDelay = 3000; // 3초
    const trainingStartTimeDate = new Date(Date.now() + startDelay);
    const trainingStartTime = trainingStartTimeDate.toISOString();
    const createdAtISO = formatToKstIsoString(trainingStartTimeDate); // ISO 형식으로 저장
    
    showToast('3초 후 모든 참가자의 훈련이 동시에 시작됩니다!', 'info');
    
    // 방 상태 업데이트 (trainingStartTime 및 createdAt 포함)
    const success = await apiUpdateRoom(roomCode, {
      status: 'training',
      createdAt: createdAtISO, // ISO 형식
      trainingStartTime: trainingStartTime
    });
    
    if (success) {
      // 모니터링 화면 새로고침
      await refreshRoomMonitoring(roomCode);
      
      showToast('훈련이 시작되었습니다! 모든 참가자가 동시에 시작됩니다.', 'success');
    } else {
      throw new Error('방 상태 업데이트 실패');
    }
    
  } catch (error) {
    console.error('❌ 모니터링 화면에서 훈련 시작 실패:', error);
    showToast('훈련 시작에 실패했습니다: ' + (error.message || '알 수 없는 오류'), 'error');
  }
}

/**
 * 방 모니터링 코칭 시작
 */
function startRoomMonitoringCoaching(roomCode) {
  showToast('코칭 기능은 준비 중입니다', 'info');
  // TODO: 코칭 기능 구현
}

/**
 * 참가자 실시간 데이터 가져오기 (방 모니터링용)
 */
async function getParticipantLiveDataForRoom(participantId) {
  try {
    // 백엔드에서 실시간 데이터 가져오기
    if (window.GAS_URL && participantId) {
      const result = await jsonpRequest(window.GAS_URL, {
        action: 'getParticipantLiveData',
        participantId: String(participantId)
      });
      
      if (result?.success && result.data) {
        return {
          power: result.data.power || 0,
          heartRate: result.data.heartRate || 0,
          cadence: result.data.cadence || 0,
          progress: result.data.progress || 0,
          timestamp: result.data.timestamp || new Date().toISOString()
        };
      }
    }
    
    // 백엔드에서 데이터를 가져올 수 없는 경우 빈 데이터 반환
    return {
      power: 0,
      heartRate: 0,
      cadence: 0,
      progress: 0,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('참가자 실시간 데이터 가져오기 실패:', error);
    return {
      power: 0,
      heartRate: 0,
      cadence: 0,
      progress: 0,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * 방 강제 중단
 */
async function forceStopRoom(roomCode) {
  const confirmed = confirm(`정말 방 ${roomCode}를 강제로 중단하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`);
  if (!confirmed) return;
  
  try {
    const success = await updateRoomOnBackend({
      code: roomCode,
      status: 'closed'
    });
    
    if (success) {
      showToast('방이 강제 중단되었습니다', 'success');
      refreshActiveRooms();
      updateRoomStatistics();
    } else {
      throw new Error('Failed to stop room');
    }
    
  } catch (error) {
    console.error('Failed to force stop room:', error);
    showToast('방 강제 중단에 실패했습니다', 'error');
  }
}

/**
 * 만료된 방 정리
 */
async function cleanupExpiredRooms() {
  const confirmed = confirm('24시간 이상 된 비활성 방들을 정리하시겠습니까?');
  if (!confirmed) return;
  
  try {
    showToast('만료된 방을 정리하는 중...', 'info');
    
    const allRooms = await getAllRoomsFromBackend();
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    let cleanedCount = 0;
    
    for (const room of allRooms) {
      const createdAt = new Date(room.CreatedAt);
      if (createdAt < oneDayAgo && room.Status !== 'training') {
        try {
          await deleteGroupTrainingRoom(room.Code);
          cleanedCount++;
        } catch (error) {
          console.error(`Failed to delete room ${room.Code}:`, error);
        }
      }
    }
    
    showToast(`${cleanedCount}개의 만료된 방을 정리했습니다`, 'success');
    refreshActiveRooms();
    updateRoomStatistics();
    
  } catch (error) {
    console.error('Failed to cleanup expired rooms:', error);
    showToast('방 정리에 실패했습니다', 'error');
  }
}

/**
 * 전체 방 긴급 중단
 */
async function emergencyStopAllRooms() {
  const confirmed = confirm('⚠️ 경고: 모든 활성 훈련방을 긴급 중단하시겠습니까?\n이 작업은 되돌릴 수 없으며, 모든 참가자의 훈련이 중단됩니다.');
  if (!confirmed) return;
  
  const doubleConfirmed = confirm('정말로 확실하십니까? "예"를 클릭하면 모든 방이 즉시 중단됩니다.');
  if (!doubleConfirmed) return;
  
  try {
    showToast('모든 방을 긴급 중단하는 중...', 'warning');
    
    const allRooms = await getAllRoomsFromBackend();
    const activeRooms = allRooms.filter(r => r.Status === 'waiting' || r.Status === 'training');
    
    let stoppedCount = 0;
    
    for (const room of activeRooms) {
      try {
        await updateRoomOnBackend({
          code: room.Code,
          status: 'emergency_stopped'
        });
        stoppedCount++;
      } catch (error) {
        console.error(`Failed to stop room ${room.Code}:`, error);
      }
    }
    
    showToast(`${stoppedCount}개의 훈련방이 긴급 중단되었습니다`, 'success');
    refreshActiveRooms();
    updateRoomStatistics();
    
  } catch (error) {
    console.error('Failed to emergency stop all rooms:', error);
    showToast('긴급 중단에 실패했습니다', 'error');
  }
}



/**
 * 참가자 섹션 초기화
 */
async function initializeParticipantSection() {
  console.log('🎯 참가자 섹션 초기화 시작');
  
  // 방 코드 입력 필드 초기화
  const roomCodeInput = safeGet('roomCodeInput');
  if (roomCodeInput) {
    roomCodeInput.value = '';
  }
  
  // 방 목록 로드
  await refreshRoomList();
  
  console.log('✅ 참가자 섹션 초기화 완료');
}

// 그룹훈련 모듈 함수 등록 확인 (변수명 변경으로 충돌 방지)
const groupTrainingFunctions = [
  'showGroupWorkoutManagement', 'loadGroupWorkoutList', 'deleteGroupWorkout',
  'apiGetGroupWorkouts', 'apiCreateGroupWorkout', 'apiDeleteGroupWorkout',
  'showToast', 'safeGet',
  'initializeParticipantSection', 'refreshRoomList', 'removeDuplicateWorkoutSelectsNow'
];




// 전역 함수 등록
window.refreshActiveRooms = refreshActiveRooms;
window.updateRoomStatistics = updateRoomStatistics;
window.monitorRoom = monitorRoom;
window.showRoomMonitoringModal = showRoomMonitoringModal;
window.closeRoomMonitoringModal = closeRoomMonitoringModal;
window.refreshRoomMonitoring = refreshRoomMonitoring;
window.startTrainingFromMonitoring = startTrainingFromMonitoring;
window.getParticipantLiveDataForRoom = getParticipantLiveDataForRoom;
window.startRoomMonitoringCoaching = startRoomMonitoringCoaching;
window.forceStopRoom = forceStopRoom;
window.cleanupExpiredRooms = cleanupExpiredRooms;
window.emergencyStopAllRooms = emergencyStopAllRooms;
window.initializeManagerDashboard = initializeManagerDashboard;


// ========== 그룹훈련 워크아웃 관리 UI 함수들 ==========

/**
 * 그룹훈련 워크아웃 목록 화면 표시
 */
async function showGroupWorkoutManagement() {
  console.log('🎯 그룹훈련 워크아웃 관리 화면 표시');
  
  const currentUser = window.currentUser;
  if (!currentUser || (currentUser.grade !== '1' && currentUser.grade !== 1)) {
    if (typeof showToast === 'function') {
      showToast('그룹훈련 워크아웃 관리는 관리자만 접근할 수 있습니다');
    } else {
      alert('관리자 권한이 필요합니다');
    }
    return;
  }
  
  // 화면 전환
  if (typeof showScreen === 'function') {
    showScreen('groupWorkoutManagementScreen');
  } else {
    // 대체 방법: 모든 화면 숨김 후 그룹워크아웃 관리 화면만 표시
    document.querySelectorAll('.screen').forEach(screen => {
      screen.classList.add('hidden');
    });
    
    const groupWorkoutScreen = document.getElementById('groupWorkoutManagementScreen');
    if (groupWorkoutScreen) {
      groupWorkoutScreen.classList.remove('hidden');
    }
  }
  
  // 워크아웃 목록 로드
  setTimeout(async () => {
    await loadGroupWorkoutList();
  }, 150);
}

/**
 * 그룹훈련 워크아웃 목록 로드
 */
async function loadGroupWorkoutList() {
  const workoutList = safeGet('groupWorkoutList');
  if (!workoutList) {
    console.warn('groupWorkoutList 요소를 찾을 수 없습니다');
    return;
  }
  
  try {
    workoutList.innerHTML = `
      <div class="loading-container">
        <div class="spinner"></div>
        <div style="color: #666; font-size: 14px;">그룹훈련 워크아웃 목록을 불러오는 중...</div>
      </div>
    `;
    
    const result = await apiGetGroupWorkouts();
    
    if (result && result.success && result.workouts) {
      renderGroupWorkoutList(result.workouts);
    } else {
      workoutList.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📝</div>
          <div class="empty-state-title">그룹훈련 워크아웃이 없습니다</div>
          <div class="empty-state-description">새로운 그룹훈련 워크아웃을 추가해보세요</div>
          <button class="btn btn-primary" onclick="showCreateGroupWorkoutModal()">
            <span class="btn-icon">➕</span>
            워크아웃 추가
          </button>
        </div>
      `;
    }
  } catch (error) {
    console.error('그룹훈련 워크아웃 목록 로드 실패:', error);
    workoutList.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">❌</div>
        <div class="error-state-title">로딩 실패</div>
        <div class="error-state-description">그룹훈련 워크아웃 목록을 불러올 수 없습니다</div>
        <button class="retry-button" onclick="loadGroupWorkoutList()">다시 시도</button>
      </div>
    `;
  }
}

/**
 * 그룹훈련 워크아웃 목록 렌더링
 */
function renderGroupWorkoutList(workouts) {
  const workoutList = safeGet('groupWorkoutList');
  if (!workoutList) return;
  
  const workoutCards = workouts.map(workout => `
    <div class="workout-card" data-workout-id="${workout.id}">
      <div class="workout-header">
        <h3 class="workout-title">${escapeHtml(workout.title)}</h3>
        <div class="workout-badges">
          <span class="badge badge-${workout.difficulty || 'medium'}">${workout.difficulty || 'Medium'}</span>
          <span class="badge badge-category">${workout.category || 'General'}</span>
        </div>
      </div>
      
      <div class="workout-info">
        <div class="workout-meta">
          <span class="meta-item">
            <i class="icon-time"></i>
            ${workout.duration || 60}분
          </span>
          <span class="meta-item">
            <i class="icon-users"></i>
            최대 ${workout.maxParticipants || 20}명
          </span>
          <span class="meta-item">
            <i class="icon-user"></i>
            ${escapeHtml(workout.author || '미상')}
          </span>
        </div>
        
        <p class="workout-description">${escapeHtml(workout.description || '설명 없음')}</p>
      </div>
      
      <div class="workout-actions">
        <button class="btn btn-secondary btn-sm" onclick="editGroupWorkout('${workout.id}')">
          <span class="btn-icon">✏️</span>
          편집
        </button>
        <button class="btn btn-primary btn-sm" onclick="useGroupWorkout('${workout.id}')">
          <span class="btn-icon">🚀</span>
          사용
        </button>
        <button class="btn btn-danger btn-sm" onclick="deleteGroupWorkout('${workout.id}')">
          <span class="btn-icon">🗑️</span>
          삭제
        </button>
      </div>
    </div>
  `).join('');
  
  workoutList.innerHTML = `
    <div class="workout-management-header">
      <h2>그룹훈련 워크아웃 관리</h2>
      <button class="btn btn-primary" onclick="showCreateGroupWorkoutModal()">
        <span class="btn-icon">➕</span>
        새 워크아웃 추가
      </button>
    </div>
    <div class="workout-grid">
      ${workoutCards}
    </div>
  `;
}

/**
 * 그룹훈련 워크아웃 삭제
 */
async function deleteGroupWorkout(workoutId) {
  if (!workoutId) {
    showToast('유효하지 않은 워크아웃 ID입니다');
    return;
  }
  
  if (!confirm('정말로 이 그룹훈련 워크아웃을 삭제하시겠습니까?\n삭제된 워크아웃은 복구할 수 없습니다.')) {
    return;
  }
  
  try {
    if (typeof showLoading === 'function') showLoading('워크아웃 삭제 중...');
    
    const result = await apiDeleteGroupWorkout(workoutId);
    
    if (result && result.success) {
      if (typeof showToast === 'function') {
        showToast('그룹훈련 워크아웃이 삭제되었습니다');
      }
      await loadGroupWorkoutList(); // 목록 새로고침
    } else {
      throw new Error(result.error || '삭제 실패');
    }
  } catch (error) {
    console.error('그룹훈련 워크아웃 삭제 실패:', error);
    if (typeof showToast === 'function') {
      showToast('워크아웃 삭제에 실패했습니다: ' + error.message);
    }
  } finally {
    if (typeof hideLoading === 'function') hideLoading();
  }
}

/**
 * HTML 이스케이프 (XSS 방지)
 */
function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) {
    return '';
  }
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ========== 전역 함수 등록 ==========
// ========== 전역 함수 등록 ==========
window.showGroupWorkoutManagement = showGroupWorkoutManagement;
window.loadGroupWorkoutList = loadGroupWorkoutList;
window.deleteGroupWorkout = deleteGroupWorkout;
window.apiGetGroupWorkouts = apiGetGroupWorkouts;
window.apiCreateGroupWorkout = apiCreateGroupWorkout;
window.apiDeleteGroupWorkout = apiDeleteGroupWorkout;
window.showToast = showToast;
window.safeGet = safeGet;
window.loadWorkoutsForGroupRoom = loadWorkoutsForGroupRoom;
window.initializeAdminSection = initializeAdminSection;
window.createGroupRoomFromWorkout = createGroupRoomFromWorkout;


// 🆕 새로 추가된 함수들
window.initializeParticipantSection = initializeParticipantSection;
window.refreshRoomList = refreshRoomList;
window.removeDuplicateWorkoutSelectsNow = removeDuplicateWorkoutSelectsNow;
window.getRoomsByWorkoutId = getRoomsByWorkoutId;

/**
 * 그룹 훈련 시작 (5초 카운트다운 포함)
 * 모든 참가자가 동시에 훈련을 시작하도록 함
 */
async function startGroupTrainingWithCountdown() {
  try {
    // 관리자 체크 (groupTrainingState.isAdmin 또는 grade=1)
    const currentUser = window.currentUser || {};
    const isAdminUser = groupTrainingState.isAdmin || 
                       currentUser.grade === '1' || 
                       currentUser.grade === 1 ||
                       (typeof getViewerGrade === 'function' && getViewerGrade() === '1');
    
    if (!isAdminUser) {
      showToast('관리자만 훈련을 시작할 수 있습니다', 'error');
      return;
    }

    const room = groupTrainingState.currentRoom;
    const roomCode = getCurrentRoomCode(room);
    if (!room || !room.workoutId || !roomCode) {
      showToast('방 정보가 없습니다', 'error');
      return;
    }

    // 워크아웃 확인
    if (!window.currentWorkout) {
      showToast('워크아웃을 먼저 로드해주세요', 'error');
      return;
    }

    const participantCount = room.participants?.length || 0;
    if (participantCount < 1) {
      showToast('참가자가 없습니다', 'warning');
      return;
    }
    
    const readyCount = countReadyParticipants(room.participants || []);
    if (readyCount < 1) {
      showToast('준비 완료된 참가자가 1명 이상 필요합니다', 'error');
      return;
    } else if (readyCount < participantCount) {
      showToast(`일부 참가자가 아직 준비되지 않았습니다 (${readyCount}/${participantCount})`, 'info');
    }
    
    console.log('🚀 그룹 훈련 시작 카운트다운 시작');
    console.log(`✅ 준비 완료된 참가자: ${readyCount}명`);

    // 현재시간 타이머에 표시된 시간 기준으로 1분 후 훈련 시작 시간 계산
    // formatTime은 서울 시간을 반환하므로, 이를 기준으로 계산
    const syncedTime = getSyncedTime();
    const currentTimeStr = formatTime(syncedTime); // 현재시간 타이머 표시 시간 (HH:MM:SS)
    
    // 현재시간 타이머 시간 + 1분 계산
    const [hours, minutes, seconds] = currentTimeStr.split(':').map(Number);
    let trainingHours = hours;
    let trainingMinutes = minutes + 1; // 1분 추가
    let trainingSeconds = seconds;
    
    // 분이 60을 넘으면 시간 증가
    if (trainingMinutes >= 60) {
      trainingMinutes = trainingMinutes - 60;
      trainingHours = (trainingHours + 1) % 24;
    }
    
    // 훈련 시작 시간 (HH:MM:SS 형식)
    const trainingStartTimeStr = `${String(trainingHours).padStart(2, '0')}:${String(trainingMinutes).padStart(2, '0')}:${String(trainingSeconds).padStart(2, '0')}`;
    
    // Date 객체로 변환 (비교용)
    const trainingStartTime = new Date(syncedTime);
    trainingStartTime.setUTCHours(trainingHours - 9, trainingMinutes, trainingSeconds, 0); // 서울 시간을 UTC로 변환
    
    console.log('⏰ 훈련 시작 시간 설정:', {
      현재시간: currentTimeStr,
      훈련시작시간: trainingStartTimeStr,
      현재시간ISO: syncedTime.toISOString(),
      훈련시작시간ISO: trainingStartTime.toISOString()
    });
    
    // 구글 시트에 훈련 시작 시간 업데이트 (ISO 형식으로 저장, KST 기준)
    try {
      let updateSuccess = false;
      const createdAtISO = formatToKstIsoString(trainingStartTime); // YYYY-MM-DDTHH:mm:ss.sss+09:00 형식
      if (typeof apiUpdateRoom === 'function') {
        const result = await apiUpdateRoom(roomCode, {
          createdAt: createdAtISO, // ISO 형식
          trainingStartTime: trainingStartTimeStr // HH:MM:SS 형식 (하위 호환성)
        });
        updateSuccess = !!(result && result.success);
        if (updateSuccess) {
          console.log('✅ 구글 시트에 훈련 시작 시간 업데이트 완료:', {
            roomCode,
            현재시간: currentTimeStr,
            훈련시작시간: trainingStartTimeStr,
            createdAtISO: createdAtISO,
            result
          });
        } else {
          console.error('❌ 구글 시트 업데이트 실패:', result);
        }
      } else if (typeof updateRoomOnBackend === 'function') {
        updateSuccess = await updateRoomOnBackend({
          ...room,
          createdAt: createdAtISO, // ISO 형식
          trainingStartTime: trainingStartTimeStr // HH:MM:SS 형식 (하위 호환성)
        });
        if (updateSuccess) {
          console.log('✅ 구글 시트에 훈련 시작 시간 업데이트 완료 (updateRoomOnBackend):', {
            현재시간: currentTimeStr,
            훈련시작시간: trainingStartTimeStr,
            createdAtISO: createdAtISO
          });
        } else {
          console.error('❌ 구글 시트 업데이트 실패 (updateRoomOnBackend)');
        }
      }
      
      if (!updateSuccess) {
        throw new Error('구글 시트 업데이트가 실패했습니다');
      }
    } catch (error) {
      console.error('❌ 구글 시트 업데이트 실패:', error);
      showToast('훈련 시작 시간 업데이트에 실패했습니다: ' + (error.message || '알 수 없는 오류'), 'error');
      return;
    }
    
    // 알림 표시
    const startTimeFormatted = formatTime(trainingStartTime);
    showToast(`훈련이 ${startTimeFormatted}에 시작됩니다`, 'success');
    
    // 카운트다운 로직 제거: 현재시간과 훈련시작시간 비교로만 동작
    // 참가자들이 5초마다 checkTrainingStartTime을 통해 자동으로 체크하고 카운트다운 시작

  } catch (error) {
    console.error('❌ 그룹 훈련 시작 실패:', error);
    showToast('훈련 시작에 실패했습니다: ' + (error.message || '알 수 없는 오류'), 'error');
  }
}

/**
 * 그룹 훈련 카운트다운 오버레이 표시 (5초)
 */
async function showGroupCountdownOverlay(options = {}) {
  const opts = typeof options === 'number' ? { seconds: options } : (options || {});
  const baseSeconds = Number.isFinite(opts.seconds) ? opts.seconds : GROUP_COUNTDOWN_SECONDS;
  const explicitEndMs = opts.targetEndTime ? new Date(opts.targetEndTime).getTime() : null;
  const fallbackEndMs = Date.now() + baseSeconds * 1000;
  const countdownEndMs = Number.isFinite(explicitEndMs) ? explicitEndMs : fallbackEndMs;

  return new Promise((resolve) => {
    let overlay = document.getElementById('countdownOverlay');
    let countdownNumber = document.getElementById('countdownNumber');

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'countdownOverlay';
      overlay.className = 'countdown-overlay';
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        backdrop-filter: blur(10px);
      `;

      countdownNumber = document.createElement('div');
      countdownNumber.id = 'countdownNumber';
      countdownNumber.className = 'countdown-number';
      countdownNumber.style.cssText = `
        font-size: 120px;
        font-weight: 900;
        color: #4cc9f0;
        text-shadow: 0 0 40px rgba(76, 201, 240, 0.8), 0 0 80px rgba(76, 201, 240, 0.5);
        animation: countdownPulse 1s ease-in-out infinite;
      `;

      overlay.appendChild(countdownNumber);
      document.body.appendChild(overlay);

      if (!document.getElementById('countdownAnimationStyle')) {
        const style = document.createElement('style');
        style.id = 'countdownAnimationStyle';
        style.textContent = `
          @keyframes countdownPulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.2); opacity: 0.8; }
          }
        `;
        document.head.appendChild(style);
      }
    }

    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';

    let tickInterval = null;

    const getRemainingSeconds = () => {
      const diffMs = countdownEndMs - Date.now();
      return Math.max(0, Math.ceil(diffMs / 1000));
    };

    let lastDisplayed = -1;
    let finished = false;

    const updateDisplay = () => {
      if (finished) return;
      const remaining = getRemainingSeconds();

      if (remaining !== lastDisplayed) {
        countdownNumber.textContent = remaining;
        if (remaining > 0 && typeof playBeep === 'function') {
          try {
            playBeep(880, 120, 0.25);
          } catch (e) {
            console.warn('카운트다운 비프 실패:', e);
          }
        } else if (remaining === 0 && typeof playBeep === 'function') {
          try {
            playBeep(1500, 700, 0.35, 'square');
          } catch (e) {
            console.warn('카운트다운 종료 비프 실패:', e);
          }
        }
        lastDisplayed = remaining;
      }

      if (remaining <= 0) {
        finishCountdown();
      }
    };

    const finishCountdown = () => {
      if (finished) return;
      finished = true;
      overlay.classList.add('hidden');
      overlay.style.display = 'none';
      if (tickInterval) {
        clearInterval(tickInterval);
      }

      // 관리자 카운트다운 플래그 리셋
      if (groupTrainingState.isAdmin) {
        groupTrainingState.adminCountdownInitiated = false;
      }

      console.log('✅ 카운트다운 완료, 훈련 시작');

      Promise.resolve(startAllParticipantsTraining())
        .catch(err => console.error('startAllParticipantsTraining 실패:', err))
        .finally(resolve);
    };

    if (countdownEndMs <= Date.now()) {
      finishCountdown();
      return;
    }

    updateDisplay();
    tickInterval = setInterval(updateDisplay, 250);
  });
}

/**
 * 모든 참가자에게 훈련 시작 신호 전송 및 로컬 훈련 시작
 */
async function startAllParticipantsTraining() {
  try {
    const room = groupTrainingState.currentRoom;
    const roomCode = getCurrentRoomCode(room);
    if (!room || !roomCode) {
      console.error('방 정보가 없습니다');
      return;
    }

    // 서버에 훈련 시작 신호 전송 (관리자만)
    // grade=1 사용자도 관리자로 인식
    const adminUser = window.currentUser || {};
    const adminUserCheck = groupTrainingState.isAdmin || 
                       adminUser.grade === '1' || 
                       adminUser.grade === 1 ||
                       (typeof getViewerGrade === 'function' && getViewerGrade() === '1');
    const trainingStartDate = new Date();
    const trainingStartTime = trainingStartDate.toISOString();
    const createdAtISO = formatToKstIsoString(trainingStartDate); // ISO 형식으로 저장
    
    if (adminUserCheck) {
      try {
        // API 호출로 방 상태를 'training'으로 변경하여 모든 참가자에게 신호 전송
        if (typeof apiUpdateRoom === 'function') {
          await apiUpdateRoom(roomCode, {
            status: 'training',
            createdAt: createdAtISO, // ISO 형식
            trainingStartTime,
            countdownEndTime: null
          });
        } else if (typeof updateRoomOnBackend === 'function') {
          await updateRoomOnBackend({
            ...room,
            status: 'training',
            createdAt: createdAtISO, // ISO 형식
            trainingStartTime,
            countdownEndTime: null
          });
        }
        groupTrainingState.trainingStartSignaled = true;
        if (groupTrainingState.currentRoom) {
          groupTrainingState.currentRoom.status = 'training';
          groupTrainingState.currentRoom.trainingStartTime = trainingStartTime;
          delete groupTrainingState.currentRoom.countdownEndTime;
        }
        console.log('✅ 서버에 훈련 시작 신호 전송 완료');
      } catch (error) {
        console.warn('서버에 훈련 시작 신호 전송 실패:', error);
        // 서버 전송 실패해도 로컬 훈련은 시작
      }
    }

    // 로컬 훈련 시작
    // 카운트다운이 완료되었다는 것은 관리자가 훈련을 시작했다는 의미이므로,
    // 준비완료 상태와 관계없이 모든 참가자가 훈련 화면으로 전환되어야 함
    const participantUser = window.currentUser || {};
    const participantIsAdmin = groupTrainingState.isAdmin || 
                       participantUser.grade === '1' || 
                       participantUser.grade === 1 ||
                       (typeof getViewerGrade === 'function' && getViewerGrade() === '1');
    
    // 관리자가 모니터링 모드인 경우에만 모니터링 모드로 유지
    // 일반 참가자는 항상 훈련 화면으로 전환
    if (participantIsAdmin && !shouldAutoStartLocalTraining()) {
      console.log('관리자 모니터링 모드 - 로컬 훈련을 시작하지 않습니다');
      showWaitingScreen();
      const monitoringSnapshot = updateTimelineSnapshot(groupTrainingState.currentRoom);
      syncMonitoringLoopWithSnapshot(monitoringSnapshot);
    } else {
      // 일반 참가자 또는 준비완료된 관리자는 훈련 화면으로 전환
      await startLocalGroupTraining();
    }

  } catch (error) {
    console.error('❌ 모든 참가자 훈련 시작 실패:', error);
    showToast('훈련 시작에 실패했습니다', 'error');
  }
}

/**
 * 로컬 훈련 시작 (개인 훈련 화면 전환 및 훈련 시작)
 * 주의: startLocalGroupTraining 함수는 이미 3516번 줄에 선언되어 있으므로 중복 선언 제거됨
 * 기존 함수를 사용하되, 훈련 시작 시간 체크 중지 기능이 이미 포함되어 있음
 */

// 함수를 전역으로 노출
window.startGroupTrainingWithCountdown = startGroupTrainingWithCountdown;
window.showGroupCountdownOverlay = showGroupCountdownOverlay;
window.startAllParticipantsTraining = startAllParticipantsTraining;
window.startLocalGroupTraining = startLocalGroupTraining;
window.setupGroupTrainingControlBar = setupGroupTrainingControlBar;

     

groupTrainingFunctions.forEach(funcName => {
  if (typeof window[funcName] !== 'function') {
    console.warn(`⚠️ 그룹훈련 함수 ${funcName}가 제대로 등록되지 않았습니다`);
  }
});

console.log('✅ 그룹 훈련 관리자 모듈 로딩 완료');

// 추가 그룹훈련 유틸리티 함수들 전역 등록
// 추가 그룹훈련 유틸리티 함수들 전역 등록 (존재하는 함수만)
try {
  // 유틸리티 함수들
  if (typeof generateRoomCode === 'function') {
    window.generateRoomCode = generateRoomCode;
  }
  if (typeof generateId === 'function') {
    window.generateId = generateId;
  }
  if (typeof getCurrentTimeString === 'function') {
    window.getCurrentTimeString = getCurrentTimeString;
  }
  
  // 🆕 API 함수들 추가
  if (typeof apiCreateRoom === 'function') {
    window.apiCreateRoom = apiCreateRoom;
  }
  if (typeof apiGetRoom === 'function') {
    window.apiGetRoom = apiGetRoom;
  }
  if (typeof apiJoinRoom === 'function') {
    window.apiJoinRoom = apiJoinRoom;
  }
  if (typeof apiUpdateRoom === 'function') {
    window.apiUpdateRoom = apiUpdateRoom;
  }
  if (typeof updateRoomOnBackend === 'function') {
    window.updateRoomOnBackend = updateRoomOnBackend;
  }
  if (typeof apiGetWorkouts === 'function') {
    window.apiGetWorkouts = apiGetWorkouts;
  }
  if (typeof apiLeaveRoom === 'function') {
    window.apiLeaveRoom = apiLeaveRoom;
  }
  if (typeof apiSyncRoom === 'function') {
    window.apiSyncRoom = apiSyncRoom;
  }
  
  // 화면 전환 함수들
  if (typeof selectTrainingMode === 'function') {
    window.selectTrainingMode = selectTrainingMode;
  }
  if (typeof selectGroupMode === 'function') {
    window.selectGroupMode = selectGroupMode;
  }
  
  // 방 관리 함수들
  if (typeof createGroupRoom === 'function') {
    window.createGroupRoom = createGroupRoom;
  }
  if (typeof createRoomOnBackend === 'function') {
    window.createRoomOnBackend = createRoomOnBackend;
  }
  if (typeof joinGroupRoom === 'function') {
    window.joinGroupRoom = joinGroupRoom;
  }
  if (typeof leaveGroupRoom === 'function') {
    // leaveGroupRoom은 groupTrainingManager_part2.js에서 최종 등록됨
// window.leaveGroupRoom = leaveGroupRoom; // 주석 처리 - part2에서 등록
  }
  
  // 역할 선택 함수
  if (typeof selectRole === 'function') {
    window.selectRole = selectRole;
  }
  
  console.log('✅ 그룹훈련 추가 함수들 안전 등록 완료');
} catch (error) {
  console.error('❌ 그룹훈련 함수 등록 중 오류:', error);
}

/**
 * 그룹 훈련 카드 상태 업데이트 (훈련방 존재 여부에 따라)
 */
async function updateGroupTrainingCardStatus() {
  try {
    const groupTrainingCard = document.querySelector('.training-mode-card.group-training');
    if (!groupTrainingCard) {
      console.log('그룹 훈련 카드를 찾을 수 없습니다.');
      return;
    }

    // 훈련방 목록 확인
    const availableRooms = await getRoomsFromBackend();
    const hasAvailableRooms = availableRooms && availableRooms.length > 0;

    // 상태 업데이트
    if (hasAvailableRooms) {
      // 훈련방이 있으면 활성화 상태
      groupTrainingCard.classList.remove('disabled');
      groupTrainingCard.classList.add('active');
      const btn = groupTrainingCard.querySelector('#btnGroupTraining');
      if (btn) {
        btn.disabled = false;
        btn.style.pointerEvents = '';
        btn.style.opacity = '1';
      }
      console.log('✅ 그룹 훈련 카드 활성화 (훈련방 있음)');
    } else {
      // 훈련방이 없으면 비활성화 상태
      groupTrainingCard.classList.remove('active');
      groupTrainingCard.classList.add('disabled');
      const btn = groupTrainingCard.querySelector('#btnGroupTraining');
      if (btn) {
        btn.disabled = true;
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.5';
      }
      console.log('⚠️ 그룹 훈련 카드 비활성화 (훈련방 없음)');
    }
  } catch (error) {
    console.error('그룹 훈련 카드 상태 업데이트 실패:', error);
    // 에러 발생 시 기본적으로 비활성화 상태로 설정
    const groupTrainingCard = document.querySelector('.training-mode-card.group-training');
    if (groupTrainingCard) {
      groupTrainingCard.classList.remove('active');
      groupTrainingCard.classList.add('disabled');
      const btn = groupTrainingCard.querySelector('#btnGroupTraining');
      if (btn) {
        btn.disabled = true;
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.5';
      }
    }
  }
}

// 전역 함수로 등록
window.updateGroupTrainingCardStatus = updateGroupTrainingCardStatus;

// 모듈 로딩 완료 마크
window.groupTrainingManagerReady = true;
console.log('🎯 그룹훈련 관리자 모듈 준비 완료');

// 시간 API 테스트 함수 (브라우저 콘솔에서 직접 호출 가능)
window.testTimeAPIs = async function() {
  console.log('=== 시간 API 테스트 시작 ===\n');
  
  for (const api of TIME_APIS) {
    console.log(`\n[${api.name}] 테스트 중...`);
    const apiUrl = typeof api.url === 'function' 
      ? api.url(Math.floor(Date.now() / 1000))
      : api.url;
    console.log(`URL: ${apiUrl}`);
    
    try {
      const startTime = Date.now();
      // 구글 타임존 API는 현재 UTC 타임스탬프 필요
      const requestTimestamp = api.requiresTimestamp 
        ? Math.floor(Date.now() / 1000) 
        : null;
      
      const serverTime = await tryFetchTimeFromAPI(api, 5000, requestTimestamp);
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      const localTime = new Date();
      const offset = serverTime.getTime() - localTime.getTime();
      
      console.log('✅ 응답 성공!');
      console.log('응답 시간:', responseTime + 'ms');
      console.log('서버 시간:', serverTime.toISOString());
      console.log('로컬 시간:', localTime.toISOString());
      console.log('시간 차이:', Math.round(offset / 1000) + '초');
      
    } catch (error) {
      console.error('❌ 실패:', error.name, error.message);
      if (error.errorType === 'TIMEOUT') {
        console.error('   → 타임아웃 (5초 초과)');
      } else if (error.errorType === 'NETWORK_ERROR') {
        console.error('   → 네트워크 연결 실패 (ERR_CONNECTION_RESET 가능)');
        console.error('   → 가능한 원인: 방화벽, 프록시, 네트워크 정책, API 서버 장애');
      } else if (error.errorType === 'CORS_ERROR') {
        console.error('   → CORS 정책 위반');
      }
    }
  }
  
  console.log('\n=== 테스트 완료 ===');
  console.log('💡 브라우저 콘솔에서 testTimeAPIs() 함수를 호출하여 언제든지 테스트할 수 있습니다.');
};

// 모듈 중복 로딩 방지 블록 종료
}

