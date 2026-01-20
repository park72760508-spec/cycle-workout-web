/* ==========================================================
   ErgController.js (v5.0 Protocol Matcher)
   - CycleOps/Legacy 모드에서 ERG 동작 보장
   - Handshake (0x00) 필수 전송
========================================================== */

class ErgController {
  constructor() {
    this._state = {
      enabled: false,
      targetPower: 0,
      connectionStatus: 'disconnected'
    };
    this.state = this._createReactiveState(this._state);
    this._keepAliveInterval = null;
    this._subscribers = [];
  }

  _createReactiveState(obj) {
    const self = this;
    return new Proxy(obj, {
      set(target, key, value) {
        if (target[key] !== value) {
            target[key] = value;
            self._notifySubscribers(key, value);
        }
        return true;
      }
    });
  }

  subscribe(cb) { this._subscribers.push(cb); }
  _notifySubscribers(k, v) { this._subscribers.forEach(cb => { try{cb(this.state, k, v)}catch(e){} }); }

  async toggleErgMode(enable) {
    const trainer = window.connectedDevices?.trainer;
    if (!trainer || !trainer.controlPoint) {
      this.state.enabled = false;
      throw new Error("제어권(Control Point)이 없습니다. 다시 연결해주세요.");
    }

    this.state.enabled = enable;
    
    if (enable) {
      try {
        // ★ CycleOps는 연결 초기 또는 ERG 시작 시 Control Request(0x00) 필요
        if (trainer.protocol === 'FTMS' || trainer.protocol === 'CYCLEOPS') {
           // [OpCode 0x00: Request Control]
           await trainer.controlPoint.writeValue(new Uint8Array([0x00]));
           console.log('[ERG] Control Request(0x00) sent');
        }
        
        if (this.state.targetPower > 0) await this.setTargetPower(this.state.targetPower);
        this._startKeepAlive();
        if(typeof showToast === 'function') showToast("ERG 모드 ON");

      } catch (e) {
        this.state.enabled = false;
        console.error(e);
        throw new Error("제어권 요청 실패: " + e.message);
      }
    } else {
      this._stopKeepAlive();
      this.state.targetPower = 0;
      if(typeof showToast === 'function') showToast("ERG 모드 OFF");
    }
  }

  async setTargetPower(watts) {
    if (!this.state.enabled) return;
    this.state.targetPower = Math.round(watts);
    await this._sendPower(this.state.targetPower);
  }

  async _sendPower(watts) {
    const trainer = window.connectedDevices?.trainer;
    if (!trainer || !trainer.controlPoint) return;

    let buffer;
    // Protocol별 명령 패킷 생성
    if (trainer.protocol === 'FTMS') {
        // FTMS: 0x05 + int16
        buffer = new ArrayBuffer(3);
        const v = new DataView(buffer);
        v.setUint8(0, 0x05);
        v.setInt16(1, watts, true);
    } 
    else if (trainer.protocol === 'CYCLEOPS') {
        // ★ Legacy CycleOps: 보통 OpCode 없이 바로 Uint8/16을 쓰거나 Wahoo 모드를 씀.
        // 하지만 Hammer 등은 0x42 (Wahoo Emulation) 또는 Custom을 씀.
        // 가장 호환성 높은 방법: Wahoo Legacy Format (0x42 + Power)
        buffer = new ArrayBuffer(3);
        const v = new DataView(buffer);
        v.setUint8(0, 0x42); 
        v.setUint16(1, watts, true);
    }
    else if (trainer.protocol === 'WAHOO') {
        buffer = new ArrayBuffer(3);
        const v = new DataView(buffer);
        v.setUint8(0, 0x42);
        v.setUint16(1, watts, true);
    }
    else {
        // Default fallback
        buffer = new ArrayBuffer(3);
        const v = new DataView(buffer);
        v.setUint8(0, 0x42);
        v.setUint16(1, watts, true);
    }

    try {
        await trainer.controlPoint.writeValue(buffer);
    } catch(e) {
        console.warn('Power Send Fail:', e);
    }
  }

  _startKeepAlive() {
    this._stopKeepAlive();
    this._keepAliveInterval = setInterval(() => {
        if(this.state.enabled && this.state.targetPower > 0) {
            this._sendPower(this.state.targetPower);
        }
    }, 2000);
  }

  _stopKeepAlive() {
    if(this._keepAliveInterval) clearInterval(this._keepAliveInterval);
    this._keepAliveInterval = null;
  }

  updatePower(p) { /* 그래프용 */ }
  updateConnectionStatus(s) {
      this.state.connectionStatus = s;
      if(s==='disconnected') { this.state.enabled = false; this._stopKeepAlive(); }
  }
}

const ergController = new ErgController();
if (typeof window !== 'undefined') window.ergController = ergController;
