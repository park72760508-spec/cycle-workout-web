/**
 * 음성 통신 모듈 (voice-addon.js)
 * 기존 앱에 최소한의 변경으로 음성 기능 추가
 */

// ===== 전역 변수 초기화 =====
if (!window.voiceCommunication) {
  window.voiceCommunication = {
    isInitialized: false,
    localStream: null,
    peerConnections: new Map(),
    isHostMicOn: false,
    isBroadcasting: false,
    signalPollingInterval: null,
    audioContext: null,
    audioElements: new Map()
  };
}

if (!window.groupTraining) {
  window.groupTraining = {
    currentRoom: null,
    isGroupMode: false,
    participants: [],
    roomStatus: 'waiting',
    isHost: false,
    pollingInterval: null,
    voiceEnabled: false
  };
}

// ICE 서버 설정
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

// ===== 음성 통신 기본 기능 =====

/**
 * 음성 통신 초기화
 */
async function initVoiceCommunication() {
  try {
    if (!navigator.mediaDevices || !window.RTCPeerConnection) {
      console.warn('이 브라우저는 음성 통신을 지원하지 않습니다.');
      return false;
    }

    window.voiceCommunication.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    window.voiceCommunication.isInitialized = true;
    
    console.log('음성 통신 초기화 완료');
    return true;
    
  } catch (error) {
    console.error('음성 통신 초기화 오류:', error);
    return false;
  }
}

/**
 * 방장 마이크 시작
 */
async function startHostMicrophone() {
  try {
    if (!window.voiceCommunication.isInitialized) {
      await initVoiceCommunication();
    }

    // 마이크 권한 요청
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    window.voiceCommunication.localStream = stream;
    window.voiceCommunication.isHostMicOn = true;
    window.voiceCommunication.isBroadcasting = true;

    // 실제 WebRTC 연결 설정은 여기서 구현
    // 현재는 기본 UI 업데이트만
    updateVoiceUI();
    showToast('마이크가 활성화되었습니다.');
    
    return true;

  } catch (error) {
    console.error('마이크 시작 오류:', error);
    
    if (error.name === 'NotAllowedError') {
      showToast('마이크 접근 권한을 허용해주세요.', 'error');
    } else if (error.name === 'NotFoundError') {
      showToast('마이크를 찾을 수 없습니다.', 'error');
    } else {
      showToast('마이크 활성화에 실패했습니다.', 'error');
    }
    return false;
  }
}

/**
 * 마이크 음소거/해제 토글
 */
function toggleMicrophone() {
  if (!window.voiceCommunication.localStream) {
    startHostMicrophone();
    return;
  }

  const audioTrack = window.voiceCommunication.localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    window.voiceCommunication.isBroadcasting = audioTrack.enabled;
    
    updateVoiceUI();
    showToast(audioTrack.enabled ? '마이크 활성화' : '마이크 음소거');
  }
}

/**
 * 마이크 완전 중지
 */
function stopMicrophone() {
  if (window.voiceCommunication.localStream) {
    window.voiceCommunication.localStream.getTracks().forEach(track => track.stop());
    window.voiceCommunication.localStream = null;
  }

  window.voiceCommunication.isHostMicOn = false;
  window.voiceCommunication.isBroadcasting = false;

  updateVoiceUI();
  showToast('마이크가 비활성화되었습니다.');
}

// ===== 그룹 훈련 기본 기능 =====

/**
 * 그룹 훈련방 참가 (간단한 시뮬레이션)
 */
async function joinGroupTraining() {
  try {
    // 실제로는 서버 API 호출
    // 현재는 시뮬레이션
    
    window.groupTraining.isGroupMode = true;
    window.groupTraining.roomStatus = 'waiting';
    window.groupTraining.currentRoom = {
      roomId: 'demo-room-' + Date.now(),
      roomName: '데모 그룹 훈련방',
      hostUserId: 'demo-host'
    };
    
    // 현재 사용자가 방장인지 확인
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    window.groupTraining.isHost = (currentUser && currentUser.grade === '1');
    
    // 더미 참가자 추가
    window.groupTraining.participants = [
      { userId: 'user1', userName: '김훈련' },
      { userId: 'user2', userName: '박사이클' },
      { userId: 'user3', userName: '이스포츠' }
    ];

    showGroupTrainingUI();
    showToast('그룹 훈련방에 참가했습니다!');

    // 음성 통신 초기화
    if (window.groupTraining.isHost) {
      await initVoiceCommunication();
      window.groupTraining.voiceEnabled = true;
    }

    return true;

  } catch (error) {
    console.error('그룹 훈련 참가 오류:', error);
    showToast('그룹 훈련 참가에 실패했습니다.', 'error');
    return false;
  }
}

/**
 * 그룹 훈련방 생성 (간단한 시뮬레이션)
 */
async function createGroupRoom() {
  try {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    
    if (!currentUser || currentUser.grade !== '1') {
      showToast('관리자만 그룹 훈련방을 생성할 수 있습니다.', 'error');
      return false;
    }

    // 실제로는 방 생성 모달 표시
    const roomName = prompt('그룹 훈련방 이름을 입력하세요:', '오늘 저녁 그룹 훈련');
    if (!roomName) return false;

    window.groupTraining.isGroupMode = true;
    window.groupTraining.isHost = true;
    window.groupTraining.roomStatus = 'waiting';
    window.groupTraining.currentRoom = {
      roomId: 'room-' + Date.now(),
      roomName: roomName,
      hostUserId: currentUser.userId
    };

    window.groupTraining.participants = [
      { userId: currentUser.userId, userName: currentUser.name || currentUser.userId }
    ];

    showGroupTrainingUI();
    showToast('그룹 훈련방이 생성되었습니다!');

    // 음성 통신 초기화
    await initVoiceCommunication();
    window.groupTraining.voiceEnabled = true;

    return true;

  } catch (error) {
    console.error('그룹 훈련방 생성 오류:', error);
    showToast('그룹 훈련방 생성에 실패했습니다.', 'error');
    return false;
  }
}

/**
 * 그룹 훈련방 나가기
 */
function leaveGroupTraining() {
  // 음성 정리
  stopMicrophone();

  // 상태 초기화
  window.groupTraining = {
    currentRoom: null,
    isGroupMode: false,
    participants: [],
    roomStatus: 'waiting',
    isHost: false,
    pollingInterval: null,
    voiceEnabled: false
  };

  hideGroupTrainingUI();
  showToast('그룹 훈련방에서 나왔습니다.');
}

// ===== UI 업데이트 함수들 =====

/**
 * 그룹 훈련 UI 표시
 */
function showGroupTrainingUI() {
  const panel = document.getElementById('voiceControlPanel');
  const micBtn = document.getElementById('btnToggleMic');
  const leaveBtn = document.getElementById('btnLeaveGroupTraining');
  const participantsList = document.getElementById('participantsList');

  if (panel) {
    panel.classList.add('active');
  }

  // 방장인 경우 마이크 버튼 표시
  if (window.groupTraining.isHost && micBtn) {
    micBtn.style.display = 'inline-flex';
  }

  if (leaveBtn) {
    leaveBtn.style.display = 'inline-flex';
  }

  // 참가자 목록 업데이트
  updateParticipantsList();
  updateVoiceUI();
}

/**
 * 그룹 훈련 UI 숨김
 */
function hideGroupTrainingUI() {
  const panel = document.getElementById('voiceControlPanel');
  const micBtn = document.getElementById('btnToggleMic');
  const leaveBtn = document.getElementById('btnLeaveGroupTraining');

  if (panel) {
    panel.classList.remove('active');
  }

  if (micBtn) {
    micBtn.style.display = 'none';
  }

  if (leaveBtn) {
    leaveBtn.style.display = 'none';
  }

  updateVoiceUI();
}

/**
 * 참가자 목록 업데이트
 */
function updateParticipantsList() {
  const participantsList = document.getElementById('participantsList');
  if (!participantsList || !window.groupTraining.participants) return;

  if (window.groupTraining.participants.length === 0) {
    participantsList.innerHTML = '<p style="text-align: center; opacity: 0.7; margin: 10px 0;">참가자가 없습니다.</p>';
    return;
  }

  participantsList.innerHTML = window.groupTraining.participants.map(participant => `
    <div class="participant-item">
      <span class="participant-name">${escapeHtml(participant.userName || participant.userId)}</span>
      <span class="participant-voice-status">
        ${participant.userId === window.groupTraining.currentRoom?.hostUserId ? '방장' : '참가자'}
      </span>
    </div>
  `).join('');
}

/**
 * 음성 UI 업데이트
 */
function updateVoiceUI() {
  const micBtn = document.getElementById('btnToggleMic');
  const indicator = document.getElementById('voiceStatusIndicator');
  const trainingIndicator = document.getElementById('trainingVoiceIndicator');

  // 마이크 버튼 상태
  if (micBtn && window.groupTraining.isHost) {
    if (!window.voiceCommunication.isHostMicOn) {
      micBtn.innerHTML = '<span>🎤</span> 마이크 시작';
      micBtn.className = 'btn';
    } else if (window.voiceCommunication.isBroadcasting) {
      micBtn.innerHTML = '<span>🔇</span> 음소거';
      micBtn.className = 'btn btn-mic-on';
    } else {
      micBtn.innerHTML = '<span>🎤</span> 방송';
      micBtn.className = 'btn btn-mic-muted';
    }
  }

  // 상태 표시기
  if (indicator) {
    if (window.voiceCommunication.isBroadcasting) {
      indicator.textContent = '방송 중';
      indicator.className = 'voice-status-indicator broadcasting';
    } else if (window.voiceCommunication.isHostMicOn) {
      indicator.textContent = '음소거';
      indicator.className = 'voice-status-indicator muted';
    } else if (window.groupTraining.isHost && window.groupTraining.voiceEnabled) {
      indicator.textContent = '마이크 대기';
      indicator.className = 'voice-status-indicator';
    } else if (window.groupTraining.isGroupMode) {
      indicator.textContent = '음성 수신 대기';
      indicator.className = 'voice-status-indicator listening';
    } else {
      indicator.textContent = '대기 중';
      indicator.className = 'voice-status-indicator';
    }
  }

  // 훈련 중 표시기
  if (trainingIndicator) {
    if (window.groupTraining.isGroupMode) {
      const icon = document.getElementById('voiceIndicatorIcon');
      const text = document.getElementById('voiceIndicatorText');
      
      if (window.voiceCommunication.isBroadcasting) {
        if (icon) icon.textContent = '🔴';
        if (text) text.textContent = '방송 중';
        trainingIndicator.className = 'training-voice-indicator active broadcasting';
      } else if (window.groupTraining.isHost && window.voiceCommunication.isHostMicOn) {
        if (icon) icon.textContent = '🔇';
        if (text) text.textContent = '음소거';
        trainingIndicator.className = 'training-voice-indicator active';
      } else if (window.groupTraining.isGroupMode) {
        if (icon) icon.textContent = '👂';
        if (text) text.textContent = '음성 수신';
        trainingIndicator.className = 'training-voice-indicator active listening';
      } else {
        trainingIndicator.className = 'training-voice-indicator';
      }
    } else {
      trainingIndicator.className = 'training-voice-indicator';
    }
  }
}

// ===== 유틸리티 함수들 =====

/**
 * HTML 이스케이프
 */
function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * 토스트 메시지 표시 (기존 함수 활용)
 */
function showToast(message, type = 'info') {
  if (window.showToast) {
    window.showToast(message, type);
  } else {
    // 기본 토스트 구현
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = message;
      toast.className = 'toast show';
      setTimeout(() => {
        toast.className = 'toast hidden';
      }, 3000);
    } else {
      // 토스트 엘리먼트가 없으면 alert로 대체
      alert(message);
    }
  }
}

// ===== 이벤트 리스너 등록 =====

/**
 * DOM 로드 후 초기화
 */
document.addEventListener('DOMContentLoaded', function() {
  initializeVoiceAddon();
});

/**
 * 음성 애드온 초기화
 */
function initializeVoiceAddon() {
  console.log('음성 애드온 초기화');

  // 기존 사용자 정보로 관리자 권한 확인
  setTimeout(() => {
    const currentUser = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || 'null');
    const createBtn = document.getElementById('btnCreateGroupTraining');
    
    if (currentUser && currentUser.grade === '1' && createBtn) {
      createBtn.style.display = 'inline-flex';
    }
  }, 1000); // 기존 앱 로드 후 실행

  // 이벤트 리스너 등록
  const joinBtn = document.getElementById('btnJoinGroupTraining');
  const createBtn = document.getElementById('btnCreateGroupTraining');
  const micBtn = document.getElementById('btnToggleMic');
  const leaveBtn = document.getElementById('btnLeaveGroupTraining');

  if (joinBtn) {
    joinBtn.addEventListener('click', joinGroupTraining);
  }

  if (createBtn) {
    createBtn.addEventListener('click', createGroupRoom);
  }

  if (micBtn) {
    micBtn.addEventListener('click', toggleMicrophone);
  }

  if (leaveBtn) {
    leaveBtn.addEventListener('click', leaveGroupTraining);
  }

  // 주기적 UI 업데이트
  setInterval(updateVoiceUI, 2000);
}

// ===== 전역 함수로 등록 =====
window.voiceAddon = {
  initVoiceCommunication,
  startHostMicrophone,
  toggleMicrophone,
  stopMicrophone,
  joinGroupTraining,
  createGroupRoom,
  leaveGroupTraining,
  showGroupTrainingUI,
  hideGroupTrainingUI,
  updateVoiceUI
};

console.log('음성 애드온 모듈 로드 완료');
