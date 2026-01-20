/* ==========================================================
   ergMode.js (v5.0 UI Sync)
   - ERG 실패 시 스위치 강제 OFF 복구 기능 강화
========================================================== */

function initializeErgMode() {
  const toggle = document.getElementById('ergModeToggle');
  const status = document.getElementById('ergModeStatus');
  const container = document.getElementById('ergModeContainer');

  if (!toggle) return;

  // 1. 상태 모니터링
  if (window.ergController && window.ergController.subscribe) {
    window.ergController.subscribe((state, key, value) => {
      if (key === 'enabled') {
        toggle.checked = value;
        if (status) status.textContent = value ? 'ON' : 'OFF';
        if (container) value ? container.classList.add('active') : container.classList.remove('active');
        if (window.updateBluetoothConnectionButtonColor) window.updateBluetoothConnectionButtonColor();
      }
    });
  }

  // 2. 스위치 조작
  if (!toggle.hasAttribute('data-init')) {
    toggle.setAttribute('data-init', 'true');
    toggle.addEventListener('change', async (e) => {
      const isEnabled = e.target.checked;
      
      // 연결 확인
      if (!window.connectedDevices?.trainer) {
          alert("먼저 스마트 트레이너를 연결해주세요.");
          e.target.checked = !isEnabled; // 복구
          return;
      }

      try {
        await window.ergController.toggleErgMode(isEnabled);
      } catch (err) {
        console.error("ERG Fail:", err);
        // ★ 에러 발생 시 UI 즉시 복구 (체크 해제)
        e.target.checked = !isEnabled;
        if(status) status.textContent = "OFF";
        
        const msg = err.message || "제어 실패";
        // 'Control Point Missing'일 경우 구체적 안내
        if (msg.includes("Control Point")) {
             alert("오류: 트레이너 제어 권한을 얻지 못했습니다.\n\n페이지를 새로고침 한 뒤 트레이너를 다시 연결해주세요.");
        } else {
             alert("ERG 모드 전환 실패: " + msg);
        }
      }
    });
  }
}

window.toggleErgMode = async function(enabled) {
  if (window.ergController) return window.ergController.toggleErgMode(enabled);
};
window.setErgTargetPower = async function(watts) {
  if (window.ergController) return window.ergController.setTargetPower(watts);
};

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', initializeErgMode);
