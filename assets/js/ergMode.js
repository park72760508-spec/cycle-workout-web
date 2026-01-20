/* ==========================================================
   ergMode.js (v2.2 Safe Linker)
   - UI 이벤트 및 예외 처리
========================================================== */

function initializeErgMode() {
  const toggle = document.getElementById('ergModeToggle');
  const container = document.getElementById('ergModeContainer');
  const statusLabel = document.getElementById('ergModeStatus');

  if (!toggle) return;

  // 1. Controller 상태 -> UI 반영
  if (window.ergController) {
    window.ergController.subscribe((state, key, value) => {
      if (key === 'enabled') {
        toggle.checked = value;
        if (statusLabel) statusLabel.textContent = value ? 'ON' : 'OFF';
        if (container) value ? container.classList.add('active') : container.classList.remove('active');
        
        // 버튼 색상 업데이트
        if (typeof window.updateBluetoothConnectionButtonColor === 'function') {
            window.updateBluetoothConnectionButtonColor();
        }
      }
    });
  }

  // 2. UI 조작 -> Controller 명령
  const handleToggle = async (e) => {
    const isChecked = e.target.checked;
    
    // 안전장치: 트레이너 연결 확인
    if (!window.connectedDevices?.trainer) {
        alert("스마트 로라가 연결되지 않았습니다.");
        e.preventDefault();
        e.target.checked = !isChecked; // 원복
        return;
    }

    try {
      await window.ergController.toggleErgMode(isChecked);
    } catch (err) {
      console.error("ERG Toggle Error:", err);
      alert("ERG 모드 실패: " + err.message);
      e.target.checked = !isChecked; // 원복
    }
  };

  // 중복 리스너 방지
  if (!toggle._hasErgListener) {
      toggle.addEventListener('change', handleToggle);
      toggle._hasErgListener = true;
  }
}

// Global Wrapper (외부 호출용)
window.setErgTargetPower = function(watts) {
  if (window.ergController) {
      window.ergController.setTargetPower(watts);
  }
};

window.toggleErgMode = function(enable) {
  if (window.ergController) {
      const t = document.getElementById('ergModeToggle');
      if (t) t.checked = enable;
      window.ergController.toggleErgMode(enable);
  }
};

document.addEventListener('DOMContentLoaded', initializeErgMode);
