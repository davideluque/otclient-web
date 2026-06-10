// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMetricsOverlay } from '../lib/jamera/metricsOverlay';
import { reportMetric, setMetricsSink } from '../lib/jamera/metrics';

afterEach(() => {
  setMetricsSink(null);
  document.body.replaceChildren();
});

describe('metrics bus', () => {
  it('routes reports to the sink and is a no-op without one', () => {
    expect(() => reportMetric('step', 100)).not.toThrow();
    const seen: Array<[string, number]> = [];
    setMetricsSink({ report: (n, ms) => seen.push([n, ms]) });
    reportMetric('step', 180);
    reportMetric('repaint', 6);
    expect(seen).toEqual([['step', 180], ['repaint', 6]]);
  });
});

describe('createMetricsOverlay', () => {
  it('renders the three rows after a measured second and cleans up on destroy', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance'] });
    try {
      const overlay = createMetricsOverlay();
      expect(overlay.el.textContent).toContain('fps —');

      // It registered itself as the sink.
      reportMetric('step', 180);
      reportMetric('repaint', 6);

      // Cross the 1s FPS window.
      for (let i = 0; i < 70; i++) vi.advanceTimersToNextFrame();
      expect(overlay.el.textContent).toMatch(/fps \d+/);
      expect(overlay.el.textContent).toContain('step 180ms');
      expect(overlay.el.textContent).toContain('repaint 6ms');

      overlay.destroy();
      expect(document.body.contains(overlay.el)).toBe(false);
      // Sink detached: further reports go nowhere (no throw).
      expect(() => reportMetric('step', 1)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
