/* ==========================================================
   ergMode.js (v2.1 UI Linker)
========================================================== */
function initializeErgMode() {
  const toggle = document.getElementById('ergModeToggle');
  const container = document.getElementById('ergModeContainer');
  if (!toggle) return;

  if (window.ergController) {
    window.ergController.subscribe((state, key, value) => {
      if (key === 'enabled') {
        toggle.checked = value;
        if (container) value ? container.classList.add('active') : container.classList.remove('active');
        if (typeof window.updateBluetoothConnectionButtonColor === 'function') window.updateBluetoothConnectionButtonColor();
      }
    });
  }

  const handleToggle = async (e) => {
    const isChecked = e.target.checked;
    if (!window.connectedDevices?.trainer) {
        alert("로라 연결이 필요합니다.");
        e.target.checked = !isChecked;
        return;
    }
    try {
      await window.ergController.toggleErgMode(isChecked);
    } catch (err) {
      alert("오류: " + err.message);
      e.target.checked = !isChecked;
    }
  };

  if (!toggle._hasErgListener) {
      toggle.addEventListener('change', handleToggle);
      toggle._hasErgListener = true;
  }
}

window.setErgTargetPower = function(watts) {
    if(window.ergController) window.ergController.setTargetPower(watts);
};
window.toggleErgMode = function(enable) {
    if(window.ergController) {
        const t = document.getElementById('ergModeToggle');
        if(t) t.checked = enable;
        window.ergController.toggleErgMode(enable);
    }
};

document.addEventListener('DOMContentLoaded', initializeErgMode);
