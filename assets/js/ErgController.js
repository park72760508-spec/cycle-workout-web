/* ==========================================================
   ErgController.js (v3.1 Universal ERG Support)
   - FTMS(0x05)와 Legacy(0x42) 명령 자동 전환 기능 탑재
   - CycleOps Hammer 구형 기기 ERG 모드 완벽 지원
   - ZWIFT/Mywoosh 호환 ERG 제어 로직 적용
   - 구형/신형 스마트 트레이너 모두 대응
========================================================== */

class ErgController {
  constructor() {
    this._state = {
      enabled: false,
      targetPower: 0,
      currentPower: 0,
      pidParams: { Kp: 0.5, Ki: 0.1, Kd: 0.05 },
      pedalingStyle: 'smooth',
      fatigueLevel: 0,
      autoAdjustmentEnabled: true,
      connectionStatus: 'disconnected'
    };
    this.state = this._createReactiveState(this._state);

    this._commandQueue = [];
    this._isProcessingQueue = false;
    this._lastCommandTime = 0;
    this._minCommandInterval = 200;
    this._maxQueueSize = 50;
    this._commandTimeout = 5000;
    this._subscribers = [];
    this._cadenceHistory = [];
    this._powerHistory = [];
    this._heartRateHistory = [];
    this._lastPowerUpdateTime = 0;
    this._powerUpdateDebounce = 500;

    // 명령 우선순위
    this._commandPriorities = {
      'RESET': 100,
      'REQUEST_CONTROL': 90,
      'SET_TARGET_POWER': 50
    };

    this._setupConnectionWatcher();
    console.log('[ErgController] v3.1 초기화 (Universal ERG Support)');
  }

  // (기존 setupConnectionWatcher, resetState, createReactiveState 등 생략 - 동일함)
  _setupConnectionWatcher() {
    let lastTrainerState = null;
    const checkConnection = () => {
      const currentTrainer = window.connectedDevices?.trainer;
      const wasConnected = lastTrainerState?.controlPoint !== null;
      const isConnected = currentTrainer?.controlPoint !== null;
      if (wasConnected && !isConnected) this._resetState();
      if (isConnected !== (this.state.connectionStatus === 'connected')) {
        this.state.connectionStatus = isConnected ? 'connected' : 'disconnected';
      }
      lastTrainerState = currentTrainer;
    };
    setInterval(checkConnection, 1000);
  }

  _resetState() {
    if (this.state.enabled) {
      this.state.enabled = false;
      this.state.targetPower = 0;
      this.state.connectionStatus = 'disconnected';
      this._commandQueue = [];
      this._isProcessingQueue = false;
    }
  }

  _createReactiveState(state) {
    const self = this;
    return new Proxy(state, {
      set(target, key, value) {
        if (target[key] !== value) {
          target[key] = value;
          self._notifySubscribers(key, value);
        }
        return true;
      },
      get(target, key) { return target[key]; }
    });
  }

  subscribe(callback) {
    if (typeof callback !== 'function') return;
    this._subscribers.push(callback);
    return () => {
      const idx = this._subscribers.indexOf(callback);
      if (idx > -1) this._subscribers.splice(idx, 1);
    };
  }

  _notifySubscribers(key, value) {
    this._subscribers.forEach(cb => { try{ cb(this.state, key, value); }catch(e){} });
  }

  async toggleErgMode(enable) {
    try {
      const trainer = window.connectedDevices?.trainer;
      if (!trainer) throw new Error('스마트로라 연결 안됨');

      // Control Point 확인
      if (!trainer.controlPoint) {
        throw new Error('제어권 없음 - ERG 모드를 사용하려면 스마트 트레이너가 필요합니다');
      }

      this.state.enabled = enable;
      this.state.connectionStatus = 'connected';

      if (enable) {
        const protocol = trainer.realProtocol || 'FTMS';
        
        // ★ FTMS: Request Control 필요
        if (protocol === 'FTMS') {
          await this._queueCommand(() => {
            const cmd = new Uint8Array([0x00]); // Request Control
            return trainer.controlPoint.writeValue(cmd);
          }, 'REQUEST_CONTROL', { priority: 90 });
          console.log('[ERG] FTMS Request Control 전송');
        }
        // ★ CycleOps/Wahoo Legacy: 일부 기기는 초기화 명령 필요
        else if (protocol === 'CYCLEOPS' || protocol === 'WAHOO') {
          // ZWIFT/Mywoosh 방식: 구형 CycleOps는 초기화 후 바로 파워 설정 가능
          // 일부 기기는 0x01 (Reset) 명령으로 초기화 후 사용
          try {
            await this._queueCommand(() => {
              const cmd = new Uint8Array([0x01]); // Reset/Initialize
              return trainer.controlPoint.writeValue(cmd);
            }, 'RESET', { priority: 90 });
            console.log('[ERG] Legacy 초기화 명령 전송');
            // 초기화 후 약간의 지연
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (e) {
            // 초기화 실패해도 계속 진행 (일부 기기는 필요 없음)
            console.warn('[ERG] Legacy 초기화 실패, 계속 진행:', e);
          }
        }
        
        if (typeof showToast === 'function') showToast('ERG 모드 ON');
      } else {
        // ERG 모드 해제
        const protocol = trainer.realProtocol || 'FTMS';
        
        if (protocol === 'FTMS') {
          await this._queueCommand(() => {
            const cmd = new Uint8Array([0x01]); // Reset
            return trainer.controlPoint.writeValue(cmd);
          }, 'RESET', { priority: 100 });
          console.log('[ERG] FTMS Reset 전송');
        }
        // Legacy 기기는 파워를 0으로 설정하여 해제
        else if (protocol === 'CYCLEOPS' || protocol === 'WAHOO') {
          try {
            await this._queueCommand(() => {
              const buffer = new ArrayBuffer(3);
              const view = new DataView(buffer);
              view.setUint8(0, 0x42); // Set Power
              view.setUint16(1, 0, true); // 0W
              return trainer.controlPoint.writeValue(buffer);
            }, 'SET_TARGET_POWER', { priority: 100 });
            console.log('[ERG] Legacy 파워 0W 설정');
          } catch (e) {
            console.warn('[ERG] Legacy 해제 실패:', e);
          }
        }
        
        this.state.targetPower = 0;
        if (typeof showToast === 'function') showToast('ERG 모드 OFF');
      }
    } catch (error) {
      this.state.enabled = false;
      console.error('[ERG] toggleErgMode 오류:', error);
      if (typeof showToast === 'function') showToast(error.message);
    }
  }

  // ★ [핵심] 프로토콜에 따른 명령 분기
  async setTargetPower(watts) {
    if (!this.state.enabled) return;
    if (watts < 0) return;

    const trainer = window.connectedDevices?.trainer;
    if (!trainer || !trainer.controlPoint) return;

    const now = Date.now();
    if (now - this._lastPowerUpdateTime < this._powerUpdateDebounce) {
      return new Promise((resolve) => {
        setTimeout(() => { this.setTargetPower(watts).then(resolve); }, 
        this._powerUpdateDebounce - (now - this._lastPowerUpdateTime));
      });
    }
    this._lastPowerUpdateTime = now;

    try {
      const targetWatts = Math.round(watts);
      
      // ★ 프로토콜별 명령 생성 (ZWIFT/Mywoosh 호환)
      let buffer;
      const protocol = trainer.realProtocol || 'FTMS';

      if (protocol === 'FTMS') {
        // 표준 FTMS: OpCode 0x05 + int16 (power, little-endian)
        buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x05); // Set Target Power
        view.setInt16(1, targetWatts, true); // Little-endian
        console.log(`[ERG] FTMS (0x05) -> ${targetWatts}W`);
      } 
      else if (protocol === 'CYCLEOPS' || protocol === 'WAHOO') {
        // ★ CycleOps/Wahoo Legacy: OpCode 0x42 + uint16 (power, little-endian)
        // ZWIFT/Mywoosh에서 사용하는 표준 방식
        buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x42); // Set Target Power (Legacy)
        view.setUint16(1, targetWatts, true); // Little-endian, unsigned
        console.log(`[ERG] Legacy (0x42) -> ${targetWatts}W`);
      }
      else if (protocol === 'CPS') {
        // CPS만 있고 Control Point가 있는 경우 (드문 경우)
        // 일부 기기는 CPS Control Point (0x2A66)를 사용할 수 있음
        console.warn(`[ERG] CPS 프로토콜 - Control Point 확인 필요`);
        buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x42); // 기본값 시도
        view.setUint16(1, targetWatts, true);
      }
      else {
        // 알 수 없는 프로토콜: Legacy 방식 시도
        console.warn(`[ERG] 알 수 없는 프로토콜: ${protocol}, Legacy(0x42) 시도`);
        buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x42);
        view.setUint16(1, targetWatts, true);
      }

      await this._queueCommand(() => {
        return trainer.controlPoint.writeValue(buffer);
      }, 'SET_TARGET_POWER', { priority: 50 });

      this.state.targetPower = watts;

    } catch (error) {
      console.error('[ErgController] 파워 설정 오류:', error);
    }
  }

  // (이하 큐 처리 및 기타 함수 동일)
  async _queueCommand(commandFn, commandType, options = {}) {
    return new Promise((resolve, reject) => {
      if (this._commandQueue.length >= this._maxQueueSize) this._commandQueue.shift();
      const priority = options.priority || this._commandPriorities[commandType] || 0;
      const command = {
        commandFn, commandType, resolve, reject,
        timestamp: Date.now(), priority,
        retryCount: 0, maxRetries: 3
      };
      const idx = this._commandQueue.findIndex(cmd => cmd.priority < priority);
      if (idx === -1) this._commandQueue.push(command);
      else this._commandQueue.splice(idx, 0, command);
      if (!this._isProcessingQueue) this._startQueueProcessing();
    });
  }

  _startQueueProcessing() {
    if (this._isProcessingQueue) return;
    this._isProcessingQueue = true;
    const processNext = async () => {
      if (this._commandQueue.length === 0) {
        this._isProcessingQueue = false;
        return;
      }
      const now = Date.now();
      if (now - this._lastCommandTime < this._minCommandInterval) {
        setTimeout(processNext, this._minCommandInterval - (now - this._lastCommandTime));
        return;
      }
      const command = this._commandQueue.shift();
      this._lastCommandTime = Date.now();
      try {
        await command.commandFn();
        command.resolve();
      } catch (error) {
        if (command.retryCount < command.maxRetries) {
          command.retryCount++;
          this._commandQueue.unshift(command);
        } else {
          command.reject(error);
        }
      }
      setTimeout(processNext, this._minCommandInterval);
    };
    processNext();
  }

  // 데이터 수집 (생략 - 기존 유지)
  updateCadence(c) { if(c>0) this._cadenceHistory.push(c); }
  updatePower(p) { if(p>0) this._powerHistory.push({value:p, timestamp:Date.now()}); }
  updateHeartRate(h) { if(h>0) this._heartRateHistory.push({value:h, timestamp:Date.now()}); }
  updateConnectionStatus(s) { this.state.connectionStatus = s; if(s==='disconnected') this._resetState(); }
  getState() { return {...this.state}; }
}

const ergController = new ErgController();
if (typeof window !== 'undefined') window.ergController = ergController;
if (typeof module !== 'undefined' && module.exports) module.exports = { ergController, ErgController };
