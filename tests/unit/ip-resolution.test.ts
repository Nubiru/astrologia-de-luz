/**
 * G_C-17 unit pairing — `resolveIp` (AC-3.5.4).
 *
 * What this catches:
 *   - `x-forwarded-for` first entry is no longer split on comma — every
 *     caller behind a chain of proxies gets bucketed under the WRONG ip
 *     (the chain string itself), defeating rate-limit semantics.
 *   - The whitespace trim is removed — `'  1.2.3.4  '` would bucket
 *     separately from `'1.2.3.4'`, fragmenting the limit per Vercel edge
 *     formatting whim.
 *   - The header precedence inverts (x-real-ip wins) — the load-bearing
 *     Vercel header is silently ignored.
 *   - The `'unknown'` fallback is dropped — `resolveIp` throws on header-less
 *     test requests, which the integration layer catches and 500s on (a
 *     visitor whose browser strips the header gets a hard 500 instead of
 *     the degraded shared-bucket).
 */

import { describe, expect, test } from 'vitest';

import { resolveIp } from '@/lib/rate-limit';

const h = (entries: Record<string, string>): Headers => new Headers(entries);

describe('resolveIp — AC-3.5.4', () => {
  test('returns the first comma-separated entry of x-forwarded-for', () => {
    expect(resolveIp(h({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12' }))).toBe('1.2.3.4');
  });

  test('trims surrounding whitespace from the first x-forwarded-for entry', () => {
    expect(resolveIp(h({ 'x-forwarded-for': '  1.2.3.4  , 5.6.7.8' }))).toBe('1.2.3.4');
  });

  test('handles a single-entry x-forwarded-for (no comma)', () => {
    expect(resolveIp(h({ 'x-forwarded-for': '203.0.113.5' }))).toBe('203.0.113.5');
  });

  test('falls back to x-real-ip when x-forwarded-for is absent', () => {
    expect(resolveIp(h({ 'x-real-ip': '99.99.99.99' }))).toBe('99.99.99.99');
  });

  test('trims whitespace from x-real-ip on fallback', () => {
    expect(resolveIp(h({ 'x-real-ip': '  10.0.0.1  ' }))).toBe('10.0.0.1');
  });

  test('prefers x-forwarded-for over x-real-ip when both are present', () => {
    expect(resolveIp(h({ 'x-forwarded-for': '1.1.1.1', 'x-real-ip': '2.2.2.2' }))).toBe('1.1.1.1');
  });

  test('returns the literal "unknown" when neither header is present', () => {
    expect(resolveIp(h({}))).toBe('unknown');
  });

  test('IPv6 addresses survive the comma-split intact', () => {
    expect(resolveIp(h({ 'x-forwarded-for': '2001:db8::1, 192.0.2.1' }))).toBe('2001:db8::1');
  });
});
