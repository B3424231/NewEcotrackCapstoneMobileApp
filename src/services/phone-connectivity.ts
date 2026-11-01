import { Platform } from 'react-native';

type BluetoothManager = {
  state(): Promise<string>;
  onStateChange(listener: (state: string) => void, emitCurrentState: boolean): { remove(): void };
};

let systemPromptOpen = false;

async function launchPhoneControl(action: string) {
  if (systemPromptOpen) throw new Error('Finish the open phone connectivity prompt, then retry.');
  systemPromptOpen = true;
  try {
    // Lazy loading keeps manual setup usable in web and older native builds.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const launcher: typeof import('expo-intent-launcher') = require('expo-intent-launcher');
    return await launcher.startActivityAsync(action);
  } finally {
    systemPromptOpen = false;
  }
}

function waitForBluetooth(manager: BluetoothManager, accept: (state: string) => boolean, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let subscription: { remove(): void } | undefined;
    let settled = false;
    const finish = (state?: string, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription?.remove();
      if (error) reject(error);
      else resolve(state || 'Unknown');
    };
    const update = (state: string) => { if (accept(state)) finish(state); };
    const timer = setTimeout(() => finish('Unknown'), timeoutMs);
    try {
      subscription = manager.onStateChange(update, true);
      if (settled) subscription.remove();
      // Cover a state change between the initial read and installing the listener.
      void manager.state().then(update, error => finish(undefined, error));
    } catch (error) {
      finish(undefined, error);
    }
  });
}

/** Request Android's user-controlled enable dialog, then verify the actual radio. */
export async function ensurePhoneBluetooth(manager: BluetoothManager, promptToEnable = true): Promise<void> {
  let state = await manager.state();
  if (state === 'Unknown' || state === 'Resetting') {
    state = await waitForBluetooth(manager, next => next !== 'Unknown' && next !== 'Resetting', 4000);
  }
  if (state === 'PoweredOff' && Platform.OS === 'android' && promptToEnable) {
    let result;
    try {
      result = await launchPhoneControl('android.bluetooth.adapter.action.REQUEST_ENABLE');
    } catch {
      throw new Error('Bluetooth is disabled. Install the updated EcoTrack APK to use the enable prompt, or enable Bluetooth in phone Settings and retry.');
    }
    if (result.resultCode !== -1) throw new Error('Bluetooth is still disabled. Allow the Bluetooth enable prompt to scan for AC devices.');
    state = await waitForBluetooth(manager, next => ['PoweredOn', 'Unauthorized', 'Unsupported'].includes(next), 8000);
  }
  if (state === 'PoweredOff') throw new Error('Bluetooth is disabled. Enable Bluetooth in phone Settings, then tap Connect Nearby Device.');
  if (state === 'Unauthorized') throw new Error('Bluetooth permission is required. Allow Nearby Devices for EcoTrack in phone Settings and retry.');
  if (state === 'Unsupported') throw new Error('This phone does not support Bluetooth Low Energy.');
  if (state !== 'PoweredOn') throw new Error('Bluetooth has not finished turning on. Tap Connect Nearby Device to retry.');
}

/** Resolves when Android returns to EcoTrack; callers must recheck the connection. */
export async function openPhoneWifiControls(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (Number(Platform.Version) >= 29) {
    try {
      await launchPhoneControl('android.settings.panel.action.WIFI');
      return;
    } catch {
      // Some Android vendors omit the compact panel; use the public settings page.
    }
  }
  await launchPhoneControl('android.settings.WIFI_SETTINGS');
}
