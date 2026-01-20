/* ==========================================================
   ErgController.js (v4.1 Full Integrity)
   - 기존 기능(Queue, State, History) 100% 포함
   - 수정사항: FTMS 제어권 요청(0x00) 및 프로토콜별 파워 명령 분기
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
    
    // 반응형 상태 생성
    this.state = this._createReactiveState(this._state);

    // 명령 큐 시스템 초기화
    this._commandQueue = [];
    this._isProcessingQueue = false;
    this._lastCommandTime = 0;
    this._minCommandInterval = 200; // 명령 간격
    this._maxQueueSize = 50;
    this._commandTimeout = 5000;
    
    // 구독자 및 히스토리
    this._subscribers = [];
    this._cadenceHistory = [];
    this._powerHistory = [];
    this._heartRateHistory = [];
    
    // 파워 업데이트 디바운싱
    this._lastPowerUpdateTime = 0;
    this._powerUpdateDebounce = 200; // 반응성을 위해 약간 줄임

    // 명령 우선순위 정의
    this._commandPriorities = {
      'RESET': 100,
      'REQUEST_CONTROL': 95,
      'SET_TARGET_POWER': 50
    };

    this._setupConnectionWatcher();
    console.log('[ErgController] v4.1 initialized');
  }

  // ── [1] 내부 유틸리티 (상태, 구독, 감시) ──

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

  _setupConnectionWatcher() {
    let lastTrainerState = null;
    const checkConnection = () => {
      const currentTrainer = window.connectedDevices?.trainer;
      const wasConnected = lastTrainerState?.controlPoint !== null;
      const isConnected = currentTrainer?.controlPoint !== null;
      
      // 연결 끊김 감지 시 리셋
      if (wasConnected && !isConnected) this._resetState();
      
      // 상태 업데이트
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
      if (typeof window.showToast === 'function') window.showToast('트레이너 연결 끊김');
    }
  }

  // ── [2] 핵심 로직: ERG 토글 (수정됨) ──

  async toggleErgMode(enable) {
    try {
      const trainer = window.connectedDevices?.trainer;
      if (!trainer) throw new Error('스마트로라 연결 안됨');
      if (!trainer.controlPoint) throw new Error('제어권한 없음 (Control Point Missing)');

      if (enable) {
        // [수정] FTMS 프로토콜은 'Request Control (0x00)' 필수
        if (trainer.realProtocol === 'FTMS') {
            console.log("[ERG] FTMS 제어권 요청 중...");
            await this._queueCommand(() => {
                const cmd = new Uint8Array([0x00]); // 0x00: Request Control
                return trainer.controlPoint.writeValue(cmd);
            }, 'REQUEST_CONTROL', { priority: 95 });
            
            // 기기 반응 대기
            await new Promise(r => setTimeout(r, 300));
        }

        this.state.enabled = true;
        this.state.connectionStatus = 'connected';
        if (typeof showToast === 'function') showToast('ERG 모드 ON (제어권 획득)');
        
        // 이전에 설정된 목표 파워가 있다면 재전송
        if (this.state.targetPower > 0) {
            this.setTargetPower(this.state.targetPower);
        }

      } else {
        // ERG OFF
        this.state.enabled = false;
        
        // [수정] 제어권 반환 (Reset)
        if (trainer.realProtocol === 'FTMS') {
             await this._queueCommand(() => {
                const cmd = new Uint8Array([0x01]); // 0x01: Reset
                return trainer.controlPoint.writeValue(cmd);
            }, 'RESET', { priority: 100 });
        }
        
        this.state.targetPower = 0;
        if (typeof showToast === 'function') showToast('ERG 모드 OFF');
      }
    } catch (error) {
      console.error("[ERG Error]", error);
      this.state.enabled = false;
      throw error; // UI에서 스위치를 끄도록 에러 전파
    }
  }

  // ── [3] 핵심 로직: 파워 설정 (수정됨) ──

  async setTargetPower(watts) {
    if (!this.state.enabled) return;
    if (watts < 0) return;

    const trainer = window.connectedDevices?.trainer;
    if (!trainer || !trainer.controlPoint) return;

    // 디바운싱
    const now = Date.now();
    if (now - this._lastPowerUpdateTime < this._powerUpdateDebounce) {
      // 마지막 요청만 실행하도록 덮어쓰기 로직이 필요하나, 
      // 여기서는 단순 빈도로 제한 (Queue가 밀리는 것 방지)
      return; 
    }
    this._lastPowerUpdateTime = now;

    try {
      const targetWatts = Math.round(watts);
      
      // [수정] 프로토콜별 바이너리 생성
      let buffer;
      const protocol = trainer.realProtocol || 'FTMS';

      if (protocol === 'FTMS') {
        // FTMS: OpCode 0x05 + int16 (Little Endian)
        buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x05); 
        view.setInt16(1, targetWatts, true);
      } 
      else {
        // Legacy (CycleOps/Wahoo): OpCode 0x42 + uint16
        buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x42); 
        view.setUint16(1, targetWatts, true);
      }

      // 명령 큐 등록
      await this._queueCommand(() => {
        return trainer.controlPoint.writeValue(buffer);
      }, 'SET_TARGET_POWER', { priority: 50 });

      this.state.targetPower = watts;

    } catch (error) {
      console.error('[ErgController] 파워 설정 실패:', error);
    }
  }

  // ── [4] 명령 큐 시스템 (기존 로직 유지) ──

  async _queueCommand(commandFn, commandType, options = {}) {
    return new Promise((resolve, reject) => {
      // 큐 사이즈 제한
      if (this._commandQueue.length >= this._maxQueueSize) this._commandQueue.shift();
      
      const priority = options.priority || this._commandPriorities[commandType] || 0;
      const command = {
        commandFn, commandType, resolve, reject,
        timestamp: Date.now(), priority,
        retryCount: 0, maxRetries: 3
      };

      // 우선순위 기반 삽입
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
        console.warn(`[ERG Cmd Fail] ${command.commandType}:`, error);
        if (command.retryCount < command.maxRetries) {
          command.retryCount++;
          // 재시도 시 우선순위 높여서 앞쪽에 배치
          command.priority += 1;
          this._commandQueue.unshift(command);
        } else {
          command.reject(error);
        }
      }
      
      setTimeout(processNext, this._minCommandInterval);
    };

    processNext();
  }

  // ── [5] 데이터 수집 헬퍼 (기존 유지) ──
  updateCadence(c) { if(c>0) this._cadenceHistory.push(c); }
  updatePower(p) { if(p>0) this._powerHistory.push({value:p, timestamp:Date.now()}); }
  updateHeartRate(h) { if(h>0) this._heartRateHistory.push({value:h, timestamp:Date.now()}); }
  
  getState() { return {...this.state}; }
}

// 인스턴스 생성 및 내보내기
const ergController = new ErgController();
if (typeof window !== 'undefined') window.ergController = ergController;
if (typeof module !== 'undefined' && module.exports) module.exports = { ergController, ErgController };
