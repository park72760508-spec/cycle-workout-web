/**
 * useBleDeviceStorage.ts
 * STELVIO AI - 앱 브릿지(deviceConnected)로 저장된 기기 정보를 React에서 읽는 훅
 *
 * - 전역 리스너 등록/해제는 deviceBridgeStorage.js에서만 수행 (중복·메모리 누수 방지)
 * - 이 훅은 저장된 값 로드 및 (선택) deviceConnected 시 상태 갱신만 담당
 */

import { useState, useEffect, useCallback } from 'react';

export type BridgeDeviceType = 'hr' | 'power' | 'trainer';

export interface BridgeSavedDevices {
  hr?: string;
  power?: string;
  trainer?: string;
}

declare global {
  interface Window {
    StelvioDeviceBridgeStorage?: {
      loadSavedDevices: () => BridgeSavedDevices;
      STELVIO_SAVED_DEVICES_KEY: string;
    };
  }
}

/**
 * 브릿지 저장소에서 기기 맵 로드 (객체 포맷).
 * StelvioDeviceBridgeStorage가 없으면 빈 객체 반환.
 */
function loadSavedDevicesFromBridge(): BridgeSavedDevices {
  if (typeof window === 'undefined' || !window.StelvioDeviceBridgeStorage) return {};
  try {
    return window.StelvioDeviceBridgeStorage.loadSavedDevices();
  } catch {
    return {};
  }
}

/**
 * deviceConnected 브릿지로 저장된 기기 정보를 읽는 React 훅.
 * 리스너 등록은 하지 않음 (전역 deviceBridgeStorage.js에서 한 번만 등록).
 */
export function useBleDeviceStorage() {
  const [savedDevices, setSavedDevices] = useState<BridgeSavedDevices>(() =>
    loadSavedDevicesFromBridge()
  );

  const reload = useCallback(() => {
    setSavedDevices(loadSavedDevicesFromBridge());
  }, []);

  // 마운트 시 한 번 로드
  useEffect(() => {
    reload();
  }, [reload]);

  // deviceConnected 발생 시 저장소가 바뀌므로, storage 이벤트로 동기 탭만 반영됨.
  // 같은 페이지 내에서는 브릿지 저장 시 커스텀 이벤트로 갱신할 수 있음 (deviceBridgeStorage에서 dispatch 시)
  useEffect(() => {
    const handler = () => reload();
    window.addEventListener('stelvio-bridge-devices-updated', handler);
    return () => window.removeEventListener('stelvio-bridge-devices-updated', handler);
  }, [reload]);

  return { savedDevices, reload };
}
