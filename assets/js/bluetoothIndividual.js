// bluetoothIndividual.js

// ========== 전역 변수 안전 초기화 (파일 최상단) ==========
// window.connectedDevices 안전 초기화 (bluetooth.js와 동일한 구조)
if (!window.connectedDevices) {
    window.connectedDevices = {
        trainer: null,
        powerMeter: null,
        heartRate: null
    };
}

// window.liveData 안전 초기화
if (!window.liveData) {
    window.liveData = {
        power: 0,
        heartRate: 0,
        cadence: 0,
        targetPower: 0
    };
}

// 1. URL 파라미터에서 트랙 번호 확인 (?track=1 또는 ?bike=1)
const params = new URLSearchParams(window.location.search);
let myTrackId = params.get('track') || params.get('bike'); // bike 파라미터도 지원 (하위 호환성)

// 번호가 없으면 강제로 물어봄
while (!myTrackId) {
    myTrackId = prompt("트랙 번호를 입력하세요 (예: 1, 5, 12)", "1");
    if(myTrackId) {
        // 입력받은 번호로 URL 새로고침 (track 파라미터로 통일)
        const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?track=' + myTrackId + (params.get('room') ? '&room=' + params.get('room') : '');
        window.history.pushState({path:newUrl},'',newUrl);
    }
}

// 초기 표시 (나중에 사용자 이름으로 업데이트됨)
const bikeIdDisplayEl = document.getElementById('bike-id-display');
if (bikeIdDisplayEl) {
    bikeIdDisplayEl.innerText = `Track ${myTrackId}`;
    
    // 초기 로드 시에도 클릭 이벤트 추가 (updateUserName이 호출되지 않을 경우 대비)
    if (!bikeIdDisplayEl.hasAttribute('data-click-listener-added')) {
        bikeIdDisplayEl.setAttribute('data-click-listener-added', 'true');
        bikeIdDisplayEl.style.cursor = 'pointer';
        bikeIdDisplayEl.title = '클릭하여 Live Training Rooms로 이동';
        
        bikeIdDisplayEl.addEventListener('click', () => {
            // Live Training Rooms 화면으로 이동
            window.location.href = 'index.html#trainingRoomScreen';
        });
    }
}

// 사용자 FTP 값 저장 (전역 변수)
let userFTP = 200; // 기본값 200W
window.userFTP = userFTP; // workoutManager.js에서 접근 가능하도록 전역 노출

// Firebase에서 받은 목표 파워 값 저장 (전역 변수)
let firebaseTargetPower = null;

// 개인 훈련 대시보드 강도 조절 변수
let individualIntensityAdjustment = 1.0; // 기본값: 1.0 (100%)

// 가민 스타일 부드러운 바늘 움직임을 위한 변수
let currentPowerValue = 0; // window.liveData에서 받은 실제 파워값
let displayPower = 0; // 화면에 표시되는 부드러운 파워값 (보간 적용)
let gaugeAnimationFrameId = null; // 애니메이션 루프 ID

// 파워 히스토리 저장 (avgPower, maxPower, segmentPower 계산용)
let powerHistory = []; // 전체 파워 히스토리
let segmentPowerHistory = []; // 현재 세그먼트 파워 히스토리
let currentSegmentStartTime = null; // 현재 세그먼트 시작 시간
let maxPowerRecorded = 0; // 기록된 최대 파워

// 사용자 정보 저장 (Firebase 업데이트용)
let currentUserInfo = {
    userId: null,
    userName: null,
    ftp: 200,
    weight: null
};

// 2. window.liveData에서 데이터 읽기 및 Firebase로 전송
// SESSION_ID는 firebaseConfig.js에 정의됨
// window.liveData는 bluetooth.js에서 업데이트됨 (power, heartRate, cadence)
let firebaseDataUpdateInterval = null; // Firebase 전송 인터벌

// Firebase에 데이터를 전송하는 함수
function sendDataToFirebase() {
    if (!window.liveData || !SESSION_ID || !myTrackId) {
        return;
    }
    
    // window.liveData에서 데이터 읽기
    const power = Number(window.liveData.power || 0);
    const heartRate = Number(window.liveData.heartRate || 0);
    const cadence = Number(window.liveData.cadence || 0);
    const targetPower = Number(window.liveData.targetPower || firebaseTargetPower || 0);
    
    const now = Date.now();
    
    // 파워 히스토리 업데이트 (유효한 파워값만)
    if (power > 0) {
        powerHistory.push({ power, timestamp: now });
        // 히스토리 크기 제한 (메모리 관리: 최근 1시간 분량만 유지)
        const oneHourAgo = now - (60 * 60 * 1000);
        powerHistory = powerHistory.filter(entry => entry.timestamp > oneHourAgo);
        
        // 최대 파워 업데이트
        if (power > maxPowerRecorded) {
            maxPowerRecorded = power;
        }
        
        // 세그먼트 파워 히스토리 업데이트
        segmentPowerHistory.push({ power, timestamp: now });
        // 세그먼트 히스토리도 최근 1시간 분량만 유지
        const segmentOneHourAgo = now - (60 * 60 * 1000);
        segmentPowerHistory = segmentPowerHistory.filter(entry => entry.timestamp > segmentOneHourAgo);
    }
    
    // 평균 파워 계산 (전체)
    let avgPower = 0;
    if (powerHistory.length > 0) {
        const totalPower = powerHistory.reduce((sum, entry) => sum + entry.power, 0);
        avgPower = Math.round(totalPower / powerHistory.length);
    }
    
    // 세그먼트 평균 파워 계산
    let segmentPower = 0;
    if (segmentPowerHistory.length > 0) {
        const totalSegmentPower = segmentPowerHistory.reduce((sum, entry) => sum + entry.power, 0);
        segmentPower = Math.round(totalSegmentPower / segmentPowerHistory.length);
    }
    
    // Firebase에 전송할 데이터 객체
    const dataToSend = {
        power: power > 0 ? power : 0,
        hr: heartRate > 0 ? heartRate : 0,
        heartRate: heartRate > 0 ? heartRate : 0,
        cadence: cadence > 0 ? cadence : 0,
        rpm: cadence > 0 ? cadence : 0,
        avgPower: avgPower,
        maxPower: maxPowerRecorded,
        segmentPower: segmentPower,
        targetPower: targetPower,
        lastUpdate: now,
        timestamp: now
    };
    
    // 사용자 정보 추가 (있는 경우)
    if (currentUserInfo.userId) {
        dataToSend.userId = currentUserInfo.userId;
    }
    if (currentUserInfo.userName) {
        dataToSend.userName = currentUserInfo.userName;
    }
    if (currentUserInfo.ftp) {
        dataToSend.ftp = currentUserInfo.ftp;
    }
    if (currentUserInfo.weight !== null && currentUserInfo.weight !== undefined) {
        dataToSend.weight = currentUserInfo.weight;
    }
    
    // Firebase에 업데이트 (merge: true로 기존 데이터 보존)
    db.ref(`sessions/${SESSION_ID}/users/${myTrackId}`).update(dataToSend)
        .then(() => {
            // Firebase 전송 성공 로그 (UI 업데이트는 startFirebaseDataTransmission의 setInterval에서 처리)
            // UI 업데이트는 주기적으로 window.liveData를 읽어서 처리하므로 여기서는 전송만 함
        })
        .catch((error) => {
            console.error('[BluetoothIndividual] Firebase 전송 실패:', error);
        });
}

// 주기적으로 Firebase에 데이터 전송 및 UI 업데이트 (1초마다)
function startFirebaseDataTransmission() {
    // 기존 인터벌이 있으면 제거
    if (firebaseDataUpdateInterval) {
        clearInterval(firebaseDataUpdateInterval);
    }
    
    // 1초마다 데이터 전송 및 UI 업데이트
    firebaseDataUpdateInterval = setInterval(() => {
        // 1. window.liveData에서 데이터를 읽어서 UI 업데이트 (Bluetooth 디바이스 값 표시)
        // window.liveData 초기화 확인
        if (!window.liveData) {
            window.liveData = { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
        }
        
        // 로컬 시간 추적 업데이트 (훈련 중일 때) - Bluetooth 개인훈련 대시보드 전용
        if (window.currentTrainingState === 'running' && bluetoothIndividualTrainingStartTime) {
            const now = Date.now();
            bluetoothIndividualTotalElapsedTime = Math.floor((now - bluetoothIndividualTrainingStartTime) / 1000);
            
            // 세그먼트 경과 시간 업데이트
            if (bluetoothIndividualSegmentStartTime && currentSegmentIndex >= 0) {
                bluetoothIndividualSegmentElapsedTime = Math.floor((now - bluetoothIndividualSegmentStartTime) / 1000);
            }
        }
        
        updateDashboard(); // data 파라미터 없이 호출하면 window.liveData를 읽음
        
        // 랩카운트다운 업데이트 (로컬 시간 추적 사용) - Bluetooth 개인훈련 대시보드 전용
        updateLapTime(firebaseStatus);
        
        // 2. Firebase에 데이터 전송
        sendDataToFirebase();
    }, 1000);
    
    console.log('[BluetoothIndividual] Firebase 데이터 전송 및 UI 업데이트 시작 (1초마다)');
}

// Firebase 데이터 전송 중지
function stopFirebaseDataTransmission() {
    if (firebaseDataUpdateInterval) {
        clearInterval(firebaseDataUpdateInterval);
        firebaseDataUpdateInterval = null;
        console.log('[BluetoothIndividual] Firebase 데이터 전송 중지');
    }
}

// Firebase에 디바이스 정보 업데이트
function updateFirebaseDevices() {
    if (!SESSION_ID || !myTrackId || !db) {
        console.warn('[BluetoothIndividual] Firebase 업데이트 실패: SESSION_ID 또는 myTrackId가 없습니다.');
        return;
    }
    
    // 연결된 디바이스 ID 가져오기
    const heartRateId = window.connectedDevices?.heartRate?.device?.id || null;
    const powerMeterId = window.connectedDevices?.powerMeter?.device?.id || null;
    const smartTrainerId = window.connectedDevices?.trainer?.device?.id || null;
    
    // Firebase에 업데이트할 데이터 객체 (연결되지 않은 디바이스는 null로 설정)
    const devicesData = {
        heartRateId: heartRateId || null,
        powerMeterId: powerMeterId || null,
        smartTrainerId: smartTrainerId || null
    };
    
    // devices 경로에 업데이트 (sessions/{SESSION_ID}/devices/{myTrackId})
    const devicesRef = db.ref(`sessions/${SESSION_ID}/devices/${myTrackId}`);
    devicesRef.update(devicesData)
        .then(() => {
            console.log('[BluetoothIndividual] ✅ Firebase 디바이스 정보 업데이트 성공:', {
                path: `sessions/${SESSION_ID}/devices/${myTrackId}`,
                heartRateId,
                powerMeterId,
                smartTrainerId
            });
        })
        .catch((error) => {
            console.error('[BluetoothIndividual] ❌ Firebase 디바이스 정보 업데이트 실패:', error);
        });
    
    // 하위 호환성을 위해 users 경로에도 업데이트 (기존 코드와의 호환성)
    const usersDevicesRef = db.ref(`sessions/${SESSION_ID}/users/${myTrackId}/devices`);
    usersDevicesRef.update(devicesData)
        .then(() => {
            console.log('[BluetoothIndividual] ✅ Firebase users/devices 경로 업데이트 성공 (하위 호환성)');
        })
        .catch((error) => {
            console.warn('[BluetoothIndividual] ⚠️ Firebase users/devices 경로 업데이트 실패:', error);
        });
}

// 페이지 로드 시 Firebase 데이터 전송 시작 및 초기 UI 업데이트
// window.liveData 초기화 (bluetooth.js가 로드되기 전일 수 있으므로)
if (!window.liveData) {
    window.liveData = { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
    console.log('[BluetoothIndividual] window.liveData 초기화 (페이지 로드 시)');
}

function initializeBluetoothDashboard() {
    // 부모 창(window.opener)에서 Bluetooth 연결 상태 복사
    // bluetoothIndividual.html이 새 창으로 열렸을 때 부모 창의 연결 상태를 가져옴
    if (window.opener && !window.opener.closed) {
        try {
            // 부모 창의 자식 창 배열에 자신을 등록 (postMessage를 받기 위해)
            if (!window.opener._bluetoothChildWindows) {
                window.opener._bluetoothChildWindows = [];
            }
            // 이미 등록되어 있지 않은 경우만 추가
            if (!window.opener._bluetoothChildWindows.includes(window)) {
                window.opener._bluetoothChildWindows.push(window);
                console.log('[BluetoothIndividual] ✅ 부모 창의 자식 창 배열에 등록 완료 (postMessage 받을 준비됨)');
            }
            
            // 부모 창의 window.connectedDevices 복사 시도
            const parentConnectedDevices = window.opener.connectedDevices;
            const parentLiveData = window.opener.liveData;
            
            if (parentConnectedDevices) {
                // 부모 창의 연결 상태 복사 (참조가 아닌 구조 복사)
                window.connectedDevices = {
                    trainer: parentConnectedDevices.trainer ? {
                        name: parentConnectedDevices.trainer.name,
                        device: parentConnectedDevices.trainer.device, // 참조 복사
                        server: parentConnectedDevices.trainer.server,
                        characteristic: parentConnectedDevices.trainer.characteristic
                    } : null,
                    powerMeter: parentConnectedDevices.powerMeter ? {
                        name: parentConnectedDevices.powerMeter.name,
                        device: parentConnectedDevices.powerMeter.device,
                        server: parentConnectedDevices.powerMeter.server,
                        characteristic: parentConnectedDevices.powerMeter.characteristic
                    } : null,
                    heartRate: parentConnectedDevices.heartRate ? {
                        name: parentConnectedDevices.heartRate.name,
                        device: parentConnectedDevices.heartRate.device,
                        server: parentConnectedDevices.heartRate.server,
                        characteristic: parentConnectedDevices.heartRate.characteristic
                    } : null
                };
                console.log('[BluetoothIndividual] ✅ 부모 창에서 연결 상태 복사 완료:', {
                    heartRate: window.connectedDevices.heartRate?.name || null,
                    powerMeter: window.connectedDevices.powerMeter?.name || null,
                    trainer: window.connectedDevices.trainer?.name || null
                });
            }
            
            // 부모 창의 window.liveData 값 복사 (초기값)
            if (parentLiveData) {
                if (!window.liveData) {
                    window.liveData = { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
                }
                // 현재 값 복사 (부모 창과 동기화되지 않으므로 초기값만)
                if (parentLiveData.heartRate) {
                    window.liveData.heartRate = parentLiveData.heartRate;
                }
                if (parentLiveData.power) {
                    window.liveData.power = parentLiveData.power;
                }
                if (parentLiveData.cadence) {
                    window.liveData.cadence = parentLiveData.cadence;
                }
                console.log('[BluetoothIndividual] ✅ 부모 창에서 liveData 초기값 복사 완료:', {
                    heartRate: window.liveData.heartRate,
                    power: window.liveData.power,
                    cadence: window.liveData.cadence
                });
                
                // 부모 창의 liveData를 주기적으로 동기화 (polling)
                // postMessage를 통한 실시간 동기화도 함께 사용
                const syncInterval = setInterval(() => {
                    try {
                        if (!window.opener.closed && window.opener.liveData) {
                            const parentHR = window.opener.liveData.heartRate;
                            const parentPower = window.opener.liveData.power;
                            const parentCadence = window.opener.liveData.cadence;
                            
                            // 값이 변경되었으면 복사 및 UI 업데이트
                            let updated = false;
                            if (parentHR !== undefined && parentHR !== null && window.liveData.heartRate !== parentHR) {
                                window.liveData.heartRate = parentHR;
                                updated = true;
                            }
                            if (parentPower !== undefined && parentPower !== null && window.liveData.power !== parentPower) {
                                window.liveData.power = parentPower;
                                updated = true;
                            }
                            if (parentCadence !== undefined && parentCadence !== null && window.liveData.cadence !== parentCadence) {
                                window.liveData.cadence = parentCadence;
                                updated = true;
                            }
                            
                            // 값이 업데이트되었으면 대시보드 업데이트
                            if (updated) {
                                updateDashboard();
                            }
                        } else {
                            // 부모 창이 닫혔으면 인터벌 정리
                            clearInterval(syncInterval);
                        }
                    } catch (e) {
                        // 부모 창 접근 실패 (CORS 또는 닫힘) - 조용히 무시
                        clearInterval(syncInterval);
                    }
                }, 100); // 100ms마다 부모 창의 liveData 동기화
                console.log('[BluetoothIndividual] ✅ 부모 창 liveData 동기화 시작 (100ms마다 polling)');
                
                // postMessage를 통한 실시간 동기화 리스너 등록
                window.addEventListener('message', (event) => {
                    // 보안: 같은 origin에서 온 메시지만 처리
                    if (event.origin !== window.location.origin) {
                        return;
                    }
                    
                    // 부모 창에서 liveData 업데이트 알림
                    if (event.data && event.data.type === 'bluetoothLiveDataUpdate') {
                        const { heartRate, power, cadence } = event.data;
                        
                        if (!window.liveData) {
                            window.liveData = { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
                        }
                        
                        let updated = false;
                        if (heartRate !== undefined && heartRate !== null && window.liveData.heartRate !== heartRate) {
                            window.liveData.heartRate = heartRate;
                            updated = true;
                        }
                        if (power !== undefined && power !== null && window.liveData.power !== power) {
                            window.liveData.power = power;
                            updated = true;
                        }
                        if (cadence !== undefined && cadence !== null && window.liveData.cadence !== cadence) {
                            window.liveData.cadence = cadence;
                            updated = true;
                        }
                        
                        // 값이 업데이트되었으면 대시보드 업데이트
                        if (updated) {
                            updateDashboard();
                            console.log('[BluetoothIndividual] ✅ postMessage로 부모 창 liveData 동기화:', { heartRate, power, cadence });
                        }
                    }
                });
                console.log('[BluetoothIndividual] ✅ postMessage 리스너 등록 완료 (부모 창에서 liveData 업데이트 알림 받음)');
            }
        } catch (e) {
            console.warn('[BluetoothIndividual] 부모 창에서 연결 상태 복사 실패 (CORS 또는 다른 이유):', e.message);
            // window.connectedDevices 초기화 (bluetooth.js가 로드되기 전일 수 있음)
            if (!window.connectedDevices) {
                window.connectedDevices = {
                    trainer: null,
                    powerMeter: null,
                    heartRate: null
                };
                console.log('[BluetoothIndividual] window.connectedDevices 초기화 (부모 창 접근 실패)');
            }
        }
    } else {
        // 부모 창이 없거나 닫힌 경우 (직접 접속)
        // window.connectedDevices 초기화 (bluetooth.js가 로드되기 전일 수 있음)
        if (!window.connectedDevices) {
            window.connectedDevices = {
                trainer: null,
                powerMeter: null,
                heartRate: null
            };
            console.log('[BluetoothIndividual] window.connectedDevices 초기화 (부모 창 없음)');
        }
    }
    
    // window.liveData 모니터링을 위한 Proxy 설정 (디버깅용)
    // bluetooth.js의 handleHeartRateData가 호출될 때 값이 업데이트되는지 확인
    if (window.liveData && !window.liveData._isProxied) {
        const originalLiveData = window.liveData;
        
        // Proxy를 사용하여 값 변경 감지
        window.liveData = new Proxy(originalLiveData, {
            set(target, property, value) {
                const oldValue = target[property];
                target[property] = value;
                // 값이 변경되면 로그 출력 (heartRate, power, cadence만)
                if (['heartRate', 'power', 'cadence'].includes(property) && oldValue !== value) {
                    console.log(`[BluetoothIndividual] ✅ window.liveData.${property} 업데이트:`, oldValue, '→', value, '(handleHeartRateData 호출 확인됨)');
                    // 값이 업데이트되면 즉시 UI 업데이트
                    if (value > 0 || (property === 'power' && value >= 0)) {
                        updateDashboard();
                    }
                }
                return true;
            },
            get(target, property) {
                return target[property];
            }
        });
        window.liveData._isProxied = true;
        console.log('[BluetoothIndividual] window.liveData Proxy 설정 완료 (변경 감지 활성화)');
        
        // handleHeartRateData 함수 확인 및 래핑 (심박계)
        if (typeof window.handleHeartRateData === 'function') {
            const originalHandleHeartRateData = window.handleHeartRateData;
            window.handleHeartRateData = function(event) {
                console.log('[BluetoothIndividual] ✅ handleHeartRateData 호출됨 (bluetooth.js에서)');
                const result = originalHandleHeartRateData.call(this, event);
                // handleHeartRateData가 호출된 후 window.liveData를 확인
                setTimeout(() => {
                    if (window.liveData?.heartRate) {
                        console.log('[BluetoothIndividual] handleHeartRateData 후 heartRate 확인:', window.liveData.heartRate, 'bpm');
                        updateDashboard();
                    }
                }, 100);
                return result;
            };
            console.log('[BluetoothIndividual] handleHeartRateData 래핑 완료 (호출 감지 활성화)');
        }
        
        // handlePowerMeterData 함수 확인 및 래핑 (파워미터 - power, cadence 업데이트)
        if (typeof window.handlePowerMeterData === 'function') {
            const originalHandlePowerMeterData = window.handlePowerMeterData;
            window.handlePowerMeterData = function(event) {
                console.log('[BluetoothIndividual] ✅ handlePowerMeterData 호출됨 (bluetooth.js에서)');
                const result = originalHandlePowerMeterData.call(this, event);
                // handlePowerMeterData가 호출된 후 window.liveData를 확인
                setTimeout(() => {
                    if (window.liveData?.power || window.liveData?.cadence) {
                        console.log('[BluetoothIndividual] handlePowerMeterData 후 데이터 확인:', {
                            power: window.liveData.power,
                            cadence: window.liveData.cadence
                        });
                        updateDashboard();
                    }
                }, 100);
                return result;
            };
            console.log('[BluetoothIndividual] handlePowerMeterData 래핑 완료 (호출 감지 활성화)');
        } else if (typeof handlePowerMeterData === 'function') {
            // window에 노출되지 않은 경우 (블록 스코프) 전역으로 노출
            const originalHandlePowerMeterData = handlePowerMeterData;
            window.handlePowerMeterData = function(event) {
                console.log('[BluetoothIndividual] ✅ handlePowerMeterData 호출됨 (bluetooth.js에서)');
                const result = originalHandlePowerMeterData.call(this, event);
                setTimeout(() => {
                    if (window.liveData?.power || window.liveData?.cadence) {
                        console.log('[BluetoothIndividual] handlePowerMeterData 후 데이터 확인:', {
                            power: window.liveData.power,
                            cadence: window.liveData.cadence
                        });
                        updateDashboard();
                    }
                }, 100);
                return result;
            };
            console.log('[BluetoothIndividual] handlePowerMeterData 래핑 완료 (전역 노출 및 호출 감지 활성화)');
        }
        
        // handleTrainerData 함수 확인 및 래핑 (스마트 트레이너 - power, cadence 업데이트)
        if (typeof window.handleTrainerData === 'function') {
            const originalHandleTrainerData = window.handleTrainerData;
            window.handleTrainerData = function(event) {
                console.log('[BluetoothIndividual] ✅ handleTrainerData 호출됨 (bluetooth.js에서)');
                const result = originalHandleTrainerData.call(this, event);
                // handleTrainerData가 호출된 후 window.liveData를 확인
                setTimeout(() => {
                    if (window.liveData?.power || window.liveData?.cadence) {
                        console.log('[BluetoothIndividual] handleTrainerData 후 데이터 확인:', {
                            power: window.liveData.power,
                            cadence: window.liveData.cadence
                        });
                        updateDashboard();
                    }
                }, 100);
                return result;
            };
            console.log('[BluetoothIndividual] handleTrainerData 래핑 완료 (호출 감지 활성화)');
        } else if (typeof handleTrainerData === 'function') {
            // window에 노출되지 않은 경우 (블록 스코프) 전역으로 노출
            const originalHandleTrainerData = handleTrainerData;
            window.handleTrainerData = function(event) {
                console.log('[BluetoothIndividual] ✅ handleTrainerData 호출됨 (bluetooth.js에서)');
                const result = originalHandleTrainerData.call(this, event);
                setTimeout(() => {
                    if (window.liveData?.power || window.liveData?.cadence) {
                        console.log('[BluetoothIndividual] handleTrainerData 후 데이터 확인:', {
                            power: window.liveData.power,
                            cadence: window.liveData.cadence
                        });
                        updateDashboard();
                    }
                }, 100);
                return result;
            };
            console.log('[BluetoothIndividual] handleTrainerData 래핑 완료 (전역 노출 및 호출 감지 활성화)');
        }
    }
    
    // Firebase 데이터 전송 시작
    startFirebaseDataTransmission();
    
    // 초기 UI 업데이트 (window.liveData 값 표시)
    setTimeout(() => {
        const connectedDevicesInfo = {
            heartRate: window.connectedDevices?.heartRate ? (window.connectedDevices.heartRate.name || 'connected') : null,
            powerMeter: window.connectedDevices?.powerMeter ? (window.connectedDevices.powerMeter.name || 'connected') : null,
            trainer: window.connectedDevices?.trainer ? (window.connectedDevices.trainer.name || 'connected') : null
        };
        console.log('[BluetoothIndividual] 초기 UI 업데이트:', {
            liveData: window.liveData,
            heartRate: window.liveData?.heartRate,
            power: window.liveData?.power,
            cadence: window.liveData?.cadence,
            connectedDevices: connectedDevicesInfo,
            hasBluetoothJS: typeof window.connectHeartRate === 'function',
            handleHeartRateDataExists: typeof window.handleHeartRateData === 'function',
            connectedDevicesObject: window.connectedDevices
        });
        
        // 연결된 디바이스 확인 (bluetooth.js가 로드되었는지 확인)
        const hasBluetoothJS = typeof window.connectHeartRate === 'function' || typeof window.connectTrainer === 'function' || typeof window.connectPowerMeter === 'function';
        
        // bluetooth.js가 로드되지 않았으면 대기
        if (!hasBluetoothJS) {
            console.log('[BluetoothIndividual] bluetooth.js가 아직 로드되지 않았습니다. 잠시 후 다시 확인합니다.');
            // 1초 후 다시 확인
            setTimeout(() => {
                const retryConnectedDevices = window.connectedDevices || { trainer: null, powerMeter: null, heartRate: null };
                if (!retryConnectedDevices.heartRate && !retryConnectedDevices.powerMeter && !retryConnectedDevices.trainer) {
                    console.info('[BluetoothIndividual] ℹ️ 연결된 Bluetooth 디바이스가 없습니다. bluetoothIndividual.html은 별도 페이지이므로, 이 페이지에서 직접 디바이스를 연결해야 합니다.');
                    console.info('[BluetoothIndividual] ℹ️ 또는 index.html에서 연결한 후 새 창으로 bluetoothIndividual.html을 열면 연결 상태가 공유되지 않을 수 있습니다.');
                }
            }, 1000);
        } else {
            // bluetooth.js가 로드되었고, 연결된 디바이스가 없으면 안내 (경고 대신 정보)
            if (!window.connectedDevices?.heartRate && !window.connectedDevices?.powerMeter && !window.connectedDevices?.trainer) {
                console.info('[BluetoothIndividual] ℹ️ 연결된 Bluetooth 디바이스가 없습니다. 이 페이지에서 직접 디바이스를 연결해주세요.');
            }
        }
        
        updateDashboard(); // 초기 표시를 위해 한 번 호출
        // 블루투스 연결 상태 업데이트
        if (typeof updateBluetoothConnectionStatus === 'function') {
            updateBluetoothConnectionStatus();
        }
    }, 500); // bluetooth.js가 로드되고 초기화될 시간을 줌
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initializeBluetoothDashboard();
    });
} else {
    initializeBluetoothDashboard();
}

// 페이지 언로드 시 Firebase 데이터 전송 중지
window.addEventListener('beforeunload', () => {
    stopFirebaseDataTransmission();
});

// 사용자 이름 및 기타 메타데이터는 Firebase에서 한 번만 읽기
let userDataLoaded = false;
db.ref(`sessions/${SESSION_ID}/users/${myTrackId}`).once('value', (snapshot) => {
    const data = snapshot.val();
    
    if (data && !userDataLoaded) {
        userDataLoaded = true;
        
        // 사용자 FTP 값 업데이트
        let foundFTP = null;
        
        if (data.ftp !== undefined && data.ftp !== null && data.ftp !== '') {
            foundFTP = Number(data.ftp);
        } else if (data.FTP !== undefined && data.FTP !== null && data.FTP !== '') {
            foundFTP = Number(data.FTP);
        } else if (data.userFTP !== undefined && data.userFTP !== null && data.userFTP !== '') {
            foundFTP = Number(data.userFTP);
        } else if (data.userFtp !== undefined && data.userFtp !== null && data.userFtp !== '') {
            foundFTP = Number(data.userFtp);
        } else if (data.participant && data.participant.ftp !== undefined && data.participant.ftp !== null) {
            foundFTP = Number(data.participant.ftp);
        } else if (data.participant && data.participant.FTP !== undefined && data.participant.FTP !== null) {
            foundFTP = Number(data.participant.FTP);
        } else if (data.user && data.user.ftp !== undefined && data.user.ftp !== null) {
            foundFTP = Number(data.user.ftp);
        } else if (data.user && data.user.FTP !== undefined && data.user.FTP !== null) {
            foundFTP = Number(data.user.FTP);
        }
        
        if (foundFTP !== null && !isNaN(foundFTP) && foundFTP > 0) {
            userFTP = foundFTP;
            window.userFTP = userFTP;
            if (typeof updateGaugeTicksAndLabels === 'function') {
                updateGaugeTicksAndLabels();
            }
        }
        
        // targetPower 값 확인
        if (data.targetPower !== undefined && data.targetPower !== null && data.targetPower !== '') {
            const targetPowerValue = Number(data.targetPower);
            if (!isNaN(targetPowerValue) && targetPowerValue >= 0) {
                firebaseTargetPower = targetPowerValue;
            }
        } else if (data.target_power !== undefined && data.target_power !== null && data.target_power !== '') {
            const targetPowerValue = Number(data.target_power);
            if (!isNaN(targetPowerValue) && targetPowerValue >= 0) {
                firebaseTargetPower = targetPowerValue;
            }
        } else if (data.segmentTargetPowerW !== undefined && data.segmentTargetPowerW !== null && data.segmentTargetPowerW !== '') {
            const targetPowerValue = Number(data.segmentTargetPowerW);
            if (!isNaN(targetPowerValue) && targetPowerValue >= 0) {
                firebaseTargetPower = targetPowerValue;
            }
        }
        
        // 사용자 ID 저장
        if (data.userId) {
            currentUserIdForSession = String(data.userId);
            currentUserInfo.userId = String(data.userId);
        }
        
        // 사용자 이름 저장
        if (data.userName) {
            currentUserInfo.userName = String(data.userName);
        }
        
        // 사용자 FTP 저장
        if (foundFTP !== null && !isNaN(foundFTP) && foundFTP > 0) {
            currentUserInfo.ftp = foundFTP;
        }
        
        // 사용자 체중 저장
        if (data.weight !== undefined && data.weight !== null && data.weight !== '') {
            currentUserInfo.weight = Number(data.weight);
        }
        
        // 사용자 이름 업데이트
        updateUserName(data);
        
        // TARGET 파워 업데이트
        updateTargetPower();
    }
});

// 사용자 이름 업데이트 함수
function updateUserName(data) {
    const bikeIdDisplay = document.getElementById('bike-id-display');
    if (!bikeIdDisplay) return;
    
    // 사용자 이름 추출
    const userName = data.userName || null;
    
    if (userName) {
        bikeIdDisplay.innerText = userName;
    } else {
        // 이름이 없으면 Track 번호 표시
        bikeIdDisplay.innerText = `Track ${myTrackId}`;
    }
    
    // 사용자명 라벨 클릭 이벤트 추가 (한 번만)
    if (!bikeIdDisplay.hasAttribute('data-click-listener-added')) {
        bikeIdDisplay.setAttribute('data-click-listener-added', 'true');
        bikeIdDisplay.style.cursor = 'pointer';
        bikeIdDisplay.title = '클릭하여 Live Training Rooms로 이동';
        
        bikeIdDisplay.addEventListener('click', () => {
            // Live Training Rooms 화면으로 이동
            window.location.href = 'index.html#trainingRoomScreen';
        });
    }
}

// 3. 훈련 상태 구독 (타이머, 세그먼트 정보)
let currentSegmentIndex = -1;
let previousTrainingState = null; // 이전 훈련 상태 추적
let lastWorkoutId = null; // 마지막 워크아웃 ID
window.currentTrainingState = 'idle'; // 전역 훈련 상태 (마스코트 애니메이션용)
let firebaseStatus = null; // Firebase status 저장 (세그먼트 정보용)

// Bluetooth 개인훈련 대시보드 전용 세그먼트 경과 시간 추적 (다른 화면과 독립)
let bluetoothIndividualSegmentStartTime = null; // 현재 세그먼트 시작 시간
let bluetoothIndividualSegmentElapsedTime = 0; // 현재 세그먼트 경과 시간 (초)
let bluetoothIndividualTotalElapsedTime = 0; // 전체 경과 시간 (초)
let bluetoothIndividualTrainingStartTime = null; // 훈련 시작 시간

/**
 * Workout ID를 가져오는 헬퍼 함수 (비동기)
 * @returns {Promise<string|null>} workoutId 또는 null
 */
async function getWorkoutId() {
    // 1순위: window.currentWorkout.id (가장 빠름)
    if (window.currentWorkout?.id) {
        return window.currentWorkout.id;
    }
    
    // 2순위: lastWorkoutId (로컬 변수)
    if (lastWorkoutId) {
        return lastWorkoutId;
    }
    
    // 3순위: Firebase에서 직접 가져오기
    try {
        const snapshot = await db.ref(`sessions/${SESSION_ID}/workoutId`).once('value');
        const workoutId = snapshot.val();
        if (workoutId) {
            // 가져온 값 저장
            if (!window.currentWorkout) {
                window.currentWorkout = {};
            }
            window.currentWorkout.id = workoutId;
            lastWorkoutId = workoutId;
            return workoutId;
        }
    } catch (error) {
        console.error('[getWorkoutId] Firebase에서 workoutId 가져오기 실패:', error);
    }
    
    return null;
}

/**
 * Workout ID를 동기적으로 가져오는 함수 (이미 로드된 경우)
 * @returns {string|null} workoutId 또는 null
 */
function getWorkoutIdSync() {
    // 1순위: window.currentWorkout.id
    if (window.currentWorkout?.id) {
        return window.currentWorkout.id;
    }
    
    // 2순위: lastWorkoutId
    if (lastWorkoutId) {
        return lastWorkoutId;
    }
    
    return null;
}

// 전역으로 노출 (다른 스크립트에서도 사용 가능)
window.getWorkoutId = getWorkoutId;
window.getWorkoutIdSync = getWorkoutIdSync;

db.ref(`sessions/${SESSION_ID}/status`).on('value', (snapshot) => {
    const status = snapshot.val();
    if (status) {
        // Firebase status 저장 (updateTargetPower에서 사용)
        firebaseStatus = status;
        
        // 훈련 상태 변화 감지 및 세션 관리
        const currentState = status.state || 'idle';
        const previousState = window.currentTrainingState;
        window.currentTrainingState = currentState; // 전역 변수에 저장
        
        // 화면 잠금 방지 제어 (훈련 진행 중에만 활성화)
        if (typeof window.wakeLockControl !== 'undefined') {
            if (currentState === 'running' && previousState !== 'running') {
                // 훈련 시작: 화면 잠금 방지 활성화
                console.log('[Bluetooth 개인 훈련] 훈련 시작 - 화면 잠금 방지 활성화');
                window.wakeLockControl.request();
            } else if ((currentState === 'idle' || currentState === 'paused' || currentState === 'ended') && previousState === 'running') {
                // 훈련 종료/일시정지: 화면 잠금 방지 해제
                console.log('[Bluetooth 개인 훈련] 훈련 종료/일시정지 - 화면 잠금 방지 해제');
                window.wakeLockControl.release();
            }
        }
        
        // 훈련 시작 감지 (idle/paused -> running)
        if (previousTrainingState !== 'running' && currentState === 'running') {
            // 워크아웃 ID 가져오기 (Firebase에서 또는 window.currentWorkout에서)
            db.ref(`sessions/${SESSION_ID}/workoutId`).once('value', (workoutIdSnapshot) => {
                const workoutId = workoutIdSnapshot.val();
                if (workoutId) {
                    if (!window.currentWorkout) {
                        window.currentWorkout = {};
                    }
                    window.currentWorkout.id = workoutId;
                    lastWorkoutId = workoutId;
                }
                
                // 세션 시작 (사용자 ID는 이미 currentUserIdForSession에 저장됨)
                if (window.trainingResults && typeof window.trainingResults.startSession === 'function' && currentUserIdForSession) {
                    window.trainingResults.startSession(currentUserIdForSession);
                    console.log('[BluetoothIndividual] 훈련 세션 시작:', { userId: currentUserIdForSession, workoutId: lastWorkoutId || window.currentWorkout?.id });
                } else if (!currentUserIdForSession) {
                    console.warn('[BluetoothIndividual] 사용자 ID가 없어 세션을 시작할 수 없습니다.');
                }
            });
        }
        
        // 훈련 종료 감지 (running -> finished/stopped/idle 또는 모든 세그먼트 완료)
        if (previousTrainingState === 'running' && (currentState === 'finished' || currentState === 'stopped' || currentState === 'idle')) {
            // 또는 모든 세그먼트가 완료되었는지 확인
            const totalSegments = window.currentWorkout?.segments?.length || 0;
            const lastSegmentIndex = totalSegments > 0 ? totalSegments - 1 : -1;
            const isAllSegmentsComplete = (status.segmentIndex !== undefined && status.segmentIndex >= lastSegmentIndex) || currentState === 'finished';
            
            if (isAllSegmentsComplete || currentState === 'finished' || currentState === 'stopped') {
                // elapsedTime을 전역 변수에 저장 (저장 시 사용)
                if (status.elapsedTime !== undefined && status.elapsedTime !== null) {
                    window.lastElapsedTime = status.elapsedTime;
                    console.log('[BluetoothIndividual] 훈련 종료 시 elapsedTime 저장:', window.lastElapsedTime);
                }
                
                // 모바일 대시보드와 동일한 훈련 결과 저장 로직 적용
                // ✅ await 없이 순차 실행(저장 → 초기화 → 결과 모달 표시)
                Promise.resolve()
                    .then(() => {
                        console.log('[BluetoothIndividual] 🚀 1단계: 결과 저장 시작');
                        return window.saveTrainingResultAtEnd?.();
                    })
                    .then((saveResult) => {
                        console.log('[BluetoothIndividual] ✅ 1단계 완료:', saveResult);
                        
                        // 저장 결과 확인 및 알림
                        if (saveResult?.saveResult?.source === 'local') {
                            console.log('[BluetoothIndividual] 📱 로컬 저장 모드 - CORS 오류로 서버 저장 실패');
                            if (typeof showToast === "function") {
                                showToast("훈련 결과가 기기에 저장되었습니다 (서버 연결 불가)", "warning");
                            }
                        } else if (saveResult?.saveResult?.source === 'gas') {
                            console.log('[BluetoothIndividual] 🌐 서버 저장 성공');
                            if (typeof showToast === "function") {
                                showToast("훈련 결과가 서버에 저장되었습니다");
                            }
                        }
                        
                        return window.trainingResults?.initializeResultScreen?.();
                    })
                    .catch((e) => { 
                        console.warn('[BluetoothIndividual] initializeResultScreen error', e); 
                    })
                    .then(() => {
                        console.log('[BluetoothIndividual] ✅ 2단계: 결과 화면 초기화 완료');
                        // 결과 팝업 표시
                        showTrainingResultModal(status);
                    })
                    .catch((error) => {
                        console.error('[BluetoothIndividual] ❌ 훈련 결과 저장/초기화 실패:', error);
                        // 저장 실패해도 팝업 표시 (로컬 데이터라도 있으면)
                        showTrainingResultModal(status);
                    });
            }
        }
        
        previousTrainingState = currentState;
        
        updateTimer(status);
        
        // 세그먼트 정보 표시
        const previousSegmentIndex = currentSegmentIndex;
        // 훈련 상태가 'running'이 아닐 때는 세그먼트 인덱스를 -1로 설정 (첫 로딩 시 마지막 세그먼트 표시 방지)
        if (currentState === 'running') {
            currentSegmentIndex = status.segmentIndex !== undefined ? status.segmentIndex : -1;
        } else {
            // 훈련이 진행 중이 아니면 세그먼트 인덱스 초기화
            currentSegmentIndex = -1;
        }
        
        // 세그먼트가 변경되면 세그먼트 파워 히스토리 초기화 및 로컬 시간 추적 초기화
        if (previousSegmentIndex !== currentSegmentIndex && currentSegmentIndex >= 0 && currentState === 'running') {
            segmentPowerHistory = [];
            currentSegmentStartTime = Date.now();
            // Bluetooth 개인훈련 대시보드 전용 세그먼트 시간 추적 초기화
            bluetoothIndividualSegmentStartTime = Date.now();
            bluetoothIndividualSegmentElapsedTime = 0;
            console.log(`[BluetoothIndividual] 세그먼트 변경: ${previousSegmentIndex} → ${currentSegmentIndex}, 파워 히스토리 및 시간 추적 초기화`);
            
            // 세그먼트 변경 시 속도계 목표값 및 세그먼트 정보 업데이트 (Bluetooth 개인훈련 대시보드 전용)
            updateSpeedometerTargetForSegment(currentSegmentIndex);
            // 세그먼트 정보는 약간의 지연 후 업데이트 (세그먼트 데이터가 완전히 로드된 후)
            setTimeout(() => {
                updateSpeedometerSegmentInfo();
            }, 100);
        }
        
        // 훈련 시작 시 로컬 시간 추적 초기화 및 속도계 목표값 업데이트
        if (previousTrainingState !== 'running' && currentState === 'running') {
            bluetoothIndividualTrainingStartTime = Date.now();
            bluetoothIndividualTotalElapsedTime = 0;
            if (currentSegmentIndex >= 0) {
                bluetoothIndividualSegmentStartTime = Date.now();
                bluetoothIndividualSegmentElapsedTime = 0;
                // 훈련 시작 시 첫 세그먼트의 속도계 목표값 및 세그먼트 정보 업데이트
                updateSpeedometerTargetForSegment(currentSegmentIndex);
                setTimeout(() => {
                    updateSpeedometerSegmentInfo();
                }, 100);
            }
            console.log('[BluetoothIndividual] 훈련 시작 - 로컬 시간 추적 초기화');
        }
        
        // 훈련 종료 시 로컬 시간 추적 정리
        if (previousTrainingState === 'running' && (currentState === 'idle' || currentState === 'finished' || currentState === 'stopped')) {
            bluetoothIndividualTrainingStartTime = null;
            bluetoothIndividualSegmentStartTime = null;
            bluetoothIndividualTotalElapsedTime = 0;
            bluetoothIndividualSegmentElapsedTime = 0;
            console.log('[BluetoothIndividual] 훈련 종료 - 로컬 시간 추적 정리');
        }
        
        // 세그먼트 인덱스가 변경되었지만 이전에 감지하지 못한 경우 처리
        if (currentSegmentIndex >= 0 && !bluetoothIndividualSegmentStartTime && currentState === 'running') {
            bluetoothIndividualSegmentStartTime = Date.now();
            bluetoothIndividualSegmentElapsedTime = 0;
            // 늦은 감지 시에도 속도계 목표값 및 세그먼트 정보 업데이트
            updateSpeedometerTargetForSegment(currentSegmentIndex);
            updateSpeedometerSegmentInfo();
            console.log('[BluetoothIndividual] 세그먼트 시간 추적 초기화 (늦은 감지)');
        }
        
        // 세그먼트 정보 업데이트 (Bluetooth 개인훈련 대시보드 전용)
        updateSpeedometerSegmentInfo();
        
        // 모든 세그먼트 완료 여부 확인 (Bluetooth 개인훈련 대시보드 전용)
        const isAllSegmentsComplete = checkAllSegmentsComplete(status, currentState, currentSegmentIndex);
        
        // 모든 세그먼트가 완료되었으면 더 이상 동작하지 않도록 처리
        if (isAllSegmentsComplete) {
            console.log('[BluetoothIndividual] 모든 세그먼트 완료 - 업데이트 중지');
            // 완료 상태 표시
            const segmentInfoEl = document.getElementById('segment-info');
            if (segmentInfoEl) {
                segmentInfoEl.textContent = '훈련 완료';
                segmentInfoEl.setAttribute('fill', '#fff'); // 흰색
            }
            // 경과시간은 마지막 값 유지, 카운트다운은 00:00으로 표시
            const lapTimeEl = document.getElementById('ui-lap-time');
            if (lapTimeEl) {
                lapTimeEl.textContent = '00:00';
                lapTimeEl.setAttribute('fill', '#00d4aa');
            }
            // 카운트다운 오버레이 숨김
            if (segmentCountdownActive) {
                stopSegmentCountdown();
            }
            // 더 이상 업데이트하지 않음 (return으로 함수 종료)
            return;
        }
        
        // 랩타임 카운트다운 업데이트
        updateLapTime(status);
        
        // 현재 세그먼트 정보 확인 및 로그 출력 (디버깅용)
        if (status.state === 'running') {
            logCurrentSegmentInfo();
        }
        
        // 속도계 하단 세그먼트 정보 및 진행률 업데이트 (Bluetooth 개인훈련 대시보드 전용)
        updateSpeedometerSegmentInfo();
        
        // TARGET 파워 업데이트 (세그먼트 변경 시)
        updateTargetPower();
        
        // 세그먼트 그래프 업데이트
        if (window.currentWorkout && window.currentWorkout.segments) {
            updateSegmentGraph(window.currentWorkout.segments, currentSegmentIndex);
        }
    }
});

// 4. 워크아웃 정보 구독 (세그먼트 그래프 표시용)
db.ref(`sessions/${SESSION_ID}/workoutPlan`).on('value', (snapshot) => {
    const segments = snapshot.val();
    if (segments && Array.isArray(segments) && segments.length > 0) {
        // 워크아웃 객체 생성
        if (!window.currentWorkout) {
            window.currentWorkout = {};
        }
        window.currentWorkout.segments = segments;
        
        // 워크아웃 ID 가져오기 (Firebase에서 확인)
        // workoutPlan이 업데이트될 때 workoutId도 함께 확인하여 저장
        // 헬퍼 함수를 사용하여 workoutId 가져오기
        (async () => {
            try {
                const workoutId = await getWorkoutId();
                if (workoutId) {
                    console.log('[BluetoothIndividual] workoutPlan 업데이트 시 workoutId 확인:', workoutId);
                } else {
                    // workoutId가 없어도 경고만 출력 (나중에 로드될 수 있음)
                    console.log('[BluetoothIndividual] workoutPlan은 있지만 workoutId를 아직 찾을 수 없습니다. (나중에 로드될 수 있음)');
                }
            } catch (error) {
                console.warn('[BluetoothIndividual] workoutId 가져오기 실패:', error);
            }
        })();
        
        // 세그먼트 그래프 그리기
        updateSegmentGraph(segments, currentSegmentIndex);
        // TARGET 파워 업데이트 (워크아웃 정보 로드 시)
        updateTargetPower();
        
        // 워크아웃 로드 시 현재 세그먼트의 속도계 목표값 및 세그먼트 정보 업데이트 (Bluetooth 개인훈련 대시보드 전용)
        if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
            updateSpeedometerTargetForSegment(currentSegmentIndex);
            setTimeout(() => {
                updateSpeedometerSegmentInfo();
            }, 100);
        }
    }
});

// =========================================================
// UI 업데이트 함수들
// =========================================================

// updateDashboard 함수: window.liveData에서 읽어서 대시보드 업데이트
// Bluetooth 개인훈련 대시보드 전용 (다른 화면과 독립)
function updateDashboard(data = null) {
    // Bluetooth 개인훈련 대시보드 화면인지 확인 (독립적 구동 보장)
    const isBluetoothIndividualScreen = window.location.pathname.includes('bluetoothIndividual.html');
    if (!isBluetoothIndividualScreen) {
        return; // 다른 화면에서는 실행하지 않음
    }
    
    // window.liveData 초기화 확인 (bluetooth.js에서 초기화하지만 안전을 위해)
    if (!window.liveData) {
        window.liveData = { power: 0, heartRate: 0, cadence: 0, targetPower: 0 };
        console.log('[BluetoothIndividual] window.liveData 초기화');
    }
    
    // data가 없으면 window.liveData에서 직접 읽기 (Bluetooth 디바이스 데이터)
    // data 파라미터는 Firebase에서 받은 데이터일 수 있으므로, window.liveData를 우선 사용
    if (!data) {
        data = window.liveData;
    }
    
    // 디버깅 로그 (5초마다 한 번씩만 출력)
    if (!window.lastDashboardLog || (Date.now() - window.lastDashboardLog) > 5000) {
        window.lastDashboardLog = Date.now();
        const connectedDevicesInfo = {
            heartRate: window.connectedDevices?.heartRate ? (window.connectedDevices.heartRate.name || 'connected') : null,
            powerMeter: window.connectedDevices?.powerMeter ? (window.connectedDevices.powerMeter.name || 'connected') : null,
            trainer: window.connectedDevices?.trainer ? (window.connectedDevices.trainer.name || 'connected') : null
        };
        console.log('[BluetoothIndividual] updateDashboard 호출:', {
            power: window.liveData?.power,
            heartRate: window.liveData?.heartRate,
            cadence: window.liveData?.cadence,
            hasData: !!data,
            connectedDevices: connectedDevicesInfo,
            hasBluetoothJS: typeof window.connectHeartRate === 'function',
            handleHeartRateDataExists: typeof window.handleHeartRateData === 'function'
        });
    }
    
    // 1. 텍스트 업데이트
    // 파워값 가져오기 (window.liveData 우선 사용, bluetooth.js에서 업데이트됨)
    const power = Number(window.liveData?.power || data?.power || data?.currentPower || data?.watts || data?.currentPowerW || 0);
    
    // 3초 평균 파워값 계산 (전역 함수 사용)
    let powerValue = power; // 기본값은 현재 파워값
    if (window.get3SecondAveragePower && typeof window.get3SecondAveragePower === 'function') {
      powerValue = window.get3SecondAveragePower();
    } else {
      // 함수가 없으면 현재값 사용
      powerValue = Math.round(power);
    }
    
    // 현재 파워값을 전역 변수에 저장 (바늘 애니메이션 루프에서 사용)
    currentPowerValue = powerValue;
    
    // SVG text 요소는 textContent 사용 (innerText보다 안정적)
    // 텍스트는 즉시 업데이트 (바늘은 애니메이션 루프에서 부드럽게 이동)
    const powerEl = document.getElementById('ui-current-power');
    if (powerEl) {
        powerEl.textContent = powerValue;
        powerEl.setAttribute('fill', '#fff');
    }
    
    // 현재 파워값 하단에 세그먼트 정보 및 진행률 표시 (Bluetooth 개인훈련 대시보드 전용)
    updateSpeedometerSegmentInfo();
    
    // TARGET 파워는 세그먼트 정보에서 계산
    updateTargetPower();
    
    // 목표 파워 원호 업데이트 (달성도에 따라 색상 변경)
    if (typeof updateTargetPowerArc === 'function') {
        updateTargetPowerArc();
    }
    
    // CADENCE 표시 (Bluetooth 디바이스에서 받은 값)
    // window.liveData.cadence 우선 사용 (bluetooth.js에서 직접 업데이트됨)
    const cadence = Number(window.liveData?.cadence || data?.cadence || data?.rpm || 0);
    const cadenceEl = document.getElementById('ui-cadence');
    if (cadenceEl) {
        // cadence가 0이거나 유효하지 않으면 확실히 0으로 표시
        const displayCadence = (cadence > 0 && !isNaN(cadence)) ? Math.round(cadence) : 0;
        cadenceEl.textContent = displayCadence;
    }
    
    // HEART RATE 표시 (Bluetooth 디바이스에서 받은 값)
    // window.liveData.heartRate 우선 사용 (bluetooth.js에서 직접 업데이트됨)
    const hr = Number(window.liveData?.heartRate || data?.hr || data?.heartRate || data?.bpm || 0);
    const hrEl = document.getElementById('ui-hr');
    if (hrEl) {
        hrEl.textContent = Math.round(hr);
        // 디버깅 로그 (심박수가 업데이트될 때마다)
        if (hr > 0 && (!window.lastHRLog || (Date.now() - window.lastHRLog) > 5000)) {
            window.lastHRLog = Date.now();
            console.log('[BluetoothIndividual] 심박수 업데이트:', hr, 'bpm (window.liveData.heartRate:', window.liveData?.heartRate, ')');
        }
    }
    
    // 랩파워 표시 (세그먼트 평균 파워)
    // 세그먼트가 진행됨에 따라 실시간으로 계산
    // 1순위: segmentPowerHistory를 사용하여 직접 계산 (실시간 업데이트)
    // 2순위: Firebase에서 받은 segmentPower 값 사용
    let lapPower = 0;
    
    // segmentPowerHistory를 사용하여 직접 계산 (세그먼트 진행 중 실시간 업데이트)
    if (segmentPowerHistory.length > 0) {
        const totalSegmentPower = segmentPowerHistory.reduce((sum, entry) => sum + entry.power, 0);
        lapPower = Math.round(totalSegmentPower / segmentPowerHistory.length);
    } else {
        // segmentPowerHistory가 없으면 Firebase에서 받은 값 사용
        lapPower = Number(data.segmentPower || data.avgPower || data.segmentAvgPower || data.averagePower || 0);
    }
    
    const lapPowerEl = document.getElementById('ui-lap-power');
    if (lapPowerEl) {
        lapPowerEl.textContent = Math.round(lapPower);
    }
    
    // 실시간 데이터를 resultManager에 기록 (훈련 진행 중일 때만)
    if (window.trainingResults && typeof window.trainingResults.appendStreamSample === 'function') {
        // 파워 데이터 기록
        if (powerValue > 0) {
            window.trainingResults.appendStreamSample('power', powerValue);
        }
        // 심박수 데이터 기록
        if (hr > 0) {
            window.trainingResults.appendStreamSample('hr', hr);
        }
        // 케이던스 데이터 기록
        if (cadence > 0) {
            window.trainingResults.appendStreamSample('cadence', cadence);
        }
    }
    
    // 바늘 움직임은 startGaugeAnimationLoop에서 처리 (가민 스타일 부드러운 움직임)
}

function updateTimer(status) {
    const timerEl = document.getElementById('main-timer');
    
    if (status.state === 'running') {
        // 방장이 계산해서 보내준 elapsedTime 사용 (가장 정확)
        const totalSeconds = status.elapsedTime || 0;
        timerEl.innerText = formatHMS(totalSeconds); // hh:mm:ss 형식
        timerEl.style.color = '#00d4aa'; // 실행중 색상
        
        // 경과시간을 전역 변수에 저장 (마스코트 위치 계산용)
        if (status.elapsedTime !== undefined && status.elapsedTime !== null) {
            window.lastElapsedTime = status.elapsedTime;
        }
        
        // 세그먼트 그래프 업데이트 (마스코트 위치 업데이트)
        if (window.currentWorkout && window.currentWorkout.segments) {
            const currentSegmentIndex = status.segmentIndex !== undefined ? status.segmentIndex : -1;
            updateSegmentGraph(window.currentWorkout.segments, currentSegmentIndex);
        }
    } else if (status.state === 'paused') {
        timerEl.style.color = '#ffaa00'; // 일시정지 색상
    } else {
        timerEl.innerText = "00:00:00";
        timerEl.style.color = '#fff';
        
        // 훈련이 종료되거나 시작 전이면 마스코트를 0 위치로
        if (window.currentWorkout && window.currentWorkout.segments) {
            window.lastElapsedTime = 0;
            const currentSegmentIndex = status.segmentIndex !== undefined ? status.segmentIndex : -1;
            updateSegmentGraph(window.currentWorkout.segments, currentSegmentIndex);
        }
    }
}

// 시간 포맷: 초 → "mm:ss"
function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// 시간 포맷: 초 → "hh:mm:ss"
function formatHMS(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 5초 카운트다운 상태 관리
let segmentCountdownActive = false;
let segmentCountdownTimer = null;
let lastCountdownValue = null;
let startCountdownActive = false; // 시작 카운트다운 활성 상태
let goDisplayTime = null; // GO!! 표시 시작 시간

// Beep 사운드 (Web Audio)
let __beepCtx = null;

// 오디오 컨텍스트 초기화 함수
async function ensureBeepContext() {
    try {
        if (!window.AudioContext && !window.webkitAudioContext) {
            console.warn('[Bluetooth 개인 훈련] Web Audio API not supported');
            return false;
        }

        if (!__beepCtx) {
            __beepCtx = new (window.AudioContext || window.webkitAudioContext)();
            console.log('[Bluetooth 개인 훈련] New audio context created');
        }
        
        if (__beepCtx.state === "suspended") {
            await __beepCtx.resume();
            console.log('[Bluetooth 개인 훈련] Audio context resumed');
        }
        
        return __beepCtx.state === "running";
        
    } catch (error) {
        console.error('[Bluetooth 개인 훈련] Audio context initialization failed:', error);
        __beepCtx = null;
        return false;
    }
}

// 벨소리 재생 함수
async function playBeep(freq = 880, durationMs = 120, volume = 0.2, type = "sine") {
    try {
        console.log(`[Bluetooth 개인 훈련] Beep 재생 시도: ${freq}Hz, ${durationMs}ms, ${volume} 볼륨, ${type} 타입`);
        
        const contextReady = await ensureBeepContext();
        if (!contextReady) {
            console.warn('[Bluetooth 개인 훈련] Audio context not available for beep');
            return;
        }

        const osc = __beepCtx.createOscillator();
        const gain = __beepCtx.createGain();
        
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.value = volume;

        osc.connect(gain);
        gain.connect(__beepCtx.destination);

        const now = __beepCtx.currentTime;
        
        // 볼륨 페이드 아웃 설정
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

        // 오실레이터 시작 및 정지
        osc.start(now);
        osc.stop(now + durationMs / 1000);
        
        console.log(`[Bluetooth 개인 훈련] Beep 재생 성공: ${freq}Hz`);
        
        // Promise로 재생 완료 시점 반환
        return new Promise(resolve => {
            setTimeout(resolve, durationMs);
        });
        
    } catch (error) {
        console.error('[Bluetooth 개인 훈련] Beep 재생 실패:', error);
    }
}

// 랩카운트다운 업데이트 함수 (훈련방의 세그먼트 시간 경과값 표시)
// Bluetooth 개인훈련 대시보드 전용 (다른 화면과 독립)
function updateLapTime(status = null) {
    const lapTimeEl = document.getElementById('ui-lap-time');
    if (!lapTimeEl) return;
    
    // status가 없으면 firebaseStatus 사용
    if (!status) {
        status = firebaseStatus || { state: 'idle' };
    }
    
    // 모든 세그먼트 완료 여부 확인 (독립적으로 체크)
    const currentState = status.state || 'idle';
    const currentSegIdx = status.segmentIndex !== undefined ? status.segmentIndex : currentSegmentIndex;
    const isAllSegmentsComplete = checkAllSegmentsComplete(status, currentState, currentSegIdx);
    
    // 모든 세그먼트가 완료되었으면 더 이상 업데이트하지 않음
    if (isAllSegmentsComplete) {
        lapTimeEl.textContent = '00:00';
        lapTimeEl.setAttribute('fill', '#00d4aa');
        return;
    }
    
    // 훈련방의 세그먼트 남은 시간 값 사용 (5,4,3,2,1,0 카운트다운과는 별개)
    let countdownValue = null;
    
    // 훈련 중일 때: 세그먼트 남은 시간 우선 사용
    if (status.state === 'running') {
        // 1순위: segmentRemainingSec (훈련방에서 계산된 세그먼트 남은 시간)
        if (status.segmentRemainingSec !== undefined && status.segmentRemainingSec !== null && Number.isFinite(status.segmentRemainingSec)) {
            countdownValue = Math.max(0, Math.floor(status.segmentRemainingSec));
        }
        // 2순위: segmentRemainingTime (다른 필드명)
        else if (status.segmentRemainingTime !== undefined && status.segmentRemainingTime !== null && Number.isFinite(status.segmentRemainingTime)) {
            countdownValue = Math.max(0, Math.floor(status.segmentRemainingTime));
        }
        // 3순위: 로컬에서 계산 (Bluetooth 개인훈련 대시보드 전용)
        else if (window.currentWorkout && window.currentWorkout.segments) {
            const segIndex = status.segmentIndex !== undefined ? status.segmentIndex : currentSegmentIndex;
            const seg = window.currentWorkout.segments[segIndex];
            
            if (seg && segIndex >= 0) {
                const segDuration = seg.duration_sec || seg.duration || 0;
                
                // 로컬 세그먼트 경과 시간 사용
                if (bluetoothIndividualSegmentStartTime && segIndex >= 0) {
                    const now = Date.now();
                    const elapsed = Math.floor((now - bluetoothIndividualSegmentStartTime) / 1000);
                    bluetoothIndividualSegmentElapsedTime = elapsed;
                    countdownValue = Math.max(0, segDuration - elapsed);
                    
                    // 세그먼트가 완료되었고 다음 세그먼트로 넘어가지 않았을 때는 null로 설정
                    if (countdownValue === 0 && elapsed >= segDuration) {
                        // 다음 세그먼트가 있는지 확인
                        const nextSegmentIndex = segIndex + 1;
                        const hasNextSegment = nextSegmentIndex < window.currentWorkout.segments.length;
                        // 다음 세그먼트가 없거나 아직 시작되지 않았으면 null로 설정하여 카운트다운 숨김
                        if (!hasNextSegment || (status.segmentIndex !== undefined && status.segmentIndex === segIndex)) {
                            countdownValue = null;
                        }
                    }
                }
                // segmentElapsedSec가 있으면 사용
                else if (status.segmentElapsedSec !== undefined && Number.isFinite(status.segmentElapsedSec)) {
                    const elapsed = Math.floor(status.segmentElapsedSec);
                    countdownValue = Math.max(0, segDuration - elapsed);
                    
                    // 세그먼트가 완료되었을 때 처리
                    if (countdownValue === 0 && elapsed >= segDuration) {
                        const nextSegmentIndex = segIndex + 1;
                        const hasNextSegment = nextSegmentIndex < window.currentWorkout.segments.length;
                        if (!hasNextSegment || (status.segmentIndex !== undefined && status.segmentIndex === segIndex)) {
                            countdownValue = null;
                        }
                    }
                }
                // segmentElapsedTime이 있으면 사용
                else if (status.segmentElapsedTime !== undefined && Number.isFinite(status.segmentElapsedTime)) {
                    const elapsed = Math.floor(status.segmentElapsedTime);
                    countdownValue = Math.max(0, segDuration - elapsed);
                    
                    // 세그먼트가 완료되었을 때 처리
                    if (countdownValue === 0 && elapsed >= segDuration) {
                        const nextSegmentIndex = segIndex + 1;
                        const hasNextSegment = nextSegmentIndex < window.currentWorkout.segments.length;
                        if (!hasNextSegment || (status.segmentIndex !== undefined && status.segmentIndex === segIndex)) {
                            countdownValue = null;
                        }
                    }
                }
                // elapsedTime과 segmentStartTime으로 계산
                else if (status.elapsedTime !== undefined && status.segmentStartTime !== undefined) {
                    const segElapsed = Math.max(0, status.elapsedTime - status.segmentStartTime);
                    countdownValue = Math.max(0, segDuration - segElapsed);
                    
                    // 세그먼트가 완료되었을 때 처리
                    if (countdownValue === 0 && segElapsed >= segDuration) {
                        const nextSegmentIndex = segIndex + 1;
                        const hasNextSegment = nextSegmentIndex < window.currentWorkout.segments.length;
                        if (!hasNextSegment || (status.segmentIndex !== undefined && status.segmentIndex === segIndex)) {
                            countdownValue = null;
                        }
                    }
                }
                // 전체 경과 시간에서 이전 세그먼트들의 시간을 빼서 계산
                else if (status.elapsedTime !== undefined) {
                    let prevSegmentsTime = 0;
                    for (let i = 0; i < segIndex; i++) {
                        const prevSeg = window.currentWorkout.segments[i];
                        if (prevSeg) {
                            prevSegmentsTime += (prevSeg.duration_sec || prevSeg.duration || 0);
                        }
                    }
                    const segElapsed = Math.max(0, status.elapsedTime - prevSegmentsTime);
                    countdownValue = Math.max(0, segDuration - segElapsed);
                    
                    // 세그먼트가 완료되었을 때 처리
                    if (countdownValue === 0 && segElapsed >= segDuration) {
                        const nextSegmentIndex = segIndex + 1;
                        const hasNextSegment = nextSegmentIndex < window.currentWorkout.segments.length;
                        if (!hasNextSegment || (status.segmentIndex !== undefined && status.segmentIndex === segIndex)) {
                            countdownValue = null;
                        }
                    }
                }
            }
        }
    }
    // 훈련 시작 전: countdownRemainingSec (전체 훈련 시작 카운트다운)
    else if (status.countdownRemainingSec !== undefined && status.countdownRemainingSec !== null && Number.isFinite(status.countdownRemainingSec)) {
        countdownValue = Math.max(0, Math.floor(status.countdownRemainingSec));
    }
    
    // 카운트다운 값 표시
    if (countdownValue !== null && countdownValue >= 0) {
        lapTimeEl.textContent = formatTime(countdownValue);
        // 10초 이하면 빨간색, 그 외는 청록색
        lapTimeEl.setAttribute('fill', countdownValue <= 10 ? '#ff4444' : '#00d4aa');
    } else {
        lapTimeEl.textContent = '00:00';
        lapTimeEl.setAttribute('fill', '#00d4aa');
    }
    
    // 5초 카운트다운 오버레이 처리
    if (status) {
        handleSegmentCountdown(countdownValue, status);
    }
}

// 5초 카운트다운 오버레이 처리 함수
function handleSegmentCountdown(countdownValue, status) {
    // 시작 카운트다운인지 세그먼트 카운트다운인지 구분
    const isStartCountdown = status.state === 'countdown' || 
                             (status.countdownRemainingSec !== undefined && 
                              status.countdownRemainingSec !== null && 
                              status.countdownRemainingSec >= 0 && 
                              status.state !== 'running');
    
    // 시작 카운트다운 처리 (5, 4, 3, 2, 1, GO!!)
    if (isStartCountdown && countdownValue !== null && countdownValue >= 0) {
        startCountdownActive = true; // 시작 카운트다운 활성화
        
        // 5초 이상이면 오버레이 표시하지 않음 (Firebase 동기화 지연 고려)
        if (countdownValue <= 5) {
            // 이전 값과 다르거나 카운트다운이 시작되지 않은 경우
            if (lastCountdownValue !== countdownValue || !segmentCountdownActive) {
                lastCountdownValue = countdownValue;
                // 0일 때는 "GO!!" 표시
                const displayValue = countdownValue === 0 ? 'GO!!' : countdownValue;
                showSegmentCountdown(displayValue);
                
                // GO!! 표시 시 시간 기록
                if (displayValue === 'GO!!') {
                    goDisplayTime = Date.now();
                }
            }
        }
        return; // 시작 카운트다운 중에는 세그먼트 카운트다운 로직 실행하지 않음
    }
    
    // GO!! 표시 후 1초 이내에는 오버레이 유지 (시작 카운트다운 종료 후 보호)
    if (goDisplayTime !== null) {
        const elapsedSinceGo = Date.now() - goDisplayTime;
        if (elapsedSinceGo < 1000) { // GO!! 표시 후 1초 이내
            // 오버레이가 표시되어 있는지 확인하고 유지
            const overlay = document.getElementById('countdownOverlay');
            if (overlay && !overlay.classList.contains('hidden')) {
                return; // 오버레이 유지
            }
        } else {
            // 1초 경과 후 GO!! 표시 시간 초기화
            goDisplayTime = null;
            startCountdownActive = false;
        }
    }
    
    // 시작 카운트다운이 활성화되어 있으면 세그먼트 카운트다운 로직 실행하지 않음
    if (startCountdownActive) {
        return;
    }
    
    // 세그먼트 카운트다운 처리 (기존 로직)
    // countdownValue가 null이면 세그먼트가 완료되었으므로 오버레이 숨김
    if (countdownValue === null) {
        if (segmentCountdownActive && !startCountdownActive) {
            stopSegmentCountdown();
        }
        lastCountdownValue = null;
        return;
    }
    
    // 마지막 세그먼트인지 확인 (Bluetooth 개인훈련 대시보드 전용)
    const isLastSegment = checkIsLastSegment(status);
    if (isLastSegment) {
        // 마지막 세그먼트에서는 5초 카운트다운 표시하지 않음
        if (segmentCountdownActive && !startCountdownActive) {
            stopSegmentCountdown();
        }
        lastCountdownValue = null;
        return;
    }
    
    // countdownValue가 유효하지 않거나 5초보다 크면 오버레이 숨김
    if (countdownValue > 5) {
        if (segmentCountdownActive && !startCountdownActive) {
            stopSegmentCountdown();
        }
        lastCountdownValue = null;
        return;
    }
    
    // 5초 이하일 때만 오버레이 표시 (마지막 세그먼트가 아닐 때만)
    if (countdownValue <= 5 && countdownValue >= 0) {
        // 이전 값과 다르거나 카운트다운이 시작되지 않은 경우
        if (lastCountdownValue !== countdownValue || !segmentCountdownActive) {
            lastCountdownValue = countdownValue;
            showSegmentCountdown(countdownValue);
        }
    } else if (countdownValue < 0) {
        // 0 미만이면 오버레이 숨김 (시작 카운트다운이 아닐 때만)
        if (segmentCountdownActive && !startCountdownActive) {
            stopSegmentCountdown();
        }
        lastCountdownValue = null;
    }
}

// 세그먼트 카운트다운 오버레이 표시
function showSegmentCountdown(value) {
    const overlay = document.getElementById('countdownOverlay');
    const numEl = document.getElementById('countdownNumber');
    
    if (!overlay || !numEl) return;
    
    // 오버레이 표시 (강제로 표시)
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
    overlay.style.visibility = 'visible';
    overlay.style.opacity = '1';
    
    // 숫자 또는 "GO!!" 업데이트
    numEl.textContent = String(value);
    
    // "GO!!"일 때 스타일 조정
    if (value === 'GO!!') {
        numEl.style.fontSize = '150px'; // GO!!는 조금 작게
        numEl.style.color = '#00d4aa'; // 민트색
        goDisplayTime = Date.now(); // GO!! 표시 시간 기록
    } else {
        numEl.style.fontSize = '200px'; // 기본 크기
        numEl.style.color = '#fff'; // 흰색
    }
    
    // 애니메이션 효과를 위해 클래스 재적용 (강제 리플로우)
    numEl.style.animation = 'none';
    setTimeout(() => {
        numEl.style.animation = '';
    }, 10);
    
    // 벨소리 재생
    if (value === 'GO!!' || value === 0) {
        // GO!! 또는 0일 때: 강조 벨소리 (높은 주파수, 긴 지속시간)
        playBeep(1500, 700, 0.35, "square").catch(err => {
            console.warn('[Bluetooth 개인 훈련] 벨소리 재생 실패:', err);
        });
    } else if (typeof value === 'number' && value > 0 && value <= 5) {
        // 1~5초일 때: 일반 벨소리
        playBeep(880, 120, 0.25, "sine").catch(err => {
            console.warn('[Bluetooth 개인 훈련] 벨소리 재생 실패:', err);
        });
    }
    
    segmentCountdownActive = true;
    
    // 0 또는 "GO!!"일 때 1초 후 오버레이 숨김 (GO!!는 더 길게 표시)
    if (value === 0 || value === 'GO!!') {
        // 기존 타이머가 있으면 제거
        if (segmentCountdownTimer) {
            clearTimeout(segmentCountdownTimer);
        }
        segmentCountdownTimer = setTimeout(() => {
            // GO!! 표시 후 1초가 지났는지 확인
            if (goDisplayTime !== null) {
                const elapsedSinceGo = Date.now() - goDisplayTime;
                if (elapsedSinceGo >= 1000) {
                    stopSegmentCountdown();
                    goDisplayTime = null;
                    startCountdownActive = false;
                } else {
                    // 아직 1초가 안 지났으면 추가 대기
                    const remainingTime = 1000 - elapsedSinceGo;
                    segmentCountdownTimer = setTimeout(() => {
                        stopSegmentCountdown();
                        goDisplayTime = null;
                        startCountdownActive = false;
                    }, remainingTime);
                }
            } else {
                stopSegmentCountdown();
            }
        }, 1000); // 1초로 증가
    }
}

// 세그먼트 카운트다운 오버레이 숨김
function stopSegmentCountdown() {
    // 시작 카운트다운 중이거나 GO!! 표시 후 1초가 안 지났으면 숨기지 않음
    if (startCountdownActive || (goDisplayTime !== null && (Date.now() - goDisplayTime) < 1000)) {
        return;
    }
    
    const overlay = document.getElementById('countdownOverlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.style.display = 'none';
        overlay.style.visibility = 'hidden';
    }
    
    if (segmentCountdownTimer) {
        clearTimeout(segmentCountdownTimer);
        segmentCountdownTimer = null;
    }
    
    segmentCountdownActive = false;
    lastCountdownValue = null;
    startCountdownActive = false;
    goDisplayTime = null;
}

// TARGET 파워 업데이트 함수 (Firebase에서 계산된 값 우선 사용)
// Bluetooth 개인훈련 대시보드 전용 (다른 화면과 독립)
function updateTargetPower() {
    // Bluetooth 개인훈련 대시보드 화면인지 확인 (독립적 구동 보장)
    const isBluetoothIndividualScreen = window.location.pathname.includes('bluetoothIndividual.html');
    if (!isBluetoothIndividualScreen) {
        return; // 다른 화면에서는 실행하지 않음
    }
    
    const targetPowerEl = document.getElementById('ui-target-power');
    if (!targetPowerEl) {
        console.warn('[updateTargetPower] ui-target-power 요소를 찾을 수 없습니다.');
        return;
    }
    
    // 모든 세그먼트 완료 여부 확인 (독립적으로 체크)
    const status = firebaseStatus || { state: 'idle' };
    const currentState = status.state || 'idle';
    const currentSegIdx = status.segmentIndex !== undefined ? status.segmentIndex : currentSegmentIndex;
    const isAllSegmentsComplete = checkAllSegmentsComplete(status, currentState, currentSegIdx);
    
    // 모든 세그먼트가 완료되었으면 더 이상 업데이트하지 않음
    if (isAllSegmentsComplete) {
        return;
    }
    
    // 1순위: Firebase에서 받은 targetPower 값 사용 (서버에서 계산된 값)
    // 단, targetPower가 0이면 세그먼트 정보로부터 계산 (Firebase 값이 0일 수 있음)
    if (firebaseTargetPower !== null && !isNaN(firebaseTargetPower) && firebaseTargetPower > 0) {
        // 강도 조절 비율 적용 (개인 훈련 대시보드 슬라이드 바)
        const adjustedTargetPower = Math.round(firebaseTargetPower * individualIntensityAdjustment);
        console.log('[updateTargetPower] Firebase targetPower 값 사용:', firebaseTargetPower, 'W');
        console.log('[updateTargetPower] 강도 조절 적용:', individualIntensityAdjustment, '→ 조절된 목표 파워:', adjustedTargetPower, 'W');
        
        // TARGET 라벨 업데이트 로직 (Firebase 값 사용 시)
        const targetLabelEl = document.getElementById('ui-target-label');
        const targetRpmUnitEl = document.getElementById('ui-target-rpm-unit');
        const seg = getCurrentSegment();
        const targetType = seg?.target_type || 'ftp_pct';
        
        // ftp_pctz 타입인 경우 상한값 저장
        if (targetType === 'ftp_pctz' && seg?.target_value) {
            const targetValue = seg.target_value;
            let minPercent = 60;
            let maxPercent = 75;
            
            if (typeof targetValue === 'string' && targetValue.includes('/')) {
                const parts = targetValue.split('/').map(s => s.trim());
                if (parts.length >= 2) {
                    minPercent = Number(parts[0]) || 60;
                    maxPercent = Number(parts[1]) || 75;
                }
            } else if (typeof targetValue === 'string' && targetValue.includes(',')) {
                // 기존 형식(쉼표)도 지원 (하위 호환성)
                const parts = targetValue.split(',').map(s => s.trim());
                if (parts.length >= 2) {
                    minPercent = Number(parts[0]) || 60;
                    maxPercent = Number(parts[1]) || 75;
                }
            } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
                minPercent = Number(targetValue[0]) || 60;
                maxPercent = Number(targetValue[1]) || 75;
            }
            
            const ftp = userFTP || window.currentUser?.ftp || 200;
            const baseMaxPower = Math.round(ftp * (maxPercent / 100));
            const baseMinPower = Math.round(ftp * (minPercent / 100));
            // 강도 조절 비율 적용
            window.currentSegmentMaxPower = Math.round(baseMaxPower * individualIntensityAdjustment);
            window.currentSegmentMinPower = Math.round(baseMinPower * individualIntensityAdjustment);
        } else {
            window.currentSegmentMaxPower = null;
            window.currentSegmentMinPower = null;
        }
        
        if (targetType === 'dual') {
            // dual 타입: TARGET 라벨에 RPM 값과 단위를 1줄에 표시, 숫자는 빨강색, 단위는 그레이
            const targetValue = seg?.target_value || seg?.target || '0';
            let targetRpm = 0;
            if (typeof targetValue === 'string' && targetValue.includes('/')) {
                const parts = targetValue.split('/').map(s => s.trim());
                targetRpm = Number(parts[1]) || 0;
            } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
                targetRpm = Number(targetValue[1]) || 0;
            }
            
            if (targetRpm > 0 && targetLabelEl) {
                // 기존 내용 삭제
                targetLabelEl.textContent = '';
                targetLabelEl.setAttribute('fill', '#ef4444'); // 기본 색상 빨강색
                targetLabelEl.setAttribute('font-size', '10'); // 속도계 눈금 폰트 크기와 동일
                targetLabelEl.setAttribute('y', '90'); // 위치 동일하게 유지
                
                // 숫자는 빨강색, RPM 단위는 그레이로 1줄에 표시
                const rpmNumber = Math.round(targetRpm);
                const tspanNumber = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                tspanNumber.setAttribute('fill', '#ef4444'); // 빨강색
                tspanNumber.textContent = rpmNumber.toString();
                targetLabelEl.appendChild(tspanNumber);
                
                const tspanUnit = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                tspanUnit.setAttribute('fill', '#888'); // 그레이
                tspanUnit.textContent = ' RPM';
                targetLabelEl.appendChild(tspanUnit);
                
                // RPM 단위 요소는 숨김 처리
                if (targetRpmUnitEl) {
                    targetRpmUnitEl.style.display = 'none';
                }
            } else {
                if (targetLabelEl) {
                    targetLabelEl.textContent = 'TARGET';
                    targetLabelEl.setAttribute('fill', '#888');
                    targetLabelEl.setAttribute('font-size', '6'); // 원래 폰트 크기로 복원
                }
                if (targetRpmUnitEl) {
                    targetRpmUnitEl.style.display = 'none';
                }
            }
            targetPowerEl.textContent = String(adjustedTargetPower);
            targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
        } else if (targetType === 'cadence_rpm') {
            // cadence_rpm 타입: 목표 파워값 자리에 RPM 값 표시, 색상 #ef4444 (빨강색), TARGET 라벨을 'CADENCE'로 변경
            const targetValue = seg?.target_value || seg?.target || '0';
            const targetRpm = Number(targetValue) || 0;
            
            if (targetRpm > 0) {
                if (targetLabelEl) {
                    targetLabelEl.textContent = 'CADENCE';
                    targetLabelEl.setAttribute('fill', '#888');
                }
                if (targetRpmUnitEl) {
                    targetRpmUnitEl.style.display = 'none';
                }
                targetPowerEl.textContent = Math.round(targetRpm).toString();
                targetPowerEl.setAttribute('fill', '#ef4444'); // 빨강색
            } else {
                if (targetLabelEl) {
                    targetLabelEl.textContent = 'TARGET';
                    targetLabelEl.setAttribute('fill', '#888');
                }
                if (targetRpmUnitEl) {
                    targetRpmUnitEl.style.display = 'none';
                }
                targetPowerEl.textContent = '0';
                targetPowerEl.setAttribute('fill', '#ff8c00');
            }
        } else if (targetType === 'ftp_pctz') {
            // ftp_pctz 타입: TARGET 라벨 표시, 목표 파워값(주황색) - 하한값 표시
            if (targetLabelEl) {
                targetLabelEl.textContent = 'TARGET';
                targetLabelEl.setAttribute('fill', '#888');
            }
            if (targetRpmUnitEl) {
                targetRpmUnitEl.style.display = 'none';
            }
            targetPowerEl.textContent = String(adjustedTargetPower);
            targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
        } else {
            // ftp_pct 타입: TARGET 라벨 표시, 목표 파워값(주황색) 원래 색상으로 되돌림
            if (targetLabelEl) {
                targetLabelEl.textContent = 'TARGET';
                targetLabelEl.setAttribute('fill', '#888');
            }
            if (targetRpmUnitEl) {
                targetRpmUnitEl.style.display = 'none';
            }
            targetPowerEl.textContent = String(adjustedTargetPower);
            targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
        }
        
        // 목표 파워 원호 업데이트
        if (typeof updateTargetPowerArc === 'function') {
            updateTargetPowerArc();
        }
        return;
    }
    
    // 2순위: Firebase status의 segmentTargetType/segmentTargetValue 사용 (Firebase targetPower가 없거나 0일 때)
    // Firebase status에서 세그먼트 정보 가져오기
    let targetType = null;
    let targetValue = null;
    
    if (firebaseStatus && firebaseStatus.segmentTargetType && firebaseStatus.segmentTargetValue !== undefined) {
        targetType = firebaseStatus.segmentTargetType;
        targetValue = firebaseStatus.segmentTargetValue;
        console.log('[updateTargetPower] Firebase status에서 세그먼트 정보 사용:', { targetType, targetValue });
    }
    
    // Firebase status에 세그먼트 정보가 없으면 getCurrentSegment() 사용
    if (!targetType || targetValue === null) {
        const seg = getCurrentSegment();
        if (seg) {
            targetType = seg.target_type || 'ftp_pct';
            targetValue = seg.target_value;
            console.log('[updateTargetPower] getCurrentSegment()에서 세그먼트 정보 사용:', { targetType, targetValue });
        }
    }
    
    // 세그먼트 정보가 없으면 워크아웃 데이터 확인
    if (!targetType || targetValue === null || targetValue === undefined) {
        // 워크아웃 데이터 확인
        if (!window.currentWorkout || !window.currentWorkout.segments || window.currentWorkout.segments.length === 0) {
        // 경고 메시지는 디버깅 모드에서만 출력 (조용히 처리)
        if (window.DEBUG_MODE) {
            console.warn('[updateTargetPower] 워크아웃 데이터가 없습니다.');
        }
        const targetLabelEl = document.getElementById('ui-target-label');
        const targetRpmUnitEl = document.getElementById('ui-target-rpm-unit');
        if (targetLabelEl) {
            targetLabelEl.textContent = 'TARGET';
            targetLabelEl.setAttribute('fill', '#888');
        }
        if (targetRpmUnitEl) {
            targetRpmUnitEl.style.display = 'none';
        }
        targetPowerEl.textContent = '0';
            targetPowerEl.setAttribute('fill', '#ff8c00');
            // 목표 파워 원호 숨김
            if (typeof updateTargetPowerArc === 'function') {
                updateTargetPowerArc();
            }
            return;
        }
        
        // 워크아웃 데이터가 있어도 세그먼트 정보가 없으면 기본값 사용
        const targetLabelEl = document.getElementById('ui-target-label');
        const targetRpmUnitEl = document.getElementById('ui-target-rpm-unit');
        if (targetLabelEl) {
            targetLabelEl.textContent = 'TARGET';
            targetLabelEl.setAttribute('fill', '#888');
        }
        if (targetRpmUnitEl) {
            targetRpmUnitEl.style.display = 'none';
        }
        targetPowerEl.textContent = '0';
        targetPowerEl.setAttribute('fill', '#ff8c00');
        // 목표 파워 원호 숨김
        if (typeof updateTargetPowerArc === 'function') {
            updateTargetPowerArc();
        }
        return;
    }
    
    // FTP 값 사용 (Firebase에서 가져온 사용자 FTP 값)
    const ftp = userFTP;
    
    // 세그먼트 목표 파워 계산
    let targetPower = 0;
    
    // target_type에 따라 계산 (Firebase status 또는 getCurrentSegment()에서 가져온 값 사용)
    
    console.log('[updateTargetPower] 세그먼트 데이터로 계산 (Firebase targetPower 없음)');
    console.log('[updateTargetPower] 세그먼트 인덱스:', currentSegmentIndex);
    console.log('[updateTargetPower] target_type:', targetType, 'target_value:', targetValue, '타입:', typeof targetValue);
    console.log('[updateTargetPower] 사용자 FTP 값:', ftp);
    
    if (targetType === 'ftp_pct') {
        const ftpPercent = Number(targetValue) || 100;
        targetPower = Math.round(ftp * (ftpPercent / 100));
        console.log('[updateTargetPower] ftp_pct 계산: FTP', ftp, '*', ftpPercent, '% =', targetPower);
    } else if (targetType === 'dual') {
        // dual 타입: "100/120" 형식 파싱
        if (typeof targetValue === 'string' && targetValue.includes('/')) {
            const parts = targetValue.split('/').map(s => s.trim());
            if (parts.length >= 1) {
                const ftpPercent = Number(parts[0]) || 100;
                targetPower = Math.round(ftp * (ftpPercent / 100));
            }
        } else if (Array.isArray(targetValue) && targetValue.length > 0) {
            const ftpPercent = Number(targetValue[0]) || 100;
            targetPower = Math.round(ftp * (ftpPercent / 100));
        } else {
            // 숫자로 저장된 경우 처리
            const numValue = Number(targetValue);
            if (numValue > 1000 && numValue < 1000000) {
                const str = String(numValue);
                if (str.length >= 4) {
                    const ftpPart = str.slice(0, -3);
                    const ftpPercent = Number(ftpPart) || 100;
                    targetPower = Math.round(ftp * (ftpPercent / 100));
                }
            } else {
                const ftpPercent = numValue <= 1000 ? numValue : 100;
                targetPower = Math.round(ftp * (ftpPercent / 100));
            }
        }
    } else if (targetType === 'cadence_rpm') {
        // RPM만 있는 경우 파워는 0
        targetPower = 0;
    } else if (targetType === 'ftp_pctz') {
        // ftp_pctz 타입: "56/75" 형식 (하한, 상한)
        let minPercent = 60;
        let maxPercent = 75;
        
        if (typeof targetValue === 'string' && targetValue.includes('/')) {
            const parts = targetValue.split('/').map(s => s.trim());
            if (parts.length >= 2) {
                minPercent = Number(parts[0]) || 60;
                maxPercent = Number(parts[1]) || 75;
            } else {
                minPercent = Number(parts[0]) || 60;
                maxPercent = 75;
            }
        } else if (typeof targetValue === 'string' && targetValue.includes(',')) {
            // 기존 형식(쉼표)도 지원 (하위 호환성)
            const parts = targetValue.split(',').map(s => s.trim());
            if (parts.length >= 2) {
                minPercent = Number(parts[0]) || 60;
                maxPercent = Number(parts[1]) || 75;
            } else {
                minPercent = Number(parts[0]) || 60;
                maxPercent = 75;
            }
        } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
            minPercent = Number(targetValue[0]) || 60;
            maxPercent = Number(targetValue[1]) || 75;
        }
        
        // 하한값을 목표 파워값으로 사용
        targetPower = Math.round(ftp * (minPercent / 100));
        console.log('[updateTargetPower] ftp_pctz 계산: FTP', ftp, '* 하한', minPercent, '% =', targetPower, 'W (상한:', maxPercent, '%)');
        
        // 상한값을 전역 변수에 저장 (updateTargetPowerArc에서 사용)
        const baseMaxPower = Math.round(ftp * (maxPercent / 100));
        // 강도 조절 비율 적용 (나중에 adjustedTargetPower와 함께 적용)
        window.currentSegmentMaxPower = baseMaxPower; // 일단 기본값 저장, 나중에 강도 조절 적용
        window.currentSegmentMinPower = targetPower; // 일단 기본값 저장, 나중에 강도 조절 적용
    } else {
        window.currentSegmentMaxPower = null;
        window.currentSegmentMinPower = null;
    }
    
    // 강도 조절 비율 적용 (개인 훈련 대시보드 슬라이드 바)
    const adjustedTargetPower = Math.round(targetPower * individualIntensityAdjustment);
    
    // ftp_pctz 타입인 경우 상한값에도 강도 조절 비율 적용
    if (targetType === 'ftp_pctz' && window.currentSegmentMaxPower) {
        window.currentSegmentMaxPower = Math.round(window.currentSegmentMaxPower * individualIntensityAdjustment);
        window.currentSegmentMinPower = adjustedTargetPower; // adjustedTargetPower는 이미 강도 조절이 적용된 값
    }
    
    console.log('[updateTargetPower] 최종 계산된 목표 파워:', targetPower, 'W');
    console.log('[updateTargetPower] 강도 조절 적용:', individualIntensityAdjustment, '→ 조절된 목표 파워:', adjustedTargetPower, 'W');
    console.log('[updateTargetPower] 계산 상세: FTP =', ftp, ', target_type =', targetType, ', target_value =', targetValue);
    
    // TARGET 라벨 업데이트 로직
    const targetLabelEl = document.getElementById('ui-target-label');
    const targetRpmUnitEl = document.getElementById('ui-target-rpm-unit');
    
    if (targetType === 'dual') {
        // dual 타입: TARGET 라벨에 RPM 값과 단위를 1줄에 표시, 숫자는 빨강색, 단위는 그레이
        let targetRpm = 0;
        if (typeof targetValue === 'string' && targetValue.includes('/')) {
            const parts = targetValue.split('/').map(s => s.trim());
            targetRpm = Number(parts[1]) || 0;
        } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
            targetRpm = Number(targetValue[1]) || 0;
        }
        
        if (targetRpm > 0 && targetLabelEl) {
            // 기존 내용 삭제
            targetLabelEl.textContent = '';
            targetLabelEl.setAttribute('fill', '#ef4444'); // 기본 색상 빨강색
            targetLabelEl.setAttribute('font-size', '10'); // 속도계 눈금 폰트 크기와 동일
            targetLabelEl.setAttribute('y', '90'); // 위치 동일하게 유지
            
            // 숫자는 빨강색, RPM 단위는 그레이로 1줄에 표시
            const rpmNumber = Math.round(targetRpm);
            const tspanNumber = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            tspanNumber.setAttribute('fill', '#ef4444'); // 빨강색
            tspanNumber.textContent = rpmNumber.toString();
            targetLabelEl.appendChild(tspanNumber);
            
            const tspanUnit = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            tspanUnit.setAttribute('fill', '#888'); // 그레이
            tspanUnit.textContent = ' RPM';
            targetLabelEl.appendChild(tspanUnit);
            
            // RPM 단위 요소는 숨김 처리
            if (targetRpmUnitEl) {
                targetRpmUnitEl.style.display = 'none';
            }
        } else if (targetLabelEl) {
            targetLabelEl.textContent = 'TARGET';
            targetLabelEl.setAttribute('fill', '#888'); // 원래 색상
            targetLabelEl.setAttribute('font-size', '6'); // 원래 폰트 크기로 복원
            if (targetRpmUnitEl) {
                targetRpmUnitEl.style.display = 'none';
            }
        }
        
        // targetPowerEl은 파워 값 표시 (dual이므로 파워도 있음)
        targetPowerEl.textContent = adjustedTargetPower > 0 ? String(adjustedTargetPower) : '0';
        targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
    } else if (targetType === 'cadence_rpm') {
        // cadence_rpm 타입: 목표 파워값 자리에 RPM 값 표시, 색상 #ef4444 (빨강색), TARGET 라벨을 'CADENCE'로 변경
        const targetRpm = Number(targetValue) || 0;
        
        if (targetRpm > 0) {
            // TARGET 라벨을 CADENCE로 변경
            if (targetLabelEl) {
                targetLabelEl.textContent = 'CADENCE';
                targetLabelEl.setAttribute('fill', '#888'); // 원래 색상
            }
            // RPM 단위 숨김
            if (targetRpmUnitEl) {
                targetRpmUnitEl.style.display = 'none';
            }
            // 목표 파워값 자리에 RPM 값 표시
            targetPowerEl.textContent = Math.round(targetRpm).toString();
            targetPowerEl.setAttribute('fill', '#ef4444'); // 빨강색
        } else {
            if (targetLabelEl) {
                targetLabelEl.textContent = 'TARGET';
                targetLabelEl.setAttribute('fill', '#888');
            }
            if (targetRpmUnitEl) {
                targetRpmUnitEl.style.display = 'none';
            }
            targetPowerEl.textContent = '0';
            targetPowerEl.setAttribute('fill', '#ff8c00');
        }
    } else if (targetType === 'ftp_pctz') {
        // ftp_pctz 타입: TARGET 라벨 표시, 목표 파워값(주황색) - 하한값 표시
        if (targetLabelEl) {
            targetLabelEl.textContent = 'TARGET';
            targetLabelEl.setAttribute('fill', '#888'); // 원래 색상
        }
        if (targetRpmUnitEl) {
            targetRpmUnitEl.style.display = 'none';
        }
        targetPowerEl.textContent = adjustedTargetPower > 0 ? String(adjustedTargetPower) : '0';
        targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
    } else {
        // ftp_pct 타입: TARGET 라벨 표시, 목표 파워값(주황색) 원래 색상으로 되돌림
        if (targetLabelEl) {
            targetLabelEl.textContent = 'TARGET';
            targetLabelEl.setAttribute('fill', '#888'); // 원래 색상
        }
        if (targetRpmUnitEl) {
            targetRpmUnitEl.style.display = 'none';
        }
        targetPowerEl.textContent = adjustedTargetPower > 0 ? String(adjustedTargetPower) : '0';
        targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
    }
    
    // 목표 파워 원호 업데이트 (애니메이션 루프에서도 호출되지만 여기서도 즉시 업데이트)
    if (typeof updateTargetPowerArc === 'function') {
        updateTargetPowerArc();
    }
}

/**
 * 세그먼트 변경 시 속도계 목표값 업데이트 (Bluetooth 개인훈련 대시보드 전용)
 * 인도어 대시보드의 applySegmentTarget 로직을 참고하여 독립적으로 구현
 * 다른 화면과 독립적으로 작동
 * @param {number} segmentIndex - 현재 세그먼트 인덱스
 */
function updateSpeedometerTargetForSegment(segmentIndex) {
    // Bluetooth 개인훈련 대시보드 화면인지 확인 (독립적 구동 보장)
    const isBluetoothIndividualScreen = window.location.pathname.includes('bluetoothIndividual.html');
    if (!isBluetoothIndividualScreen) {
        return; // 다른 화면에서는 실행하지 않음
    }
    
    try {
        // Firebase status에서 세그먼트 정보 우선 확인
        const status = firebaseStatus || {};
        let targetType = 'ftp_pct';
        let targetValue = null;
        
        // 1순위: Firebase status에서 받은 값 사용
        if (status.segmentTargetType && status.segmentTargetValue !== undefined) {
            targetType = status.segmentTargetType;
            targetValue = status.segmentTargetValue;
            console.log('[updateSpeedometerTargetForSegment] Firebase status 값 사용 - 타입:', targetType, '값:', targetValue);
        } 
        // 2순위: window.currentWorkout에서 가져온 값 사용
        else {
            const workout = window.currentWorkout;
            if (!workout || !workout.segments || workout.segments.length === 0) {
                console.warn('[updateSpeedometerTargetForSegment] 워크아웃 또는 세그먼트가 없습니다.');
                return;
            }
            
            // 세그먼트 인덱스 유효성 확인
            if (segmentIndex < 0 || segmentIndex >= workout.segments.length) {
                console.warn('[updateSpeedometerTargetForSegment] 유효하지 않은 세그먼트 인덱스:', segmentIndex);
                return;
            }
            
            const seg = workout.segments[segmentIndex];
            if (!seg) {
                console.warn('[updateSpeedometerTargetForSegment] 세그먼트 데이터가 없습니다. 인덱스:', segmentIndex);
                return;
            }
            
            targetType = seg.target_type || 'ftp_pct';
            targetValue = seg.target_value;
            console.log('[updateSpeedometerTargetForSegment] window.currentWorkout 값 사용 - 타입:', targetType, '값:', targetValue);
        }
        
        // targetValue가 null이면 기본값 사용
        if (targetValue === null || targetValue === undefined) {
            console.warn('[updateSpeedometerTargetForSegment] targetValue가 없습니다. 기본값 사용');
            targetValue = targetType === 'cadence_rpm' ? 90 : 100;
        }
        
        const ftp = userFTP || window.currentUser?.ftp || 200;
        
        // 속도계 UI 요소 가져오기
        const targetLabelEl = document.getElementById('ui-target-label');
        const targetPowerEl = document.getElementById('ui-target-power');
        const targetRpmUnitEl = document.getElementById('ui-target-rpm-unit');
        
        if (!targetPowerEl) {
            console.warn('[updateSpeedometerTargetForSegment] ui-target-power 요소를 찾을 수 없습니다.');
            return;
        }
        
        // 강도 조절 비율 적용
        const intensityAdjustment = individualIntensityAdjustment || 1.0;
        
        // 세그먼트 타입에 따라 목표값 계산 및 표시
        if (targetType === 'cadence_rpm') {
            // cadence_rpm 타입: 목표 파워값 자리에 RPM 값 표시
            const targetRpm = Number(targetValue) || 0;
            
            if (targetLabelEl) {
                targetLabelEl.textContent = 'CADENCE';
                targetLabelEl.setAttribute('fill', '#888');
            }
            if (targetRpmUnitEl) {
                targetRpmUnitEl.style.display = 'none';
            }
            targetPowerEl.textContent = targetRpm > 0 ? String(Math.round(targetRpm)) : '0';
            targetPowerEl.setAttribute('fill', '#ef4444'); // 빨강색
            
            console.log('[updateSpeedometerTargetForSegment] cadence_rpm 타입 - RPM:', targetRpm);
            
        } else if (targetType === 'dual') {
            // dual 타입: FTP%와 RPM 모두 표시
            let ftpPercent = 100;
            let targetRpm = 0;
            
            // target_value 파싱
            if (typeof targetValue === 'string' && targetValue.includes('/')) {
                const parts = targetValue.split('/').map(s => s.trim());
                if (parts.length >= 2) {
                    ftpPercent = Number(parts[0]) || 100;
                    targetRpm = Number(parts[1]) || 0;
                } else if (parts.length === 1) {
                    ftpPercent = Number(parts[0]) || 100;
                }
            } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
                ftpPercent = Number(targetValue[0]) || 100;
                targetRpm = Number(targetValue[1]) || 0;
            }
            
            // 목표 파워 계산
            const baseTargetPower = Math.round(ftp * (ftpPercent / 100));
            const adjustedTargetPower = Math.round(baseTargetPower * intensityAdjustment);
            
            // TARGET 라벨에 RPM 표시
            if (targetRpm > 0 && targetLabelEl) {
                targetLabelEl.textContent = '';
                targetLabelEl.setAttribute('fill', '#ef4444');
                targetLabelEl.setAttribute('font-size', '10');
                targetLabelEl.setAttribute('y', '90');
                
                // 기존 tspan 제거
                while (targetLabelEl.firstChild) {
                    targetLabelEl.removeChild(targetLabelEl.firstChild);
                }
                
                // RPM 숫자와 단위 추가
                const tspanNumber = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                tspanNumber.setAttribute('fill', '#ef4444');
                tspanNumber.textContent = String(Math.round(targetRpm));
                targetLabelEl.appendChild(tspanNumber);
                
                const tspanUnit = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                tspanUnit.setAttribute('fill', '#888');
                tspanUnit.textContent = ' RPM';
                targetLabelEl.appendChild(tspanUnit);
            } else {
                if (targetLabelEl) {
                    targetLabelEl.textContent = 'TARGET';
                    targetLabelEl.setAttribute('fill', '#888');
                    targetLabelEl.setAttribute('font-size', '6');
                }
            }
            
            if (targetRpmUnitEl) {
                targetRpmUnitEl.style.display = 'none';
            }
            
            targetPowerEl.textContent = String(adjustedTargetPower);
            targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
            
            console.log('[updateSpeedometerTargetForSegment] dual 타입 - FTP%:', ftpPercent, 'RPM:', targetRpm, 'Power:', adjustedTargetPower);
            
        } else if (targetType === 'ftp_pctz') {
            // ftp_pctz 타입: 하한/상한 범위
            let minPercent = 60;
            let maxPercent = 75;
            
            // target_value 파싱
            if (typeof targetValue === 'string' && targetValue.includes('/')) {
                const parts = targetValue.split('/').map(s => s.trim());
                if (parts.length >= 2) {
                    minPercent = Number(parts[0]) || 60;
                    maxPercent = Number(parts[1]) || 75;
                } else if (parts.length === 1) {
                    minPercent = Number(parts[0]) || 60;
                }
            } else if (typeof targetValue === 'string' && targetValue.includes(',')) {
                const parts = targetValue.split(',').map(s => s.trim());
                if (parts.length >= 2) {
                    minPercent = Number(parts[0]) || 60;
                    maxPercent = Number(parts[1]) || 75;
                }
            } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
                minPercent = Number(targetValue[0]) || 60;
                maxPercent = Number(targetValue[1]) || 75;
            }
            
            // 하한값을 목표 파워로 사용
            const baseTargetPower = Math.round(ftp * (minPercent / 100));
            const adjustedTargetPower = Math.round(baseTargetPower * intensityAdjustment);
            
            // 상한값 저장 (원호 표시용)
            const baseMaxPower = Math.round(ftp * (maxPercent / 100));
            window.currentSegmentMaxPower = Math.round(baseMaxPower * intensityAdjustment);
            window.currentSegmentMinPower = adjustedTargetPower;
            
            if (targetLabelEl) {
                targetLabelEl.textContent = 'TARGET';
                targetLabelEl.setAttribute('fill', '#888');
            }
            if (targetRpmUnitEl) {
                targetRpmUnitEl.style.display = 'none';
            }
            
            targetPowerEl.textContent = String(adjustedTargetPower);
            targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
            
            console.log('[updateSpeedometerTargetForSegment] ftp_pctz 타입 - 하한:', minPercent, '상한:', maxPercent, 'Power:', adjustedTargetPower);
            
        } else {
            // ftp_pct 타입 (기본)
            const ftpPercent = Number(targetValue) || 100;
            const baseTargetPower = Math.round(ftp * (ftpPercent / 100));
            const adjustedTargetPower = Math.round(baseTargetPower * intensityAdjustment);
            
            if (targetLabelEl) {
                targetLabelEl.textContent = 'TARGET';
                targetLabelEl.setAttribute('fill', '#888');
            }
            if (targetRpmUnitEl) {
                targetRpmUnitEl.style.display = 'none';
            }
            
            targetPowerEl.textContent = String(adjustedTargetPower);
            targetPowerEl.setAttribute('fill', '#ff8c00'); // 주황색
            
            console.log('[updateSpeedometerTargetForSegment] ftp_pct 타입 - FTP%:', ftpPercent, 'Power:', adjustedTargetPower);
        }
        
        // 목표 파워 원호 업데이트
        if (typeof updateTargetPowerArc === 'function') {
            updateTargetPowerArc();
        }
        
    } catch (error) {
        console.error('[updateSpeedometerTargetForSegment] 오류:', error);
    }
}

/**
 * 속도계 하단 세그먼트 정보 업데이트 (Bluetooth 개인훈련 대시보드 전용)
 * 현재 파워값 하단에 현재 진행 세그먼트 정보를 표시
 * 인도어 대시보드의 applySegmentTarget 로직을 참고하여 독립적으로 구현
 * 다른 화면과 독립적으로 작동
 */
function updateSpeedometerSegmentInfo() {
    // Bluetooth 개인훈련 대시보드 화면인지 확인 (독립적 구동 보장)
    const isBluetoothIndividualScreen = window.location.pathname.includes('bluetoothIndividual.html');
    if (!isBluetoothIndividualScreen) {
        return; // 다른 화면에서는 실행하지 않음
    }
    
    const segmentInfoEl = document.getElementById('segment-info');
    if (!segmentInfoEl) {
        console.warn('[updateSpeedometerSegmentInfo] segment-info 요소를 찾을 수 없습니다.');
        return;
    }
    
    try {
        // 현재 상태 확인
        const status = firebaseStatus || { state: 'idle' };
        const currentState = status.state || 'idle';
        
        // 훈련이 실행 중이 아니면 기본 메시지 표시
        if (currentState !== 'running') {
            if (currentState === 'paused') {
                segmentInfoEl.textContent = '일시정지';
            } else {
                segmentInfoEl.textContent = '대기 중';
            }
            segmentInfoEl.setAttribute('fill', '#fff'); // 흰색
            return;
        }
        
        // 현재 세그먼트 정보 가져오기
        const currentSeg = getCurrentSegment();
        if (!currentSeg) {
            // 세그먼트 정보가 없으면 Firebase status에서 받은 정보로 표시
            if (status.segmentTargetType && status.segmentTargetValue !== undefined) {
                const segmentText = formatSegmentInfo(status.segmentTargetType, status.segmentTargetValue);
                segmentInfoEl.textContent = segmentText;
                segmentInfoEl.setAttribute('fill', '#fff'); // 흰색
            } else {
                segmentInfoEl.textContent = '준비 중';
                segmentInfoEl.setAttribute('fill', '#fff'); // 흰색
            }
            return;
        }
        
        // 세그먼트 타입과 값 가져오기 (인도어 대시보드 로직 참고)
        const targetType = status.segmentTargetType || currentSeg.target_type || 'ftp_pct';
        const targetValue = status.segmentTargetValue !== undefined ? status.segmentTargetValue : currentSeg.target_value;
        
        // 세그먼트 이름 가져오기 (인도어 대시보드와 동일한 방식)
        const segmentName = currentSeg.label || currentSeg.name || currentSeg.segment_type || `세그먼트 ${currentSegmentIndex + 1}`;
        
        // target_type에 따라 세그먼트 정보 텍스트 구성 (인도어 대시보드 로직 참고)
        let segmentText = '';
        
        if (targetType === 'cadence_rpm') {
            // cadence_rpm 타입: "세그먼트 이름 - RPM 값"
            const targetRpm = Number(targetValue) || 0;
            segmentText = `${segmentName} - RPM ${targetRpm}`;
        } else if (targetType === 'dual') {
            // dual 타입: "세그먼트 이름 - FTP 값% / RPM 값"
            let ftpPercent = 100;
            let targetRpm = 0;
            
            // target_value 파싱 (인도어 대시보드 로직 참고)
            if (typeof targetValue === 'string' && targetValue.includes('/')) {
                const parts = targetValue.split('/').map(s => s.trim());
                if (parts.length >= 2) {
                    ftpPercent = Number(parts[0]) || 100;
                    targetRpm = Number(parts[1]) || 0;
                } else if (parts.length === 1) {
                    ftpPercent = Number(parts[0]) || 100;
                }
            } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
                ftpPercent = Number(targetValue[0]) || 100;
                targetRpm = Number(targetValue[1]) || 0;
            }
            
            segmentText = `${segmentName} - FTP ${ftpPercent}% / RPM ${targetRpm || 0}`;
        } else {
            // ftp_pct 또는 ftp_pctz 타입: "세그먼트 이름 - FTP 값%"
            const ftpPercent = Number(targetValue) || 100;
            segmentText = `${segmentName} - FTP ${ftpPercent}%`;
        }
        
        // 표시
        segmentInfoEl.textContent = segmentText;
        segmentInfoEl.setAttribute('fill', '#fff'); // 흰색
        
        console.log('[updateSpeedometerSegmentInfo] 세그먼트 정보 업데이트:', segmentText, '타입:', targetType, '값:', targetValue);
        
    } catch (error) {
        console.error('[updateSpeedometerSegmentInfo] 오류:', error);
        const segmentInfoEl = document.getElementById('segment-info');
        if (segmentInfoEl) {
            segmentInfoEl.textContent = '준비 중';
            segmentInfoEl.setAttribute('fill', '#fff'); // 흰색
        }
    }
}

/**
 * 마지막 세그먼트인지 확인 (Bluetooth 개인훈련 대시보드 전용)
 * @param {Object} status - Firebase status 객체
 * @returns {boolean} 마지막 세그먼트이면 true
 */
function checkIsLastSegment(status) {
    // 워크아웃이 없으면 false
    if (!window.currentWorkout || !window.currentWorkout.segments || window.currentWorkout.segments.length === 0) {
        return false;
    }
    
    const totalSegments = window.currentWorkout.segments.length;
    const lastSegmentIndex = totalSegments > 0 ? totalSegments - 1 : -1;
    
    // 현재 세그먼트 인덱스 확인
    const currentSegIdx = status.segmentIndex !== undefined ? status.segmentIndex : currentSegmentIndex;
    
    // 현재 세그먼트가 마지막 세그먼트인지 확인
    return currentSegIdx === lastSegmentIndex && currentSegIdx >= 0;
}

/**
 * 모든 세그먼트 완료 여부 확인 (Bluetooth 개인훈련 대시보드 전용)
 * @param {Object} status - Firebase status 객체
 * @param {string} currentState - 현재 훈련 상태
 * @param {number} currentSegmentIndex - 현재 세그먼트 인덱스
 * @returns {boolean} 모든 세그먼트가 완료되었으면 true
 */
function checkAllSegmentsComplete(status, currentState, currentSegmentIndex) {
    // 훈련이 실행 중이 아니면 완료로 간주하지 않음
    if (currentState !== 'running' && currentState !== 'finished') {
        return false;
    }
    
    // Firebase 상태가 'finished'이면 완료
    if (currentState === 'finished' || status.state === 'finished') {
        return true;
    }
    
    // 워크아웃이 없으면 완료로 간주하지 않음
    if (!window.currentWorkout || !window.currentWorkout.segments || window.currentWorkout.segments.length === 0) {
        return false;
    }
    
    const totalSegments = window.currentWorkout.segments.length;
    const lastSegmentIndex = totalSegments > 0 ? totalSegments - 1 : -1;
    
    // 현재 세그먼트 인덱스가 마지막 세그먼트를 넘었으면 완료
    if (currentSegmentIndex > lastSegmentIndex) {
        return true;
    }
    
    // 마지막 세그먼트이고 남은 시간이 0 이하인 경우 완료
    if (currentSegmentIndex === lastSegmentIndex) {
        // segmentRemainingSec 확인
        if (status.segmentRemainingSec !== undefined && status.segmentRemainingSec !== null && status.segmentRemainingSec <= 0) {
            return true;
        }
        // segmentRemainingTime 확인
        if (status.segmentRemainingTime !== undefined && status.segmentRemainingTime !== null && status.segmentRemainingTime <= 0) {
            return true;
        }
        // 로컬 시간으로 계산
        if (bluetoothIndividualSegmentStartTime) {
            const currentSegment = window.currentWorkout.segments[currentSegmentIndex];
            if (currentSegment) {
                const segDuration = currentSegment.duration_sec || currentSegment.duration || 0;
                const now = Date.now();
                const elapsed = Math.floor((now - bluetoothIndividualSegmentStartTime) / 1000);
                if (elapsed >= segDuration) {
                    return true;
                }
            }
        }
    }
    
    return false;
}

/**
 * 세그먼트 목표값을 표시 형식으로 변환 (Bluetooth 개인훈련 대시보드 전용)
 * 인도어 대시보드의 applySegmentTarget 로직을 참고하여 독립적으로 구현
 * @param {string} targetType - 세그먼트 타입 (ftp_pct, dual, cadence_rpm, ftp_pctz)
 * @param {any} targetValue - 세그먼트 목표값
 * @returns {string} 표시할 텍스트
 */
function formatSegmentInfo(targetType, targetValue) {
    if (!targetType || targetValue === undefined || targetValue === null) {
        return '준비 중';
    }
    
    // target_type에 따라 표시 형식 결정
    if (targetType === 'ftp_pct') {
        // FTP 퍼센트: "FTP 60%"
        const percent = Number(targetValue) || 100;
        return `FTP ${percent}%`;
    } else if (targetType === 'dual') {
        // Dual 타입: "FTP 값% / RPM 값" 형식
        let ftpPercent = 100;
        let targetRpm = 0;
        
        // target_value 파싱 (인도어 대시보드 로직 참고)
        if (typeof targetValue === 'string' && targetValue.includes('/')) {
            const parts = targetValue.split('/').map(s => s.trim());
            if (parts.length >= 2) {
                ftpPercent = Number(parts[0]) || 100;
                targetRpm = Number(parts[1]) || 0;
            } else if (parts.length === 1) {
                ftpPercent = Number(parts[0]) || 100;
            }
        } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
            ftpPercent = Number(targetValue[0]) || 100;
            targetRpm = Number(targetValue[1]) || 0;
        } else if (typeof targetValue === 'number') {
            // 숫자로 저장된 경우 처리
            const numValue = targetValue;
            if (numValue > 1000 && numValue < 1000000) {
                const str = String(numValue);
                if (str.length >= 4) {
                    const ftpPart = str.slice(0, -3);
                    const rpmPart = str.slice(-3);
                    ftpPercent = Number(ftpPart) || 100;
                    targetRpm = Number(rpmPart) || 0;
                }
            } else {
                ftpPercent = numValue <= 1000 ? numValue : 100;
            }
        }
        
        return `FTP ${ftpPercent}% / RPM ${targetRpm || 0}`;
    } else if (targetType === 'cadence_rpm') {
        // RPM: "RPM 90"
        const rpm = Number(targetValue) || 0;
        return `RPM ${rpm}`;
    } else if (targetType === 'ftp_pctz') {
        // FTP 퍼센트 존: "FTP 60-75%" 형식
        let minPercent = 60;
        let maxPercent = 75;
        
        if (typeof targetValue === 'string' && targetValue.includes('/')) {
            const parts = targetValue.split('/').map(s => s.trim());
            if (parts.length >= 2) {
                minPercent = Number(parts[0]) || 60;
                maxPercent = Number(parts[1]) || 75;
            }
        } else if (typeof targetValue === 'string' && targetValue.includes(',')) {
            const parts = targetValue.split(',').map(s => s.trim());
            if (parts.length >= 2) {
                minPercent = Number(parts[0]) || 60;
                maxPercent = Number(parts[1]) || 75;
            }
        } else if (Array.isArray(targetValue) && targetValue.length >= 2) {
            minPercent = Number(targetValue[0]) || 60;
            maxPercent = Number(targetValue[1]) || 75;
        }
        
        return `FTP ${minPercent}-${maxPercent}%`;
    } else {
        // 알 수 없는 타입: 기본값 표시
        const segIdx = (currentSegmentIndex >= 0 ? currentSegmentIndex + 1 : 1);
        return `Segment ${segIdx}`;
    }
}

/**
 * 현재 진행 중인 세그먼트 정보 가져오기
 * @returns {Object|null} 현재 세그먼트 객체 또는 null
 */
function getCurrentSegment() {
    // 세그먼트 인덱스 확인
    // currentSegmentIndex가 -1인 것은 훈련이 시작되지 않았을 때 정상 상태이므로 조용히 처리
    if (currentSegmentIndex < 0) {
        // 디버그 모드에서만 로그 출력 (훈련 시작 전에는 정상적인 상태)
        if (window.DEBUG_MODE) {
            console.log('[getCurrentSegment] 현재 세그먼트 인덱스가 유효하지 않음 (훈련 시작 전):', currentSegmentIndex);
        }
        return null;
    }
    
    // 워크아웃 데이터 확인
    if (!window.currentWorkout || !window.currentWorkout.segments || window.currentWorkout.segments.length === 0) {
        console.log('[getCurrentSegment] 워크아웃 데이터가 없음');
        return null;
    }
    
    // 세그먼트 인덱스 범위 확인
    if (currentSegmentIndex >= window.currentWorkout.segments.length) {
        console.warn('[getCurrentSegment] 세그먼트 인덱스가 범위를 벗어남:', currentSegmentIndex, '세그먼트 개수:', window.currentWorkout.segments.length);
        return null;
    }
    
    const segment = window.currentWorkout.segments[currentSegmentIndex];
    if (!segment) {
        console.warn('[getCurrentSegment] 세그먼트 데이터가 없음. 인덱스:', currentSegmentIndex);
        return null;
    }
    
    return segment;
}

/**
 * 현재 세그먼트 정보를 로그로 출력 (디버깅용)
 */
function logCurrentSegmentInfo() {
    const segment = getCurrentSegment();
    if (segment) {
        console.log('[현재 세그먼트 정보]', {
            index: currentSegmentIndex,
            target_type: segment.target_type,
            target_value: segment.target_value,
            duration_sec: segment.duration_sec || segment.duration,
            segment_type: segment.segment_type,
            name: segment.name
        });
    } else {
        console.log('[현재 세그먼트 정보] 세그먼트를 찾을 수 없음');
    }
}

// 세그먼트 그래프 업데이트 함수
let mascotAnimationInterval = null; // 마스코트 애니메이션 인터벌

function updateSegmentGraph(segments, currentSegmentIndex = -1) {
    if (!segments || segments.length === 0) return;
    
    // workoutManager.js의 drawSegmentGraph 함수 사용
    if (typeof drawSegmentGraph === 'function') {
        // 컨테이너 크기가 확정된 후 그래프 그리기
        const drawGraph = () => {
            const canvas = document.getElementById('individualSegmentGraph');
            if (!canvas) {
                console.warn('[updateSegmentGraph] Canvas 요소를 찾을 수 없습니다.');
                return;
            }
            
            const container = canvas.parentElement;
            if (!container) {
                console.warn('[updateSegmentGraph] 컨테이너 요소를 찾을 수 없습니다.');
                return;
            }
            
            // 컨테이너가 실제 높이를 가지도록 대기
            if (container.clientHeight === 0) {
                // 컨테이너가 아직 준비되지 않았으면 다시 시도
                setTimeout(drawGraph, 50);
                return;
            }
            
            // 그래프 그리기 (경과시간 전달)
            const elapsedTime = window.lastElapsedTime || 0;
            drawSegmentGraph(segments, currentSegmentIndex, 'individualSegmentGraph', elapsedTime);
        };
        
        // DOM이 준비될 때까지 대기 후 그리기
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(drawGraph, 150);
            });
        } else {
            // DOM이 이미 로드되었으면 바로 실행 (약간의 지연으로 레이아웃 안정화)
            setTimeout(drawGraph, 150);
        }
        
        // 마스코트 펄스 애니메이션을 위한 주기적 그래프 재그리기 (훈련 중일 때만)
        if (window.currentTrainingState === 'running') {
            // 기존 인터벌이 있으면 제거
            if (mascotAnimationInterval) {
                clearInterval(mascotAnimationInterval);
            }
            
            // 100ms마다 그래프를 다시 그려서 펄스 애니메이션 효과
            mascotAnimationInterval = setInterval(() => {
                if (window.currentWorkout && window.currentWorkout.segments && window.currentTrainingState === 'running') {
                    const elapsedTime = window.lastElapsedTime || 0;
                    drawSegmentGraph(window.currentWorkout.segments, currentSegmentIndex, 'individualSegmentGraph', elapsedTime);
                } else {
                    // 훈련이 종료되면 애니메이션 중지
                    if (mascotAnimationInterval) {
                        clearInterval(mascotAnimationInterval);
                        mascotAnimationInterval = null;
                    }
                }
            }, 100);
        } else {
            // 훈련이 실행 중이 아니면 애니메이션 중지
            if (mascotAnimationInterval) {
                clearInterval(mascotAnimationInterval);
                mascotAnimationInterval = null;
            }
        }
    } else {
        console.warn('[Bluetooth 개인 훈련] drawSegmentGraph 함수를 찾을 수 없습니다.');
    }
}

// 속도계 눈금 생성 함수 (Indoor Training 스타일)
function generateGaugeTicks() {
    const centerX = 100;
    const centerY = 140;
    const radius = 80;
    const innerRadius = radius - 10; // 눈금 안쪽 시작점
    
    let ticksHTML = '';
    
    // 주눈금: 0, 1, 2, 3, 4, 5, 6 (총 7개)
    // 각도: 180도(왼쪽 상단, 0)에서 270도(위쪽)를 거쳐 360도(0도, 오른쪽 상단, 6)까지 180도 범위
    // 주눈금 간격: 180도 / 6 = 30도
    
    // 모든 눈금 생성 (주눈금 + 보조눈금)
    for (let i = 0; i <= 24; i++) { // 0~24 (주눈금 7개 + 보조눈금 18개 = 총 25개)
        const isMajor = i % 4 === 0; // 4 간격마다 주눈금 (0, 4, 8, 12, 16, 20, 24)
        
        // 각도 계산: 180도에서 시작하여 270도를 거쳐 360도(0도)까지 (위쪽 반원)
        // i=0 → 180도 (왼쪽 상단), i=12 → 270도 (위쪽), i=24 → 360도(0도) (오른쪽 상단)
        // 180도에서 시작하여 270도를 거쳐 360도(0도)로 가는 경로 (총 180도 범위)
        // 각도가 증가하는 방향: 180 → 270 → 360(0)
        let angle = 180 + (i / 24) * 180; // 180도에서 시작하여 360도까지
        if (angle >= 360) angle = angle % 360; // 360도는 0도로 변환
        const rad = (angle * Math.PI) / 180;
        
        // 눈금 위치 계산
        const x1 = centerX + innerRadius * Math.cos(rad);
        const y1 = centerY + innerRadius * Math.sin(rad);
        
        // 주눈금은 길게, 보조눈금은 짧게
        const tickLength = isMajor ? 14 : 7;
        const x2 = centerX + (innerRadius + tickLength) * Math.cos(rad);
        const y2 = centerY + (innerRadius + tickLength) * Math.sin(rad);
        
        // 흰색 눈금
        ticksHTML += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" 
                            stroke="#ffffff" 
                            stroke-width="${isMajor ? 2.5 : 1.5}"/>`;
    }
    
    return ticksHTML;
}

// 속도계 레이블 생성 함수 (Indoor Training 스타일)
function generateGaugeLabels() {
    const centerX = 100;
    const centerY = 140;
    const radius = 80;
    const labelRadius = radius + 18; // 레이블 위치 (원 바깥쪽)
    
    let labelsHTML = '';
    
    // FTP 배수 정의
    const multipliers = [
        { index: 0, mult: 0, color: '#ffffff' },
        { index: 1, mult: 0.33, color: '#ffffff' },
        { index: 2, mult: 0.67, color: '#ffffff' },
        { index: 3, mult: 1, color: '#ef4444' }, // 빨강색
        { index: 4, mult: 1.33, color: '#ffffff' },
        { index: 5, mult: 1.67, color: '#ffffff' },
        { index: 6, mult: 2, color: '#ffffff' }
    ];
    
    // 주눈금 레이블 생성 (7개)
    multipliers.forEach((item, i) => {
        // 각도 계산: 180도에서 270도를 거쳐 360도(0도)까지 (위쪽 반원)
        // i=0 → 180도 (왼쪽 상단), i=3 → 270도 (위쪽), i=6 → 360도(0도) (오른쪽 상단)
        // 각도가 증가하는 방향: 180 → 270 → 360(0)
        let angle = 180 + (i / 6) * 180; // 180도에서 시작하여 360도까지
        if (angle >= 360) angle = angle % 360; // 360도는 0도로 변환
        const rad = (angle * Math.PI) / 180;
        
        // 레이블 위치 계산
        const x = centerX + labelRadius * Math.cos(rad);
        const y = centerY + labelRadius * Math.sin(rad);
        
        // FTP 값을 곱한 값 계산 (정수만 표기)
        const value = Math.round(userFTP * item.mult);
        
        // 레이블 생성 (정수값만 표기)
        labelsHTML += `<text x="${x}" y="${y}" 
                             text-anchor="middle" 
                             dominant-baseline="middle"
                             fill="${item.color}" 
                             font-size="10" 
                             font-weight="600">${value}</text>`;
    });
    
    return labelsHTML;
}

// 속도계 눈금 및 레이블 업데이트 함수
function updateGaugeTicksAndLabels() {
    const ticksGroup = document.getElementById('gauge-ticks');
    const labelsGroup = document.getElementById('gauge-labels');
    
    if (ticksGroup) {
        ticksGroup.innerHTML = generateGaugeTicks();
    }
    
    if (labelsGroup) {
        labelsGroup.innerHTML = generateGaugeLabels();
    }
}

/**
 * [가민 스타일] 게이지 애니메이션 루프 (60FPS 보간 이동)
 * - 바늘은 매 프레임 부드럽게 이동 (Lerp 적용)
 * - Indoor Training의 바늘 움직임 로직과 동일
 */
function startGaugeAnimationLoop() {
    // 이미 실행 중이면 중복 실행 방지
    if (gaugeAnimationFrameId !== null) return;
    
    const loop = () => {
        // 1. 목표값(currentPowerValue)과 현재표시값(displayPower)의 차이 계산
        const target = currentPowerValue || 0;
        const current = displayPower || 0;
        const diff = target - current;
        
        // 2. 보간(Interpolation) 적용: 거리가 멀면 빠르게, 가까우면 천천히 (감속 효과)
        // 0.15는 반응속도 계수 (높을수록 빠름, 낮을수록 부드러움. 0.1~0.2 추천)
        if (Math.abs(diff) > 0.1) {
            displayPower = current + diff * 0.15;
        } else {
            displayPower = target; // 차이가 미세하면 목표값으로 고정 (떨림 방지)
        }
        
        // 3. 바늘 각도 계산 및 업데이트 (매 프레임 실행)
        // FTP 기반으로 최대 파워 계산 (FTP × 2)
        const maxPower = userFTP * 2;
        let ratio = Math.min(Math.max(displayPower / maxPower, 0), 1);
        
        // -90도(왼쪽 상단) ~ 90도(오른쪽 상단) - 위쪽 반원
        const angle = -90 + (ratio * 180);
        
        const needle = document.getElementById('gauge-needle');
        if (needle) {
            // CSS Transition 간섭 제거하고 직접 제어
            needle.style.transition = 'none';
            needle.setAttribute('transform', `translate(100, 140) rotate(${angle})`);
        }
        
        // 4. 목표 파워 원호 업데이트
        updateTargetPowerArc();
        
        // 다음 프레임 요청
        gaugeAnimationFrameId = requestAnimationFrame(loop);
    };
    
    // 루프 시작
    gaugeAnimationFrameId = requestAnimationFrame(loop);
}

/**
 * 훈련 결과 팝업 표시
 * @param {Object} status - Firebase status 객체 (elapsedTime 포함)
 */
function showTrainingResultModal(status = null) {
    const modal = document.getElementById('trainingResultModal');
    if (!modal) {
        console.warn('[Bluetooth 개인 훈련] 훈련 결과 모달을 찾을 수 없습니다.');
        return;
    }
    
    // 결과값 계산
    const sessionData = window.trainingResults?.getCurrentSessionData?.();
    if (!sessionData) {
        console.warn('[Bluetooth 개인 훈련] 세션 데이터를 찾을 수 없습니다.');
        return;
    }
    
    // 통계 계산
    const stats = window.trainingResults?.calculateSessionStats?.() || {};
    
    // 훈련 시간 계산 - status.elapsedTime 우선 사용 (세그먼트 그래프 상단 시간값)
    let totalSeconds = 0;
    let duration_min = 0;
    
    if (status && status.elapsedTime !== undefined && status.elapsedTime !== null) {
        // Firebase에서 받은 elapsedTime 사용 (가장 정확)
        totalSeconds = Math.max(0, Math.floor(status.elapsedTime));
        duration_min = Math.floor(totalSeconds / 60);
        console.log('[showTrainingResultModal] elapsedTime 사용:', { elapsedTime: status.elapsedTime, totalSeconds, duration_min });
    } else if (window.lastElapsedTime !== undefined && window.lastElapsedTime !== null) {
        // 전역 변수에 저장된 elapsedTime 사용
        totalSeconds = Math.max(0, Math.floor(window.lastElapsedTime));
        duration_min = Math.floor(totalSeconds / 60);
        console.log('[showTrainingResultModal] lastElapsedTime 사용:', { lastElapsedTime: window.lastElapsedTime, totalSeconds, duration_min });
    } else {
        // 대체: startTime과 endTime으로 계산
        const startTime = sessionData.startTime ? new Date(sessionData.startTime) : null;
        const endTime = sessionData.endTime ? new Date(sessionData.endTime) : new Date();
        totalSeconds = startTime ? Math.floor((endTime - startTime) / 1000) : 0;
        duration_min = Math.floor(totalSeconds / 60);
        console.log('[showTrainingResultModal] startTime/endTime 사용:', { startTime, endTime, totalSeconds, duration_min });
    }
    
    // TSS 및 NP 계산 (resultManager.js와 동일한 로직)
    let tss = 0;
    let np = 0;
    
    // trainingMetrics가 있으면 사용 (가장 정확)
    if (window.trainingMetrics && window.trainingMetrics.elapsedSec > 0) {
        const elapsedSec = window.trainingMetrics.elapsedSec;
        const np4sum = window.trainingMetrics.np4sum || 0;
        const count = window.trainingMetrics.count || 1;
        
        if (count > 0 && np4sum > 0) {
            np = Math.pow(np4sum / count, 0.25);
            const userFtp = window.currentUser?.ftp || userFTP || 200;
            const IF = userFtp > 0 ? (np / userFtp) : 0;
            tss = (elapsedSec / 3600) * (IF * IF) * 100;
            console.log('[showTrainingResultModal] TSS 계산 (trainingMetrics):', { elapsedSec, np, IF, tss, userFtp });
        }
    }
    
    // trainingMetrics가 없으면 대체 계산 (elapsedTime 또는 totalSeconds 사용)
    if (!tss || tss === 0) {
        const userFtp = window.currentUser?.ftp || userFTP || 200;
        
        // NP가 없으면 평균 파워 * 1.05로 근사
        if (!np || np === 0) {
            np = Math.round((stats.avgPower || 0) * 1.05);
        }
        
        // IF 계산
        const IF = userFtp > 0 ? (np / userFtp) : 0;
        
        // TSS 계산: elapsedTime 우선 사용, 없으면 totalSeconds 사용
        const timeForTss = totalSeconds > 0 ? totalSeconds : (duration_min * 60);
        tss = (timeForTss / 3600) * (IF * IF) * 100;
        console.log('[showTrainingResultModal] TSS 계산 (대체):', { totalSeconds, duration_min, timeForTss, np, IF, tss, userFtp, avgPower: stats.avgPower });
    }
    
    // 값 반올림 및 최소값 보장
    tss = Math.max(0, Math.round(tss * 100) / 100);
    np = Math.max(0, Math.round(np * 10) / 10);
    
    // 칼로리 계산 (평균 파워 * 시간(초) * 3.6 / 4184)
    // 또는 더 간단한 공식: 평균 파워(W) * 시간(분) * 0.0143
    const avgPower = stats.avgPower || 0;
    const calories = Math.round(avgPower * duration_min * 0.0143);
    
    // 결과값 표시
    const durationEl = document.getElementById('result-duration');
    const avgPowerEl = document.getElementById('result-avg-power');
    const npEl = document.getElementById('result-np');
    const tssEl = document.getElementById('result-tss');
    const hrAvgEl = document.getElementById('result-hr-avg');
    const caloriesEl = document.getElementById('result-calories');
    
    if (durationEl) durationEl.textContent = `${duration_min}분`;
    if (avgPowerEl) avgPowerEl.textContent = `${stats.avgPower || 0}W`;
    if (npEl) npEl.textContent = `${np}W`;
    if (tssEl) tssEl.textContent = `${tss}`;
    if (hrAvgEl) hrAvgEl.textContent = `${stats.avgHR || 0}bpm`;
    if (caloriesEl) caloriesEl.textContent = `${calories}kcal`;
    
    console.log('[showTrainingResultModal] 최종 결과:', { duration_min, avgPower: stats.avgPower, np, tss, hrAvg: stats.avgHR, calories });
    
    // 모달 표시
    modal.classList.remove('hidden');
}

/**
 * 훈련 결과 팝업 닫기
 */
function closeTrainingResultModal() {
    const modal = document.getElementById('trainingResultModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// 전역 함수로 노출
window.showTrainingResultModal = showTrainingResultModal;
window.closeTrainingResultModal = closeTrainingResultModal;

/**
 * 속도계 원호에 목표 파워값만큼 채우기 (세그먼트 달성도에 따라 색상 변경)
 * - LAP AVG 파워값 / 목표 파워값 비율이 0.985 이상이면 투명 민트색
 * - 미만이면 투명 주황색
 * Bluetooth 개인훈련 대시보드 전용 (다른 화면과 독립)
 */
function updateTargetPowerArc() {
    // Bluetooth 개인훈련 대시보드 화면인지 확인 (독립적 구동 보장)
    const isBluetoothIndividualScreen = window.location.pathname.includes('bluetoothIndividual.html');
    if (!isBluetoothIndividualScreen) {
        return; // 다른 화면에서는 실행하지 않음
    }
    
    // 목표 파워값 가져오기
    const targetPowerEl = document.getElementById('ui-target-power');
    if (!targetPowerEl) return;
    
    const targetPower = Number(targetPowerEl.textContent) || 0;
    if (targetPower <= 0) {
        // 목표 파워가 없으면 원호 숨김
        const targetArc = document.getElementById('gauge-target-arc');
        if (targetArc) {
            targetArc.style.display = 'none';
        }
        // 상한 원호도 숨김
        const maxArc = document.getElementById('gauge-max-arc');
        if (maxArc) {
            maxArc.style.display = 'none';
        }
        return;
    }
    
    // LAP AVG 파워값 가져오기
    const lapPowerEl = document.getElementById('ui-lap-power');
    const lapPower = lapPowerEl ? Number(lapPowerEl.textContent) || 0 : 0;
    
    // 세그먼트 달성도 계산 (LAP AVG / 목표 파워) - 하한값 기준
    const achievementRatio = targetPower > 0 ? lapPower / targetPower : 0;
    
    // 색상 결정: 비율이 0.985 이상이면 민트색, 미만이면 주황색
    const arcColor = achievementRatio >= 0.985 
        ? 'rgba(0, 212, 170, 0.5)'  // 투명 민트색 (#00d4aa)
        : 'rgba(255, 140, 0, 0.5)'; // 투명 주황색
    
    // FTP 기반으로 최대 파워 계산
    const maxPower = userFTP * 2;
    if (maxPower <= 0) return;
    
    // 현재 세그먼트 정보 가져오기
    const seg = getCurrentSegment();
    const targetType = seg?.target_type || 'ftp_pct';
    const isFtpPctz = targetType === 'ftp_pctz';
    
    // cadence_rpm 타입인 경우: 파워값이 없으므로 원호 표시하지 않음
    if (targetType === 'cadence_rpm') {
        const targetArc = document.getElementById('gauge-target-arc');
        if (targetArc) {
            targetArc.style.display = 'none';
        }
        const maxArc = document.getElementById('gauge-max-arc');
        if (maxArc) {
            maxArc.style.display = 'none';
        }
        return;
    }
    
    // 목표 파워 비율 계산 (0 ~ 1) - 하한값 기준
    const minRatio = Math.min(Math.max(targetPower / maxPower, 0), 1);
    
    // 각도 계산: 180도(왼쪽 상단)에서 시작하여 각도가 증가하는 방향으로
    const startAngle = 180;
    let minEndAngle = 180 + (minRatio * 180);
    
    // SVG 원호 경로 생성
    const centerX = 100;
    const centerY = 140;
    const radius = 80;
    
    // 하한값 원호 경로 생성
    const startRad = (startAngle * Math.PI) / 180;
    const minEndRad = (minEndAngle * Math.PI) / 180;
    
    const startX = centerX + radius * Math.cos(startRad);
    const startY = centerY + radius * Math.sin(startRad);
    const minEndX = centerX + radius * Math.cos(minEndRad);
    const minEndY = centerY + radius * Math.sin(minEndRad);
    
    const minAngleDiff = minEndAngle - startAngle;
    const minLargeArcFlag = minAngleDiff > 180 ? 1 : 0;
    const minPathData = `M ${startX} ${startY} A ${radius} ${radius} 0 ${minLargeArcFlag} 1 ${minEndX} ${minEndY}`;
    
    // 목표 파워 원호 요소 가져오기 또는 생성 (하한값)
    let targetArc = document.getElementById('gauge-target-arc');
    if (!targetArc) {
        // SVG에 원호 요소 추가
        const svg = document.querySelector('.gauge-container svg');
        if (svg) {
            targetArc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            targetArc.id = 'gauge-target-arc';
            targetArc.setAttribute('fill', 'none');
            targetArc.setAttribute('stroke-width', '12');
            targetArc.setAttribute('stroke-linecap', 'round');
            // 원호 배경 뒤에, 눈금 앞에 배치
            const arcBg = svg.querySelector('path[d*="M 20 140"]');
            if (arcBg && arcBg.nextSibling) {
                svg.insertBefore(targetArc, arcBg.nextSibling);
            } else {
                svg.insertBefore(targetArc, svg.firstChild.nextSibling);
            }
        } else {
            return;
        }
    }
    
    // 하한값 원호 경로 및 색상 업데이트
    targetArc.setAttribute('d', minPathData);
    targetArc.setAttribute('stroke', arcColor);
    targetArc.style.display = 'block';
    
    // ftp_pctz 타입인 경우 상한값 원호 추가
    if (isFtpPctz && window.currentSegmentMaxPower && window.currentSegmentMaxPower > targetPower) {
        const maxPowerValue = window.currentSegmentMaxPower;
        const maxRatio = Math.min(Math.max(maxPowerValue / maxPower, 0), 1);
        const maxEndAngle = 180 + (maxRatio * 180);
        const maxEndRad = (maxEndAngle * Math.PI) / 180;
        const maxEndX = centerX + radius * Math.cos(maxEndRad);
        const maxEndY = centerY + radius * Math.sin(maxEndRad);
        
        const maxAngleDiff = maxEndAngle - minEndAngle;
        const maxLargeArcFlag = maxAngleDiff > 180 ? 1 : 0;
        const maxPathData = `M ${minEndX} ${minEndY} A ${radius} ${radius} 0 ${maxLargeArcFlag} 1 ${maxEndX} ${maxEndY}`;
        
        // 상한값 원호 요소 가져오기 또는 생성
        let maxArc = document.getElementById('gauge-max-arc');
        if (!maxArc) {
            const svg = document.querySelector('.gauge-container svg');
            if (svg) {
                maxArc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                maxArc.id = 'gauge-max-arc';
                maxArc.setAttribute('fill', 'none');
                maxArc.setAttribute('stroke-width', '12');
                maxArc.setAttribute('stroke-linecap', 'round');
                // 하한값 원호 다음에 배치
                if (targetArc && targetArc.nextSibling) {
                    svg.insertBefore(maxArc, targetArc.nextSibling);
                } else {
                    svg.appendChild(maxArc);
                }
            } else {
                return;
            }
        }
        
        // 상한값 원호 경로 및 색상 업데이트 (투명도 낮춘 주황색)
        maxArc.setAttribute('d', maxPathData);
        maxArc.setAttribute('stroke', 'rgba(255, 140, 0, 0.2)'); // 더 투명한 주황색
        maxArc.style.display = 'block';
    } else {
        // ftp_pctz가 아니거나 상한값이 없으면 상한 원호 숨김
        const maxArc = document.getElementById('gauge-max-arc');
        if (maxArc) {
            maxArc.style.display = 'none';
        }
    }
    
    // 디버깅 로그 (선택사항)
    if (achievementRatio > 0) {
        console.log(`[updateTargetPowerArc] 달성도: ${(achievementRatio * 100).toFixed(1)}% (LAP: ${lapPower}W / 목표: ${targetPower}W), 색상: ${achievementRatio >= 0.985 ? '민트색' : '주황색'}${isFtpPctz ? `, 상한: ${window.currentSegmentMaxPower}W` : ''}`);
    }
}

/**
 * 개인 훈련 대시보드 강도 조절 슬라이드 바 초기화
 */
function initializeIndividualIntensitySlider() {
    const slider = document.getElementById('individualIntensityAdjustmentSlider');
    const valueDisplay = document.getElementById('individualIntensityAdjustmentValue');
    
    if (!slider || !valueDisplay) {
        console.warn('[Bluetooth 개인 훈련] 강도 조절 슬라이더 요소를 찾을 수 없습니다');
        return;
    }
    
    // 초기값 설정: 로컬 스토리지에서 불러오기
    let currentAdjustment = individualIntensityAdjustment;
    
    try {
        const saved = localStorage.getItem('individualIntensityAdjustment');
        if (saved) {
            currentAdjustment = parseFloat(saved);
            individualIntensityAdjustment = currentAdjustment;
        } else {
            currentAdjustment = 1.0;
            individualIntensityAdjustment = 1.0;
        }
    } catch (e) {
        currentAdjustment = 1.0;
        individualIntensityAdjustment = 1.0;
    }
    
    // 조정 계수를 슬라이더 값으로 변환 (0.95 → -5, 1.0 → 0, 1.05 → +5)
    const sliderValue = Math.round((currentAdjustment - 1.0) * 100);
    // 슬라이더 범위는 -5 ~ +5이므로 클램프
    const clampedValue = Math.max(-5, Math.min(5, sliderValue));
    
    console.log('[Bluetooth 개인 훈련] 강도 조절 초기값 설정:', {
        adjustment: currentAdjustment,
        sliderValue: sliderValue,
        clampedValue: clampedValue
    });
    
    slider.value = clampedValue;
    updateIndividualIntensityDisplay(clampedValue);
    
    // 초기화 시에도 목표 파워 업데이트
    updateTargetPower();
    
    // 기존 이벤트 리스너 제거 (중복 방지)
    const newSlider = slider.cloneNode(true);
    slider.parentNode.replaceChild(newSlider, slider);
    
    // 슬라이더 이벤트 리스너 (input: 실시간 반영)
    newSlider.addEventListener('input', function(e) {
        const value = parseInt(e.target.value, 10);
        if (!isNaN(value)) {
            // 실시간으로 목표 파워와 표시 값 업데이트
            updateIndividualIntensityAdjustment(value);
        }
    });
    
    // 슬라이더 변경 완료 시 (마우스 떼거나 터치 종료) - 로컬 스토리지 저장
    newSlider.addEventListener('change', function(e) {
        const value = parseInt(e.target.value, 10);
        if (!isNaN(value)) {
            updateIndividualIntensityAdjustment(value);
            // 로컬 스토리지에 저장
            localStorage.setItem('individualIntensityAdjustment', String(individualIntensityAdjustment));
            console.log('[Bluetooth 개인 훈련] 강도 조절 로컬 스토리지에 저장:', individualIntensityAdjustment);
        }
    });
}

/**
 * 개인 훈련 대시보드 강도 조절 업데이트
 */
function updateIndividualIntensityAdjustment(sliderValue) {
    // 슬라이더 값(-5 ~ +5)을 조정 계수로 변환 (0.95 ~ 1.05)
    const adjustment = 1.0 + (sliderValue / 100);
    individualIntensityAdjustment = adjustment;
    
    console.log('[Bluetooth 개인 훈련] 강도 조절 값 변경:', {
        sliderValue: sliderValue,
        adjustment: adjustment,
        percentage: (adjustment * 100).toFixed(1) + '%'
    });
    
    // 1. 표시 업데이트 (강도 조절 % 표시) - 즉시 반영
    updateIndividualIntensityDisplay(sliderValue);
    
    // 2. 목표 파워 실시간 업데이트
    updateTargetPower();
}

/**
 * 개인 훈련 대시보드 강도 조절 표시 업데이트
 */
function updateIndividualIntensityDisplay(sliderValue) {
    const valueDisplay = document.getElementById('individualIntensityAdjustmentValue');
    if (valueDisplay) {
        const sign = sliderValue >= 0 ? '+' : '';
        valueDisplay.textContent = `${sign}${sliderValue}%`;
        
        // 색상 변경 (음수: 파란색, 0: 회색, 양수: 빨간색)
        if (sliderValue < 0) {
            valueDisplay.style.color = '#3b82f6'; // 파란색
        } else if (sliderValue > 0) {
            valueDisplay.style.color = '#ef4444'; // 빨간색
        } else {
            valueDisplay.style.color = '#9ca3af'; // 회색
        }
        
        console.log('[Bluetooth 개인 훈련] 강도 조절 표시 업데이트:', `${sign}${sliderValue}%`);
    } else {
        console.warn('[Bluetooth 개인 훈련] individualIntensityAdjustmentValue 요소를 찾을 수 없습니다');
    }
}

// 블루투스 연결 드롭다운 토글
function toggleBluetoothDropdown() {
    const dropdown = document.getElementById('bluetoothDropdown');
    if (dropdown) {
        dropdown.classList.toggle('show');
        // 드롭다운 외부 클릭 시 닫기
        if (dropdown.classList.contains('show')) {
            setTimeout(() => {
                document.addEventListener('click', closeBluetoothDropdownOnOutsideClick);
            }, 0);
        } else {
            document.removeEventListener('click', closeBluetoothDropdownOnOutsideClick);
        }
    }
}

// 드롭다운 외부 클릭 시 닫기
function closeBluetoothDropdownOnOutsideClick(event) {
    const dropdown = document.getElementById('bluetoothDropdown');
    const button = document.getElementById('bluetoothConnectBtn');
    if (dropdown && button && !dropdown.contains(event.target) && !button.contains(event.target)) {
        dropdown.classList.remove('show');
        document.removeEventListener('click', closeBluetoothDropdownOnOutsideClick);
    }
}

// 블루투스 디바이스 연결 함수
async function connectBluetoothDevice(deviceType) {
    // 드롭다운 닫기
    const dropdown = document.getElementById('bluetoothDropdown');
    if (dropdown) {
        dropdown.classList.remove('show');
        document.removeEventListener('click', closeBluetoothDropdownOnOutsideClick);
    }
    
    // 연결 함수가 있는지 확인
    let connectFunction;
    switch (deviceType) {
        case 'trainer':
            connectFunction = window.connectTrainer;
            break;
        case 'heartRate':
            connectFunction = window.connectHeartRate;
            break;
        case 'powerMeter':
            connectFunction = window.connectPowerMeter;
            break;
        default:
            console.error('[BluetoothIndividual] 알 수 없는 디바이스 타입:', deviceType);
            return;
    }
    
    if (!connectFunction || typeof connectFunction !== 'function') {
        console.error('[BluetoothIndividual] 블루투스 연결 함수를 찾을 수 없습니다:', deviceType);
        alert('블루투스 연결 기능이 로드되지 않았습니다. 페이지를 새로고침해주세요.');
        return;
    }
    
    try {
        console.log('[BluetoothIndividual] 블루투스 디바이스 연결 시도:', deviceType);
        await connectFunction();
        
        // 연결 성공 후 잠시 대기 (window.connectedDevices 업데이트를 위해)
        setTimeout(() => {
            // 연결 상태 업데이트
            updateBluetoothConnectionStatus();
            
            // Firebase에 디바이스 정보 업데이트
            updateFirebaseDevices();
            
            // updateDevicesList 호출 (bluetooth.js에 있으면)
            if (typeof window.updateDevicesList === 'function') {
                window.updateDevicesList();
            }
        }, 200); // 200ms 대기 후 업데이트
    } catch (error) {
        console.error('[BluetoothIndividual] 블루투스 디바이스 연결 실패:', deviceType, error);
        // 에러는 bluetooth.js의 showToast에서 표시됨
    }
}

// 블루투스 연결 상태 업데이트 함수
function updateBluetoothConnectionStatus() {
    const hrItem = document.getElementById('bluetoothHRItem');
    const hrStatus = document.getElementById('heartRateStatus');
    const trainerItem = document.getElementById('bluetoothTrainerItem');
    const trainerStatus = document.getElementById('trainerStatus');
    const pmItem = document.getElementById('bluetoothPMItem');
    const pmStatus = document.getElementById('powerMeterStatus');
    const connectBtn = document.getElementById('bluetoothConnectBtn');
    
    // 이전 연결 상태 저장 (변경 감지용)
    const prevHRConnected = hrItem?.classList.contains('connected') || false;
    const prevTrainerConnected = trainerItem?.classList.contains('connected') || false;
    const prevPMConnected = pmItem?.classList.contains('connected') || false;
    
    // 심박계 상태
    if (window.connectedDevices?.heartRate) {
        if (hrItem) hrItem.classList.add('connected');
        if (hrStatus) {
            hrStatus.textContent = '연결됨';
            hrStatus.style.color = '#00d4aa';
        }
    } else {
        if (hrItem) hrItem.classList.remove('connected');
        if (hrStatus) {
            hrStatus.textContent = '미연결';
            hrStatus.style.color = '#888';
        }
    }
    
    // 스마트 트레이너 상태
    if (window.connectedDevices?.trainer) {
        if (trainerItem) trainerItem.classList.add('connected');
        if (trainerStatus) {
            trainerStatus.textContent = '연결됨';
            trainerStatus.style.color = '#00d4aa';
        }
    } else {
        if (trainerItem) trainerItem.classList.remove('connected');
        if (trainerStatus) {
            trainerStatus.textContent = '미연결';
            trainerStatus.style.color = '#888';
        }
    }
    
    // 파워미터 상태
    if (window.connectedDevices?.powerMeter) {
        if (pmItem) pmItem.classList.add('connected');
        if (pmStatus) {
            pmStatus.textContent = '연결됨';
            pmStatus.style.color = '#00d4aa';
        }
    } else {
        if (pmItem) pmItem.classList.remove('connected');
        if (pmStatus) {
            pmStatus.textContent = '미연결';
            pmStatus.style.color = '#888';
        }
    }
    
    // 연결 버튼 상태 업데이트 (연결된 디바이스가 하나라도 있으면)
    if (connectBtn) {
        if (window.connectedDevices?.heartRate || window.connectedDevices?.trainer || window.connectedDevices?.powerMeter) {
            connectBtn.classList.add('has-connection');
        } else {
            connectBtn.classList.remove('has-connection');
        }
    }
    
    // 연결 상태가 변경되었으면 Firebase 업데이트
    const currentHRConnected = window.connectedDevices?.heartRate ? true : false;
    const currentTrainerConnected = window.connectedDevices?.trainer ? true : false;
    const currentPMConnected = window.connectedDevices?.powerMeter ? true : false;
    
    if (prevHRConnected !== currentHRConnected || 
        prevTrainerConnected !== currentTrainerConnected || 
        prevPMConnected !== currentPMConnected) {
        // 연결 상태가 변경되었으므로 Firebase 업데이트
        updateFirebaseDevices();
    }
}

// 전역 함수로 노출
window.toggleBluetoothDropdown = toggleBluetoothDropdown;
window.connectBluetoothDevice = connectBluetoothDevice;
window.updateBluetoothConnectionStatus = updateBluetoothConnectionStatus;
window.updateFirebaseDevices = updateFirebaseDevices;

// 초기 속도계 눈금 및 레이블 생성
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // 개인 훈련 대시보드 강도 조절 슬라이드 바 초기화
        initializeIndividualIntensitySlider();
        updateGaugeTicksAndLabels();
        startGaugeAnimationLoop(); // 바늘 애니메이션 루프 시작
        // 블루투스 연결 상태 초기 업데이트
        setTimeout(() => {
            updateBluetoothConnectionStatus();
            // 1초마다 연결 상태 확인 및 업데이트
            setInterval(updateBluetoothConnectionStatus, 1000);
        }, 1000);
    });
} else {
    // DOM이 이미 로드되었으면 바로 실행
    updateGaugeTicksAndLabels();
    startGaugeAnimationLoop(); // 바늘 애니메이션 루프 시작
    // 블루투스 연결 상태 초기 업데이트
    setTimeout(() => {
        updateBluetoothConnectionStatus();
        // 1초마다 연결 상태 확인 및 업데이트
        setInterval(updateBluetoothConnectionStatus, 1000);
    }, 1000);
}
    