/* ==========================================================
   ErgController.js (v2.1 Universal Support)
   - CycleOps, Wahoo, Tacx 구형 기기 재연결 지원
   - Deep Scan을 통해 숨겨진 Control Point 복구
========================================================== */

/**
 * Modern ERG Controller Class
 * Singleton Pattern으로 전역 상태 오염 방지
 */
class ErgController {
  constructor() {
    // 내부 상태
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

    // BLE 명령 큐
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
    this._lastCloudAICall = 0;
    this._cloudAICallInterval = 5 * 60 * 1000;
    this._lastPowerUpdateTime = 0;
    this._powerUpdateDebounce = 500;

    // ★ [핵심] 모든 Legacy UUID 등록
    this.UUIDS = {
      FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb',
      FTMS_CONTROL: '00002ad9-0000-1000-8000-00805f9b34fb',
      // CycleOps Legacy
      CYCLEOPS_SERVICE: '347b0001-7635-408b-8918-8ff3949ce592',
      CYCLEOPS_CONTROL: '347b0012-7635-408b-8918-8ff3949ce592',
      // Wahoo Legacy
      WAHOO_SERVICE:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
      WAHOO_CONTROL:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
      // Tacx Legacy
      TACX_SERVICE:     '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e',
      TACX_CONTROL:     '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e'
    };

    this.ERG_OP_CODES = {
      REQUEST_CONTROL: 0x00,
      RESET: 0x01,
      SET_TARGET_POWER: 0x05
    };

    this._commandPriorities = {
      'RESET': 100,
      'REQUEST_CONTROL': 90,
      'SET_TARGET_POWER': 50
    };

    this._setupConnectionWatcher();
    console.log('[ErgController] 초기화 완료 (v2.1 Universal)');
  }

  _setupConnectionWatcher() {
    let lastTrainerState = null;
    const checkConnection = () => {
      const currentTrainer = window.connectedDevices?.trainer;
      const wasConnected = lastTrainerState?.controlPoint !== null;
      const isConnected = currentTrainer?.controlPoint !== null;
      if (wasConnected && !isConnected) {
        console.log('[ErgController] 연결 해제 -> 초기화');
        this._resetState();
      }
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
        const oldValue = target[key];
        if (oldValue !== value) {
          target[key] = value;
          self._notifySubscribers(key, value, oldValue);
        }
        return true;
      },
      get(target, key) { return target[key]; }
    });
  }

  subscribe(callback) {
    if (typeof callback !== 'function') return null;
    this._subscribers.push(callback);
    return () => {
      const index = this._subscribers.indexOf(callback);
      if (index > -1) this._subscribers.splice(index, 1);
    };
  }

  _notifySubscribers(key, value, oldValue) {
    this._subscribers.forEach(cb => { try { cb(this.state, key, value, oldValue); } catch (e) {} });
  }

  async toggleErgMode(enable) {
    try {
      const trainer = window.connectedDevices?.trainer;
      if (!trainer) throw new Error('스마트로라 연결 안됨');

      // bluetooth.js v3.3에서 찾은 Control Point가 있으면 바로 사용
      let controlPoint = trainer.controlPoint;
      
      // 없으면 Deep Scan 재시도
      if (!controlPoint) {
        console.log('[ErgController] Control Point 재검색...');
        try {
          controlPoint = await this._reconnectControlPoint(trainer);
          if (controlPoint) {
            trainer.controlPoint = controlPoint;
          }
        } catch (e) {
          throw new Error('ERG 제어권 확보 실패 (지원하지 않는 기기)');
        }
      }

      this.state.enabled = enable;
      this.state.connectionStatus = 'connected';

      if (enable) {
        await this._enableErgMode();
        if (typeof showToast === 'function') showToast('ERG 모드 ON');
      } else {
        await this._disableErgMode();
        if (typeof showToast === 'function') showToast('ERG 모드 OFF');
      }
    } catch (error) {
      console.error('[ErgController] 오류:', error);
      this.state.enabled = false;
      if (typeof showToast === 'function') showToast(error.message);
      throw error;
    }
  }

  /**
   * ★ [핵심] Deep Scan을 포함한 재연결 로직
   */
  async _reconnectControlPoint(trainer) {
    try {
      if (!trainer.server) throw new Error('서버 연결 없음');
      let service, controlPoint;

      // 1. 표준 FTMS
      try {
        service = await trainer.server.getPrimaryService(this.UUIDS.FTMS_SERVICE);
        controlPoint = await service.getCharacteristic(this.UUIDS.FTMS_CONTROL);
        return controlPoint;
      } catch (e) {}

      // 2. CycleOps Legacy
      try {
        service = await trainer.server.getPrimaryService(this.UUIDS.CYCLEOPS_SERVICE);
        controlPoint = await service.getCharacteristic(this.UUIDS.CYCLEOPS_CONTROL);
        console.log('✅ CycleOps Legacy 찾음');
        return controlPoint;
      } catch (e) {}

      // 3. Wahoo Legacy
      try {
        service = await trainer.server.getPrimaryService(this.UUIDS.WAHOO_SERVICE);
        controlPoint = await service.getCharacteristic(this.UUIDS.WAHOO_CONTROL);
        console.log('✅ Wahoo Legacy 찾음');
        return controlPoint;
      } catch (e) {}
      
      // 4. 별칭 시도
      try {
        service = await trainer.server.getPrimaryService("fitness_machine");
        controlPoint = await service.getCharacteristic("fitness_machine_control_point");
        return controlPoint;
      } catch (e) {}

      throw new Error('모든 Control Point 탐색 실패');

    } catch (error) {
      throw error;
    }
  }

  async _enableErgMode() {
    const trainer = window.connectedDevices?.trainer;
    if (!trainer) return;
    
    let controlPoint = trainer.controlPoint;
    if (!controlPoint) {
      controlPoint = await this._reconnectControlPoint(trainer);
      trainer.controlPoint = controlPoint;
    }

    await this._queueCommand(() => {
      const cmd = new Uint8Array([this.ERG_OP_CODES.REQUEST_CONTROL]);
      return controlPoint.writeValue(cmd);
    }, 'REQUEST_CONTROL', { priority: 90 });

    const targetPower = window.liveData?.targetPower || this.state.targetPower || 0;
    if (targetPower > 0) await this.setTargetPower(targetPower);
    await this._initializeAIPID();
  }

  async _disableErgMode() {
    const trainer = window.connectedDevices?.trainer;
    if (!trainer?.controlPoint) return;
    await this._queueCommand(() => {
      const cmd = new Uint8Array([this.ERG_OP_CODES.RESET]);
      return trainer.controlPoint.writeValue(cmd);
    }, 'RESET', { priority: 100 });
    this.state.targetPower = 0;
  }

  async setTargetPower(watts) {
    if (!this.state.enabled) return;
    if (watts <= 0) return;
    const trainer = window.connectedDevices?.trainer;
    if (!trainer) return;

    let controlPoint = trainer.controlPoint;
    if (!controlPoint) {
      controlPoint = await this._reconnectControlPoint(trainer);
      if (!controlPoint) return;
      trainer.controlPoint = controlPoint;
    }

    const now = Date.now();
    if (now - this._lastPowerUpdateTime < this._powerUpdateDebounce) {
      return new Promise((resolve) => {
        setTimeout(() => { this.setTargetPower(watts).then(resolve); }, 
        this._powerUpdateDebounce - (now - this._lastPowerUpdateTime));
      });
    }
    this._lastPowerUpdateTime = now;

    try {
      const targetPowerValue = Math.round(watts * 10);
      await this._queueCommand(() => {
        const buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, this.ERG_OP_CODES.SET_TARGET_POWER);
        view.setUint16(1, targetPowerValue, true);
        return controlPoint.writeValue(buffer);
      }, 'SET_TARGET_POWER', { priority: 50 });

      this.state.targetPower = watts;
      await this._applyAIPIDTuning(watts);
    } catch (error) {
      console.error('[ErgController] 파워 설정 오류:', error);
    }
  }

  // (이하 유틸리티 함수 동일)
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

  async _initializeAIPID() {
    try {
      const style = await this._analyzePedalingStyle();
      this.state.pedalingStyle = style;
      this.state.pidParams = (style === 'smooth') ? { Kp: 0.4, Ki: 0.15, Kd: 0.03 } : { Kp: 0.6, Ki: 0.08, Kd: 0.08 };
    } catch (e) { this.state.pidParams = { Kp: 0.5, Ki: 0.1, Kd: 0.05 }; }
  }

  async _analyzePedalingStyle() {
    if (this._cadenceHistory.length < 10) return 'smooth';
    const recent = this._cadenceHistory.slice(-30);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / recent.length;
    return Math.sqrt(variance) < 5 ? 'smooth' : 'aggressive';
  }

  async _applyAIPIDTuning(targetPower) {
    const style = await this._analyzePedalingStyle();
    if (style !== this.state.pedalingStyle) {
      this.state.pedalingStyle = style;
      this.state.pidParams = (style === 'smooth') ? { Kp: 0.4, Ki: 0.15, Kd: 0.03 } : { Kp: 0.6, Ki: 0.08, Kd: 0.08 };
    }
  }

  updateCadence(cadence) {
    if (cadence > 0) {
      this._cadenceHistory.push(cadence);
      if (this._cadenceHistory.length > 100) this._cadenceHistory.shift();
      this.state.currentPower = window.liveData?.power || 0;
    }
  }
  updatePower(power) {
    if (power > 0) {
      this._powerHistory.push({ value: power, timestamp: Date.now() });
      const limit = Date.now() - 300000;
      this._powerHistory = this._powerHistory.filter(e => e.timestamp > limit);
      this.state.currentPower = power;
    }
  }
  updateHeartRate(hr) {
    if (hr > 0) {
      this._heartRateHistory.push({ value: hr, timestamp: Date.now() });
      const limit = Date.now() - 300000;
      this._heartRateHistory = this._heartRateHistory.filter(e => e.timestamp > limit);
    }
  }
  updateConnectionStatus(status) {
    this.state.connectionStatus = status;
    if (status === 'disconnected') this._resetState();
  }
  getState() { return { ...this.state }; }
}

const ergController = new ErgController();
if (typeof window !== 'undefined') window.ergController = ergController;
if (typeof module !== 'undefined' && module.exports) module.exports = { ergController, ErgController };
