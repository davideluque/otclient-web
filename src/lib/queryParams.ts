/**
 * Small helpers for reading typed values out of `URLSearchParams` (or any
 * `string | null` source). Centralised here so debug / dev / config knobs
 * across the app share the same validation behaviour — silent `NaN`
 * fall-through is the bug we're guarding against everywhere.
 */

export interface IntParseOptions {
  /** Inclusive lower bound. Defaults to no lower bound. */
  min?: number;
  /** Inclusive upper bound. Defaults to no upper bound. */
  max?: number;
}

/**
 * Parse a URL query / dev-flag string into a finite integer.
 * Returns `undefined` (use the caller's default) when:
 * - the input is `null` / empty
 * - it doesn't parse as a finite integer
 * - it falls outside `[min, max]` (if either is provided)
 *
 * Notably this guards against `Number("bad") === NaN` flowing through
 * to consumers that would otherwise treat NaN as "no override."
 */
export function parseQueryInt(raw: string | null, opts: IntParseOptions = {}): number | undefined {
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n)) return undefined;
  if (opts.min !== undefined && n < opts.min) return undefined;
  if (opts.max !== undefined && n > opts.max) return undefined;
  return n;
}
