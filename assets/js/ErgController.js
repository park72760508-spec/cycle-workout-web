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
    this._cpsErgWarningShown = false; // CPS ERG 경고 표시 여부

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

  // FTMS Control Point 재탐색 (CPS만 있는 경우 FTMS 서비스 확인)
  async _findFTMSControlPoint(trainer) {
    try {
      // trainer 객체에서 server 또는 device.gatt 사용
      const server = trainer.server || (trainer.device && trainer.device.gatt);
      if (!server) {
        console.log('[ERG] 서버 객체를 찾을 수 없음');
        return null;
      }
      
      // 서버가 연결되어 있는지 확인
      if (server.connected === false) {
        console.log('[ERG] 서버가 연결되지 않음');
        return null;
      }
      
      const FTMS_SERVICE = '00001826-0000-1000-8000-00805f9b34fb';
      const FTMS_CONTROL = '00002ad9-0000-1000-8000-00805f9b34fb';
      
      try {
        const service = await server.getPrimaryService(FTMS_SERVICE);
        const controlPoint = await service.getCharacteristic(FTMS_CONTROL);
        console.log('[ERG] FTMS Control Point 재탐색 성공');
        return controlPoint;
      } catch (e) {
        console.log('[ERG] FTMS Control Point 재탐색 실패 (정상일 수 있음):', e.message);
        return null;
      }
    } catch (e) {
      console.warn('[ERG] FTMS Control Point 재탐색 중 오류:', e);
      return null;
    }
  }


// [추가] Legacy(CycleOps/Wahoo) Control Point 재탐색
  async _findLegacyControlPoint(trainer) {
    try {
      const server = trainer.server || (trainer.device && trainer.device.gatt);
      if (!server || !server.connected) return null;

      // CycleOps/Wahoo Legacy Service UUIDs
      const LEGACY_SERVICES = [
        'a026ee01-0a1d-4335-9d7f-245f24e1a229', // Wahoo/CycleOps 표준
        // 필요 시 추가 벤더 UUID 삽입
      ];
      const LEGACY_CONTROL_CHAR = 'a026e005-0a1d-4335-9d7f-245f24e1a229';

      for (const serviceUUID of LEGACY_SERVICES) {
        try {
          const service = await server.getPrimaryService(serviceUUID);
          const controlPoint = await service.getCharacteristic(LEGACY_CONTROL_CHAR);
          console.log('[ERG] Legacy (Wahoo/CycleOps) Control Point 발견!');
          return controlPoint;
        } catch (e) {
          // 해당 서비스 없음, 다음 시도
        }
      }
      return null;
    } catch (e) {
      console.warn('[ERG] Legacy CP 탐색 중 오류:', e);
      return null;
    }
  }

  // [수정] setTargetPower 및 toggleErgMode 내부 로직 변경
  // 기존 로직: if (protocol === 'CPS') { _findFTMSControlPoint... }
  // 변경 로직: 아래와 같이 변경




   
async toggleErgMode(enable) {
    try {
      const trainer = window.connectedDevices?.trainer;
      if (!trainer) throw new Error('스마트로라 연결 안됨');

      // Control Point 확인 및 프로토콜 재탐색 로직 시작
      let controlPoint = trainer.controlPoint;
      let protocol = trainer.realProtocol || 'FTMS';
      
      // [수정됨] CPS 프로토콜이거나 Control Point가 확실치 않은 경우 강력한 재탐색 실행
      if (protocol === 'CPS' || !controlPoint) {
        console.log('[ERG] 제어 프로토콜 정밀 탐색 시작 (CPS/Legacy 대응)');
        
        // 1순위: FTMS 표준 재탐색
        const ftmsControlPoint = await this._findFTMSControlPoint(trainer);
        if (ftmsControlPoint) {
          console.log('[ERG] -> FTMS Control Point 발견 (표준)');
          controlPoint = ftmsControlPoint;
          protocol = 'FTMS';
        } 
        // 2순위: Legacy (CycleOps/Wahoo) 재탐색 [여기가 핵심]
        else {
          const legacyControlPoint = await this._findLegacyControlPoint(trainer);
          if (legacyControlPoint) {
            console.log('[ERG] -> Legacy Control Point 발견 (CycleOps/Wahoo)');
            controlPoint = legacyControlPoint;
            protocol = 'CYCLEOPS'; // 구형 프로토콜로 명시
          }
        }

        // 찾은 정보가 있다면 트레이너 객체에 업데이트
        if (controlPoint) {
          trainer.controlPoint = controlPoint;
          trainer.realProtocol = protocol;
        }
      }
      
      // ... (이후 if (!controlPoint) ... 코드는 기존과 동일하게 유지)

      if (!controlPoint) {
        throw new Error('제어권 없음 - ERG 모드를 사용하려면 스마트 트레이너가 필요합니다');
      }

      this.state.enabled = enable;
      this.state.connectionStatus = 'connected';

      if (enable) {
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
        // ★ CPS Control Point: ERG 제어가 지원되지 않을 수 있음
        else if (protocol === 'CPS') {
          // CPS Control Point는 대부분 파워미터용이며 ERG 제어를 지원하지 않을 수 있음
          console.warn('[ERG] ⚠️ CPS Control Point - ERG 제어가 지원되지 않을 수 있습니다');
          console.warn('[ERG] 이 기기는 파워미터 모드로만 작동할 수 있습니다');
          throw new Error('CPS Control Point는 ERG 제어를 지원하지 않습니다. FTMS를 지원하는 스마트 트레이너가 필요합니다.');
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
        // CPS Control Point: 파워를 0으로 설정하여 해제
        else if (protocol === 'CPS') {
          try {
            await this._queueCommand(() => {
              const buffer = new ArrayBuffer(3);
              const view = new DataView(buffer);
              view.setUint8(0, 0x42); // Set Power (Legacy 방식)
              view.setUint16(1, 0, true); // 0W
              return trainer.controlPoint.writeValue(buffer);
            }, 'SET_TARGET_POWER', { priority: 100 });
            console.log('[ERG] CPS Control Point 파워 0W 설정');
          } catch (e) {
            console.warn('[ERG] CPS Control Point 해제 실패:', e);
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
    if (!trainer) {
      console.warn('[ErgController] Trainer 없음 - 파워 설정 불가');
      return;
    }

    // [수정됨] 프로토콜 및 Control Point 재확인 로직 강화
    let controlPoint = trainer.controlPoint;
    let protocol = trainer.realProtocol || 'FTMS';
    
    // CPS 상태라면 다시 한번 올바른 제어권(FTMS or Legacy)을 찾아봄
    if (protocol === 'CPS') {
      // 1. FTMS 확인
      const ftmsControlPoint = await this._findFTMSControlPoint(trainer);
      if (ftmsControlPoint) {
        controlPoint = ftmsControlPoint;
        protocol = 'FTMS';
        trainer.controlPoint = controlPoint;
        trainer.realProtocol = 'FTMS';
      } 
      // 2. Legacy (CycleOps) 확인 [추가됨]
      else {
        const legacyControlPoint = await this._findLegacyControlPoint(trainer);
        if (legacyControlPoint) {
           console.log('[ERG] setTargetPower: Legacy Control Point 발견');
           controlPoint = legacyControlPoint;
           protocol = 'CYCLEOPS';
           trainer.controlPoint = controlPoint;
           trainer.realProtocol = 'CYCLEOPS';
        }
      }
    }

    // ... (이후 if (!controlPoint) ... 코드는 기존과 동일하게 유지)

    if (!controlPoint) {
      console.warn('[ErgController] Control Point 없음 - 파워 설정 불가');
      return;
    }

    // Control Point 연결 상태 확인
    try {
      // characteristic이 유효한지 확인 (업데이트된 controlPoint 사용)
      if (!controlPoint || typeof controlPoint.writeValue !== 'function') {
        console.warn('[ErgController] Control Point가 유효하지 않음');
        this.state.connectionStatus = 'disconnected';
        return;
      }
    } catch (e) {
      console.warn('[ErgController] Control Point 확인 중 오류:', e);
      this.state.connectionStatus = 'disconnected';
      return;
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
      const targetWatts = Math.round(watts);
      
      // ★ 프로토콜별 명령 생성 (ZWIFT/Mywoosh 호환)
      let buffer;

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
        // CPS Control Point는 ERG 제어를 지원하지 않을 수 있음
        console.error('[ERG] CPS Control Point는 ERG 제어를 지원하지 않습니다');
        throw new Error('CPS Control Point는 ERG 제어를 지원하지 않습니다. FTMS를 지원하는 스마트 트레이너가 필요합니다.');
      }
      else {
        // 알 수 없는 프로토콜: Legacy 방식 시도
        console.warn(`[ERG] 알 수 없는 프로토콜: ${protocol}, Legacy(0x42) 시도`);
        buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x42);
        view.setUint16(1, targetWatts, true);
      }

      await this._queueCommand(async () => {
        // writeValue 호출 전 연결 상태 재확인 (업데이트된 controlPoint 사용)
        if (!controlPoint) {
          throw new Error('Control Point 연결 끊김');
        }
        
        // characteristic 참조를 함수 스코프에서 유지 (업데이트된 controlPoint 사용)
        const characteristic = controlPoint;
        
        try {
          // writeWithoutResponse가 지원되는지 확인
          if (characteristic.properties && characteristic.properties.writeWithoutResponse) {
            await characteristic.writeValueWithoutResponse(buffer);
            console.log(`[ERG] writeValueWithoutResponse 성공: ${targetWatts}W`);
          } else {
            // 일반 writeValue 사용
            await characteristic.writeValue(buffer);
            console.log(`[ERG] writeValue 성공: ${targetWatts}W`);
          }
        } catch (writeError) {
          // GATT 오류 처리
          if (writeError.name === 'NotSupportedError' || 
              writeError.message?.includes('GATT') ||
              writeError.message?.includes('Unknown')) {
            console.warn(`[ERG] GATT 오류 발생, 대체 명령 시도:`, writeError);
            
            // 연결 상태 업데이트
            this.state.connectionStatus = 'error';
            
            // CPS 프로토콜인 경우 이미 위에서 오류 처리됨
            // 여기서는 대체 명령 시도를 하지 않음
            
            // CPS가 아니거나 대체 명령이 실패한 경우 원래 오류 throw
            throw writeError;
          } else {
            // GATT 오류가 아닌 경우 그대로 throw
            throw writeError;
          }
        }
      }, 'SET_TARGET_POWER', { priority: 50 });

      this.state.targetPower = watts;
      this.state.connectionStatus = 'connected';

    } catch (error) {
      console.error('[ErgController] 파워 설정 오류:', error);
      
      // GATT 오류인 경우 연결 상태 업데이트
      if (error.name === 'NotSupportedError' || 
          error.message?.includes('GATT') ||
          error.message?.includes('Unknown')) {
        this.state.connectionStatus = 'error';
        console.warn('[ErgController] GATT 오류로 인한 연결 문제 감지');
        
        // CPS 프로토콜인 경우 ERG 제어가 지원되지 않음을 알림
        if (protocol === 'CPS') {
          console.error('[ErgController] ⚠️ CPS Control Point는 ERG 제어를 지원하지 않습니다.');
          console.error('[ErgController] 이 기기는 파워미터 모드로만 작동할 수 있습니다.');
          
          // 사용자에게 알림 (한 번만 표시)
          if (!this._cpsErgWarningShown) {
            this._cpsErgWarningShown = true;
            if (typeof showToast === 'function') {
              showToast('이 기기는 ERG 제어를 지원하지 않습니다. FTMS 스마트 트레이너가 필요합니다.', 'error');
            }
          }
        }
      }
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
        // 명령 실행 전 연결 상태 확인
        const trainer = window.connectedDevices?.trainer;
        if (!trainer) {
          throw new Error('Trainer 연결 끊김');
        }
        
        // Control Point가 없으면 ERG 모드 비활성화
        if (!trainer.controlPoint) {
          throw new Error('Control Point 연결 끊김');
        }
        
        await command.commandFn();
        command.resolve();
      } catch (error) {
        // GATT 오류인 경우 재시도 간격 증가
        const isGattError = error.name === 'NotSupportedError' || 
                           error.message?.includes('GATT') ||
                           error.message?.includes('Unknown');
        
        if (command.retryCount < command.maxRetries) {
          command.retryCount++;
          // GATT 오류인 경우 재시도 간격 증가 (200ms -> 500ms)
          const retryDelay = isGattError ? 500 : this._minCommandInterval;
          console.warn(`[ERG] 명령 재시도 ${command.retryCount}/${command.maxRetries} (${retryDelay}ms 후):`, error.message);
          setTimeout(() => {
            this._commandQueue.unshift(command);
            processNext();
          }, retryDelay);
          return;
        } else {
          console.error(`[ERG] 명령 최종 실패 (${command.maxRetries}회 재시도 후):`, error);
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

