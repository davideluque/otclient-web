const SCREEN_AWAKE_KEY = 'jamera.keepScreenAwake';

export interface ScreenWakeLockHandle {
  readonly enabled: boolean;
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

interface WakeLockSentinelLike extends EventTarget {
  readonly released: boolean;
  release(): Promise<void>;
}

interface WakeLockNavigator {
  wakeLock?: {
    request(type: 'screen'): Promise<WakeLockSentinelLike>;
  };
}

export function loadKeepScreenAwake(): boolean {
  try {
    return localStorage.getItem(SCREEN_AWAKE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function saveKeepScreenAwake(enabled: boolean): void {
  try {
    localStorage.setItem(SCREEN_AWAKE_KEY, String(enabled));
  } catch { /* storage blocked: keep the session value */ }
}

/**
 * Quietly keeps the display awake during a live game. The first request is
 * tied to an ordinary pointer/key gesture for WebKit; no prompt or overlay is
 * introduced. Browsers may still reject/release the lock (Low Power Mode,
 * background tab, unsupported version), which is intentionally non-fatal.
 */
export function bindScreenWakeLock(
  doc: Document = document,
  nav: WakeLockNavigator = navigator,
): ScreenWakeLockHandle {
  let enabled = loadKeepScreenAwake();
  let activated = false;
  let requesting = false;
  let sentinel: WakeLockSentinelLike | null = null;
  let destroyed = false;

  const request = async (): Promise<void> => {
    if (destroyed || !enabled || requesting || sentinel || doc.visibilityState !== 'visible') return;
    if (!nav.wakeLock) return;
    requesting = true;
    try {
      const acquired = await nav.wakeLock.request('screen');
      if (destroyed || !enabled) {
        await acquired.release();
        return;
      }
      sentinel = acquired;
      acquired.addEventListener('release', () => {
        if (sentinel === acquired) sentinel = null;
      }, { once: true });
    } catch (error) {
      console.info('[jamera] screen wake lock unavailable:', error instanceof Error ? error.message : error);
    } finally {
      requesting = false;
    }
  };

  const activate = (): void => {
    activated = true;
    void request();
  };
  const onVisibilityChange = (): void => {
    if (doc.visibilityState === 'visible' && activated) void request();
  };

  doc.addEventListener('pointerdown', activate, { passive: true });
  doc.addEventListener('keydown', activate);
  doc.addEventListener('visibilitychange', onVisibilityChange);

  return {
    get enabled() { return enabled; },
    setEnabled(next: boolean) {
      enabled = next;
      saveKeepScreenAwake(next);
      if (next) {
        activate();
      } else if (sentinel) {
        const held = sentinel;
        sentinel = null;
        void held.release();
      }
    },
    destroy() {
      destroyed = true;
      doc.removeEventListener('pointerdown', activate);
      doc.removeEventListener('keydown', activate);
      doc.removeEventListener('visibilitychange', onVisibilityChange);
      if (sentinel) {
        const held = sentinel;
        sentinel = null;
        void held.release();
      }
    },
  };
}
