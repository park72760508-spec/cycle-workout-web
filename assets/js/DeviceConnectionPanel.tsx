/**
 * DeviceConnectionPanel.tsx
 * 
 * STELVIO AI - 블루투스 기기 연결 패널 컴포넌트
 * - 반응형 UI (데스크톱: 모달/사이드바, 모바일: 바텀시트)
 * - 저장된 기기 우선 표시
 * - 닉네임 설정 및 수정
 * - 연결 상태 시각화
 */

import React, { useState, useEffect } from 'react';
import { useBluetoothManager, DeviceType, SavedDevice, BluetoothDevice } from './useBluetoothManager';

// ========== 타입 정의 ==========

interface DeviceConnectionPanelProps {
  deviceType: DeviceType;
  isOpen: boolean;
  onClose: () => void;
  onConnected?: (device: BluetoothDevice) => void;
  onDisconnected?: () => void;
}

interface NicknameModalProps {
  isOpen: boolean;
  deviceName: string;
  currentNickname?: string;
  onSave: (nickname: string) => void;
  onCancel: () => void;
}

// ========== 닉네임 설정 모달 ==========

const NicknameModal: React.FC<NicknameModalProps> = ({
  isOpen,
  deviceName,
  currentNickname,
  onSave,
  onCancel,
}) => {
  const [nickname, setNickname] = useState(currentNickname || deviceName || '');

  useEffect(() => {
    if (isOpen) {
      setNickname(currentNickname || deviceName || '');
    }
  }, [isOpen, currentNickname, deviceName]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (nickname.trim()) {
      onSave(nickname.trim());
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
        <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
          기기 이름 설정
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          이 기기의 이름을 무엇으로 저장할까요?
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          기기명: <span className="font-mono">{deviceName}</span>
        </p>
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder="예: 지성이의 로라, 센터 3번 자전거"
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white mb-4"
          autoFocus
        />
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={!nickname.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
};

// ========== 기기 카드 컴포넌트 ==========

interface DeviceCardProps {
  device: SavedDevice;
  isConnected: boolean;
  isConnecting: boolean;
  onConnect: () => void;
  onEditNickname: () => void;
  onRemove: () => void;
}

const DeviceCard: React.FC<DeviceCardProps> = ({
  device,
  isConnected,
  isConnecting,
  onConnect,
  onEditNickname,
  onRemove,
}) => {
  const formatLastConnected = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return '오늘';
    } else if (diffDays === 1) {
      return '어제';
    } else if (diffDays < 7) {
      return `${diffDays}일 전`;
    } else {
      return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
    }
  };

  return (
    <div
      className={`
        relative p-4 rounded-lg border-2 transition-all cursor-pointer
        ${isConnected
          ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-400 dark:hover:border-blue-600'
        }
      `}
      onClick={!isConnecting && !isConnected ? onConnect : undefined}
    >
      {/* 별표 표시 (저장된 기기) */}
      <div className="absolute top-2 right-2">
        <span className="text-yellow-400 text-xl">⭐</span>
      </div>

      {/* 연결 상태 인디케이터 */}
      {isConnected && (
        <div className="absolute top-2 left-2">
          <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
        </div>
      )}

      {/* 기기 정보 */}
      <div className="pr-8">
        <h4 className="font-semibold text-lg text-gray-900 dark:text-white mb-1">
          {device.nickname}
        </h4>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
          {device.name}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          마지막 연결: {formatLastConnected(device.lastConnected)}
        </p>
      </div>

      {/* 액션 버튼 */}
      <div className="mt-3 flex gap-2">
        {isConnecting ? (
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-sm">연결 중...</span>
          </div>
        ) : isConnected ? (
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span className="text-sm font-medium">연결됨</span>
          </div>
        ) : (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEditNickname();
              }}
              className="px-3 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              이름 변경
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              className="px-3 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
            >
              삭제
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// ========== 메인 컴포넌트 ==========

const DeviceConnectionPanel: React.FC<DeviceConnectionPanelProps> = ({
  deviceType,
  isOpen,
  onClose,
  onConnected,
  onDisconnected,
}) => {
  const {
    savedDevices,
    connectionState,
    connectToSavedDevice,
    connectToNewDevice,
    saveDevice,
    updateDeviceNickname,
    removeSavedDevice,
    disconnect,
  } = useBluetoothManager(deviceType);

  const [nicknameModal, setNicknameModal] = useState<{
    isOpen: boolean;
    device: BluetoothDevice | null;
    currentNickname?: string;
  }>({
    isOpen: false,
    device: null,
  });

  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);

  // 연결 상태 변경 감지
  useEffect(() => {
    if (connectionState.connected && connectionState.device) {
      onConnected?.(connectionState.device);
    } else if (!connectionState.connected && !connectionState.connecting) {
      onDisconnected?.();
    }
  }, [connectionState.connected, connectionState.device, connectionState.connecting, onConnected, onDisconnected]);

  // 새 기기 연결 후 닉네임 모달 표시
  const handleConnectNewDevice = async () => {
    const device = await connectToNewDevice(deviceType);
    if (device) {
      setNicknameModal({
        isOpen: true,
        device,
      });
    }
  };

  // 닉네임 저장
  const handleSaveNickname = async (nickname: string) => {
    if (nicknameModal.device) {
      await saveDevice(nicknameModal.device, deviceType, nickname);
      setNicknameModal({ isOpen: false, device: null });
    } else if (editingDeviceId) {
      updateDeviceNickname(editingDeviceId, nickname);
      setEditingDeviceId(null);
    }
  };

  // 저장된 기기 연결
  const handleConnectSaved = async (deviceId: string) => {
    await connectToSavedDevice(deviceId);
  };

  // 닉네임 수정 시작
  const handleEditNickname = (device: SavedDevice) => {
    setEditingDeviceId(device.deviceId);
    setNicknameModal({
      isOpen: true,
      device: null,
      currentNickname: device.nickname,
    });
  };

  // 기기 제거
  const handleRemoveDevice = (deviceId: string) => {
    if (confirm('이 기기를 저장 목록에서 제거하시겠습니까?')) {
      removeSavedDevice(deviceId);
    }
  };

  // 연결 해제
  const handleDisconnect = async () => {
    await disconnect();
  };

  if (!isOpen) return null;

  const deviceTypeLabels: Record<DeviceType, string> = {
    trainer: '스마트 로라',
    heartRate: '심박계',
    powerMeter: '파워미터',
  };

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <>
      {/* 오버레이 */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* 패널 */}
      <div
        className={`
          fixed z-50 bg-white dark:bg-gray-800 shadow-2xl
          ${isMobile
            ? 'bottom-0 left-0 right-0 rounded-t-2xl max-h-[90vh] overflow-y-auto'
            : 'top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto'
          }
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              {deviceTypeLabels[deviceType]} 연결
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              저장된 기기를 빠르게 연결하거나 새 기기를 찾아보세요
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl font-bold w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            ×
          </button>
        </div>

        {/* 내용 */}
        <div className="p-6">
          {/* 저장된 기기 목록 */}
          {savedDevices.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                내 기기 ({savedDevices.length})
              </h3>
              <div className="space-y-3">
                {savedDevices.map((device) => {
                  const isConnected =
                    connectionState.connected &&
                    connectionState.device?.id === device.deviceId;
                  const isConnecting =
                    connectionState.connecting &&
                    connectionState.device?.id === device.deviceId;

                  return (
                    <DeviceCard
                      key={device.deviceId}
                      device={device}
                      isConnected={isConnected}
                      isConnecting={isConnecting}
                      onConnect={() => handleConnectSaved(device.deviceId)}
                      onEditNickname={() => handleEditNickname(device)}
                      onRemove={() => handleRemoveDevice(device.deviceId)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* 새 기기 찾기 버튼 */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            <button
              onClick={handleConnectNewDevice}
              disabled={connectionState.connecting}
              className="w-full px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
            >
              {connectionState.connecting ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>연결 중...</span>
                </>
              ) : (
                <>
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  <span>새 기기 찾기</span>
                </>
              )}
            </button>
          </div>

          {/* 연결된 기기 정보 및 연결 해제 */}
          {connectionState.connected && connectionState.device && (
            <div className="mt-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-300">
                    연결됨
                  </p>
                  <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                    {connectionState.device.name}
                  </p>
                </div>
                <button
                  onClick={handleDisconnect}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors text-sm"
                >
                  연결 해제
                </button>
              </div>
            </div>
          )}

          {/* 에러 메시지 */}
          {connectionState.error && (
            <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-800 dark:text-red-300">
                {connectionState.error}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 닉네임 설정 모달 */}
      <NicknameModal
        isOpen={nicknameModal.isOpen}
        deviceName={
          nicknameModal.device?.name ||
          savedDevices.find(d => d.deviceId === editingDeviceId)?.name ||
          ''
        }
        currentNickname={nicknameModal.currentNickname}
        onSave={handleSaveNickname}
        onCancel={() => {
          setNicknameModal({ isOpen: false, device: null });
          setEditingDeviceId(null);
        }}
      />
    </>
  );
};

export default DeviceConnectionPanel;
