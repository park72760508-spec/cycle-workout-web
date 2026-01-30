/* ==========================================================
   ErgController.js (v5.1 Promise Fix & Silk Road Engine)
   - Fixes "undefined reading catch" error in app.js
   - Ensures toggleErgMode ALWAYS returns a Promise
   - Retains "Silk Road" Smooth Ramping & Legacy Priority
========================================================== */

class ErgController {
  constructor() {
    this._state = {
      enabled: false,
      targetPower: 0,
      currentAppliedPower: 0,
      currentPower: 0,
      connectionStatus: 'disconnected'
    };
    this.state = this._createReactiveState(this._state);

    this._subscribers = [];

    // Engine Config
    this._rampingFactor = 0.15;
    this._controlLoopInterval = 250;
    this._controlLoopId = null;

    this._commandQueue = [];
    this._isProcessingQueue = false;
    this._maxQueueSize = 20;

    this._knownControlPoints = {
      '347b0012-7635-408b-8918-8ff3949ce592': 'CYCLEOPS',
      'a026e005-0a7d-4ab3-97fa-f1500f9feb8b': 'WAHOO',
      '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e': 'TACX',
      '00002ad9-0000-1000-8000-00805f9b34fb': 'FTMS'
    };

    this._commandPriorities = {
      'RESET': 100,
      'REQUEST_CONTROL': 90,
      'SET_TARGET_POWER': 50
    };

    this._setupConnectionWatcher();
    console.log('[ErgController] v5.1 (Promise Fix) Initialized');
  }

  // ── [1] State & Watchers ──

  _setupConnectionWatcher() {
    let lastTrainerState = null;
    const checkConnection = () => {
      const currentTrainer = window.connectedDevices?.trainer;
      const wasConnected = lastTrainerState?.controlPoint !== null;
      const isConnected = currentTrainer?.controlPoint !== null;

      if (wasConnected && !isConnected) {
          this._stopControlLoop();
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
    this.state.enabled = false;
    this.state.targetPower = 0;
    this.state.currentAppliedPower = 0;
    this._stopControlLoop();
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

  // ── [2] Deep Scan (Robust) ──

  async _deepScanForControlPoint(trainer) {
    try {
      const server = trainer.server || (trainer.device && trainer.device.gatt);
      if (!server || !server.connected) return null;

      console.log('[ERG] Starting Deep Scan (v5.1)...');
      let services = [];
      try { services = await server.getPrimaryServices(); }
      catch(e) {
          const knownSvcs = ['347b0001-7635-408b-8918-8ff3949ce592', '00001826-0000-1000-8000-00805f9b34fb'];
          for(const u of knownSvcs) try { services.push(await server.getPrimaryService(u)); } catch(_){}
      }

      let bestMatch = null;

      for (const service of services) {
        try {
           const chars = await service.getCharacteristics();
           for (const char of chars) {
              const uuid = (char.uuid || '').toLowerCase();
              if (!uuid) continue;

              if (this._knownControlPoints[uuid]) {
                 const proto = this._knownControlPoints[uuid];
                 if (proto === 'CYCLEOPS' || proto === 'WAHOO') {
                     return { point: char, protocol: proto };
                 }
                 if (proto === 'FTMS' && !bestMatch) {
                     bestMatch = { point: char, protocol: proto };
                 }
              }
              if (uuid.startsWith('347b')) return { point: char, protocol: 'CYCLEOPS' };
           }
        } catch (e) {}
      }
      return bestMatch;
    } catch (e) { return null; }
  }

  // ── [3] Silk Road Control Loop ──

  _startControlLoop() {
    if (this._controlLoopId) return;
    console.log('[ERG] Starting Smooth Control Loop');

    this._controlLoopId = setInterval(async () => {
        if (!this.state.enabled) return;

        const target = this.state.targetPower;
        let current = this.state.currentAppliedPower;

        const diff = target - current;
        if (Math.abs(diff) < 1) return;

        let nextPower = current + (diff * this._rampingFactor);
        if (Math.abs(target - nextPower) < 1) nextPower = target;

        this.state.currentAppliedPower = nextPower;

        await this._sendCommand(Math.round(nextPower));
    }, this._controlLoopInterval);
  }

  _stopControlLoop() {
    if (this._controlLoopId) {
        clearInterval(this._controlLoopId);
        this._controlLoopId = null;
    }
  }

  // ── [4] Command Sender ──

  async _sendCommand(watts) {
    const trainer = window.connectedDevices?.trainer;
    const controlPoint = trainer?.controlPoint;
    if (!trainer || !controlPoint) return;

    const protocol = trainer.realProtocol || 'FTMS';
    const safeWatts = Math.max(0, Math.min(2000, Math.round(watts)));

    let buffer;
    if (protocol === 'FTMS') {
        buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x05);
        view.setInt16(1, safeWatts, true);
    } else {
        buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x42);
        view.setUint16(1, safeWatts, true);
    }

    this._queueCommand(async () => {
         if (typeof controlPoint.writeValueWithoutResponse === 'function') {
             try { await controlPoint.writeValueWithoutResponse(buffer); return; } catch(e){}
         }
         await controlPoint.writeValue(buffer);
    }, 'SET_POWER', { priority: 50 });
  }

  // ── [5] Public API (Strict Async) ──

  async toggleErgMode(enable) {
    try {
        const trainer = window.connectedDevices?.trainer;
        if (!trainer) throw new Error("No trainer connected");

        let controlPoint = trainer.controlPoint;
        let protocol = trainer.realProtocol || 'FTMS';

        if (!controlPoint || protocol === 'CPS' || protocol === 'FTMS') {
            const result = await this._deepScanForControlPoint(trainer);
            if (result) {
                controlPoint = result.point;
                protocol = result.protocol;
                trainer.controlPoint = controlPoint;
                trainer.realProtocol = protocol;
                trainer.protocol = (protocol === 'CYCLEOPS' || protocol === 'WAHOO') ? 'FTMS' : protocol;
            }
        }

        if (!controlPoint) throw new Error("Control Point Not Found");

        this.state.enabled = enable;
        this.state.connectionStatus = 'connected';
        this._notifySubscribers('enabled', enable);

        if (typeof showToast === 'function') showToast(`ERG ${enable ? 'ON' : 'OFF'} [${protocol}]`);

        if (enable) {
           this._queueCommand(async () => {
               const initByte = (protocol === 'FTMS') ? 0x00 : 0x01;
               if (typeof controlPoint.writeValueWithoutResponse === 'function') {
                   try { await controlPoint.writeValueWithoutResponse(new Uint8Array([initByte])); } catch(e){}
               } else {
                   await controlPoint.writeValue(new Uint8Array([initByte]));
               }
           }, 'INIT', { priority: 90 });

           this.state.currentAppliedPower = 0;
           this._startControlLoop();
        } else {
           this._stopControlLoop();
           this._sendCommand(0);
        }

        return true;
    } catch (e) {
        console.error("[ERG] Toggle Error:", e);
        throw e;
    }
  }

  async setTargetPower(watts) {
    if (!this.state.enabled) return Promise.resolve();
    this.state.targetPower = Math.max(0, Math.min(2000, Math.round(watts)));
    return Promise.resolve();
  }

  // ── [6] Queue System ──

  async _queueCommand(commandFn, commandType, options = {}) {
    if (this._commandQueue.length >= this._maxQueueSize) this._commandQueue.shift();
    this._commandQueue.push({ commandFn, timestamp: Date.now() });
    if (!this._isProcessingQueue) this._processQueue();
  }

  async _processQueue() {
    if (this._isProcessingQueue || this._commandQueue.length === 0) return;
    this._isProcessingQueue = true;

    while (this._commandQueue.length > 0) {
        const cmd = this._commandQueue.shift();
        try { await cmd.commandFn(); } catch(e) { console.warn('[ERG] Write fail:', e); }
        await new Promise(r => setTimeout(r, 50));
    }
    this._isProcessingQueue = false;
  }

  subscribe(cb) {
    if (typeof cb !== 'function') return () => {};
    this._subscribers.push(cb);
    return () => {
      const i = this._subscribers.indexOf(cb);
      if (i > -1) this._subscribers.splice(i, 1);
    };
  }

  _notifySubscribers(k, v) {
    this._subscribers.forEach(cb => { try{ cb(this.state, k, v); }catch(_){} });
  }

  async initializeTrainer() {}

  updateCadence(c) {}
  updatePower(p) { if (p != null && !isNaN(p)) this.state.currentPower = p; }
  updateHeartRate(h) {}
  updateConnectionStatus(s) { this.state.connectionStatus = s; if (s === 'disconnected') this._resetState(); }
  getState() { return {...this.state}; }
}

const ergController = new ErgController();
if (typeof window !== 'undefined') window.ergController = ergController;
if (typeof module !== 'undefined' && module.exports) module.exports = { ergController, ErgController };
