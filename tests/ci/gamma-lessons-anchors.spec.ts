/**
 * D-1 pairing — gamma.md Hard-Learned Lessons anchor liveness.
 *
 * For every empirical anchor cited in `.claude/agents/gamma.md` Lessons 1-11,
 * assert the cited file / pattern / D-row still exists. The point is to fail
 * when a lesson's grounding rots silently:
 *   - the cited file gets renamed or removed
 *   - the cited D-row gets migrated out of META_PILLAR §4
 *   - the cited code pattern (e.g., next-auth pin form, tailwind content[]
 *     glob, package.json qa:fast script) drifts away from what the lesson
 *     teaches
 *
 * A lesson with a dead anchor either needs its anchor updated to the new
 * source-of-truth, or the lesson itself needs to be retired. Either way the
 * doc is no longer canon — this spec turns that drift red within seconds.
 *
 * Anchored to:
 *   - .context/META_PILLAR.md §4 (D-row ledger)
 *   - .context/active/audits/investigations/O-9-tdd-discipline-gap.md (Lesson 11)
 *   - .context/active/audits/investigations/O-10-lessons-cross-cut.md (Lessons 9, 10, 2-sub)
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const exists = (rel: string) => existsSync(resolve(ROOT, rel));

const GAMMA_MD = read('.claude/agents/gamma.md');
const META_PILLAR = read('.context/META_PILLAR.md');
const QA_MD = read('QA.md');

describe('gamma.md Hard-Learned Lessons — anchor liveness', () => {
  describe('structural — every numbered lesson is present', () => {
    test.each([
      ['Lesson 1', /### Lesson 1 — Pairing scope is NOT enough at close/],
      ['Lesson 2', /### Lesson 2 — Transparent scope expansion/],
      ['Lesson 3', /### Lesson 3 — Biome warnings are errors/],
      ['Lesson 4', /### Lesson 4 — The `@\/` alias resolution rule/],
      ['Lesson 5', /### Lesson 5 — next-auth pin form for v5/],
      ['Lesson 6', /### Lesson 6 — Auth\.js v5 anti-enumeration/],
      ['Lesson 7', /### Lesson 7 — Drizzle 0\.36 `extraConfig` is an object literal/],
      ['Lesson 8', /### Lesson 8 — Vitest 2\.1 `MockInstance<T>` generic/],
      ['Lesson 9', /### Lesson 9 — Foundational scaffolding/],
      ['Lesson 10', /### Lesson 10 — Config widens are expected/],
      ['Lesson 11', /### Lesson 11 — Clean Check-in/],
    ])('%s heading present', (_name, pattern) => {
      expect(GAMMA_MD).toMatch(pattern);
    });
  });

  describe('Lesson 1 — qa:fast gate at close (D-040)', () => {
    test('D-040 row exists in META_PILLAR §4', () => {
      expect(META_PILLAR).toMatch(/\|\s*D-040\s*\|/);
      expect(META_PILLAR).toMatch(/qa:fast.*exit 0 at every GAMMA close/i);
    });

    test('package.json declares qa:fast script chaining lint + typecheck + test', () => {
      const pkg = JSON.parse(read('package.json')) as {
        scripts?: Record<string, string>;
      };
      expect(pkg.scripts?.['qa:fast']).toBeDefined();
      const qaFast = pkg.scripts?.['qa:fast'] ?? '';
      expect(qaFast).toContain('lint');
      expect(qaFast).toContain('typecheck');
      expect(qaFast).toContain('test');
    });
  });

  describe('Lesson 2 — class table covers the six classes', () => {
    test.each([
      ['Mechanical scaffolding row'],
      ['Spec-omission sub-class row'],
      ['Config widen row'],
      ['Foundational scaffolding row'],
      ['Tool-drift patch row'],
      ['OUT-OF-SCOPE infra change row'],
    ])('%s present', (label) => {
      // each row appears verbatim as a bold cell in the Lesson 2 table
      const term = label.replace(' row', '');
      expect(GAMMA_MD).toContain(`**${term}**`);
    });

    test('spec-omission empirical anchor — G_A-5 / app/page.tsx', () => {
      expect(GAMMA_MD).toMatch(/G_A-5.*app\/page\.tsx/);
    });
  });

  describe('Lesson 3 — zero-warning posture (D-039)', () => {
    test('D-039 row exists in META_PILLAR §4', () => {
      expect(META_PILLAR).toMatch(/\|\s*D-039\s*\|/);
      expect(META_PILLAR).toMatch(/zero-warning/i);
    });

    test('QA.md tracks lint + typecheck + test gates', () => {
      expect(QA_MD).toContain('npm run lint');
      expect(QA_MD).toContain('npm run typecheck');
      expect(QA_MD).toContain('qa:fast');
    });
  });

  describe('Lesson 4 — @/ alias resolution rule', () => {
    test('tsconfig.json declares the @/* path mapping', () => {
      const ts = JSON.parse(read('tsconfig.json')) as {
        compilerOptions?: { paths?: Record<string, string[]> };
      };
      expect(ts.compilerOptions?.paths?.['@/*']).toBeDefined();
      expect(ts.compilerOptions?.paths?.['@/*']?.[0]).toMatch(/\.\/.*/);
    });

    test('tsconfig.json include[] enumerates tests/ explicitly', () => {
      const ts = JSON.parse(read('tsconfig.json')) as { include?: string[] };
      const include = ts.include ?? [];
      expect(include.some((p) => p.startsWith('tests'))).toBe(true);
    });
  });

  describe('Lesson 5 — next-auth pin form for v5', () => {
    test('package.json pins next-auth to a leading-pre-release form', () => {
      const pkg = JSON.parse(read('package.json')) as {
        dependencies?: Record<string, string>;
      };
      const nextAuth = pkg.dependencies?.['next-auth'];
      expect(nextAuth).toBeDefined();
      // leading-pre-release form opts caret into pre-release matching
      expect(nextAuth).toMatch(/\^5\.0\.0-beta/);
    });
  });

  describe('Lesson 6 — Auth.js v5 anti-enumeration mechanism', () => {
    test('auth.ts exists at repo root', () => {
      expect(exists('auth.ts')).toBe(true);
    });

    test('auth.ts wires pages.verifyRequest to a project-owned route', () => {
      const authTs = read('auth.ts');
      expect(authTs).toMatch(/verifyRequest/);
    });
  });

  describe('Lesson 7 — Drizzle 0.36 extraConfig is an object literal', () => {
    test('drizzle-orm version is in the 0.36+ range (or higher)', () => {
      const pkg = JSON.parse(read('package.json')) as {
        dependencies?: Record<string, string>;
      };
      const drizzle = pkg.dependencies?.['drizzle-orm'] ?? '';
      expect(drizzle).toMatch(/\^?0\.(3[6-9]|[4-9]\d|\d{3,})|\^?[1-9]/);
    });
  });

  describe('Lesson 8 — Vitest 2.1 MockInstance generic', () => {
    test('vitest is a dev dependency', () => {
      const pkg = JSON.parse(read('package.json')) as {
        devDependencies?: Record<string, string>;
      };
      expect(pkg.devDependencies?.vitest).toBeDefined();
    });
  });

  describe('Lesson 9 — Foundational scaffolding (db/client.ts empirical anchor)', () => {
    test('db/client.ts exists (authored by G_B-1)', () => {
      expect(exists('db/client.ts')).toBe(true);
    });

    test('Lesson 9 cites G_B-1 + db/client.ts in the empirical anchor block', () => {
      expect(GAMMA_MD).toMatch(/G_B-1.*db\/client\.ts/s);
    });
  });

  describe('Lesson 10 — Config widens are expected', () => {
    test('tailwind.config.ts content[] includes components/', () => {
      const tailwind = read('tailwind.config.ts');
      expect(tailwind).toMatch(/components\/\*\*\/\*\.\{ts,tsx\}/);
    });

    test('vitest.config.ts aliases next/server to next/server.js', () => {
      const vitestConfig = read('vitest.config.ts');
      expect(vitestConfig).toMatch(/next\/server.*next\/server\.js/s);
    });

    test('Lesson 10 cites all three empirical anchors (G_B-1 / G_A-2 / G_B-4)', () => {
      // anchors block enumerates the 3 tasks by id
      const lesson10 = GAMMA_MD.split('### Lesson 10')[1]?.split('### Lesson 11')[0] ?? '';
      expect(lesson10).toContain('G_B-1');
      expect(lesson10).toContain('G_A-2');
      expect(lesson10).toContain('G_B-4');
    });
  });

  describe('Lesson 11 — Clean Check-in (D-040 + Beck/Hunt+Thomas/Larman+Vodde cites)', () => {
    test('D-040 row exists in META_PILLAR §4', () => {
      expect(META_PILLAR).toMatch(/\|\s*D-040\s*\|/);
    });

    test('Lesson 11 cites the three corpus rows verbatim (rows 702 / 686 / 368)', () => {
      const lesson11 = GAMMA_MD.split('### Lesson 11')[1] ?? '';
      expect(lesson11).toContain('row 702');
      expect(lesson11).toContain('row 686');
      expect(lesson11).toContain('row 368');
    });

    test('Lesson 11 names the validator landing path (G_C-24 via S-3)', () => {
      const lesson11 = GAMMA_MD.split('### Lesson 11')[1] ?? '';
      expect(lesson11).toMatch(/validate-qa-fast\.cjs/);
      expect(lesson11).toMatch(/G_C-24/);
    });

    test('O-9 + O-10 reports exist at the cited audit path', () => {
      expect(exists('.context/active/audits/investigations/O-9-tdd-discipline-gap.md')).toBe(true);
      expect(exists('.context/active/audits/investigations/O-10-lessons-cross-cut.md')).toBe(true);
    });
  });

  describe('Step 5 — gates checklist mentions qa:fast', () => {
    test('Step 5 block references npm run qa:fast', () => {
      const step5 = GAMMA_MD.split('### Step 5')[1]?.split('### Step 6')[0] ?? '';
      expect(step5).toContain('npm run qa:fast');
      expect(step5).toContain('D-040');
    });
  });
});
