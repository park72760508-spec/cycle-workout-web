/* ==========================================================
   ErgController.js (v8.0 Silk Road Pro - World Class Smoothness)
   - "Water-Flow" Control Logic: Uses Physics-based LPF smoothing
   - Smart Anti-Lock: Prevents "Spiral of Death" intelligently based on RPM
   - Legacy Hunter: Guarantees connection on iOS/Bluefy & Windows
   - The Ultimate ERG Experience
========================================================== */

class ErgController {
  constructor() {
    this._state = {
      enabled: false,
      targetPower: 0,
      currentAppliedPower: 0,
      cadence: 0,
      currentPower: 0,
      connectionStatus: 'disconnected'
    };
    this.state = this._createReactiveState(this._state);

    this._subscribers = [];

    // ⚙️ Pro Tuning Parameters (The Secret Sauce)
    this._smoothFactor = 0.12;  // "Silky" factor (Lower = Smoother)
    this._controlLoopInterval = 250; // 4 updates per second
    this._controlLoopId = null;
    this._lastCadenceTime = 0;

    this._commandQueue = [];
    this._isProcessingQueue = false;
    this._maxQueueSize = 20;

    this._uuids = {
      cycleops: '347b0012-7635-408b-8918-8ff3949ce592',
      wahoo:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
      tacx:     '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e',
      ftms:     '00002ad9-0000-1000-8000-00805f9b34fb'
    };

    this._setupConnectionWatcher();
    console.log('[ErgController] v8.0 (Silk Road Pro) Initialized');
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
    this.state.cadence = 0;
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

  // ── [2] Deep Scan (Legacy Hunter - iOS Fix) ──

  async _deepScanForControlPoint(trainer) {
    try {
      const server = trainer.server || (trainer.device && trainer.device.gatt);
      if (!server || !server.connected) return null;

      console.log('[ERG] Starting Deep Scan (v8.0)...');
      let services = [];
      try { services = await server.getPrimaryServices(); }
      catch(e) {
          const knownSvcs = ['347b0001-7635-408b-8918-8ff3949ce592', 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b', '00001826-0000-1000-8000-00805f9b34fb'];
          for(const u of knownSvcs) try { services.push(await server.getPrimaryService(u)); } catch(_){}
      }

      // Priority 1: CycleOps
      for (const service of services) {
        try {
           const chars = await service.getCharacteristics();
           for (const char of chars) {
              const uuid = (char.uuid || '').toLowerCase();
              if (uuid === this._uuids.cycleops || uuid.startsWith('347b0012')) return { point: char, protocol: 'CYCLEOPS' };
           }
        } catch(e) {}
      }
      // Priority 2: Wahoo
      for (const service of services) {
        try {
           const chars = await service.getCharacteristics();
           for (const char of chars) {
              const uuid = (char.uuid || '').toLowerCase();
              if (uuid === this._uuids.wahoo) return { point: char, protocol: 'WAHOO' };
           }
        } catch(e) {}
      }
      // Priority 3: FTMS
      for (const service of services) {
        try {
           const chars = await service.getCharacteristics();
           for (const char of chars) {
              const uuid = (char.uuid || '').toLowerCase();
              if (uuid === this._uuids.ftms) return { point: char, protocol: 'FTMS' };
           }
        } catch(e) {}
      }
      return null;
    } catch (e) { return null; }
  }

  // ── [3] "Water-Flow" Control Loop (The Magic) ──

  _startControlLoop() {
    if (this._controlLoopId) return;
    console.log('[ERG] Starting Silk Road Pro Loop');

    this._controlLoopId = setInterval(async () => {
        if (!this.state.enabled) return;

        const rawTarget = this.state.targetPower;
        let rpm = this.state.cadence;

        if (Date.now() - this._lastCadenceTime > 5000) rpm = 0;

        // ★ Logic 1: Smart Anti-Lock (RPM Scaling)
        let smartTarget = rawTarget;
        if (rpm < 45) {
            smartTarget = Math.min(60, rawTarget);
        } else if (rpm < 70) {
            // 45rpm->64%, 60rpm->85%, 70rpm->100%
            const factor = 0.64 + ((rpm - 45) * 0.0144);
            smartTarget = rawTarget * Math.min(1.0, factor);
        }

        // ★ Logic 2: "Water-Flow" Smoothing (Low Pass Filter)
        let current = this.state.currentAppliedPower;
        const diff = smartTarget - current;

        if (Math.abs(diff) < 1.5) return;

        let nextPower = current + (diff * this._smoothFactor);

        if (Math.abs(smartTarget - nextPower) < 1.5) nextPower = smartTarget;

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

  // ── [4] Command Sender (Hybrid Force) ──

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
         const isLegacy = (protocol === 'CYCLEOPS' || protocol === 'WAHOO' || protocol === 'TACX');

         if (isLegacy) {
             try {
                 await controlPoint.writeValue(buffer);
                 return;
             } catch (e) {
                 if (typeof controlPoint.writeValueWithoutResponse === 'function') {
                     try { await controlPoint.writeValueWithoutResponse(buffer); return; } catch(e2){}
                 }
             }
             return;
         }

         if (typeof controlPoint.writeValueWithoutResponse === 'function') {
             try { await controlPoint.writeValueWithoutResponse(buffer); return; } catch(e){}
         }
         try { await controlPoint.writeValue(buffer); } catch(e){}
    }, 'SET_POWER', { priority: 50 });
  }

  // ── [5] Public API ──

  async toggleErgMode(enable) {
    try {
        const trainer = window.connectedDevices?.trainer;
        if (!trainer) throw new Error("No trainer connected");

        const result = await this._deepScanForControlPoint(trainer);
        if (result) {
            trainer.controlPoint = result.point;
            trainer.realProtocol = result.protocol;
            trainer.protocol = (result.protocol === 'CYCLEOPS' || result.protocol === 'WAHOO') ? 'FTMS' : result.protocol;
        }

        const controlPoint = trainer.controlPoint;
        const protocol = trainer.realProtocol || 'FTMS';

        if (!controlPoint) throw new Error("Control Point Not Found");

        this.state.enabled = enable;
        this.state.connectionStatus = 'connected';
        this._notifySubscribers('enabled', enable);

        if (typeof showToast === 'function') showToast(`ERG ${enable ? 'ON' : 'OFF'} [${protocol}]`);

        if (enable) {
           const initByte = (protocol === 'FTMS') ? 0x00 : 0x01;
           const initBuf = new Uint8Array([initByte]);
           this._queueCommand(async () => {
              try { await controlPoint.writeValue(initBuf); } catch(e) {
                  if (typeof controlPoint.writeValueWithoutResponse === 'function') try { await controlPoint.writeValueWithoutResponse(initBuf); } catch(e2){}
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

  // ── [Data Helpers] ──

  updateCadence(c) {
      if (c > 0) {
          this.state.cadence = c;
          this._lastCadenceTime = Date.now();
      }
  }

  updatePower(p) { if (p != null && !isNaN(p)) this.state.currentPower = p; }
  updateHeartRate(h) {}

  updateConnectionStatus(s) {
    this.state.connectionStatus = s;
    if (s === 'disconnected') this._resetState();
  }

  // ── [Queue System] ──

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
        try { await cmd.commandFn(); } catch(e) {}
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

  getState() { return {...this.state}; }
}

const ergController = new ErgController();
if (typeof window !== 'undefined') window.ergController = ergController;
if (typeof module !== 'undefined' && module.exports) module.exports = { ergController, ErgController };
