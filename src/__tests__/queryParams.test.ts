import { describe, it, expect } from 'vitest';
import { parseQueryInt } from '../lib/queryParams';

describe('parseQueryInt', () => {
  it('returns undefined when input is null or empty', () => {
    expect(parseQueryInt(null)).toBeUndefined();
    expect(parseQueryInt('')).toBeUndefined();
  });

  it('parses a positive integer', () => {
    expect(parseQueryInt('761')).toBe(761);
  });

  it('parses zero', () => {
    expect(parseQueryInt('0')).toBe(0);
  });

  it('parses a negative integer', () => {
    expect(parseQueryInt('-5')).toBe(-5);
  });

  it('returns undefined for non-numeric strings (guards Number("bad") === NaN)', () => {
    expect(parseQueryInt('bad')).toBeUndefined();
    expect(parseQueryInt('761abc')).toBeUndefined();
    expect(parseQueryInt('NaN')).toBeUndefined();
  });

  it('returns undefined for non-integer floats', () => {
    expect(parseQueryInt('3.14')).toBeUndefined();
    expect(parseQueryInt('1e10000')).toBeUndefined();
  });

  it('rejects values below the configured min', () => {
    expect(parseQueryInt('0', { min: 1 })).toBeUndefined();
    expect(parseQueryInt('-5', { min: 1 })).toBeUndefined();
    expect(parseQueryInt('1', { min: 1 })).toBe(1);
  });

  it('rejects values above the configured max', () => {
    expect(parseQueryInt('100', { max: 99 })).toBeUndefined();
    expect(parseQueryInt('99', { max: 99 })).toBe(99);
  });

  it('combines min and max bounds', () => {
    expect(parseQueryInt('5', { min: 1, max: 10 })).toBe(5);
    expect(parseQueryInt('0', { min: 1, max: 10 })).toBeUndefined();
    expect(parseQueryInt('11', { min: 1, max: 10 })).toBeUndefined();
  });
});
