import type { WidgetBridgeNativeModule } from './WidgetBridgeModule';

/**
 * Web has no home-screen widgets, so every method is a no-op and `isSupported`
 * is false.
 *
 * This file exists so the web bundle never reaches `requireNativeModule`, which
 * throws when there is no native counterpart. Metro picks it up by the `.web`
 * extension, so no caller has to test the platform.
 */
const WidgetBridgeModule: WidgetBridgeNativeModule = {
  isSupported: false,
  async writeSnapshot() {},
  async readPendingGrades() {
    return null;
  },
  async clearPendingGrades() {},
  async reloadWidgets() {},
};

export default WidgetBridgeModule;
