// bluetooth.js - 블루투스 디바이스 관리
class BluetoothManager {
    constructor() {
        this.heartRateDevice = null;
        this.powerMeterDevice = null;
        this.trainerDevice = null;
        
        this.heartRateCharacteristic = null;
        this.powerMeterCharacteristic = null;
        this.trainerCharacteristic = null;
        
        // Cycling Power Measurement 관련
        this.lastCrankRevolutions = null;
        this.lastCrankEventTime = null;
        this.lastRealTime = null;
        this.sampleCount = 0;
        this.shimanoFailureCount = 0;
        this.lastValidCadence = 0;
        
        // 연결 상태
        this.isHeartRateConnected = false;
        this.isPowerMeterConnected = false;
        this.isTrainerConnected = false;
    }

    // 심박계 연결
    async connectHeartRate() {
        try {
            console.log('심박계 연결 시도...');
            
            const device = await navigator.bluetooth.requestDevice({
                filters: [
                    { services: ['heart_rate'] }
                ],
                optionalServices: ['battery_service', 'device_information']
            });

            this.heartRateDevice = device;
            const server = await device.gatt.connect();
            const service = await server.getPrimaryService('heart_rate');
            this.heartRateCharacteristic = await service.getCharacteristic('heart_rate_measurement');

            // 연결 해제 이벤트 리스너
            device.addEventListener('gattserverdisconnected', () => {
                console.log('심박계 연결 해제됨');
                this.isHeartRateConnected = false;
                this.updateUI('heartRate', '연결 해제');
            });

            // 알림 시작
            await this.heartRateCharacteristic.startNotifications();
            this.heartRateCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
                this.handleHeartRateData(event.target.value);
            });

            this.isHeartRateConnected = true;
            this.updateUI('heartRate', '연결됨');
            console.log('심박계 연결 성공');

        } catch (error) {
            console.error('심박계 연결 오류:', error);
            this.updateUI('heartRate', '연결 실패');
            // 5초 후 재연결 시도
            setTimeout(() => this.connectHeartRate(), 5000);
        }
    }

    // 파워미터 연결
    async connectPowerMeter() {
        try {
            console.log('파워미터 연결 시도...');
            
            const device = await navigator.bluetooth.requestDevice({
                filters: [
                    { services: ['cycling_power'] }
                ],
                optionalServices: ['battery_service', 'device_information']
            });

            this.powerMeterDevice = device;
            const server = await device.gatt.connect();
            const service = await server.getPrimaryService('cycling_power');
            this.powerMeterCharacteristic = await service.getCharacteristic('cycling_power_measurement');

            // 연결 해제 이벤트 리스너
            device.addEventListener('gattserverdisconnected', () => {
                console.log('파워미터 연결 해제됨');
                this.isPowerMeterConnected = false;
                this.updateUI('power', '연결 해제');
                this.updateUI('cadence', '연결 해제');
            });

            // 알림 시작
            await this.powerMeterCharacteristic.startNotifications();
            this.powerMeterCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
                this.handlePowerMeterData(event.target.value);
            });

            this.isPowerMeterConnected = true;
            this.updateUI('power', '연결됨');
            this.updateUI('cadence', '연결됨');
            console.log('파워미터 연결 성공');

        } catch (error) {
            console.error('파워미터 연결 오류:', error);
            this.updateUI('power', '연결 실패');
            this.updateUI('cadence', '연결 실패');
        }
    }

    // 트레이너 연결
    async connectTrainer() {
        try {
            console.log('트레이너 연결 시도...');
            
            const device = await navigator.bluetooth.requestDevice({
                filters: [
                    { services: ['fitness_machine'] }
                ],
                optionalServices: ['battery_service', 'device_information']
            });

            this.trainerDevice = device;
            const server = await device.gatt.connect();
            const service = await server.getPrimaryService('fitness_machine');
            
            // Indoor Bike Data 특성 찾기
            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
                if (char.uuid === '00002ad2-0000-1000-8000-00805f9b34fb') { // Indoor Bike Data
                    this.trainerCharacteristic = char;
                    break;
                }
            }

            if (!this.trainerCharacteristic) {
                throw new Error('Indoor Bike Data 특성을 찾을 수 없습니다');
            }

            // 연결 해제 이벤트 리스너
            device.addEventListener('gattserverdisconnected', () => {
                console.log('트레이너 연결 해제됨');
                this.isTrainerConnected = false;
                this.updateUI('trainer', '연결 해제');
            });

            // 알림 시작
            await this.trainerCharacteristic.startNotifications();
            this.trainerCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
                this.handleTrainerData(event.target.value);
            });

            this.isTrainerConnected = true;
            this.updateUI('trainer', '연결됨');
            console.log('트레이너 연결 성공');

        } catch (error) {
            console.error('트레이너 연결 오류:', error);
            this.updateUI('trainer', '연결 실패');
        }
    }

    // 심박수 데이터 처리
    handleHeartRateData(value) {
        const flags = value.getUint8(0);
        let heartRate;
        
        if (flags & 0x01) {
            heartRate = value.getUint16(1, true);
        } else {
            heartRate = value.getUint8(1);
        }
        
        console.log('심박수:', heartRate, 'bpm');
        this.updateUI('heartRate', heartRate + ' bpm');
        
        // 전역 변수 업데이트
        if (typeof window.currentHeartRate !== 'undefined') {
            window.currentHeartRate = heartRate;
        }
    }

    // 파워미터 데이터 처리
    handlePowerMeterData(value) {
        const flags = value.getUint16(0, true);
        let instantaneousPower = value.getUint16(2, true);
        
        console.log('전력:', instantaneousPower, 'W');
        this.updateUI('power', instantaneousPower + ' W');
        
        // 전역 변수 업데이트
        if (typeof window.currentPower !== 'undefined') {
            window.currentPower = instantaneousPower;
        }

        // 크랭크 데이터가 있는지 확인
        if (flags & 0x20) { // Crank Revolution Data Present
            this.handleCrankData(value, flags);
        } else {
            // 크랭크 데이터가 없으면 케이던스를 0으로 설정
            this.updateUI('cadence', '0 RPM');
            if (typeof window.currentCadence !== 'undefined') {
                window.currentCadence = 0;
            }
        }
    }

    // 크랭크 데이터 처리
    handleCrankData(value, flags) {
        this.sampleCount++;
        console.log('Power meter flags: 0x' + flags.toString(16) + ', has crank data: true');
        
        // 크랭크 데이터 위치 계산
        let offset = 4; // flags(2) + instantaneous power(2)
        
        // 다른 필드들 건너뛰기
        if (flags & 0x01) offset += 1; // Pedal Power Balance Present
        if (flags & 0x04) offset += 2; // Accumulated Torque Present
        if (flags & 0x10) offset += 2; // Wheel Revolution Data Present
        
        const cumulativeCrankRevolutions = value.getUint16(offset, true);
        const lastCrankEventTime = value.getUint16(offset + 2, true);
        
        console.log('📊 Raw crank data - Revs:', cumulativeCrankRevolutions, 'Time:', lastCrankEventTime, 'Power:', value.getUint16(2, true) + 'W');

        const currentTime = Date.now();

        // 첫 번째 샘플이거나 20샘플마다 초기화
        if (this.lastCrankRevolutions === null || this.sampleCount % 20 === 1) {
            console.log('🔄 Initializing shimano crank data tracking (sample #' + this.sampleCount + ')');
            this.lastCrankRevolutions = cumulativeCrankRevolutions;
            this.lastCrankEventTime = lastCrankEventTime;
            this.lastRealTime = currentTime;
            return;
        }

        // 시간 차이 계산
        const realTimeDiff = currentTime - this.lastRealTime;
        const revDiff = this.calculateRevolutionDifference(cumulativeCrankRevolutions, this.lastCrankRevolutions);
        
        console.log('🔍 Sample #' + this.sampleCount + ' - RevDiff:', revDiff + ', RealTime:', realTimeDiff + 'ms');

        // 크랭크가 움직이지 않는 경우
        if (revDiff === 0) {
            console.log('⚠️ No crank revolution change');
            if (realTimeDiff > 5000) { // 5초 이상 움직임 없음
                console.log('🛑 Setting cadence to 0 (no movement for ' + realTimeDiff + 'ms)');
                const cadence = 0;
                console.log('📱 UI Updated - Cadence:', cadence, 'RPM');
                this.updateUI('cadence', cadence + ' RPM');
                if (typeof window.currentCadence !== 'undefined') {
                    window.currentCadence = cadence;
                }
            }
            return;
        }

        // 시간이 너무 짧으면 무시 (노이즈 방지)
        if (realTimeDiff < 2000) {
            console.log('❌ Shimano: Invalid timing - RevDiff:', revDiff + ', RealTimeDiff:', realTimeDiff + 'ms (need ≥2s)');
            return;
        }

        // 케이던스 계산
        const cadence = this.calculateCadence(revDiff, realTimeDiff);
        
        if (cadence > 0) {
            console.log('📱 UI Updated - Cadence:', cadence, 'RPM');
            this.updateUI('cadence', cadence + ' RPM');
            if (typeof window.currentCadence !== 'undefined') {
                window.currentCadence = cadence;
            }
        }

        // 다음 계산을 위해 저장
        this.lastCrankRevolutions = cumulativeCrankRevolutions;
        this.lastCrankEventTime = lastCrankEventTime;
        this.lastRealTime = currentTime;
    }

    // 회전 수 차이 계산 (16비트 오버플로우 처리)
    calculateRevolutionDifference(current, previous) {
        if (current >= previous) {
            return current - previous;
        } else {
            // 16비트 오버플로우 처리
            return (65536 - previous) + current;
        }
    }

    // 케이던스 계산 (개선된 버전)
    calculateCadence(revDiff, realTimeDiff) {
        try {
            // 기본 계산
            let calculatedCadence = (revDiff / realTimeDiff) * 60000; // RPM으로 변환
            
            // 일반적인 범위 체크 먼저
            if (calculatedCadence >= 20 && calculatedCadence <= 180) {
                console.log('✅ Standard cadence calculation valid:', calculatedCadence.toFixed(1), 'RPM');
                this.lastValidCadence = Math.round(calculatedCadence);
                this.shimanoFailureCount = 0;
                return this.lastValidCadence;
            }

            // 값이 너무 높으면 Shimano 특정 처리
            if (calculatedCadence > 180) {
                // Shimano 특정 처리 - 더 안전한 접근
                if (this.isShimanoPowerMeter()) {
                    // 매우 큰 revDiff는 counter overflow일 가능성이 높음
                    if (revDiff > 10000) {
                        console.log('⚠️ Shimano: Large revDiff detected (' + revDiff + '), likely counter overflow - ignoring');
                        return this.lastValidCadence || 0;
                    }
                    
                    console.log('🔧 Shimano adjustment - Original:', revDiff, 'Adjusted:', revDiff / 4);
                    let adjustedRevDiff = revDiff / 4;
                    let calculatedCadence = (adjustedRevDiff / realTimeDiff) * 60000;
                    console.log('⚙️ Shimano calculation -', adjustedRevDiff, 'revs in', (realTimeDiff/1000).toFixed(1) + 's =', calculatedCadence.toFixed(1), 'RPM');
                    
                    // 여전히 너무 높으면 더 나누기
                    if (calculatedCadence > 500) {
                        adjustedRevDiff = revDiff / 16;
                        calculatedCadence = (adjustedRevDiff / realTimeDiff) * 60000;
                        console.log('🔧 Shimano re-adjustment - /16 division:', calculatedCadence.toFixed(1), 'RPM');
                    }
                    
                    // 합리적인 범위 체크 (20-180 RPM)
                    if (calculatedCadence >= 20 && calculatedCadence <= 180) {
                        console.log('✅ Shimano cadence valid:', calculatedCadence.toFixed(1), 'RPM');
                        this.lastValidCadence = Math.round(calculatedCadence);
                        this.shimanoFailureCount = 0;
                        return this.lastValidCadence;
                    } else {
                        this.shimanoFailureCount++;
                        console.log('❌ Shimano cadence out of range:', calculatedCadence.toFixed(1), 'RPM (failures:', this.shimanoFailureCount + ')');
                        return this.lastValidCadence || 0;
                    }
                }
            }

            // 범위를 벗어나면 마지막 유효한 값 반환
            console.log('❌ Cadence out of normal range:', calculatedCadence.toFixed(1), 'RPM');
            return this.lastValidCadence || 0;

        } catch (error) {
            console.error('케이던스 계산 오류:', error);
            return this.lastValidCadence || 0;
        }
    }

    // Shimano 파워미터인지 확인
    isShimanoPowerMeter() {
        if (!this.powerMeterDevice || !this.powerMeterDevice.name) {
            return false;
        }
        const deviceName = this.powerMeterDevice.name.toLowerCase();
        return deviceName.includes('shimano') || 
               deviceName.includes('ultegra') || 
               deviceName.includes('dura-ace') ||
               deviceName.includes('105');
    }

    // 트레이너 데이터 처리
    handleTrainerData(value) {
        // Indoor Bike Data 파싱
        const flags = value.getUint16(0, true);
        let offset = 2;
        
        let speed = null;
        let cadence = null;
        let power = null;
        
        // Instantaneous Speed Present
        if (flags & 0x01) {
            speed = value.getUint16(offset, true) / 100; // km/h
            offset += 2;
        }
        
        // Average Speed Present
        if (flags & 0x02) {
            offset += 2; // Skip average speed
        }
        
        // Instantaneous Cadence Present
        if (flags & 0x04) {
            cadence = value.getUint16(offset, true) / 2; // RPM
            offset += 2;
        }
        
        // Average Cadence Present
        if (flags & 0x08) {
            offset += 2; // Skip average cadence
        }
        
        // Total Distance Present
        if (flags & 0x10) {
            offset += 3; // Skip total distance
        }
        
        // Resistance Level Present
        if (flags & 0x20) {
            offset += 2; // Skip resistance level
        }
        
        // Instantaneous Power Present
        if (flags & 0x40) {
            power = value.getUint16(offset, true); // watts
            offset += 2;
        }
        
        console.log('트레이너 데이터 - 속도:', speed, 'km/h, 케이던스:', cadence, 'RPM, 파워:', power, 'W');
        
        if (speed !== null) {
            this.updateUI('speed', speed.toFixed(1) + ' km/h');
        }
        
        if (cadence !== null) {
            this.updateUI('cadence', Math.round(cadence) + ' RPM');
            if (typeof window.currentCadence !== 'undefined') {
                window.currentCadence = Math.round(cadence);
            }
        }
        
        if (power !== null) {
            this.updateUI('power', power + ' W');
            if (typeof window.currentPower !== 'undefined') {
                window.currentPower = power;
            }
        }
    }

    // UI 업데이트
    updateUI(metric, value) {
        const element = document.getElementById(metric + 'Value');
        if (element) {
            element.textContent = value;
        }
    }

    // 모든 연결 해제
    async disconnectAll() {
        try {
            if (this.heartRateDevice && this.heartRateDevice.gatt.connected) {
                await this.heartRateDevice.gatt.disconnect();
            }
            
            if (this.powerMeterDevice && this.powerMeterDevice.gatt.connected) {
                await this.powerMeterDevice.gatt.disconnect();
            }
            
            if (this.trainerDevice && this.trainerDevice.gatt.connected) {
                await this.trainerDevice.gatt.disconnect();
            }
            
            console.log('모든 디바이스 연결 해제됨');
        } catch (error) {
            console.error('연결 해제 오류:', error);
        }
    }

    // 연결 상태 확인
    getConnectionStatus() {
        return {
            heartRate: this.isHeartRateConnected,
            powerMeter: this.isPowerMeterConnected,
            trainer: this.isTrainerConnected
        };
    }
}

// 전역 BluetoothManager 인스턴스 생성
window.bluetoothManager = new BluetoothManager();

console.log('Bluetooth Manager 로드 완료');
