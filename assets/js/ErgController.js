/* ==========================================================
   ErgController.js (v6.0 Hybrid Version)
   - [보존] v3.5의 강력한 명령 큐(Queue), 재시도(Retry), 우선순위(Priority) 시스템 완전 복구
   - [추가] CycleOps 제어권 획득을 위한 0x00 Handshake 로직 통합
   - [추가] 끊김 방지를 위한 Keep-Alive Heartbeat 로직 통합
========================================================== */

class ErgController {
  constructor() {
    this._state = {
      enabled: false,
      targetPower: 0,
      currentPower: 0,
      connectionStatus: 'disconnected'
    };
    this.state = this._createReactiveState(this._state);

    // [복구] 명령 큐 및 처리 변수
    this._commandQueue = [];
    this._isProcessingQueue = false;
    this._lastCommandTime = 0;
    this._minCommandInterval = 200; // 명령 간 최소 간격
    this._maxQueueSize = 50;
    
    // [추가] Keep-Alive (Zwift Logic)
    this._keepAliveInterval = null;

    // 구독자 관리
    this._subscribers = [];
    this._lastPowerUpdateTime = 0;
    this._powerUpdateDebounce = 300; // 너무 잦은 업데이트 방지

    // [복구] 명령 우선순위 정의
    this._commandPriorities = {
      'RESET': 100,
      'REQUEST_CONTROL': 90, // Handshake
      'SET_TARGET_POWER': 50
    };

    console.log('[ErgController] v6.0 Hybrid (Queue+KeepAlive) Initialized');
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
  }

  _notifySubscribers(key, value) {
    this._subscribers.forEach(cb => { try{ cb(this.state, key, value); }catch(e){} });
  }

  // ── [1] ERG 모드 토글 (Queue + Handshake) ──
  async toggleErgMode(enable) {
    try {
      const trainer = window.connectedDevices?.trainer;
      if (!trainer || !trainer.controlPoint) throw new Error('제어권(Control Point)이 없습니다.');

      this.state.enabled = enable;
      this.state.connectionStatus = 'connected';

      if (enable) {
        // [추가] CycleOps/FTMS Handshake (OpCode 0x00)
        // 큐 시스템을 통해 안전하게 전송
        await this._queueCommand(async () => {
            if (trainer.protocol === 'FTMS' || trainer.protocol === 'CYCLEOPS') {
                const cmd = new Uint8Array([0x00]); // Request Control
                await trainer.controlPoint.writeValue(cmd);
                console.log('[ERG] Request Control (0x00) Sent');
            }
        }, 'REQUEST_CONTROL', { priority: 90 });

        // 초기 파워 설정
        if (this.state.targetPower > 0) {
            await this.setTargetPower(this.state.targetPower);
        }
        
        // [추가] Keep-Alive 시작
        this._startKeepAlive();
        if (typeof showToast === 'function') showToast('ERG 모드 ON (제어권 확보)');
      } else {
        // 해제
        this._stopKeepAlive();
        
        // [복구] Reset 명령 큐잉
        if (trainer.protocol === 'FTMS') {
             await this._queueCommand(async () => {
                const cmd = new Uint8Array([0x01]); // Reset
                await trainer.controlPoint.writeValue(cmd);
            }, 'RESET', { priority: 100 });
        }
        this.state.targetPower = 0;
        if (typeof showToast === 'function') showToast('ERG 모드 OFF');
      }
    } catch (error) {
      this.state.enabled = false;
      this._stopKeepAlive();
      if (typeof showToast === 'function') showToast("ERG 실패: " + error.message);
    }
  }

  // ── [2] 타겟 파워 설정 (Queue + Protocol Matcher) ──
  async setTargetPower(watts) {
    if (!this.state.enabled) return;
    if (watts < 0) return;

    // 디바운싱 (너무 빠른 입력 방지)
    const now = Date.now();
    if (now - this._lastPowerUpdateTime < this._powerUpdateDebounce) {
        // 생략하거나 지연 처리 가능하나 여기선 패스
    }
    this._lastPowerUpdateTime = now;
    this.state.targetPower = Math.round(watts);

    const trainer = window.connectedDevices?.trainer;
    if (!trainer || !trainer.controlPoint) return;

    // 큐에 명령 추가
    await this._queueCommand(async () => {
        let buffer;
        const protocol = trainer.protocol;
        const targetWatts = this.state.targetPower;

        // 프로토콜별 패킷 생성
        if (protocol === 'FTMS') {
            // OpCode 0x05 + int16
            buffer = new ArrayBuffer(3);
            const view = new DataView(buffer);
            view.setUint8(0, 0x05); 
            view.setInt16(1, targetWatts, true);
        } 
        else if (protocol === 'CYCLEOPS' || protocol === 'WAHOO') {
            // Legacy: OpCode 0x42 (Wahoo Emulation for Hammer)
            buffer = new ArrayBuffer(3);
            const view = new DataView(buffer);
            view.setUint8(0, 0x42);
            view.setUint16(1, targetWatts, true);
        }
        else {
            // Fallback
            buffer = new ArrayBuffer(3);
            const view = new DataView(buffer);
            view.setUint8(0, 0x42);
            view.setUint16(1, targetWatts, true);
        }

        await trainer.controlPoint.writeValue(buffer);
        // console.log(`[ERG] ${targetWatts}W Sent via Queue`);

    }, 'SET_TARGET_POWER', { priority: 50 });
  }

  // ── [3] 명령 큐 시스템 (v3.5 Logic 복구) ──
  async _queueCommand(commandFn, commandType, options = {}) {
    return new Promise((resolve, reject) => {
      // 큐 사이즈 제한
      if (this._commandQueue.length >= this._maxQueueSize) {
          // 중요도가 낮은 오래된 명령 제거 가능
          this._commandQueue.shift(); 
      }

      const priority = options.priority || this._commandPriorities[commandType] || 0;
      const command = {
        commandFn, 
        commandType, 
        resolve, 
        reject,
        timestamp: Date.now(), 
        priority,
        retryCount: 0, 
        maxRetries: 3 // 재시도 횟수 복구
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

      const command = this._commandQueue.shift(); // 큐에서 꺼냄
      this._lastCommandTime = Date.now();

      try {
        await command.commandFn();
        command.resolve(); // 성공
      } catch (error) {
        console.warn(`[ERG] Cmd Fail (${command.commandType}):`, error);
        if (command.retryCount < command.maxRetries) {
          command.retryCount++;
          // 재시도를 위해 큐 맨 앞에 다시 넣음 (우선 처리)
          this._commandQueue.unshift(command);
          console.log(`[ERG] Retrying... (${command.retryCount})`);
        } else {
          command.reject(error); // 최종 실패
        }
      }

      // 다음 명령 처리
      setTimeout(processNext, this._minCommandInterval);
    };

    processNext();
  }

  // ── [4] Keep-Alive (Zwift Logic) ──
  _startKeepAlive() {
    this._stopKeepAlive();
    // 2초마다 현재 타겟 파워 재전송 (큐 시스템을 거치지 않고 직접 쏘거나, 낮은 우선순위로 큐에 넣음)
    // 여기서는 큐 시스템이 있으므로 큐를 통해 보내는 것이 안전함
    this._keepAliveInterval = setInterval(() => {
        if (this.state.enabled && this.state.targetPower > 0) {
            this.setTargetPower(this.state.targetPower); // 기존 함수 재활용 (큐에 들어감)
        }
    }, 2000);
  }

  _stopKeepAlive() {
    if (this._keepAliveInterval) {
        clearInterval(this._keepAliveInterval);
        this._keepAliveInterval = null;
    }
  }

  // 데이터 수집
  updatePower(p) { if(p>0) this.state.currentPower = p; }
  updateConnectionStatus(s) { 
      this.state.connectionStatus = s; 
      if(s==='disconnected') {
          this.state.enabled = false;
          this._stopKeepAlive();
          this._commandQueue = []; // 연결 끊기면 큐 비움
      }
  }
}

const ergController = new ErgController();
if (typeof window !== 'undefined') window.ergController = ergController;
