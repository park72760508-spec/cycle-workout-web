/* ==========================================================
   ErgController.js (v4.2 Final - Legacy Safety Restored)
   - ZWIFT/MyWhoosh Command Logic (0x05 for FTMS, 0x42 for Legacy)
   - Restored: Legacy ERG OFF logic (sends 0W to release resistance)
   - Restored: Legacy Initialization logic
   - Full Command Queue & State Management
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
    
    // Priority Map
    this._commandPriorities = {
      'RESET': 100,
      'REQUEST_CONTROL': 90,
      'SET_TARGET_POWER': 50
    };

    this._setupConnectionWatcher();
    console.log('[ErgController] v4.2 (Legacy Safety Restored) Initialized');
  }

  // ── [State & Connection Management] ──

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

  // ── [Core Logic: Initialization & Commands] ──

  async initializeTrainer() {
    const trainer = window.connectedDevices?.trainer;
    if (!trainer || !trainer.controlPoint) return;

    console.log(`[ERG] Initializing Control for ${trainer.protocol}...`);
    try {
        if (trainer.protocol === 'FTMS') {
             await this._queueCommand(async () => {
                await trainer.controlPoint.writeValue(new Uint8Array([0x00])); // Request Control
             }, 'REQUEST_CONTROL', { priority: 90 });
            console.log('[ERG] FTMS Control Requested (0x00)');
        } 
        // [Restored] Legacy Initialization
        else if (trainer.protocol === 'CYCLEOPS' || trainer.protocol === 'WAHOO') {
             // Some legacy devices benefit from a reset command
             try {
                await this._queueCommand(async () => {
                    await trainer.controlPoint.writeValue(new Uint8Array([0x01])); // Reset/Init
                }, 'RESET', { priority: 90 });
                console.log('[ERG] Legacy Device Initialized');
             } catch(e) { console.warn('[ERG] Legacy Init ignored:', e); }
        }
    } catch (e) {
        console.warn('[ERG] Initialize Warning:', e);
    }
  }

  async toggleErgMode(enable) {
    const trainer = window.connectedDevices?.trainer;
    if (!trainer) {
        alert("스마트 로라가 연결되지 않았습니다.");
        throw new Error("No trainer connected");
    }
    if (!trainer.controlPoint) {
        alert("이 기기는 파워미터 모드만 지원하며, 저항 제어(ERG)를 할 수 없습니다.");
        throw new Error("No control point");
    }

    this.state.enabled = enable;
    this.state.connectionStatus = 'connected';
    this._notifySubscribers('enabled', enable);

    console.log(`[ERG] ERG Mode ${enable ? 'ON' : 'OFF'} (${trainer.protocol})`);

    if (enable) {
       // ERG ON: Re-send current target power if exists
       if(this.state.targetPower > 0) this.setTargetPower(this.state.targetPower);
    } else {
       // ERG OFF: Logic depends on protocol
       if (trainer.protocol === 'FTMS') {
           try { 
               await this._queueCommand(async () => {
                    await trainer.controlPoint.writeValue(new Uint8Array([0x01])); // Reset
               }, 'RESET', { priority: 100 });
               console.log('[ERG] FTMS Reset Sent');
           } catch(e){}
       } else {
           // [Restored] Legacy: Send 0 Watts to release resistance
           try {
               await this.setTargetPower(0); 
               console.log('[ERG] Legacy Resistance Released (0W)');
           } catch(e) {}
       }
    }
  }

  async setTargetPower(watts) {
    // Note: If enabled is false, we still allow 0W calls (used for releasing resistance)
    if (!this.state.enabled && watts !== 0) return;
    
    const trainer = window.connectedDevices?.trainer;
    if (!trainer || !trainer.controlPoint) return;

    const targetWatts = Math.max(0, Math.min(2000, Math.round(watts)));
    this.state.targetPower = targetWatts;

    let buffer;
    const protocol = trainer.protocol; 

    // ★ [CORE] Protocol Router
    if (protocol === 'FTMS') {
        buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x05); 
        view.setInt16(1, targetWatts, true);
    } else {
        // Legacy (CycleOps, Wahoo, Tacx use 0x42)
        buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x42); 
        view.setUint16(1, targetWatts, true); 
    }

    // Queue system for command safety
    await this._queueCommand(async () => {
        const char = trainer.controlPoint;
        if (char.properties && char.properties.writeWithoutResponse) {
            await char.writeValueWithoutResponse(buffer);
        } else {
            await char.writeValue(buffer);
        }
        console.log(`[ERG] Sent ${targetWatts}W via ${protocol}`);
    }, 'SET_TARGET_POWER', { priority: 50 });
  }

  // ── [Queue System - PRESERVED] ──

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
          console.warn(`[ERG] 명령 재시도 ${command.retryCount}`, error.message);
          setTimeout(() => {
            this._commandQueue.unshift(command);
            processNext();
          }, 300);
          return;
        } else {
          console.error(`[ERG] 명령 실패:`, error);
          command.reject(error);
        }
      }
      setTimeout(processNext, this._minCommandInterval);
    };
    processNext();
  }

  // ── [Data Collection Helpers] ──
  updateCadence(c) { if(c>0) this._cadenceHistory.push(c); }
  updatePower(p) { if(p>0) { this._powerHistory.push({value:p, timestamp:Date.now()}); this.state.currentPower = p; } }
  updateHeartRate(h) { if(h>0) this._heartRateHistory.push({value:h, timestamp:Date.now()}); }
  updateConnectionStatus(s) { this.state.connectionStatus = s; if(s==='disconnected') this._resetState(); }
  getState() { return {...this.state}; }
}

const ergController = new ErgController();
if (typeof window !== 'undefined') window.ergController = ergController;
if (typeof module !== 'undefined' && module.exports) module.exports = { ergController, ErgController };
