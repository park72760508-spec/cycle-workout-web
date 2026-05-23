/**
 * DualRunManager ↔ RN Firebase Remote Config 어댑터 (순환 참조·모듈 해석 이슈 방지).
 */
export interface RemoteConfigAdapter {
  setDefaults(defaults: Record<string, string | number | boolean>): Promise<void>;
  fetchAndActivate(): Promise<boolean>;
  getString(key: string): string;
  getNumber(key: string): number;
}

/**
 * @react-native-firebase/remote-config 래퍼.
 * peerDependency 미설치 시 호출 시점에 실패 → DualRunManager 가 RC 없이 OFF 유지.
 */
export function createReactNativeRemoteConfigAdapter(): RemoteConfigAdapter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const remoteConfigModule = require("@react-native-firebase/remote-config") as {
    default: () => {
      setDefaults: (
        defaults: Record<string, string | number | boolean>
      ) => Promise<null>;
      fetchAndActivate: () => Promise<boolean>;
      getValue: (key: string) => { asString: () => string; asNumber: () => number };
    };
  };
  const rc = remoteConfigModule.default();

  return {
    async setDefaults(
      defaults: Record<string, string | number | boolean>
    ): Promise<void> {
      await rc.setDefaults(defaults);
    },
    async fetchAndActivate(): Promise<boolean> {
      return rc.fetchAndActivate();
    },
    getString(key: string): string {
      return rc.getValue(key).asString();
    },
    getNumber(key: string): number {
      return rc.getValue(key).asNumber();
    },
  };
}
