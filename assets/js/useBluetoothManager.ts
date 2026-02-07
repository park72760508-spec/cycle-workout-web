/**
 * useBluetoothManager.ts
 * 
 * STELVIO AI - 고도화된 블루투스 연결 매니저 훅
 * - 기기 정보 영구 저장 및 매칭 (localStorage + getDevices())
 * - 닉네임 설정 및 관리
 * - 저장된 기기 우선 연결
 * - Web Bluetooth API 통합
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// ========== 타입 정의 ==========

export type DeviceType = 'trainer' | 'heartRate' | 'powerMeter';

export interface SavedDevice {
  deviceId: string;
  name: string;
  nickname: string;
  lastConnected: number;
  deviceType: DeviceType;
}

export interface BluetoothDevice {
  id: string;
  name: string;
  gatt?: BluetoothRemoteGATTServer;
  connected?: boolean;
}

export interface DeviceConnectionState {
  device: BluetoothDevice | null;
  connecting: boolean;
  connected: boolean;
  error: string | null;
}

export interface UseBluetoothManagerReturn {
  // 상태
  savedDevices: SavedDevice[];
  availableDevices: BluetoothDevice[];
  connectionState: DeviceConnectionState;
  isScanning: boolean;
  
  // 액션
  loadSavedDevices: () => Promise<void>;
  connectToSavedDevice: (deviceId: string) => Promise<void>;
  connectToNewDevice: (deviceType: DeviceType) => Promise<void>;
  saveDevice: (device: BluetoothDevice, deviceType: DeviceType, nickname?: string) => Promise<void>;
  updateDeviceNickname: (deviceId: string, nickname: string) => void;
  removeSavedDevice: (deviceId: string) => void;
  disconnect: () => Promise<void>;
  startScan: () => Promise<void>;
}

// ========== 상수 ==========

const STORAGE_KEY = 'stelvio_saved_devices';
const UUIDS = {
  FTMS_SERVICE: '00001826-0000-1000-8000-00805f9b34fb',
  FTMS_DATA: '00002ad2-0000-1000-8000-00805f9b34fb',
  FTMS_CONTROL: '00002ad9-0000-1000-8000-00805f9b34fb',
  CPS_SERVICE: '00001818-0000-1000-8000-00805f9b34fb',
  CPS_DATA: '00002a63-0000-1000-8000-00805f9b34fb',
  CSC_SERVICE: '00001816-0000-1000-8000-00805f9b34fb',
  CYCLEOPS_SERVICE: '347b0001-7635-408b-8918-8ff3949ce592',
  CYCLEOPS_CONTROL: '347b0012-7635-408b-8918-8ff3949ce592',
  WAHOO_SERVICE: 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
  WAHOO_CONTROL: 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b',
  TACX_SERVICE: '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e',
  TACX_CONTROL: '6e40fec2-b5a3-f393-e0a9-e50e24dcca9e',
  HR_SERVICE: '0000180d-0000-1000-8000-00805f9b34fb',
};

const COMPREHENSIVE_ERG_OPTIONAL_SERVICES = [
  '347b0001-7635-408b-8918-8ff3949ce592', // CycleOps
  'a026e005-0a7d-4ab3-97fa-f1500f9feb8b', // Wahoo
  '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e', // Tacx
  '00001826-0000-1000-8000-00805f9b34fb', // FTMS
  '00001818-0000-1000-8000-00805f9b34fb', // CPS
];

// ========== 유틸리티 함수 ==========

function getDeviceFilters(deviceType: DeviceType): BluetoothLEScanFilter[] {
  switch (deviceType) {
    case 'trainer':
      return [
        { services: [UUIDS.FTMS_SERVICE] },
        { services: [UUIDS.CPS_SERVICE] },
        { namePrefix: 'CycleOps' },
        { namePrefix: 'Hammer' },
        { namePrefix: 'Saris' },
        { namePrefix: 'Wahoo' },
        { namePrefix: 'KICKR' },
        { namePrefix: 'Tacx' },
      ];
    case 'heartRate':
      return [
        { services: ['heart_rate'] },
        { services: [UUIDS.HR_SERVICE] },
      ];
    case 'powerMeter':
      return [
        { services: [UUIDS.CPS_SERVICE] },
        { services: [UUIDS.CSC_SERVICE] },
      ];
    default:
      return [];
  }
}

function getOptionalServices(deviceType: DeviceType): string[] {
  switch (deviceType) {
    case 'trainer':
      return [
        UUIDS.FTMS_SERVICE,
        UUIDS.CPS_SERVICE,
        UUIDS.CSC_SERVICE,
        UUIDS.CYCLEOPS_SERVICE,
        UUIDS.WAHOO_SERVICE,
        UUIDS.TACX_SERVICE,
        'device_information',
        'battery_service',
        ...COMPREHENSIVE_ERG_OPTIONAL_SERVICES,
      ];
    case 'heartRate':
      return ['heart_rate', UUIDS.HR_SERVICE, 'battery_service'];
    case 'powerMeter':
      return [UUIDS.CPS_SERVICE, UUIDS.CSC_SERVICE];
    default:
      return [];
  }
}

function loadSavedDevicesFromStorage(): SavedDevice[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to load saved devices from storage:', error);
    return [];
  }
}

function saveDevicesToStorage(devices: SavedDevice[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(devices));
  } catch (error) {
    console.error('Failed to save devices to storage:', error);
  }
}

// ========== 메인 훅 ==========

export function useBluetoothManager(deviceType: DeviceType): UseBluetoothManagerReturn {
  const [savedDevices, setSavedDevices] = useState<SavedDevice[]>([]);
  const [availableDevices, setAvailableDevices] = useState<BluetoothDevice[]>([]);
  const [connectionState, setConnectionState] = useState<DeviceConnectionState>({
    device: null,
    connecting: false,
    connected: false,
    error: null,
  });
  const [isScanning, setIsScanning] = useState(false);
  
  const currentDeviceRef = useRef<BluetoothDevice | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 저장된 기기 목록 로드
  const loadSavedDevices = useCallback(async () => {
    try {
      const stored = loadSavedDevicesFromStorage();
      
      // getDevices()로 이전에 페어링된 기기 가져오기
      if (navigator.bluetooth && 'getDevices' in navigator.bluetooth) {
        try {
          const pairedDevices = await navigator.bluetooth.getDevices();
          
          // 저장된 기기와 페어링된 기기 매칭
          const matchedDevices: SavedDevice[] = stored
            .filter(saved => saved.deviceType === deviceType)
            .map(saved => {
              const paired = pairedDevices.find(p => p.id === saved.deviceId);
              if (paired) {
                return {
                  ...saved,
                  name: paired.name || saved.name, // 최신 이름으로 업데이트
                };
              }
              return saved;
            });
          
          setSavedDevices(matchedDevices);
        } catch (error) {
          console.warn('getDevices() not supported or failed:', error);
          // getDevices()가 지원되지 않으면 localStorage만 사용
          setSavedDevices(stored.filter(d => d.deviceType === deviceType));
        }
      } else {
        // getDevices()가 없으면 localStorage만 사용
        setSavedDevices(stored.filter(d => d.deviceType === deviceType));
      }
    } catch (error) {
      console.error('Failed to load saved devices:', error);
      setSavedDevices([]);
    }
  }, [deviceType]);

  // 저장된 기기에 연결
  const connectToSavedDevice = useCallback(async (deviceId: string) => {
    const savedDevice = savedDevices.find(d => d.deviceId === deviceId);
    if (!savedDevice) {
      setConnectionState(prev => ({ ...prev, error: '저장된 기기를 찾을 수 없습니다.' }));
      return;
    }

    setConnectionState(prev => ({ ...prev, connecting: true, error: null }));

    try {
      // getDevices()로 기기 가져오기
      if (navigator.bluetooth && 'getDevices' in navigator.bluetooth) {
        const pairedDevices = await navigator.bluetooth.getDevices();
        const device = pairedDevices.find(d => d.id === deviceId);
        
        if (!device) {
          throw new Error('기기를 찾을 수 없습니다. 전원이 켜져 있나요?');
        }

        if (!device.gatt) {
          throw new Error('GATT 서버를 사용할 수 없습니다.');
        }

        // 연결 시도
        const server = await device.gatt.connect();
        
        const bluetoothDevice: BluetoothDevice = {
          id: device.id,
          name: device.name || savedDevice.name,
          gatt: server,
          connected: true,
        };

        currentDeviceRef.current = bluetoothDevice;
        
        // 연결 성공 시 lastConnected 업데이트
        const updatedDevices = savedDevices.map(d =>
          d.deviceId === deviceId
            ? { ...d, lastConnected: Date.now() }
            : d
        );
        setSavedDevices(updatedDevices);
        saveDevicesToStorage(updatedDevices);

        // 연결 해제 이벤트 리스너
        device.addEventListener('gattserverdisconnected', () => {
          setConnectionState({
            device: null,
            connecting: false,
            connected: false,
            error: null,
          });
          currentDeviceRef.current = null;
        });

        setConnectionState({
          device: bluetoothDevice,
          connecting: false,
          connected: true,
          error: null,
        });
      } else {
        throw new Error('이 브라우저는 저장된 기기 재연결을 지원하지 않습니다.');
      }
    } catch (error: any) {
      console.error('Failed to connect to saved device:', error);
      setConnectionState(prev => ({
        ...prev,
        connecting: false,
        connected: false,
        error: error.message || '연결에 실패했습니다.',
      }));
    }
  }, [savedDevices]);

  // 새 기기 연결 (requestDevice 사용)
  const connectToNewDevice = useCallback(async (deviceTypeParam: DeviceType) => {
    setConnectionState(prev => ({ ...prev, connecting: true, error: null }));

    try {
      const filters = getDeviceFilters(deviceTypeParam);
      const optionalServices = getOptionalServices(deviceTypeParam);

      const device = await navigator.bluetooth.requestDevice({
        filters,
        optionalServices,
      });

      if (!device.gatt) {
        throw new Error('GATT 서버를 사용할 수 없습니다.');
      }

      const server = await device.gatt.connect();
      
      const bluetoothDevice: BluetoothDevice = {
        id: device.id,
        name: device.name || '알 수 없는 기기',
        gatt: server,
        connected: true,
      };

      currentDeviceRef.current = bluetoothDevice;

      // 연결 해제 이벤트 리스너
      device.addEventListener('gattserverdisconnected', () => {
        setConnectionState({
          device: null,
          connecting: false,
          connected: false,
          error: null,
        });
        currentDeviceRef.current = null;
      });

      setConnectionState({
        device: bluetoothDevice,
        connecting: false,
        connected: true,
        error: null,
      });

      // 새 기기이므로 닉네임 설정을 위해 반환 (컴포넌트에서 처리)
      return bluetoothDevice;
    } catch (error: any) {
      console.error('Failed to connect to new device:', error);
      
      // 사용자가 취소한 경우는 에러로 처리하지 않음
      if (error.name === 'NotFoundError' || error.name === 'SecurityError') {
        setConnectionState(prev => ({
          ...prev,
          connecting: false,
          error: null,
        }));
        return null;
      }

      setConnectionState(prev => ({
        ...prev,
        connecting: false,
        connected: false,
        error: error.message || '연결에 실패했습니다.',
      }));
      return null;
    }
  }, []);

  // 기기 저장
  const saveDevice = useCallback(async (
    device: BluetoothDevice,
    deviceTypeParam: DeviceType,
    nickname?: string
  ) => {
    const savedDevice: SavedDevice = {
      deviceId: device.id,
      name: device.name || '알 수 없는 기기',
      nickname: nickname || device.name || '알 수 없는 기기',
      lastConnected: Date.now(),
      deviceType: deviceTypeParam,
    };

    const updated = [...savedDevices];
    const existingIndex = updated.findIndex(d => d.deviceId === device.id);
    
    if (existingIndex >= 0) {
      updated[existingIndex] = savedDevice;
    } else {
      updated.push(savedDevice);
    }

    setSavedDevices(updated);
    saveDevicesToStorage(updated);
  }, [savedDevices]);

  // 닉네임 업데이트
  const updateDeviceNickname = useCallback((deviceId: string, nickname: string) => {
    const updated = savedDevices.map(d =>
      d.deviceId === deviceId ? { ...d, nickname } : d
    );
    setSavedDevices(updated);
    saveDevicesToStorage(updated);
  }, [savedDevices]);

  // 저장된 기기 제거
  const removeSavedDevice = useCallback((deviceId: string) => {
    const updated = savedDevices.filter(d => d.deviceId !== deviceId);
    setSavedDevices(updated);
    saveDevicesToStorage(updated);
  }, [savedDevices]);

  // 연결 해제
  const disconnect = useCallback(async () => {
    try {
      if (currentDeviceRef.current?.gatt?.connected) {
        await currentDeviceRef.current.gatt.disconnect();
      }
      setConnectionState({
        device: null,
        connecting: false,
        connected: false,
        error: null,
      });
      currentDeviceRef.current = null;
    } catch (error) {
      console.error('Failed to disconnect:', error);
    }
  }, []);

  // 스캔 시작 (getDevices()로 사용 가능한 기기 확인)
  const startScan = useCallback(async () => {
    setIsScanning(true);
    try {
      if (navigator.bluetooth && 'getDevices' in navigator.bluetooth) {
        const devices = await navigator.bluetooth.getDevices();
        const filtered = devices
          .filter(d => {
            // deviceType에 맞는 기기만 필터링
            // 실제로는 서비스 기반으로 필터링해야 하지만,
            // getDevices()는 서비스 정보를 제공하지 않으므로 모든 기기를 반환
            return true;
          })
          .map(d => ({
            id: d.id,
            name: d.name || '알 수 없는 기기',
            gatt: d.gatt,
            connected: d.gatt?.connected || false,
          }));
        
        setAvailableDevices(filtered);
      }
    } catch (error) {
      console.error('Failed to scan devices:', error);
    } finally {
      setIsScanning(false);
    }
  }, []);

  // 초기 로드
  useEffect(() => {
    loadSavedDevices();
  }, [loadSavedDevices]);

  // 컴포넌트 언마운트 시 연결 해제
  useEffect(() => {
    return () => {
      if (currentDeviceRef.current?.gatt?.connected) {
        currentDeviceRef.current.gatt.disconnect().catch(console.error);
      }
    };
  }, []);

  return {
    savedDevices,
    availableDevices,
    connectionState,
    isScanning,
    loadSavedDevices,
    connectToSavedDevice,
    connectToNewDevice,
    saveDevice,
    updateDeviceNickname,
    removeSavedDevice,
    disconnect,
    startScan,
  };
}
