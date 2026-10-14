/**
 * The app-to-widget bridge.
 *
 * Everything the home-screen widgets know comes through here. The app writes a
 * fully-formatted snapshot (built by `@mon/core`) into a container both
 * processes can see — an App Group on iOS, SharedPreferences on Android — and
 * then asks the system to re-render.
 *
 * The reverse direction carries gradings the learner made on the home screen
 * while the app was closed. The widget cannot run the scheduler, so it appends
 * `{cardId, rating, gradedAt}` records and the app replays them through the real
 * FSRS implementation on next launch. See `widget/pending.ts` in core.
 *
 * On web there are no home-screen widgets, so the module degrades to a no-op and
 * `isSupported` is false. Callers do not branch on platform; the dashboard simply
 * hides its widget-preview affordances when support is absent.
 */
import type { PendingWidgetGrade, WidgetSnapshot } from '@mon/core';
import WidgetBridgeModule from './src/WidgetBridgeModule';

export interface WidgetBridge {
  /** True where home-screen widgets exist: iOS and Android, not web. */
  readonly isSupported: boolean;
  /** Write the snapshot the widgets render and trigger a refresh. */
  publishSnapshot(snapshot: WidgetSnapshot): Promise<void>;
  /** Gradings queued by the widget since the last drain. */
  readPendingGrades(): Promise<PendingWidgetGrade[]>;
  /** Clear the queue once the app has applied it. */
  clearPendingGrades(): Promise<void>;
  /** Ask the OS to re-render all widget instances. */
  reloadWidgets(): Promise<void>;
}

export const widgetBridge: WidgetBridge = {
  get isSupported() {
    return WidgetBridgeModule.isSupported;
  },

  async publishSnapshot(snapshot) {
    if (!WidgetBridgeModule.isSupported) return;
    await WidgetBridgeModule.writeSnapshot(JSON.stringify(snapshot));
    await WidgetBridgeModule.reloadWidgets();
  },

  async readPendingGrades() {
    if (!WidgetBridgeModule.isSupported) return [];
    const raw = await WidgetBridgeModule.readPendingGrades();
    if (!raw) return [];

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isPendingGrade);
    } catch {
      // A malformed queue is dropped rather than blocking launch. Losing an
      // unparseable home-screen tap is a smaller cost than failing to start.
      return [];
    }
  },

  async clearPendingGrades() {
    if (!WidgetBridgeModule.isSupported) return;
    await WidgetBridgeModule.clearPendingGrades();
  },

  async reloadWidgets() {
    if (!WidgetBridgeModule.isSupported) return;
    await WidgetBridgeModule.reloadWidgets();
  },
};

/**
 * Validate what came out of the shared container.
 *
 * The queue is written by native code in another process, so it is untrusted
 * input as far as the app is concerned: a partial write during a crash, or an
 * older widget binary, can leave records that do not match the current shape.
 * Anything that fails this check is dropped rather than fed to the scheduler.
 */
function isPendingGrade(value: unknown): value is PendingWidgetGrade {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.cardId === 'string' &&
    typeof candidate.gradedAt === 'string' &&
    typeof candidate.rating === 'number' &&
    candidate.rating >= 1 &&
    candidate.rating <= 4
  );
}
