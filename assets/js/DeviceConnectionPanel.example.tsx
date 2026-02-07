/**
 * DeviceConnectionPanel.example.tsx
 * 
 * 사용 예제: DeviceConnectionPanel 컴포넌트를 프로젝트에 통합하는 방법
 */

import React, { useState } from 'react';
import DeviceConnectionPanel from './DeviceConnectionPanel';
import { DeviceType } from './useBluetoothManager';

// ========== 예제 1: 기본 사용법 ==========

export function BasicExample() {
  const [isOpen, setIsOpen] = useState(false);
  const [deviceType, setDeviceType] = useState<DeviceType>('trainer');

  return (
    <div>
      <button
        onClick={() => {
          setDeviceType('trainer');
          setIsOpen(true);
        }}
        className="px-4 py-2 bg-blue-500 text-white rounded"
      >
        스마트 로라 연결
      </button>

      <DeviceConnectionPanel
        deviceType={deviceType}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onConnected={(device) => {
          console.log('기기 연결됨:', device);
          // 기존 bluetooth.js의 window.connectedDevices와 통합 가능
          if ((window as any).connectedDevices) {
            (window as any).connectedDevices.trainer = {
              name: device.name,
              device: device as any,
              // ... 기타 필요한 속성
            };
          }
        }}
        onDisconnected={() => {
          console.log('기기 연결 해제됨');
        }}
      />
    </div>
  );
}

// ========== 예제 2: 기존 연결 화면과 통합 ==========

export function IntegrationExample() {
  const [trainerPanelOpen, setTrainerPanelOpen] = useState(false);
  const [hrPanelOpen, setHrPanelOpen] = useState(false);
  const [pmPanelOpen, setPmPanelOpen] = useState(false);

  return (
    <div className="grid-2 gap-10">
      {/* 기존 버튼들을 클릭하면 패널이 열리도록 */}
      <button
        id="btnConnectTrainer"
        onClick={() => setTrainerPanelOpen(true)}
        className="btn btn-device"
      >
        <img src="assets/img/trainer_i.png" alt="스마트로라 연결" />
        <span>스마트로라 연결</span>
      </button>

      <button
        id="btnConnectHR"
        onClick={() => setHrPanelOpen(true)}
        className="btn btn-device"
      >
        <img src="assets/img/bpm_i.png" alt="심박계 연결" />
        <span>심박계 연결</span>
      </button>

      <button
        id="btnConnectPM"
        onClick={() => setPmPanelOpen(true)}
        className="btn btn-device"
      >
        <img src="assets/img/power_i.png" alt="파워미터 연결" />
        <span>파워미터 연결</span>
      </button>

      {/* 패널들 */}
      <DeviceConnectionPanel
        deviceType="trainer"
        isOpen={trainerPanelOpen}
        onClose={() => setTrainerPanelOpen(false)}
        onConnected={(device) => {
          // 기존 connectTrainer() 함수와 유사한 로직 실행
          console.log('트레이너 연결됨:', device);
          // window.connectTrainer() 대신 여기서 처리
        }}
      />

      <DeviceConnectionPanel
        deviceType="heartRate"
        isOpen={hrPanelOpen}
        onClose={() => setHrPanelOpen(false)}
        onConnected={(device) => {
          console.log('심박계 연결됨:', device);
        }}
      />

      <DeviceConnectionPanel
        deviceType="powerMeter"
        isOpen={pmPanelOpen}
        onClose={() => setPmPanelOpen(false)}
        onConnected={(device) => {
          console.log('파워미터 연결됨:', device);
        }}
      />
    </div>
  );
}

// ========== 예제 3: 기존 bluetooth.js와 통합 ==========

/**
 * 기존 bluetooth.js의 connectTrainer() 함수를 대체하거나 확장하는 방법
 */
export async function integrateWithExistingBluetooth() {
  // useBluetoothManager 훅을 직접 사용하여 기존 로직과 통합
  // 예: bluetooth.js의 connectTrainer() 함수 내부에서
  
  // 1. 저장된 기기 확인
  // const { savedDevices, connectToSavedDevice } = useBluetoothManager('trainer');
  
  // 2. 저장된 기기가 있으면 우선 연결 시도
  // if (savedDevices.length > 0) {
  //   await connectToSavedDevice(savedDevices[0].deviceId);
  //   return;
  // }
  
  // 3. 없으면 기존 requestDevice 로직 실행
  // const device = await navigator.bluetooth.requestDevice({ ... });
  
  // 4. 연결 성공 후 닉네임 설정 및 저장
  // await saveDevice(device, 'trainer', '사용자 지정 이름');
}

// ========== 통합 가이드 ==========

/**
 * 기존 프로젝트에 통합하는 방법:
 * 
 * 1. React 컴포넌트로 변환:
 *    - index.html의 연결 화면 부분을 React 컴포넌트로 변환
 *    - 또는 기존 HTML 버튼에 이벤트 리스너 추가하여 패널 열기
 * 
 * 2. 기존 bluetooth.js와의 통합:
 *    - DeviceConnectionPanel의 onConnected 콜백에서
 *      window.connectedDevices 업데이트
 *    - 기존 데이터 파서(handleTrainerData 등)는 그대로 사용
 * 
 * 3. 빌드 설정:
 *    - TypeScript 컴파일러 설정 (tsconfig.json)
 *    - 또는 Babel을 사용하여 JSX 변환 (이미 index.html에 포함됨)
 * 
 * 4. 스타일링:
 *    - Tailwind CSS가 이미 index.html에 포함되어 있음
 *    - 필요시 커스텀 스타일 추가
 */
