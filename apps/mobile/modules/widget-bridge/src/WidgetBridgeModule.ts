import { requireNativeModule } from 'expo-modules-core';

export interface WidgetBridgeNativeModule {
  isSupported: boolean;
  writeSnapshot(json: string): Promise<void>;
  readPendingGrades(): Promise<string | null>;
  clearPendingGrades(): Promise<void>;
  reloadWidgets(): Promise<void>;
}

export default requireNativeModule<WidgetBridgeNativeModule>('WidgetBridge');
