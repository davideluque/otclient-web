import { setMetricsSink, type MetricName } from './metrics';

/**
 * Dev metrics overlay (Settings → Show metrics, or ?metrics=1): FPS,
 * walk-step latency, and repaint cost — the decomposition that answers
 * "is the walk lag network/server or phone CPU":
 *
 *   step    = buildMove sent → server confirmation observed
 *             (network round-trip + server tick; Tibia paces steps at
 *             ~400-500ms/tile at base speed, so 'laggy' vs 'normal'
 *             needs this number, not a feeling)
 *   repaint = one full visible-region rebuild on this device
 *
 * The overlay registers as the metrics sink while mounted and runs its
 * own rAF loop for FPS (the renderer only animates while something
 * moves; FPS here measures the device's steady cadence).
 */

export interface MetricsOverlayHandle {
  readonly el: HTMLElement;
  destroy(): void;
}

const ROLLING = 20;

class Rolling {
  private values: number[] = [];
  last = 0;
  push(v: number): void {
    this.last = v;
    this.values.push(v);
    if (this.values.length > ROLLING) this.values.shift();
  }
  avg(): number {
    if (this.values.length === 0) return 0;
    return this.values.reduce((a, b) => a + b, 0) / this.values.length;
  }
  get count(): number { return this.values.length; }
}

export function createMetricsOverlay(parent: HTMLElement = document.body): MetricsOverlayHandle {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'top:calc(8px + env(safe-area-inset-top, 0px))', 'left:50%',
    'transform:translateX(-50%)',
    'background:rgba(0,0,0,0.7)', 'color:#9f9',
    'font:11px/1.5 ui-monospace,monospace', 'padding:4px 10px',
    'border-radius:8px', 'z-index:70', 'pointer-events:none',
    'white-space:pre', 'text-align:left',
  ].join(';');
  parent.appendChild(el);

  const stats: Record<MetricName, Rolling> = { step: new Rolling(), repaint: new Rolling() };
  setMetricsSink({ report: (name, ms) => stats[name].push(ms) });

  let frames = 0;
  let fps = 0;
  let windowStart = performance.now();
  let rafId = 0;
  let lastText = '';
  const tick = (): void => {
    frames++;
    const now = performance.now();
    if (now - windowStart >= 1000) {
      fps = Math.round((frames * 1000) / (now - windowStart));
      frames = 0;
      windowStart = now;
      const fmt = (r: Rolling): string =>
        r.count === 0 ? '—' : `${r.last.toFixed(0)}ms (avg ${r.avg().toFixed(0)})`;
      const text = `fps ${fps}\nstep ${fmt(stats.step)}\nrepaint ${fmt(stats.repaint)}`;
      if (text !== lastText) {
        lastText = text;
        el.textContent = text;
      }
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  el.textContent = 'fps —\nstep —\nrepaint —';

  return {
    el,
    destroy: () => {
      cancelAnimationFrame(rafId);
      setMetricsSink(null);
      el.remove();
    },
  };
}
