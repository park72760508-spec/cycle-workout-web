/* ==========================================================
   ergMode.js (v5.2 Final Integrity)
   - ERG UI 동작 관리 및 에러 안전장치(Safety Switch)
   - app.js 호환용 래퍼 함수(toggleErgMode, setErgTargetPower) 포함
========================================================== */

function initializeErgMode() {
  const toggle = document.getElementById('ergModeToggle');
  const status = document.getElementById('ergModeStatus');
  const container = document.getElementById('ergModeContainer');

  if (!toggle) return;

  // 1. ErgController 상태 구독 (UI 동기화)
  if (window.ergController && window.ergController.subscribe) {
    window.ergController.subscribe((state, key, value) => {
      if (key === 'enabled') {
        toggle.checked = value;
        if (status) status.textContent = value ? 'ON' : 'OFF';
        if (container) value ? container.classList.add('active') : container.classList.remove('active');
        
        // 버튼 색상 업데이트 (bluetooth.js와 연동)
        if (window.updateBluetoothConnectionButtonColor) {
            window.updateBluetoothConnectionButtonColor();
        }
      }
    });
  }

  // 2. 스위치 이벤트 리스너
  // (중복 등록 방지를 위한 속성 체크)
  if (!toggle.hasAttribute('data-init')) {
    toggle.setAttribute('data-init', 'true');
    
    toggle.addEventListener('change', async (e) => {
      const isEnabled = e.target.checked;
      
      // 트레이너 연결 선행 체크
      if (!window.connectedDevices?.trainer) {
          alert("먼저 스마트 트레이너를 연결해주세요.");
          e.target.checked = !isEnabled; // 스위치 원복
          return;
      }

      try {
        // 컨트롤러 호출
        if (window.ergController) {
            await window.ergController.toggleErgMode(isEnabled);
        } else {
            throw new Error("ErgController가 로드되지 않았습니다.");
        }
      } catch (err) {
        console.error("ERG Toggle Fail:", err);
        
        // ★ 실패 시 즉시 UI 복구 (체크 해제)
        e.target.checked = !isEnabled; 
        if(status) status.textContent = "OFF";
        
        const msg = err.message || "알 수 없는 오류";
        // 사용자가 이해하기 쉬운 에러 메시지
        if (msg.includes("Control Point")) {
            alert("⚠️ 트레이너 제어 권한 오류\n\n페이지를 새로고침(F5)하고 다시 연결해주세요.");
        } else {
            alert("ERG 모드 전환 실패: " + msg);
        }
      }
    });
  }
}

// ── [호환성 래퍼 함수] ──
// app.js나 다른 곳에서 window.toggleErgMode()를 호출해도 작동하도록 유지

window.toggleErgMode = async function(enabled) {
  if (window.ergController) {
    return window.ergController.toggleErgMode(enabled);
  }
};

window.setErgTargetPower = async function(watts) {
  if (window.ergController) {
    return window.ergController.setTargetPower(watts);
  }
};

// DOM 로드 시 초기화
document.addEventListener('DOMContentLoaded', initializeErgMode);
