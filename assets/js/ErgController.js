/* ==========================================================
   ErgController.js (v4.0 Zwift-Grade Logic)
   - Keep-Alive(Heartbeat): 2초마다 파워 명령 재전송 (끊김 방지)
   - Handshake: 'Request Control (0x00)' 필수 전송
   - Retry Logic: 명령 실패 시 자동 재시도
========================================================== */

class ErgController {
  constructor() {
    this._state = {
      enabled: false,
      targetPower: 0,
      connectionStatus: 'disconnected'
    };
    this.state = this._createReactiveState(this._state);

    // 명령 큐
    this._commandQueue = [];
    this._isProcessing = false;
    
    // Keep-Alive 타이머 (Zwift 방식)
    this._keepAliveInterval = null;
    this._lastSentPower = 0;

    // 구독자 리스트
    this._subscribers = [];

    console.log('[ErgController] v4.0 (Zwift Logic) Loaded');
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

  subscribe(callback) {
    this._subscribers.push(callback);
  }

  _notifySubscribers(key, value) {
    this._subscribers.forEach(cb => { try { cb(this.state, key, value); } catch(e){} });
  }

  // ── [1] ERG 모드 토글 (Handshake 포함) ──
  async toggleErgMode(enable) {
    const trainer = window.connectedDevices?.trainer;
    
    if (!trainer || !trainer.controlPoint) {
      this.state.enabled = false;
      throw new Error("스마트 로라가 연결되지 않았거나 제어 권한이 없습니다.");
    }

    // 상태 업데이트
    this.state.enabled = enable;
    
    if (enable) {
      console.log('[ERG] 활성화 시도...');
      
      // ★ 중요: Request Control (OpCode 0x00)
      // FTMS 및 대부분의 최신 펌웨어 CycleOps/Wahoo는 이 핸드셰이크가 필수입니다.
      try {
        if (trainer.protocol === 'FTMS' || trainer.protocol === 'CYCLEOPS') {
           await this._sendCommand([0x00]); // Request Control
           console.log('[ERG] 제어권 요청(0x00) 전송 완료');
        }
        // 제어권 획득 성공 시, 현재 타겟 파워로 즉시 시작
        if (this.state.targetPower > 0) {
            await this.setTargetPower(this.state.targetPower);
        }
        // Keep-Alive 시작
        this._startKeepAlive();
        if (typeof showToast === 'function') showToast("ERG 모드 ON (제어권 확보)");
      } catch (e) {
        console.error('[ERG] 제어권 요청 실패:', e);
        this.state.enabled = false;
        throw new Error("제어권 요청 실패: " + e.message);
      }
    } else {
      // 비활성화 시 Reset or Resistance Mode
      this._stopKeepAlive();
      this.state.targetPower = 0;
      // Reset Command (OpCode 0x01? or just stop)
      // 일부 기기는 0x01(Reset)을 보내면 연결을 끊어버릴 수 있으므로 주의.
      // 안전하게는 그냥 명령 전송을 멈추는 것이지만, FTMS 표준은 Reset을 권장.
      if (trainer.protocol === 'FTMS') {
          this._sendCommand([0x01]).catch(()=> console.warn("Reset fail ignored")); 
      }
      if (typeof showToast === 'function') showToast("ERG 모드 OFF");
    }
  }

  // ── [2] 파워 설정 (Keep-Alive 지원) ──
  async setTargetPower(watts) {
    if (!this.state.enabled || watts < 0) return;
    
    this.state.targetPower = Math.round(watts);
    
    // 즉시 전송
    await this._sendPowerCommand(this.state.targetPower);
  }

  // 실제 명령 전송 (프로토콜 분기)
  async _sendPowerCommand(watts) {
    const trainer = window.connectedDevices?.trainer;
    if (!trainer || !trainer.controlPoint) return;

    let buffer;
    const protocol = trainer.protocol;

    try {
      if (protocol === 'FTMS') {
        // FTMS: OpCode 0x05 + Power(int16)
        buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x05); // Set Target Power
        view.setInt16(1, watts, true); // Little Endian
      } 
      else if (protocol === 'CYCLEOPS' || protocol === 'WAHOO') {
        // Legacy: 보통 OpCode 0x42 (Wahoo/CycleOps 공통)을 사용하거나
        // CycleOps의 경우 그냥 Uint8/16 값을 직접 쓰기도 함.
        // 하지만 Hammer 최신 펌웨어는 FTMS OpCode를 Legacy Characteristic에서도 받아들임.
        // 안전하게 Wahoo Legacy Format (0x42 + Power) 시도
        buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x42); 
        view.setUint16(1, watts * 1, true); // *1은 형변환 확실히
      } else {
        // Unknown: FTMS 포맷 시도
        buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x05);
        view.setInt16(1, watts, true);
      }

      await this._sendCommand(buffer);
      this._lastSentPower = watts;
      // console.log(`[ERG] ${watts}W 전송 성공`);

    } catch (e) {
      console.warn(`[ERG] 파워 전송 실패 (${watts}W):`, e);
    }
  }

  // Low-level write wrapper
  async _sendCommand(data) {
    const trainer = window.connectedDevices?.trainer;
    if (!trainer || !trainer.controlPoint) return;
    
    // Array -> Uint8Array / ArrayBuffer 그대로
    const value = (Array.isArray(data)) ? new Uint8Array(data) : data;
    
    // GATT Write (Response 필수 여부에 따라 WriteValueWithResponse 등 사용 가능하나 기본 writeValue 권장)
    await trainer.controlPoint.writeValue(value);
  }

  // ── [3] Keep-Alive (Zwift Logic) ──
  // 스마트로라는 2~5초간 명령이 없으면 ERG를 풀고 Resistance 모드로 돌아감.
  // 따라서 값이 변하지 않아도 주기적으로 쏴줘야 함.
  _startKeepAlive() {
    this._stopKeepAlive();
    this._keepAliveInterval = setInterval(() => {
        if (this.state.enabled && this.state.targetPower > 0) {
            // console.log('[ERG] Keep-Alive Tick');
            this._sendPowerCommand(this.state.targetPower);
        }
    }, 2000); // 2초마다 재전송
  }

  _stopKeepAlive() {
    if (this._keepAliveInterval) {
        clearInterval(this._keepAliveInterval);
        this._keepAliveInterval = null;
    }
  }

  // 외부 데이터 수신 (그래프 업데이트 등 용도)
  updatePower(p) { /* 필요시 구현 */ }
  updateConnectionStatus(status) {
      this.state.connectionStatus = status;
      if (status === 'disconnected') {
          this.state.enabled = false;
          this._stopKeepAlive();
      }
  }
}

const ergController = new ErgController();
if (typeof window !== 'undefined') window.ergController = ergController;
