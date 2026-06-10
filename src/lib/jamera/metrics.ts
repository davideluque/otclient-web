/**
 * Lightweight metrics bus for the lag investigation: producers
 * (walkController, renderer) report timings unconditionally — a null
 * check when no sink is attached — and the metrics overlay registers
 * itself as the sink while visible. Keeps instrumentation out of every
 * constructor signature.
 */

export type MetricName =
  /** buildMove sent → server step confirmation observed (network + server). */
  | 'step'
  /** One renderer rebuild of the visible region (phone CPU). */
  | 'repaint';

export interface MetricsSink {
  report(name: MetricName, ms: number): void;
}

let sink: MetricsSink | null = null;

export function setMetricsSink(next: MetricsSink | null): void {
  sink = next;
}

export function reportMetric(name: MetricName, ms: number): void {
  sink?.report(name, ms);
}
