/* ==========================================================
   ErgController.js (v2.0 Legacy Support)
   - CycleOps/Hammer 등 레거시 기기 호환성 추가
   - '비밀 통로(Legacy UUID)'를 통한 재연결 로직 구현
   - CPS 프로토콜이라도 CycleOps 기기라면 ERG 허용
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

    // AI/History 관련
    this._cadenceHistory = [];
    this._powerHistory = [];
    this._heartRateHistory = [];
    this._lastCloudAICall = 0;
    this._cloudAICallInterval = 5 * 60 * 1000;

    this._lastPowerUpdateTime = 0;
    this._powerUpdateDebounce = 500;

    // ★ [수정] UUID 목록 업데이트 (Legacy 추가)
    this.UUIDS = {
      FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb',
      FTMS_CONTROL: '00002ad9-0000-1000-8000-00805f9b34fb',
      // CycleOps/Wahoo Legacy
      LEGACY_SERVICE: 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b', 
      LEGACY_CONTROL: 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b'
    };

    this.ERG_OP_CODES = {
      REQUEST_CONTROL: 0x00,
      RESET: 0x01,
      SET_TARGET_POWER: 0x05,
      START_OR_RESUME: 0x07,
      STOP_OR_PAUSE: 0x08
    };

    this._commandPriorities = {
      'RESET': 100,
      'REQUEST_CONTROL': 90,
      'SET_TARGET_POWER': 50
    };

    this._setupConnectionWatcher();
    console.log('[ErgController] 초기화 완료 (Legacy Support v2.0)');
  }

  // ... (기존 _setupConnectionWatcher, _resetState, _createReactiveState 등은 동일) ...
  _setupConnectionWatcher() {
    let lastTrainerState = null;
    const checkConnection = () => {
      const currentTrainer = window.connectedDevices?.trainer;
      const wasConnected = lastTrainerState?.controlPoint !== null;
      const isConnected = currentTrainer?.controlPoint !== null;
      if (wasConnected && !isConnected) {
        console.log('[ErgController] 연결 해제 감지 -> 초기화');
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

  /**
   * ★ [수정] ERG 모드 토글 (Legacy 호환성 강화)
   */
  async toggleErgMode(enable) {
    try {
      const trainer = window.connectedDevices?.trainer;
      if (!trainer) throw new Error('스마트로라가 연결되지 않았습니다.');

      // ★ [수정] CycleOps 기기라면 CPS라도 허용
      const protocol = trainer.protocol || 'unknown';
      const name = (trainer.name || "").toUpperCase();
      const isLegacyDevice = name.includes("CYCLEOPS") || name.includes("HAMMER") || name.includes("SARIS") || name.includes("MAGNUS");

      // bluetooth.js v3.2에서 이미 FTMS로 속였겠지만, 혹시 몰라 이중 체크
      if (protocol === 'CPS' && !isLegacyDevice) {
        throw new Error('현재 연결된 기기는 ERG 모드를 지원하지 않는 파워미터입니다.');
      }

      let controlPoint = trainer.controlPoint;
      
      // Control Point 없으면 재연결 시도
      if (!controlPoint) {
        console.log('[ErgController] Control Point 재연결 시도...');
        try {
          controlPoint = await this._reconnectControlPoint(trainer);
          if (controlPoint) {
            trainer.controlPoint = controlPoint;
            console.log('[ErgController] ✅ Control Point 복구됨');
          }
        } catch (e) {
          throw new Error('ERG 제어권을 확보할 수 없습니다.');
        }
      }

      if (!controlPoint) throw new Error('Control Point 없음');

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
      console.error('[ErgController] 토글 오류:', error);
      this.state.enabled = false;
      if (typeof showToast === 'function') showToast('오류: ' + error.message);
      throw error;
    }
  }

  /**
   * ★ [핵심 수정] Control Point 재연결 (Legacy 서비스 탐색 추가)
   */
  async _reconnectControlPoint(trainer) {
    try {
      if (!trainer.server) throw new Error('서버 연결 없음');

      let service, controlPoint;

      // 1. 표준 FTMS 시도
      try {
        service = await trainer.server.getPrimaryService(this.UUIDS.FTMS_SERVICE);
        controlPoint = await service.getCharacteristic(this.UUIDS.FTMS_CONTROL);
        console.log('[ErgController] 표준 FTMS Control Point 획득');
        return controlPoint;
      } catch (e) { /* 실패 시 계속 */ }

      // 2. 별칭(fitness_machine) 시도
      try {
        service = await trainer.server.getPrimaryService("fitness_machine");
        controlPoint = await service.getCharacteristic("fitness_machine_control_point");
        console.log('[ErgController] 별칭으로 Control Point 획득');
        return controlPoint;
      } catch (e) { /* 실패 시 계속 */ }

      // 3. ★ Legacy (CycleOps) 시도
      try {
        console.log('[ErgController] Legacy 서비스 탐색 시도...');
        service = await trainer.server.getPrimaryService(this.UUIDS.LEGACY_SERVICE);
        controlPoint = await service.getCharacteristic(this.UUIDS.LEGACY_CONTROL);
        console.log('[ErgController] 🎉 Legacy (CycleOps) Control Point 획득 성공!');
        return controlPoint;
      } catch (e) {
         console.warn('[ErgController] 모든 방식의 Control Point 획득 실패');
         throw e;
      }

    } catch (error) {
      console.error('[ErgController] 재연결 치명적 오류:', error);
      throw error;
    }
  }

  /**
   * ERG 활성화
   */
  async _enableErgMode() {
    const trainer = window.connectedDevices?.trainer;
    if (!trainer) throw new Error('연결 끊김');
    
    let controlPoint = trainer.controlPoint;
    if (!controlPoint) {
      controlPoint = await this._reconnectControlPoint(trainer);
      trainer.controlPoint = controlPoint;
    }

    // 제어권 요청
    await this._queueCommand(() => {
      const cmd = new Uint8Array([this.ERG_OP_CODES.REQUEST_CONTROL]);
      return controlPoint.writeValue(cmd);
    }, 'REQUEST_CONTROL', { priority: 90 });

    // 현재 목표 파워 재설정
    const targetPower = window.liveData?.targetPower || this.state.targetPower || 0;
    if (targetPower > 0) await this.setTargetPower(targetPower);

    await this._initializeAIPID();
  }

  /**
   * ERG 비활성화
   */
  async _disableErgMode() {
    const trainer = window.connectedDevices?.trainer;
    if (!trainer?.controlPoint) return;

    await this._queueCommand(() => {
      const cmd = new Uint8Array([this.ERG_OP_CODES.RESET]);
      return trainer.controlPoint.writeValue(cmd);
    }, 'RESET', { priority: 100 });

    this.state.targetPower = 0;
  }

  /**
   * 목표 파워 설정
   */
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

    // 디바운싱
    const now = Date.now();
    if (now - this._lastPowerUpdateTime < this._powerUpdateDebounce) {
      return new Promise((resolve) => {
        setTimeout(() => { this.setTargetPower(watts).then(resolve); }, 
        this._powerUpdateDebounce - (now - this._lastPowerUpdateTime));
      });
    }
    this._lastPowerUpdateTime = now;

    try {
      const targetPowerValue = Math.round(watts * 10); // 0.1W 단위

      // ★ Legacy 기기도 표준 FTMS opcode(0x05)를 보통 따름
      await this._queueCommand(() => {
        const buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, this.ERG_OP_CODES.SET_TARGET_POWER);
        view.setUint16(1, targetPowerValue, true);
        return controlPoint.writeValue(buffer);
      }, 'SET_TARGET_POWER', { priority: 50 });

      this.state.targetPower = watts;
      console.log('[ErgController] 목표 파워:', watts, 'W');
      await this._applyAIPIDTuning(watts);

    } catch (error) {
      console.error('[ErgController] 파워 설정 오류:', error);
    }
  }

  // ... (이하 _queueCommand, _startQueueProcessing, AI 관련 함수들은 기존과 동일) ...
  
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
        console.error(`[ErgController] 명령 실패 (${command.commandType}):`, error);
        if (command.retryCount < command.maxRetries) {
          command.retryCount++;
          this._commandQueue.unshift(command); // 재시도
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
      this.state.pidParams = (style === 'smooth') 
        ? { Kp: 0.4, Ki: 0.15, Kd: 0.03 } 
        : { Kp: 0.6, Ki: 0.08, Kd: 0.08 };
    } catch (e) {
      this.state.pidParams = { Kp: 0.5, Ki: 0.1, Kd: 0.05 };
    }
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
      this.state.pidParams = (style === 'smooth') 
        ? { Kp: 0.4, Ki: 0.15, Kd: 0.03 } 
        : { Kp: 0.6, Ki: 0.08, Kd: 0.08 };
    }
  }

  // 데이터 수집 함수들
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
