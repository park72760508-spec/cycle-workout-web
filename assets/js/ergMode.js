/* ==========================================================
   ergMode.js (v2.1 UI Linker)
   - UI 이벤트 <-> ErgController 양방향 바인딩
   - 안전한 초기화 로직
========================================================== */

function initializeErgMode() {
  const toggle = document.getElementById('ergModeToggle');
  const statusLabel = document.getElementById('ergModeStatus');
  const container = document.getElementById('ergModeContainer');
  const powerInput = document.getElementById('targetPowerInput'); // 만약 수동 입력창이 있다면

  if (!toggle) return;

  // 1. Controller 상태 변화 감지 -> UI 업데이트
  if (window.ergController) {
    window.ergController.subscribe((state, key, value) => {
      if (key === 'enabled') {
        toggle.checked = value;
        if (statusLabel) statusLabel.textContent = value ? 'ON' : 'OFF';
        if (container) value ? container.classList.add('active') : container.classList.remove('active');
        
        // 버튼 색상 동기화
        if (typeof window.updateBluetoothConnectionButtonColor === 'function') {
            window.updateBluetoothConnectionButtonColor();
        }
        
        // 상태 메시지 표시
        if (value) {
            // ERG 켜짐 시각 효과
            if (container) container.style.boxShadow = "0 0 15px rgba(0, 255, 0, 0.5)";
        } else {
            if (container) container.style.boxShadow = "none";
        }
      }
      
      if (key === 'targetPower' && powerInput) {
          if (document.activeElement !== powerInput) { // 사용자가 입력중이 아닐때만
              powerInput.value = value;
          }
      }
    });
  }

  // 2. UI 조작 -> Controller 명령 (중복 이벤트 방지)
  const handleToggle = async (e) => {
    const isChecked = e.target.checked;
    
    // 로라 연결 체크
    if (!window.connectedDevices?.trainer) {
        alert("먼저 스마트 로라를 연결해주세요.");
        e.preventDefault();
        e.target.checked = !isChecked; // 되돌리기
        return;
    }

    try {
      await window.ergController.toggleErgMode(isChecked);
    } catch (err) {
      alert("ERG 모드 실패: " + err.message);
      e.target.checked = !isChecked; // 실패 시 원복
    }
  };

  if (!toggle._hasErgListener) {
      toggle.addEventListener('change', handleToggle);
      toggle._hasErgListener = true;
  }
}

// Global Wrappers for external calls (e.g. from Workout Player)
window.setErgTargetPower = function(watts) {
    if (window.ergController) {
        window.ergController.setTargetPower(watts);
    }
};

window.toggleErgMode = function(enable) {
    if (window.ergController) {
        // UI 체크박스 상태도 같이 변경해주면 좋음
        const toggle = document.getElementById('ergModeToggle');
        if (toggle) toggle.checked = enable;
        
        window.ergController.toggleErgMode(enable);
    }
};

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', initializeErgMode);
