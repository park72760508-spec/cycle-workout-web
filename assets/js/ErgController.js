/* ==========================================================
   ErgController.js (v10.0 "Total Inspection" - The Final Answer)
   - Drill-Down Scan: Iterates ALL services & ALL chars to find "Write" access
   - Heuristic Discovery: Finds Control Point even if UUID is slightly different
   - Universal Write: Auto-negotiates WriteWithResponse vs WithoutResponse
   - Includes "Silk Road Pro" Smoothing & Anti-Lock
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

    // ⚙️ Pro Tuning Parameters
    this._smoothFactor = 0.12; 
    this._controlLoopInterval = 250; 
    this._controlLoopId = null;
    this._lastCadenceTime = 0;

    this._commandQueue = [];
    this._isProcessingQueue = false;
    this._maxQueueSize = 20;

    // UUID Definitions (Normalized)
    this._uuids = {
      cycleopsSvc: '347b0001-7635-408b-8918-8ff3949ce592',
      cycleopsChar:'347b0012-7635-408b-8918-8ff3949ce592',
      wahooSvc:    'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
      wahooChar:   'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
      tacxSvc:     '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e',
      tacxChar:    '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e',
      ftmsSvc:     '00001826-0000-1000-8000-00805f9b34fb',
      ftmsChar:    '00002ad9-0000-1000-8000-00805f9b34fb',
      cpsSvc:      '00001818-0000-1000-8000-00805f9b34fb',
      cpsChar:     '00002a66-0000-1000-8000-00805f9b34fb' // Cycling Power Control Point
    };

    this._setupConnectionWatcher();
    console.log('[ErgController] v10.0 (Total Inspection) Initialized');
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

  // ── [2] Total Inspection Scan (The "Find Anything" Logic) ──

  async _deepScanForControlPoint(trainer) {
    try {
      const server = trainer.server || (trainer.device && trainer.device.gatt);
      if (!server || !server.connected) return null;

      console.log('[ERG] Starting Total Inspection (v10.0)...');

      // The prioritized list of services to "Break Into"
      const targetServices = [
          { uuid: this._uuids.cycleopsSvc, proto: 'CYCLEOPS' },
          { uuid: this._uuids.wahooSvc,    proto: 'WAHOO' },
          { uuid: this._uuids.tacxSvc,     proto: 'TACX' },
          { uuid: this._uuids.ftmsSvc,     proto: 'FTMS' },
          { uuid: this._uuids.cpsSvc,      proto: 'CPS_CONTROL' }
      ];

      for (const target of targetServices) {
          try {
              // 1. Force open the Service
              const service = await server.getPrimaryService(target.uuid);
              if (!service) continue;

              // 2. Get ALL Characteristics (Don't guess, get them all)
              const chars = await service.getCharacteristics();

              // 3. Scan characteristics
              for (const char of chars) {
                  const cUuid = char.uuid.toLowerCase();
                  const props = char.properties;

                  // A. Exact Match?
                  if (cUuid === this._uuids.cycleopsChar || cUuid.startsWith('347b0012')) return { point: char, protocol: 'CYCLEOPS' };
                  if (cUuid === this._uuids.wahooChar) return { point: char, protocol: 'WAHOO' };
                  if (cUuid === this._uuids.tacxChar) return { point: char, protocol: 'TACX' };
                  if (cUuid === this._uuids.ftmsChar) return { point: char, protocol: 'FTMS' };
                  if (cUuid === this._uuids.cpsChar)  return { point: char, protocol: 'CPS_CONTROL' };

                  // B. Heuristic Match? (If it's writable, it's likely the control point)
                  // This is the "Skeleton Key" for unknown UUID variations
                  if (props && (props.write || props.writeWithoutResponse)) {
                      console.log(`[ERG] Heuristic Match: Found writable char ${cUuid} in ${target.proto}`);
                      return { point: char, protocol: target.proto };
                  }
              }
          } catch(e) {
              // Service not found or access denied, try next
          }
      }

      console.warn('[ERG] Total Inspection found no Control Points.');
      return null;
    } catch (e) { 
        console.error('[ERG] Scan Critical Error:', e);
        return null; 
    }
  }

  // ── [3] "Water-Flow" Control Loop ──

  _startControlLoop() {
    if (this._controlLoopId) return;
    console.log('[ERG] Starting Silk Road Pro Loop');

    this._controlLoopId = setInterval(async () => {
        if (!this.state.enabled) return;

        const rawTarget = this.state.targetPower;
        let rpm = this.state.cadence;

        if (Date.now() - this._lastCadenceTime > 5000) rpm = 0;

        // Anti-Lock Logic
        let smartTarget = rawTarget;
        if (rpm < 45) {
            smartTarget = Math.min(60, rawTarget);
        } else if (rpm < 70) {
            const factor = 0.64 + ((rpm - 45) * 0.0144);
            smartTarget = rawTarget * Math.min(1.0, factor);
        }

        // Smoothing
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

  // ── [4] Command Sender (Universal Write) ──

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
        // Legacy (CycleOps/Wahoo/Tacx/CPS)
        buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x42);
        view.setUint16(1, safeWatts, true);
    }

    this._queueCommand(async () => {
         // Helper: Timeout Wrapper
         const tryWrite = async (method) => {
             const timeout = new Promise((_, r) => setTimeout(() => r(new Error("Timeout")), 350));
             let p;
             if (method === 'fast') {
                 if (typeof controlPoint.writeValueWithoutResponse !== 'function') throw new Error("No fast write");
                 p = controlPoint.writeValueWithoutResponse(buffer);
             } else {
                 p = controlPoint.writeValue(buffer);
             }
             return Promise.race([p, timeout]);
         };

         // ★ Universal Write Strategy
         try {
             await tryWrite('fast');
             return;
         } catch (e) {
             try { await tryWrite('reliable'); } catch(e2) {}
         }
    }, 'SET_POWER', { priority: 50 });
  }

  // ── [5] Public API ──

  async toggleErgMode(enable) {
    try {
        const trainer = window.connectedDevices?.trainer;
        if (!trainer) throw new Error("No trainer connected");

        // Force a Total Inspection Scan
        const result = await this._deepScanForControlPoint(trainer);
        if (result) {
            trainer.controlPoint = result.point;
            trainer.realProtocol = result.protocol;
            trainer.protocol = (result.protocol === 'CYCLEOPS' || result.protocol === 'WAHOO' || result.protocol === 'TACX') ? 'FTMS' : result.protocol;
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
               try { 
                   if(typeof controlPoint.writeValueWithoutResponse === 'function') await controlPoint.writeValueWithoutResponse(initBuf);
                   else await controlPoint.writeValue(initBuf);
               } catch(e) {
                   try { await controlPoint.writeValue(initBuf); } catch(e2){}
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

  // ── [Helpers] ──
  updateCadence(c) { if (c > 0) { this.state.cadence = c; this._lastCadenceTime = Date.now(); } }
  updatePower(p) { if (p != null && !isNaN(p)) this.state.currentPower = p; }
  updateHeartRate(h) {}
  updateConnectionStatus(s) { this.state.connectionStatus = s; if (s === 'disconnected') this._resetState(); }

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
  _notifySubscribers(k, v) { this._subscribers.forEach(cb => { try{ cb(this.state, k, v); }catch(_){} }); }
  async initializeTrainer() {}
  getState() { return {...this.state}; }
}

const ergController = new ErgController();
if (typeof window !== 'undefined') window.ergController = ergController;
if (typeof module !== 'undefined' && module.exports) module.exports = { ergController, ErgController };
