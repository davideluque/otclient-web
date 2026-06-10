/**
 * Controlled failure for malformed or truncated binary input (asset files,
 * network packets). Callers can distinguish "the data is bad" from
 * programming errors instead of catching native RangeErrors thrown from
 * deep inside DataView.
 */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}
