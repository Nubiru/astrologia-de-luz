/**
 * G_C-8 unit pairing — slugify + slugifyUnique. Spec anchor: S-1 AC-2.1.3.
 *
 * What this catches:
 *   - The NFKD-normalize step is dropped or replaced with a no-op (accents
 *     leak through; "María" → "maría" instead of "maria").
 *   - The combining-marks regex is wrong (zero-width diacritics survive).
 *   - .toLowerCase() is removed (UPPER-case slugs in URLs break case-sensitive
 *     routing on libSQL's UNIQUE index).
 *   - The non-alphanumeric collapse is too narrow (punctuation creates
 *     adjacent dashes) or too wide (digits are stripped).
 *   - The leading/trailing dash trim is removed (slugs start/end with `-`).
 *   - The 64-char truncation is dropped (very-long names blow past the
 *     teachers.slug column budget once renamed via admin).
 *   - The collision-suffix walk skips a free slot or returns `-1` instead of
 *     `-2` for the first collision.
 */

import { describe, expect, test } from 'vitest';

import { slugify, slugifyUnique } from '@/lib/slugify';

describe('slugify — AC-2.1.3 pipeline', () => {
  test('plain ASCII name kebab-cases (the happy path)', () => {
    expect(slugify('Augusto Rocha')).toBe('augusto-rocha');
  });

  test('lowercases UPPER-case input', () => {
    expect(slugify('AUGUSTO')).toBe('augusto');
  });

  test('strips Spanish diacritics via NFKD', () => {
    // The whole brand voice is Spanish — must handle ÁÉÍÓÚÑáéíóúñ.
    expect(slugify('María José Núñez')).toBe('maria-jose-nunez');
    expect(slugify('Ángel del Sol')).toBe('angel-del-sol');
    expect(slugify('Iñaki')).toBe('inaki');
  });

  test('strips Portuguese + French + German diacritics', () => {
    expect(slugify('São Paulo')).toBe('sao-paulo');
    expect(slugify('François')).toBe('francois');
    expect(slugify('Björk Guðmundsdóttir')).toBe('bjork-gu-mundsdottir');
  });

  test('collapses runs of non-alphanumerics into a single dash', () => {
    expect(slugify("O'Reilly, María—del Carmen")).toBe('o-reilly-maria-del-carmen');
    expect(slugify('hello   world')).toBe('hello-world');
    expect(slugify('a___b...c')).toBe('a-b-c');
  });

  test('trims leading and trailing dashes', () => {
    expect(slugify('---hi---')).toBe('hi');
    expect(slugify('   leading and trailing   ')).toBe('leading-and-trailing');
  });

  test('preserves digits in the output', () => {
    expect(slugify('Astrologia 2026')).toBe('astrologia-2026');
    expect(slugify('Sesión #1')).toBe('sesion-1');
  });

  test('truncates output to 64 characters', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBe(64);
  });

  test('re-trims trailing dash after a truncation severs a hyphen', () => {
    // Construct an input where the 65th character would be a hyphen — the
    // post-truncate trim must remove it so the slug never ends in `-`.
    const head = 'a'.repeat(63);
    const input = `${head}-X`;
    const out = slugify(input);
    expect(out.length).toBeLessThanOrEqual(64);
    expect(out.endsWith('-')).toBe(false);
  });

  test('returns empty string for all-whitespace input', () => {
    expect(slugify('   ')).toBe('');
    expect(slugify('')).toBe('');
  });

  test('returns empty string for input with no ASCII-alphanum characters', () => {
    // Non-Latin scripts have no [a-z0-9] equivalent post-NFKD — the slug is
    // empty and the admin form must require a manual override (AC-2.1.3 last
    // sentence).
    expect(slugify('東京')).toBe('');
    expect(slugify('עברית')).toBe('');
  });
});

describe('slugifyUnique — AC-2.1.3 collision suffix', () => {
  test('returns the base slug when there is no collision', () => {
    expect(slugifyUnique('Augusto Rocha', [])).toBe('augusto-rocha');
    expect(slugifyUnique('Augusto Rocha', ['other-teacher'])).toBe('augusto-rocha');
  });

  test('appends -2 on the first collision (NOT -1)', () => {
    // -1 would conflict with humans hand-typing slugs that contain numerics;
    // AC-2.1.3 spec is "-2, -3, ..." — the first available suffix is 2.
    expect(slugifyUnique('Augusto', ['augusto'])).toBe('augusto-2');
  });

  test('walks forward when -2 is also taken', () => {
    expect(slugifyUnique('Augusto', ['augusto', 'augusto-2'])).toBe('augusto-3');
    expect(slugifyUnique('Augusto', ['augusto', 'augusto-2', 'augusto-3'])).toBe('augusto-4');
  });

  test('fills gaps in the collision sequence', () => {
    // A teacher was archived (slug still present in `existing`); the next
    // creation should reuse the smallest free suffix, not append blindly.
    expect(slugifyUnique('Augusto', ['augusto', 'augusto-2', 'augusto-4'])).toBe('augusto-3');
  });

  test('normalises the input before checking collisions', () => {
    // Admin enters "María", the existing roster already has "maria" — the
    // collision suffix must still kick in.
    expect(slugifyUnique('María', ['maria'])).toBe('maria-2');
  });

  test('accepts an Iterable (Set), not just Array', () => {
    const existing = new Set(['augusto', 'augusto-2']);
    expect(slugifyUnique('Augusto', existing)).toBe('augusto-3');
  });

  test('throws when the collision-suffix budget is exhausted', () => {
    // Empty input → stem '' → every candidate is `-N`; if the existing set
    // contains -2..-9999 we bust the budget. Throwing surfaces the misuse.
    const existing = new Set<string>();
    existing.add(''); // base slug for empty input
    for (let n = 2; n < 10_000; n += 1) existing.add(`-${n}`);
    expect(() => slugifyUnique('', existing)).toThrow(/10000 collisions/i);
  });
});
