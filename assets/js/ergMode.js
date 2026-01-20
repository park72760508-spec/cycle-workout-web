/* ==========================================================
   ergMode.js (v2.0 Refactored)
   - 직접 제어 로직 제거 -> ErgController로 위임(Delegation)
   - UI 이벤트와 AI 파라미터 조정 기능만 담당
   - CycleOps/Wahoo 등 레거시 기기 호환성 완벽 보장
========================================================== */

// 초기화 함수
function initializeErgMode() {
  const toggle = document.getElementById('ergModeToggle');
  const status = document.getElementById('ergModeStatus');
  const container = document.getElementById('ergModeContainer');

  if (!toggle || !container) return;

  // 1. UI 상태 동기화 (ErgController의 상태를 구독)
  if (window.ergController && typeof window.ergController.subscribe === 'function') {
    window.ergController.subscribe((state, key, value) => {
      if (key === 'enabled') {
        toggle.checked = value;
        if (status) status.textContent = value ? 'ON' : 'OFF';
        if (container) value ? container.classList.add('active') : container.classList.remove('active');
        
        // 버튼 색상 업데이트 등 추가 UI 로직
        if (typeof updateBluetoothConnectionButtonColor === 'function') {
          updateBluetoothConnectionButtonColor();
        }
      }
    });
  }

  // 2. 이벤트 리스너 (직접 제어하지 않고 ErgController 호출)
  if (!toggle.hasAttribute('data-init')) {
    toggle.setAttribute('data-init', 'true');
    toggle.addEventListener('change', async (e) => {
      const isEnabled = e.target.checked;
      try {
        if (window.ergController) {
          await window.ergController.toggleErgMode(isEnabled);
          // 토스트 메시지는 ErgController 내부에서 처리하거나 여기서 보조
        } else {
          throw new Error("ErgController가 로드되지 않았습니다.");
        }
      } catch (err) {
        console.error("ERG 토글 실패:", err);
        e.target.checked = !isEnabled; // 실패 시 스위치 원복
        if (typeof showToast === 'function') showToast("ERG 제어 실패: " + err.message);
      }
    });
  }
}

// 기존 코드와의 호환성을 위한 래퍼 함수들
// (외부에서 이 함수들을 호출하더라도 ErgController로 연결됨)

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

// AI 관련 로직 (PID 튜닝 등)은 ErgController 내부로 통합되었거나
// 단순 시각적 효과라면 여기에 남겨둘 수 있습니다.
// 현재 ErgController.js v3.0에 이미 PID 및 AI 로직이 포함되어 있으므로
// 중복 실행을 막기 위해 제거하는 것이 안전합니다.
