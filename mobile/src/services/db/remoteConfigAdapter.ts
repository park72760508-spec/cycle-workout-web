import type { RemoteConfigAdapter } from "./DualRunManager";

type RnRemoteConfigModule = {
  default: () => {
    setDefaults: (defaults: Record<string, string | number | boolean>) => Promise<null>;
    fetchAndActivate: () => Promise<boolean>;
    getValue: (key: string) => { asString: () => string; asNumber: () => number };
    settings: { fetchTimeMillis: number };
  };
};

/**
 * @react-native-firebase/remote-config 래퍼.
 * peerDependency 미설치 시 import 단계에서 실패 → DualRunManager 가 RC 없이 OFF 유지.
 */
export function createReactNativeRemoteConfigAdapter(): RemoteConfigAdapter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const remoteConfigModule = require("@react-native-firebase/remote-config") as RnRemoteConfigModule;
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
