/* ==========================================================
   ErgController.js (v3.0 Multi-Protocol Support)
   - FTMS(0x05)와 Legacy(0x42) 명령 자동 전환 기능 탑재
   - CycleOps Hammer의 부하 제어 문제 완벽 해결
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
    console.log('[ErgController] v3.0 초기화 (Multi-Protocol)');
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
      if (!trainer.controlPoint) throw new Error('제어권 없음');

      this.state.enabled = enable;
      this.state.connectionStatus = 'connected';

      if (enable) {
        // ★ Legacy 기기는 별도의 "Take Control" 명령이 필요 없을 수 있으나
        // FTMS는 필요함. 프로토콜에 따라 분기
        if (trainer.realProtocol === 'FTMS') {
            await this._queueCommand(() => {
                const cmd = new Uint8Array([0x00]); // Request Control
                return trainer.controlPoint.writeValue(cmd);
            }, 'REQUEST_CONTROL', { priority: 90 });
        }
        // Legacy는 즉시 파워 설정 준비 완료
        if (typeof showToast === 'function') showToast('ERG 모드 ON');
      } else {
        // 해제
        if (trainer.realProtocol === 'FTMS') {
             await this._queueCommand(() => {
                const cmd = new Uint8Array([0x01]); // Reset
                return trainer.controlPoint.writeValue(cmd);
            }, 'RESET', { priority: 100 });
        }
        this.state.targetPower = 0;
        if (typeof showToast === 'function') showToast('ERG 모드 OFF');
      }
    } catch (error) {
      this.state.enabled = false;
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
      
      // ★ 프로토콜별 명령 생성
      let buffer;
      const protocol = trainer.realProtocol || 'FTMS';

      if (protocol === 'FTMS') {
        // 표준 FTMS: OpCode 0x05 + uint16 (power)
        buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x05); 
        view.setInt16(1, targetWatts, true);
        console.log(`[ERG] Sending FTMS (0x05) -> ${targetWatts}W`);
      } 
      else if (protocol === 'CYCLEOPS' || protocol === 'WAHOO') {
        // ★ CycleOps/Wahoo Legacy: OpCode 0x42 + uint16 (power)
        buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x42); // Wahoo Legacy Set Watts
        view.setUint16(1, targetWatts, true);
        console.log(`[ERG] Sending Legacy (0x42) -> ${targetWatts}W`);
      }
      else {
        console.warn(`[ERG] 알 수 없는 프로토콜: ${protocol}, 기본값(0x42) 시도`);
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
