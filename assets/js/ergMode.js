/* ==========================================================
   ergMode.js (v4.1 Full Integrity)
   - UI 이벤트 핸들러 및 상태 동기화 로직
   - 비동기 에러 핸들링 추가 (ERG 실패 시 스위치 OFF 복구)
========================================================== */

function initializeErgMode() {
  const toggle = document.getElementById('ergModeToggle');
  const status = document.getElementById('ergModeStatus');
  const container = document.getElementById('ergModeContainer');

  if (!toggle) {
    // ergMode UI가 없는 페이지일 수 있으므로 조용히 리턴
    return;
  }

  // 1. UI 상태 동기화 (ErgController -> UI)
  // 컨트롤러의 상태가 변하면(예: 연결 끊김으로 자동 꺼짐) UI도 따라감
  if (window.ergController && typeof window.ergController.subscribe === 'function') {
    window.ergController.subscribe((state, key, value) => {
      if (key === 'enabled') {
        toggle.checked = value;
        if (status) status.textContent = value ? 'ON' : 'OFF';
        if (container) value ? container.classList.add('active') : container.classList.remove('active');
        
        // 블루투스 버튼 색상 등 연동
        if (typeof updateBluetoothConnectionButtonColor === 'function') {
          updateBluetoothConnectionButtonColor();
        }
      }
    });
  }

  // 2. 이벤트 리스너 (UI -> ErgController)
  // 중복 등록 방지
  if (!toggle.hasAttribute('data-init')) {
    toggle.setAttribute('data-init', 'true');
    
    toggle.addEventListener('change', async (e) => {
      const isEnabled = e.target.checked;
      
      // 트레이너 연결 확인
      if (!window.connectedDevices || !window.connectedDevices.trainer) {
          alert("스마트 트레이너가 먼저 연결되어야 합니다.");
          e.target.checked = !isEnabled; // 스위치 원복
          return;
      }

      try {
        if (window.ergController) {
          // 비동기 호출 (에러 발생 시 catch로 이동)
          await window.ergController.toggleErgMode(isEnabled);
        } else {
          throw new Error("ErgController가 로드되지 않았습니다.");
        }
      } catch (err) {
        console.error("ERG 제어 실패:", err);
        e.target.checked = !isEnabled; // 실패했으므로 스위치 원복
        if (status) status.textContent = "OFF";
        
        const msg = err.message || "알 수 없는 오류";
        if (typeof showToast === 'function') showToast("ERG 실패: " + msg);
        else alert("ERG 모드 전환 실패: " + msg);
      }
    });
  }
}

// ── 호환성 래퍼 함수 (외부/기존 코드 호환용) ──

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

// 페이지 로드 시 초기화 시도
document.addEventListener('DOMContentLoaded', initializeErgMode);
