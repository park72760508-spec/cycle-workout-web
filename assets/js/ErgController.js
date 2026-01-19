/* ==========================================================
   ErgController.js - Modern ERG Controller with Reactive State
   - Class & Singleton Pattern
   - Reactive State Management with Proxy
   - BLE Command Queue for Stability (Priority, Retry, Timeout)
   - Edge AI + Cloud AI Hybrid (Gemini API)
   - Enhanced Error Recovery & State Management
========================================================== */

/**
 * Modern ERG Controller Class
 * Singleton Pattern으로 전역 상태 오염 방지
 */
class ErgController {
  constructor() {
    // 내부 상태 (Proxy로 감싸서 반응형으로 만듦)
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

    // Proxy로 상태 변경 감지 및 자동 UI 업데이트
    this.state = this._createReactiveState(this._state);

    // BLE 명령 큐 (스마트로라에 명령을 너무 빨리 보내면 씹히거나 연결이 끊김)
    this._commandQueue = [];
    this._isProcessingQueue = false;
    this._queueProcessingInterval = null;
    this._lastCommandTime = 0;
    this._minCommandInterval = 200; // 최소 200ms 간격
    this._maxQueueSize = 50; // 최대 큐 크기 (메모리 보호)
    this._commandTimeout = 5000; // 명령 타임아웃 (5초)

    // 구독자 목록 (상태 변경 시 자동으로 UI 업데이트)
    this._subscribers = [];

    // Edge AI 관련 (TensorFlow.js를 사용한 로컬 분석)
    this._edgeAIAnalyzer = null;
    this._cadenceHistory = []; // 케이던스 변동성 분석용
    this._powerHistory = []; // 파워 히스토리 (평균 계산용)
    this._heartRateHistory = []; // 심박수 히스토리 (평균 계산용)
    this._lastCloudAICall = 0;
    this._cloudAICallInterval = 5 * 60 * 1000; // 5분마다 Gemini API 호출

    // 디바운싱 (빠른 연속 호출 방지)
    this._lastPowerUpdateTime = 0;
    this._powerUpdateDebounce = 500; // 500ms 디바운스

    // FTMS Control Point UUID
    this.FTMS_CONTROL_POINT_UUID = '00002ad9-0000-1000-8000-00805f9b34fb';
    this.FTMS_SERVICE_UUID = '00001826-0000-1000-8000-00805f9b34fb';

    // ERG 모드 Op Codes
    this.ERG_OP_CODES = {
      REQUEST_CONTROL: 0x00,
      RESET: 0x01,
      SET_TARGET_POWER: 0x05,
      START_OR_RESUME: 0x07,
      STOP_OR_PAUSE: 0x08,
      SET_TARGETED_INDOOR_BIKE_SIMULATION_PARAMETERS: 0x11,
      SET_TARGETED_RESISTANCE_LEVEL: 0x12,
      SET_WIND_RESISTANCE: 0x13,
      SET_TRACK_RESISTANCE: 0x14
    };

    // 명령 우선순위 (높을수록 우선 처리)
    this._commandPriorities = {
      'RESET': 100, // 최우선
      'REQUEST_CONTROL': 90,
      'SET_TARGET_POWER': 50,
      'START_OR_RESUME': 40,
      'STOP_OR_PAUSE': 30
    };

    // 연결 해제 감지 (자동 상태 초기화)
    this._setupConnectionWatcher();

    console.log('[ErgController] 초기화 완료');
  }

  /**
   * 연결 해제 감지 및 자동 상태 초기화
   */
  _setupConnectionWatcher() {
    // window.connectedDevices.trainer 변경 감지
    let lastTrainerState = null;
    
    const checkConnection = () => {
      const currentTrainer = window.connectedDevices?.trainer;
      const wasConnected = lastTrainerState?.controlPoint !== null;
      const isConnected = currentTrainer?.controlPoint !== null;

      // 연결 해제 감지
      if (wasConnected && !isConnected) {
        console.log('[ErgController] 스마트로라 연결 해제 감지 - 상태 초기화');
        this._resetState();
      }

      // 연결 상태 업데이트
      if (isConnected !== (this.state.connectionStatus === 'connected')) {
        this.state.connectionStatus = isConnected ? 'connected' : 'disconnected';
      }

      lastTrainerState = currentTrainer;
    };

    // 1초마다 연결 상태 확인
    setInterval(checkConnection, 1000);
  }

  /**
   * 상태 초기화 (연결 해제 시)
   */
  _resetState() {
    if (this.state.enabled) {
      this.state.enabled = false;
      this.state.targetPower = 0;
      this.state.connectionStatus = 'disconnected';
      
      // 명령 큐 비우기
      this._commandQueue = [];
      this._isProcessingQueue = false;
      
      console.log('[ErgController] 상태 초기화 완료');
    }
  }

  /**
   * 반응형 상태 생성 (Proxy 사용)
   * 상태가 변경되면 자동으로 구독자에게 알림
   */
  _createReactiveState(state) {
    const self = this;
    return new Proxy(state, {
      set(target, key, value) {
        const oldValue = target[key];
        
        // 값이 실제로 변경된 경우에만 알림
        if (oldValue !== value) {
          target[key] = value;
          
          // 구독자에게 변경 사항 알림
          self._notifySubscribers(key, value, oldValue);
          
          // 디버그 로그 (프로덕션에서는 제거 가능)
          if (self._shouldLogStateChange(key)) {
            console.log(`[ErgController] 상태 변경: ${key} = ${value} (이전: ${oldValue})`);
          }
        }
        return true;
      },
      get(target, key) {
        return target[key];
      }
    });
  }

  /**
   * 상태 변경 로그 여부 결정 (너무 빈번한 로그 방지)
   */
  _shouldLogStateChange(key) {
    // currentPower는 너무 자주 변경되므로 로그하지 않음
    return key !== 'currentPower';
  }

  /**
   * 구독자 등록 (상태 변경 시 자동으로 콜백 호출)
   */
  subscribe(callback) {
    if (typeof callback !== 'function') {
      console.warn('[ErgController] 구독자는 함수여야 합니다');
      return null;
    }
    this._subscribers.push(callback);
    console.log('[ErgController] 구독자 등록 완료, 총 구독자:', this._subscribers.length);
    
    // 구독 해제 함수 반환
    return () => {
      const index = this._subscribers.indexOf(callback);
      if (index > -1) {
        this._subscribers.splice(index, 1);
        console.log('[ErgController] 구독 해제 완료');
      }
    };
  }

  /**
   * 구독자에게 변경 사항 알림
   */
  _notifySubscribers(key, value, oldValue) {
    this._subscribers.forEach(callback => {
      try {
        callback(this.state, key, value, oldValue);
      } catch (error) {
        console.error('[ErgController] 구독자 콜백 오류:', error);
      }
    });
  }

  /**
   * ERG 모드 토글
   */
  async toggleErgMode(enable) {
    try {
      const trainer = window.connectedDevices?.trainer;
      
      // 스마트로라 연결 확인
      if (!trainer) {
        throw new Error('스마트로라가 연결되지 않았습니다. 먼저 스마트로라를 연결해주세요.');
      }

      // 프로토콜 확인 (CPS 프로토콜은 ERG 모드 미지원)
      const protocol = trainer.protocol || 'unknown';
      if (protocol === 'CPS') {
        throw new Error('현재 연결된 스마트로라는 CPS 프로토콜을 사용합니다. ERG 모드는 FTMS 프로토콜을 지원하는 스마트로라만 사용할 수 있습니다.');
      }

      // Control Point 확인 및 재연결 시도
      let controlPoint = trainer.controlPoint;
      
      if (!controlPoint) {
        console.log('[ErgController] Control Point가 없습니다. 재연결 시도...');
        
        // Control Point 재연결 시도
        try {
          controlPoint = await this._reconnectControlPoint(trainer);
          if (controlPoint) {
            // 재연결 성공 시 trainer 객체 업데이트
            trainer.controlPoint = controlPoint;
            console.log('[ErgController] ✅ Control Point 재연결 성공');
          }
        } catch (reconnectError) {
          console.error('[ErgController] Control Point 재연결 실패:', reconnectError);
          throw new Error('스마트로라 Control Point를 찾을 수 없습니다. 스마트로라가 ERG 모드를 지원하는지 확인해주세요.');
        }
      }

      // Control Point 최종 확인
      if (!controlPoint) {
        // 프로토콜이 FTMS인데도 controlPoint가 없는 경우
        if (protocol === 'FTMS') {
          throw new Error('FTMS 프로토콜을 사용하는 스마트로라지만 Control Point를 찾을 수 없습니다. 스마트로라가 ERG 모드를 지원하는지 확인해주세요.');
        } else {
          throw new Error('스마트로라 Control Point를 찾을 수 없습니다.');
        }
      }

      this.state.enabled = enable;
      this.state.connectionStatus = 'connected';

      if (enable) {
        await this._enableErgMode();
        console.log('[ErgController] ERG 모드 활성화됨');
        if (typeof showToast === 'function') {
          showToast('ERG 모드 활성화');
        }
      } else {
        await this._disableErgMode();
        console.log('[ErgController] ERG 모드 비활성화됨');
        if (typeof showToast === 'function') {
          showToast('ERG 모드 비활성화');
        }
      }
    } catch (error) {
      console.error('[ErgController] ERG 모드 토글 오류:', error);
      this.state.enabled = false;
      if (typeof showToast === 'function') {
        showToast('ERG 모드 전환 실패: ' + error.message);
      }
      throw error;
    }
  }

  /**
   * Control Point 재연결 시도
   */
  async _reconnectControlPoint(trainer) {
    try {
      if (!trainer.server) {
        throw new Error('서버 연결이 없습니다');
      }

      // FTMS 서비스 가져오기 (정확한 UUID 사용)
      let service;
      try {
        // 정확한 UUID로 서비스 가져오기
        service = await trainer.server.getPrimaryService(this.FTMS_SERVICE_UUID);
        console.log('[ErgController] ✅ FTMS 서비스 획득 성공');
      } catch (err) {
        // 별칭으로 재시도
        try {
          service = await trainer.server.getPrimaryService("fitness_machine");
          console.log('[ErgController] ✅ FTMS 서비스 획득 성공 (별칭)');
        } catch (err2) {
          console.warn('[ErgController] ⚠️ FTMS 서비스를 찾을 수 없습니다:', err2);
          throw new Error('FTMS 서비스를 찾을 수 없습니다.');
        }
      }

      // Control Point 특성 가져오기 (정확한 UUID 사용)
      let controlPoint;
      try {
        // 정확한 UUID로 특성 가져오기
        controlPoint = await service.getCharacteristic(this.FTMS_CONTROL_POINT_UUID);
        console.log('[ErgController] ✅ Control Point 획득 성공 (UUID)');
      } catch (err) {
        // 별칭으로 재시도
        try {
          controlPoint = await service.getCharacteristic("fitness_machine_control_point");
          console.log('[ErgController] ✅ Control Point 획득 성공 (별칭)');
        } catch (err2) {
          // 16-bit UUID로 재시도
          try {
            controlPoint = await service.getCharacteristic(0x2AD9);
            console.log('[ErgController] ✅ Control Point 획득 성공 (16-bit UUID)');
          } catch (err3) {
            console.warn('[ErgController] ⚠️ Control Point 특성을 찾을 수 없습니다:', err3);
            throw new Error('Control Point 특성을 찾을 수 없습니다.');
          }
        }
      }

      return controlPoint;
    } catch (error) {
      console.error('[ErgController] Control Point 재연결 오류:', error);
      throw error; // 에러를 다시 던져서 상위에서 처리할 수 있도록 함
    }
  }

  /**
   * ERG 모드 활성화 (내부)
   */
  async _enableErgMode() {
    const trainer = window.connectedDevices?.trainer;
    if (!trainer) {
      throw new Error('스마트로라가 연결되지 않았습니다');
    }
    
    // Control Point 확인 (없으면 재연결 시도)
    let controlPoint = trainer.controlPoint;
    if (!controlPoint) {
      controlPoint = await this._reconnectControlPoint(trainer);
      if (!controlPoint) {
        throw new Error('스마트로라 Control Point를 찾을 수 없습니다');
      }
      trainer.controlPoint = controlPoint;
    }

    // 1. Control 요청 (명령 큐에 추가, 최우선순위)
    await this._queueCommand(() => {
      const requestControl = new Uint8Array([this.ERG_OP_CODES.REQUEST_CONTROL]);
      return controlPoint.writeValue(requestControl);
    }, 'REQUEST_CONTROL', { priority: 90 });

    // 2. 현재 목표 파워 가져오기
    const targetPower = window.liveData?.targetPower || this.state.targetPower || 0;
    if (targetPower > 0) {
      await this.setTargetPower(targetPower);
    }

    // 3. AI 기반 PID 파라미터 초기화
    await this._initializeAIPID();
  }

  /**
   * ERG 모드 비활성화 (내부)
   */
  async _disableErgMode() {
    const trainer = window.connectedDevices?.trainer;
    if (!trainer) {
      return; // 이미 해제된 상태
    }
    
    // Control Point 확인 (없으면 재연결 시도)
    let controlPoint = trainer.controlPoint;
    if (!controlPoint) {
      controlPoint = await this._reconnectControlPoint(trainer);
      if (!controlPoint) {
        console.warn('[ErgController] Control Point를 찾을 수 없어 ERG 모드 해제를 건너뜁니다');
        return;
      }
      trainer.controlPoint = controlPoint;
    }

    // ERG 모드 해제 (명령 큐에 추가, 최우선순위)
    await this._queueCommand(() => {
      const reset = new Uint8Array([this.ERG_OP_CODES.RESET]);
      return controlPoint.writeValue(reset);
    }, 'RESET', { priority: 100 });

    this.state.targetPower = 0;
  }

  /**
   * 목표 파워 설정 (디바운싱 적용)
   */
  async setTargetPower(watts) {
    if (!this.state.enabled) {
      console.warn('[ErgController] ERG 모드가 비활성화되어 있습니다');
      return;
    }

    if (watts <= 0) {
      console.warn('[ErgController] 유효하지 않은 목표 파워:', watts);
      return;
    }

    const trainer = window.connectedDevices?.trainer;
    if (!trainer) {
      console.warn('[ErgController] 스마트로라가 연결되지 않았습니다');
      return;
    }
    
    // Control Point 확인 (없으면 재연결 시도)
    let controlPoint = trainer.controlPoint;
    if (!controlPoint) {
      controlPoint = await this._reconnectControlPoint(trainer);
      if (!controlPoint) {
        console.warn('[ErgController] Control Point를 찾을 수 없습니다');
        return;
      }
      trainer.controlPoint = controlPoint;
    }

    // 디바운싱: 빠른 연속 호출 방지
    const now = Date.now();
    if (now - this._lastPowerUpdateTime < this._powerUpdateDebounce) {
      // 마지막 업데이트로부터 500ms 이내면 대기
      return new Promise((resolve) => {
        setTimeout(() => {
          this.setTargetPower(watts).then(resolve);
        }, this._powerUpdateDebounce - (now - this._lastPowerUpdateTime));
      });
    }
    this._lastPowerUpdateTime = now;

    try {
      // 목표 파워를 와트 단위로 변환 (0.1W 단위)
      const targetPowerValue = Math.round(watts * 10);

      // 명령 큐에 추가 (BLE 명령이 씹히지 않도록)
      await this._queueCommand(() => {
        const buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, this.ERG_OP_CODES.SET_TARGET_POWER);
        view.setUint16(1, targetPowerValue, true); // little-endian
        return controlPoint.writeValue(buffer);
      }, 'SET_TARGET_POWER', { watts, targetPowerValue, priority: 50 });

      // 상태 업데이트 (Proxy가 자동으로 구독자에게 알림)
      this.state.targetPower = watts;

      console.log('[ErgController] 목표 파워 설정:', watts, 'W');

      // AI 기반 PID 튜닝 적용
      await this._applyAIPIDTuning(watts);

    } catch (error) {
      console.error('[ErgController] 목표 파워 설정 오류:', error);
      throw error;
    }
  }

  /**
   * BLE 명령 큐에 추가 (안정성 보장, 우선순위, 재시도 지원)
   */
  async _queueCommand(commandFn, commandType, options = {}) {
    return new Promise((resolve, reject) => {
      // 큐 크기 제한 (메모리 보호)
      if (this._commandQueue.length >= this._maxQueueSize) {
        console.warn('[ErgController] 명령 큐가 가득 참, 오래된 명령 제거');
        this._commandQueue.shift(); // 가장 오래된 명령 제거
      }

      const priority = options.priority || this._commandPriorities[commandType] || 0;
      const retryCount = options.retryCount || 0;
      const maxRetries = options.maxRetries || 3;

      const command = {
        commandFn,
        commandType,
        metadata: options.metadata || {},
        resolve,
        reject,
        timestamp: Date.now(),
        priority,
        retryCount,
        maxRetries
      };

      // 우선순위에 따라 정렬하여 삽입
      const insertIndex = this._commandQueue.findIndex(cmd => cmd.priority < priority);
      if (insertIndex === -1) {
        this._commandQueue.push(command);
      } else {
        this._commandQueue.splice(insertIndex, 0, command);
      }

      console.log(`[ErgController] 명령 큐에 추가: ${commandType} (우선순위: ${priority}), 대기 중인 명령: ${this._commandQueue.length}`);

      // 큐 처리 시작 (이미 실행 중이면 추가하지 않음)
      if (!this._isProcessingQueue) {
        this._startQueueProcessing();
      }
    });
  }

  /**
   * 큐 처리 시작 (타임아웃 및 재시도 로직 포함)
   */
  _startQueueProcessing() {
    if (this._isProcessingQueue) {
      return;
    }

    this._isProcessingQueue = true;
    console.log('[ErgController] 명령 큐 처리 시작');

    const processNext = async () => {
      if (this._commandQueue.length === 0) {
        this._isProcessingQueue = false;
        console.log('[ErgController] 명령 큐 처리 완료');
        return;
      }

      const now = Date.now();
      const timeSinceLastCommand = now - this._lastCommandTime;

      // 최소 간격 확인
      if (timeSinceLastCommand < this._minCommandInterval) {
        const waitTime = this._minCommandInterval - timeSinceLastCommand;
        setTimeout(processNext, waitTime);
        return;
      }

      const command = this._commandQueue.shift();
      this._lastCommandTime = Date.now();

      // 타임아웃 처리
      const timeoutId = setTimeout(() => {
        console.error(`[ErgController] 명령 타임아웃: ${command.commandType}`);
        if (command.retryCount < command.maxRetries) {
          // 재시도
          command.retryCount++;
          console.log(`[ErgController] 명령 재시도: ${command.commandType} (${command.retryCount}/${command.maxRetries})`);
          this._commandQueue.unshift(command); // 큐 앞에 다시 추가
        } else {
          command.reject(new Error(`명령 타임아웃: ${command.commandType}`));
        }
      }, this._commandTimeout);

      try {
        console.log(`[ErgController] 명령 실행: ${command.commandType}`, command.metadata);
        await command.commandFn();
        clearTimeout(timeoutId);
        command.resolve();
      } catch (error) {
        clearTimeout(timeoutId);
        console.error(`[ErgController] 명령 실행 오류: ${command.commandType}`, error);
        
        // 재시도 로직
        if (command.retryCount < command.maxRetries) {
          command.retryCount++;
          console.log(`[ErgController] 명령 재시도: ${command.commandType} (${command.retryCount}/${command.maxRetries})`);
          // 우선순위에 따라 다시 삽입
          const insertIndex = this._commandQueue.findIndex(cmd => cmd.priority < command.priority);
          if (insertIndex === -1) {
            this._commandQueue.push(command);
          } else {
            this._commandQueue.splice(insertIndex, 0, command);
          }
        } else {
          command.reject(error);
        }
      }

      // 다음 명령 처리
      setTimeout(processNext, this._minCommandInterval);
    };

    processNext();
  }

  /**
   * AI 기반 PID 파라미터 초기화
   */
  async _initializeAIPID() {
    try {
      // 사용자 페달링 스타일 분석 (최근 데이터 기반)
      const pedalingStyle = await this._analyzePedalingStyle();
      this.state.pedalingStyle = pedalingStyle;

      // 페달링 스타일에 따른 기본 PID 파라미터 설정
      if (pedalingStyle === 'smooth') {
        this.state.pidParams = { Kp: 0.4, Ki: 0.15, Kd: 0.03 };
      } else {
        this.state.pidParams = { Kp: 0.6, Ki: 0.08, Kd: 0.08 };
      }

      console.log('[ErgController] AI PID 초기화 완료:', {
        pedalingStyle,
        pidParams: this.state.pidParams
      });
    } catch (error) {
      console.error('[ErgController] AI PID 초기화 오류:', error);
      // 기본값 사용
      this.state.pidParams = { Kp: 0.5, Ki: 0.1, Kd: 0.05 };
    }
  }

  /**
   * 페달링 스타일 분석 (Edge AI - 로컬 분석)
   */
  async _analyzePedalingStyle() {
    // 최근 케이던스 데이터 분석 (변동성 계산)
    if (this._cadenceHistory.length < 10) {
      return 'smooth'; // 기본값
    }

    const recentCadences = this._cadenceHistory.slice(-30); // 최근 30개 샘플
    const avg = recentCadences.reduce((a, b) => a + b, 0) / recentCadences.length;
    const variance = recentCadences.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / recentCadences.length;
    const stdDev = Math.sqrt(variance);

    // 변동성이 낮으면 부드러운 스타일, 높으면 공격적인 스타일
    return stdDev < 5 ? 'smooth' : 'aggressive';
  }

  /**
   * AI 기반 PID 튜닝 적용
   */
  async _applyAIPIDTuning(targetPower) {
    // Edge AI: 로컬에서 케이던스 변동성 분석
    const pedalingStyle = await this._analyzePedalingStyle();
    
    if (pedalingStyle !== this.state.pedalingStyle) {
      this.state.pedalingStyle = pedalingStyle;
      
      // PID 파라미터 재조정
      if (pedalingStyle === 'smooth') {
        this.state.pidParams = { Kp: 0.4, Ki: 0.15, Kd: 0.03 };
      } else {
        this.state.pidParams = { Kp: 0.6, Ki: 0.08, Kd: 0.08 };
      }
    }

    // Cloud AI: 5분마다 Gemini API 호출 (비용 절감)
    const now = Date.now();
    if (now - this._lastCloudAICall > this._cloudAICallInterval) {
      await this._callCloudAI();
      this._lastCloudAICall = now;
    }
  }

  /**
   * Cloud AI 호출 (Gemini API - 5분마다)
   */
  async _callCloudAI() {
    try {
      // 최근 5분간의 데이터 요약
      const summary = this._summarizeRecentData();
      
      // Gemini API 호출 (기존 checkFatigueAndAdjust 함수 활용)
      if (typeof checkFatigueAndAdjust === 'function') {
        // checkFatigueAndAdjust는 인자 없이 호출되므로, 내부에서 데이터를 수집함
        const result = await checkFatigueAndAdjust();
        
        if (result && result.fatigueLevel !== undefined) {
          this.state.fatigueLevel = result.fatigueLevel;
          
          // 피로도가 높으면 자동으로 강도 조정
          if (this.state.autoAdjustmentEnabled && result.fatigueLevel > 70) {
            const currentPower = this.state.targetPower;
            const adjustedPower = Math.round(currentPower * 0.95); // 5% 감소
            await this.setTargetPower(adjustedPower);
            console.log('[ErgController] 피로도 감지로 강도 조정:', currentPower, 'W →', adjustedPower, 'W');
          }
        }
      } else {
        // checkFatigueAndAdjust가 없으면 직접 분석
        const fatigueLevel = this._calculateFatigueLevel(summary);
        this.state.fatigueLevel = fatigueLevel;
        
        if (this.state.autoAdjustmentEnabled && fatigueLevel > 70) {
          const currentPower = this.state.targetPower;
          const adjustedPower = Math.round(currentPower * 0.95);
          await this.setTargetPower(adjustedPower);
          console.log('[ErgController] 피로도 감지로 강도 조정:', currentPower, 'W →', adjustedPower, 'W');
        }
      }
    } catch (error) {
      console.error('[ErgController] Cloud AI 호출 오류:', error);
    }
  }

  /**
   * 피로도 수준 계산 (휴리스틱 방법)
   */
  _calculateFatigueLevel(summary) {
    // 간단한 휴리스틱: 심박수와 파워 달성도 기반
    const hrRatio = summary.avgHeartRate > 0 ? (summary.avgHeartRate / 180) : 0; // 최대 심박수 180 가정
    const powerRatio = summary.targetPower > 0 ? (summary.avgPower / summary.targetPower) : 1;
    
    // 심박수가 높고 파워 달성도가 낮으면 피로도 높음
    const fatigueLevel = Math.min(100, Math.max(0, (hrRatio * 0.7 + (1 - powerRatio) * 0.3) * 100));
    
    return Math.round(fatigueLevel);
  }

  /**
   * 최근 데이터 요약 (Gemini API용)
   */
  _summarizeRecentData() {
    const now = Date.now();
    const fiveMinutesAgo = now - (5 * 60 * 1000);
    
    // 히스토리에서 최근 5분간 데이터 필터링
    const recentPower = this._powerHistory.filter(entry => entry.timestamp > fiveMinutesAgo).map(e => e.value);
    const recentHR = this._heartRateHistory.filter(entry => entry.timestamp > fiveMinutesAgo).map(e => e.value);
    const recentCadence = this._cadenceHistory.slice(-60); // 최근 60개 샘플
    
    return {
      avgPower: this._calculateAverageFromArray(recentPower) || (window.liveData?.power || 0),
      avgHeartRate: this._calculateAverageFromArray(recentHR) || (window.liveData?.heartRate || 0),
      avgCadence: this._calculateAverageFromArray(recentCadence) || (window.liveData?.cadence || 0),
      targetPower: this.state.targetPower,
      pedalingStyle: this.state.pedalingStyle,
      timestamp: now
    };
  }

  /**
   * 배열에서 평균 계산
   */
  _calculateAverageFromArray(arr) {
    if (!arr || arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /**
   * 케이던스 업데이트 (Edge AI 분석용)
   */
  updateCadence(cadence) {
    if (typeof cadence === 'number' && cadence > 0) {
      this._cadenceHistory.push(cadence);
      // 히스토리 크기 제한 (최근 100개만 유지)
      if (this._cadenceHistory.length > 100) {
        this._cadenceHistory.shift();
      }

      // 현재 파워 업데이트
      this.state.currentPower = window.liveData?.power || 0;
    }
  }

  /**
   * 파워 업데이트 (히스토리 저장)
   */
  updatePower(power) {
    if (typeof power === 'number' && power > 0) {
      this._powerHistory.push({ value: power, timestamp: Date.now() });
      // 히스토리 크기 제한 (최근 5분 분량만 유지)
      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
      this._powerHistory = this._powerHistory.filter(entry => entry.timestamp > fiveMinutesAgo);
      
      this.state.currentPower = power;
    }
  }

  /**
   * 심박수 업데이트 (히스토리 저장)
   */
  updateHeartRate(heartRate) {
    if (typeof heartRate === 'number' && heartRate > 0) {
      this._heartRateHistory.push({ value: heartRate, timestamp: Date.now() });
      // 히스토리 크기 제한 (최근 5분 분량만 유지)
      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
      this._heartRateHistory = this._heartRateHistory.filter(entry => entry.timestamp > fiveMinutesAgo);
    }
  }

  /**
   * 연결 상태 업데이트
   */
  updateConnectionStatus(status) {
    this.state.connectionStatus = status;
    
    // 연결 해제 시 상태 초기화
    if (status === 'disconnected' && this.state.enabled) {
      this._resetState();
    }
  }

  /**
   * 현재 상태 가져오기
   */
  getState() {
    return { ...this.state };
  }

  /**
   * 명령 큐 상태 가져오기 (디버깅용)
   */
  getQueueStatus() {
    return {
      queueLength: this._commandQueue.length,
      isProcessing: this._isProcessingQueue,
      lastCommandTime: this._lastCommandTime
    };
  }
}

// Singleton 인스턴스 생성 및 export
const ergController = new ErgController();

// 전역 노출 (모듈 시스템 미지원 환경 대응)
if (typeof window !== 'undefined') {
  window.ergController = ergController;
}

// ES6 모듈 export (모듈 시스템 지원 환경)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ergController, ErgController };
}

console.log('[ErgController] 모듈 로드 완료');
