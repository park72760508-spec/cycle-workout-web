/* ==========================================================
   ErgController.js (v4.3 Legacy Re-Discovery Restored)
   - Restoration of "Lazy Discovery": If Control Point is missing at connection,
     it attempts to find it again when ERG is toggled.
   - Essential for CycleOps/Wahoo devices that connect as CPS first.
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
    this._cpsErgWarningShown = false;

    this._commandPriorities = {
      'RESET': 100,
      'REQUEST_CONTROL': 90,
      'SET_TARGET_POWER': 50
    };

    this._setupConnectionWatcher();
    console.log('[ErgController] v4.3 (Re-Discovery Engine) Initialized');
  }

  // ── [1] Internal Helpers ──

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

  // ── [2] Re-Discovery Logic (The Missing Link) ──

  async _findFTMSControlPoint(trainer) {
    try {
      const server = trainer.server || (trainer.device && trainer.device.gatt);
      if (!server || !server.connected) return null;
      
      // FTMS UUIDs
      const service = await server.getPrimaryService('00001826-0000-1000-8000-00805f9b34fb');
      return await service.getCharacteristic('00002ad9-0000-1000-8000-00805f9b34fb');
    } catch (e) { return null; }
  }

  async _findLegacyControlPoint(trainer) {
    try {
      const server = trainer.server || (trainer.device && trainer.device.gatt);
      if (!server || !server.connected) return null;

      // CycleOps UUIDs
      try {
        const svc = await server.getPrimaryService('347b0001-7635-408b-8918-8ff3949ce592');
        const cp = await svc.getCharacteristic('347b0012-7635-408b-8918-8ff3949ce592');
        console.log('[ERG] Legacy CycleOps Control Found via Re-scan');
        return cp;
      } catch (_) {}

      // Wahoo UUIDs
      try {
        const svc = await server.getPrimaryService('a026e005-0a7d-4ab3-97fa-f1500f9feb8b');
        const cp = await svc.getCharacteristic('a026e005-0a7d-4ab3-97fa-f1500f9feb8b');
        console.log('[ERG] Legacy Wahoo Control Found via Re-scan');
        return cp;
      } catch (_) {}

      return null;
    } catch (e) { return null; }
  }

  // ── [3] Core Logic: Toggle & Set Power ──

  async toggleErgMode(enable) {
    const trainer = window.connectedDevices?.trainer;
    if (!trainer) {
        alert("스마트 로라가 연결되지 않았습니다.");
        throw new Error("No trainer connected");
    }

    // ★ [CORE FIX] Lazy Discovery: If Control Point is missing, try to find it NOW.
    let controlPoint = trainer.controlPoint;
    let protocol = trainer.realProtocol || 'FTMS';

    if (!controlPoint || protocol === 'CPS') {
        console.log('[ERG] Control Point Missing/CPS. Attempting Re-Discovery...');
        
        // 1. Try FTMS
        const ftmsCP = await this._findFTMSControlPoint(trainer);
        if (ftmsCP) {
            controlPoint = ftmsCP;
            protocol = 'FTMS';
            console.log('✅ Re-Discovery: Found FTMS');
        } 
        // 2. Try Legacy
        else {
            const legacyCP = await this._findLegacyControlPoint(trainer);
            if (legacyCP) {
                controlPoint = legacyCP;
                protocol = 'CYCLEOPS'; // Force Legacy Protocol
                console.log('✅ Re-Discovery: Found Legacy (CycleOps/Wahoo)');
            }
        }

        // Update the trainer object if found
        if (controlPoint) {
            trainer.controlPoint = controlPoint;
            trainer.realProtocol = protocol;
            trainer.protocol = protocol;
        }
    }

    // Now check again
    if (!controlPoint) {
        alert("이 기기는 파워미터 모드만 지원하며, 저항 제어(ERG)를 할 수 없습니다.");
        throw new Error("No control point found after re-scan");
    }

    this.state.enabled = enable;
    this.state.connectionStatus = 'connected';
    this._notifySubscribers('enabled', enable);

    if (enable) {
       // Enable Logic
       if (protocol === 'FTMS') {
           await this._queueCommand(async () => {
               await controlPoint.writeValue(new Uint8Array([0x00])); // Request Control
           }, 'REQUEST_CONTROL', { priority: 90 });
       } else if (protocol === 'CYCLEOPS' || protocol === 'WAHOO') {
           // Legacy Init
           try {
               await this._queueCommand(async () => {
                   await controlPoint.writeValue(new Uint8Array([0x01])); 
               }, 'RESET', { priority: 90 });
           } catch(e) {}
       }
       
       if(this.state.targetPower > 0) this.setTargetPower(this.state.targetPower);

    } else {
       // Disable Logic
       if (protocol === 'FTMS') {
           try { 
               await this._queueCommand(async () => {
                    await controlPoint.writeValue(new Uint8Array([0x01])); // Reset
               }, 'RESET', { priority: 100 });
           } catch(e){}
       } else {
           // Legacy: Send 0W
           try { await this.setTargetPower(0); } catch(e) {}
       }
    }
  }

  async setTargetPower(watts) {
    if (!this.state.enabled && watts !== 0) return;
    
    const trainer = window.connectedDevices?.trainer;
    // Re-check control point in case it was just found
    const controlPoint = trainer?.controlPoint;
    
    if (!trainer || !controlPoint) return;

    const targetWatts = Math.max(0, Math.min(2000, Math.round(watts)));
    this.state.targetPower = targetWatts;

    let buffer;
    // Use realProtocol for router
    const protocol = trainer.realProtocol || trainer.protocol || 'FTMS'; 

    if (protocol === 'FTMS') {
        buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x05); 
        view.setInt16(1, targetWatts, true);
    } else {
        // Legacy (CycleOps/Wahoo use 0x42)
        buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x42); 
        view.setUint16(1, targetWatts, true); 
    }

    await this._queueCommand(async () => {
        if (controlPoint.properties && controlPoint.properties.writeWithoutResponse) {
            await controlPoint.writeValueWithoutResponse(buffer);
        } else {
            await controlPoint.writeValue(buffer);
        }
        console.log(`[ERG] Sent ${targetWatts}W via ${protocol}`);
    }, 'SET_TARGET_POWER', { priority: 50 });
  }

  // ── [4] Queue System ──

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
          setTimeout(() => {
            this._commandQueue.unshift(command);
            processNext();
          }, 500); // 500ms delay on retry
          return;
        } else {
          command.reject(error);
        }
      }
      setTimeout(processNext, this._minCommandInterval);
    };
    processNext();
  }

  // Called by bluetooth.js after connect (optional; control point discovered on first ERG toggle)
  async initializeTrainer() {
    // Lazy: control point discovered when user toggles ERG
  }

  updateCadence(c) { if(c>0) this._cadenceHistory.push(c); }
  updatePower(p) { if(p>0) { this._powerHistory.push({value:p, timestamp:Date.now()}); this.state.currentPower = p; } }
  updateHeartRate(h) { if(h>0) this._heartRateHistory.push({value:h, timestamp:Date.now()}); }
  updateConnectionStatus(s) { this.state.connectionStatus = s; if(s==='disconnected') this._resetState(); }
  getState() { return {...this.state}; }
}

const ergController = new ErgController();
if (typeof window !== 'undefined') window.ergController = ergController;
if (typeof module !== 'undefined' && module.exports) module.exports = { ergController, ErgController };
