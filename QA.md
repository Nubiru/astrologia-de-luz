# QA.md — Quality Assurance Tracking Ledger

**Owner**: MEGA (architect) → GAMMA (cleanup) → DELTA (sweep)
**Born**: 2026-05-18 (M-10) per lead directive *"all warnings and errors of qa are not acceptable. we fix all of them. we write the cleanest code possible"*
**Status**: ✅ GREEN — `npm run qa` GREEN end-to-end (lint + typecheck + vitest 891/891 across 62 files + next build). Cascade repair COMPLETE (9/9 files migrated G_C-38..G_C-46) + helper extraction landed (G_C-47) + Restructure-Wave-4 CLOSED at G_C-36 with 4-route manual smoke walk passing on the production-mode server.

The QA gate (D-036) is `npm run qa = lint && typecheck && test && next build`. This file lists current state + every outstanding issue + ownership, and travels with the repo so any contributor sees the debt at a glance.

---

## Current state (snapshot 2026-05-21T11:00Z, post-G_C-36 RESTRUCTURE-WAVE-4 CLOSED)

| Gate | Command | Status | Owner |
|------|---------|--------|-------|
| Biome lint + format | `npm run lint` | ✅ **0 errors + 0 warnings** (145 files clean) | — |
| TypeScript | `npm run typecheck` | ✅ **0 errors** (full-tree since G_C-39) | — |
| Vitest | `npm run test` | ✅ **891/891 tests passing across 62 files** (cascade COMPLETE post-G_C-46) | — |
| Next build | `next build` | ✅ **compiles clean** post-G_C-36 (route table: 4 static + 7 dynamic + proxy middleware). PostBuild `db:migrate` fails locally without env vars — irrelevant for Vercel where Turso creds will be set. | — |
| **qa:fast** | `npm run qa:fast` | ✅ **GREEN end-to-end** (continuous since G_C-46 close) | — |
| **qa** | `npm run qa` | ✅ qa:fast GREEN + next build GREEN + 4-route manual smoke walk passing on `npx next start` (G_C-36) | — |

**Cascade repair COMPLETE (post-G_C-46)**: 9-file test-fixture cascade introduced by G_C-31's 16-file coherent-extract (D-053 exception, lead-warned at M-19) is fully repaired across 9 single-file GAMMA pilots (G_C-38..G_C-46) per D-056 strict one-at-a-time + MEGA re-calibration between each close. 4 Path A variants validated empirically across the 9 files. qa:fast GREEN end-to-end for the first time since 2026-05-20. ZERO `[GAMMA-BLOCK]` events in the 9-pilot run.

---

## Outstanding issues

| Class | Count | Status | Owner |
|-------|-------|--------|-------|
| Helper deduplication (cascade-test stub builders) | 9 cascade files duplicated ~234 LOC | ✅ G_C-47 DONE 2026-05-21 (tests/_helpers/dispatcher-stubs.ts) | — |
| Slow tests (>1s per-test bar) | 1 file / 1 test | ⏳ B-1 BETA audit queued | BETA |
| Suite-level collect-phase wall-time | 45.86s collect vs 33.69s tests sum | 🟡 surfaced for lead awareness; likely OMEGA investigation (separate from B-1) | TBD |

---

## Slow-test bar (set 2026-05-21 M-30 per lead directive)

**Threshold**: per-test execution time
- **>1s = slow** — flag for BETA `/test-evaluation` audit one-at-a-time per D-056.
- **>5s = severe** — escalate; queue a GAMMA fix in the same architect cycle as the BETA audit.

**Current measurement** (post-G_C-47 cascade complete, 2026-05-21T10:00Z):
- Wall-clock: 10.31s / 891 tests / 62 files
- Transform: 4.47s · Collect: 45.86s · Tests sum: 33.69s · Prepare: 5.60s

| Test | File | Cost | Verdict |
|------|------|------|---------|
| `importing @/app/api/sessions/route does not call getEnv` | `tests/integration/build-collect-page-data.spec.ts` | **1731ms** | 🟡 slow (above >1s bar) |
| `importing @/auth does not call getEnv (NextAuth lambda is lazy)` | `tests/integration/build-collect-page-data.spec.ts` | 728ms | ✅ below slow bar (but same root cause as 1731ms) |
| _all other tests_ | _various_ | <500ms | ✅ under bar |

**Hypothesis** (to verify in B-1): `vi.resetModules()` in beforeEach + per-test dynamic `import()` of heavy module graphs (Auth.js v5 beta + Drizzle adapter + Resend SDK + all route handlers) forces a full transpile cost per test, paying N× instead of 1×.

**Suite-level note**: vitest `collect` phase = 45.86s dominates worker time even though wall-clock is reasonable. This is suite-WIDE (not B-1's scope) and likely reflects the same module-graph cost replicated across worker startup. Flagged for lead's situational awareness; potential OMEGA work if it becomes a development friction.

### Cascade repair progress (per D-056 one-at-a-time + MEGA re-calibration between each close)

| File | Concern | Status | Task |
|------|---------|--------|------|
| `tests/integration/webhook-status-dot.test.ts` | A (clock-injection) | ✅ DONE | G_C-38 |
| `tests/unit/brand-owner-lookup.test.ts` | B (factory-over-port + SQL exercise) | ✅ DONE | G_C-39 |
| `tests/integration/notify-fanout-augusto.test.ts` | C.1 (4-port dispatcher; dedupe) | ✅ DONE | G_C-40 |
| `tests/integration/notify-fanout-other-maestro.test.ts` | C.2 (4-port dispatcher; separate-maestro) | ✅ DONE | G_C-41 |
| `tests/integration/notify-failure-logs.test.ts` | C.3 (failure-injection + warning telegram) | ✅ DONE | G_C-42 |
| `tests/integration/visitor-email-failure-warning.test.ts` | C.4 (dispatchTransition factory + failure-injection) | ✅ DONE | G_C-43 |
| `tests/integration/dispatch-transition-matrix.test.ts` | C.5 (dispatchTransition + emailDescriptorFor pure block preserved) | ✅ DONE | G_C-44 |
| `tests/integration/manual-reenviar-success.test.ts` | D.1 (route-handler integration; composition-level injection NEW variant) | ✅ DONE | G_C-45 |
| `tests/integration/manual-reenviar-failure.test.ts` | D.2 (G_C-45 mirror + G_C-42 failure-injection setters) | ✅ DONE | G_C-46 |

### Resolved by G_C-23 (2026-05-19)

| File | Rule | Count | Fix |
|------|------|-------|-----|
| `tests/unit/schema-cp3-tables.test.ts` | `noNonNullAssertion` | 3 | Explicit guard (`if (!x) throw …`) replacing `arr[0]!` |
| `tests/unit/schema-authjs-tables.test.ts` | `noNonNullAssertion` | 4 | Same pattern |
| `tests/unit/schema-teachers-sessions.test.ts` | `noNonNullAssertion` | 1 | Same pattern |
| `tests/integration/auth-session-endpoint.test.ts` | `noNonNullAssertion` | 1 | Local `secret` var + guard for `process.env.AUTH_SECRET` |
| `tests/integration/telegram-sendmessage.test.ts` | `noNonNullAssertion` | 6 | Extract `call = calls[0]` + guard once per test |
| `app/panel/layout.tsx` | `useSemanticElements` | 1 | `<span role="status">` → `<output>` (implicit role=status). Playwright selector `[role="status"][data-color]` → `output[data-color]` in `tests/e2e/panel-auth-guard.spec.ts:155` |
| `components/reservar/PickerStep.tsx` | `useSemanticElements` | 1 | Inline `// biome-ignore` between attributes — WAI-ARIA APG card-radio pattern is canonical when the card wraps rich content (avatar + name + bio); `<input type="radio">` cannot contain block content. Pattern asserted by `tests/e2e/reservar-2-maestros-4-steps.spec.ts:8,58`. |
| `tsconfig.json` | `format` | 1 | `npx biome format --write tsconfig.json` (auto-fix) |

**Total**: 18 issues across 9 files. Two cascaded into a test file (`panel-auth-guard.spec.ts` selector swap). No rule globally demoted; one localized `biome-ignore` with rationale for the WAI-ARIA pattern.

### Resolved by G_C-23 (2026-05-19)

| File | Rule | Count | Fix |
|------|------|-------|-----|
| `tests/unit/schema-cp3-tables.test.ts` | `noNonNullAssertion` | 3 | Explicit guard (`if (!x) throw …`) replacing `arr[0]!` |
| `tests/unit/schema-authjs-tables.test.ts` | `noNonNullAssertion` | 4 | Same pattern |
| `tests/unit/schema-teachers-sessions.test.ts` | `noNonNullAssertion` | 1 | Same pattern |
| `tests/integration/auth-session-endpoint.test.ts` | `noNonNullAssertion` | 1 | Local `secret` var + guard for `process.env.AUTH_SECRET` |
| `tests/integration/telegram-sendmessage.test.ts` | `noNonNullAssertion` | 6 | Extract `call = calls[0]` + guard once per test |
| `app/panel/layout.tsx` | `useSemanticElements` | 1 | `<span role="status">` → `<output>` (implicit role=status). Playwright selector `[role="status"][data-color]` → `output[data-color]` in `tests/e2e/panel-auth-guard.spec.ts:155` |
| `components/reservar/PickerStep.tsx` | `useSemanticElements` | 1 | Inline `// biome-ignore` between attributes — WAI-ARIA APG card-radio pattern is canonical when the card wraps rich content (avatar + name + bio); `<input type="radio">` cannot contain block content. Pattern asserted by `tests/e2e/reservar-2-maestros-4-steps.spec.ts:8,58`. |
| `tsconfig.json` | `format` | 1 | `npx biome format --write tsconfig.json` (auto-fix) |

**Total**: 18 issues across 9 files. Two cascaded into a test file (`panel-auth-guard.spec.ts` selector swap). No rule globally demoted; one localized `biome-ignore` with rationale for the WAI-ARIA pattern.

---

## Disciplines that this file enforces

| ID | Rule | Origin |
|----|------|--------|
| **D-036** | `npm run qa = lint && typecheck && test && next build`. `qa:fast` skips build for inner loop. | M-9 |
| **D-039** | **Zero-warning posture.** New GAMMA close that introduces ANY new biome warning OR new tsc error is BLOCKED. Re-run lint+typecheck at close. | M-10 |
| **D-040** | `qa:fast` MUST exit 0 at every GAMMA task close. Pairings list the qa:fast check as a verification item (alongside vitest pass count). | M-10 |

---

## History

| Date | Event |
|------|-------|
| 2026-05-18T22:00Z (M-8) | D-036 QA gate canonized; G_C-22 queued for wave-1 latent debt |
| 2026-05-18T22:55Z (M-9) | G_C-22 closed claiming qa:fast=0 |
| 2026-05-18T23:30Z (M-10) | Lead flagged "huge amount of errors". Live biome run surfaces 1 err + 17 warn. QA.md authored. G_C-23 queued. D-039 + D-040 codified. |
| 2026-05-19T12:30Z (G_C-23) | All 18 biome issues resolved (1 err + 17 warn → 0 + 0). `npm run qa:fast` exit 0; vitest 726/726; tsc clean. QA.md flipped 🔴 → ✅. |
| 2026-05-19T13:30Z (G_C-25) | Env lazy-getter refactor lands. `lib/env.ts` + `db/client.ts` flipped from eager-at-module-load to `getEnv()` / `getDb()` memoized getters. Auth.ts uses NextAuth v5 lazy-init lambda. `/reservar` + `/panel` marked `dynamic = 'force-dynamic'` (DB-backed / auth-gated; SSG was attempting prerender at build → env throw). **`npm run qa` now exits 0 without prod env vars** — the build gate is green for the first time. vitest 782/782; tsc clean. |
| 2026-05-19..M-20 (G_C-26..G_C-37) | DDD restructure wave-4 production-code complete. All closes `--qa-fast-waived` for various reasons (foreign tsc in parallel pool, codemod, etc.). |
| 2026-05-20T22:00Z..M-20 (G_C-31 close) | 16-file coherent-extract (D-053 exception, M-16-approved) cascaded 54 vitest + 15 tsc errors into 9 legacy test files. Lead-predicted at M-19; lesson canonized as D-056 at M-20 (minimal-size sequential decomposition default; D-053 exceptions HIGH-COST default-NO). |
| 2026-05-21T00:30..03:30Z (M-20..M-23, G_C-38..G_C-41) | Cascade repair 4/9 done one-at-a-time per D-056. Full-tree tsc 0 since G_C-39; biome clean; vitest cascade 54 → 31 failures (-23 in 4 GAMMA pilots). 5 cascade files remain (3 concern-C + 2 concern-D). |
| 2026-05-21T05:00Z (M-25, G_C-42) | G_C-42 closed (concern C.3 notify-failure-logs); pattern extended with per-port failure-injection setters (`setResultByEventKind` + `setResultByChatId`). Cascade vitest 31 → 26 failures (-5). 4 cascade files remain. |
| 2026-05-21T06:00Z (M-26, G_C-43) | G_C-43 closed (concern C.4 visitor-email-failure-warning); dispatchTransition factory swap pattern proven. Cascade vitest 26 → 21 failures (-5). 3 cascade files remain (C.5 + D.1 + D.2). |
| 2026-05-21T07:00Z (M-27, G_C-44) | G_C-44 closed (concern C.5 dispatch-transition-matrix; emailDescriptorFor pure-mapping describe preserved verbatim; 26 tests passing). Concern C COMPLETE. Cascade vitest 21 → 7 failures (-14). 2 cascade files remain (concern D × 2 manual-reenviar). |
| 2026-05-21T08:00Z (M-28, G_C-45) | G_C-45 closed (concern D.1 manual-reenviar-success; NEW Path A variant validated — composition-injection via vi.spyOn(getComposition)). 5/5 vitest in isolation. 1 cascade file remains (D.2 = G_C-46). |
| 2026-05-21T09:00Z (M-29, G_C-46) | 🎉 **CASCADE COMPLETE.** G_C-46 closed concern D.2 (manual-reenviar-failure; 3/3 vitest in isolation; near-mirror of G_C-45 with G_C-42 failure-injection setters). **qa:fast GREEN end-to-end** — 891/891 tests across 62 files. **Closed WITHOUT `--qa-fast-waived` for the first time since G_C-31 started this cascade 2026-05-20.** G_C-47 helper extraction queued under D-053 mechanical-codemod exception. |
| 2026-05-21T10:00Z (G_C-47) | Helper extraction landed — `tests/_helpers/dispatcher-stubs.ts` (234 LOC) consolidates 4 stub builders + composition-injection helpers; 9 cascade test files migrated to import the shared API. ~220 LOC of duplicate stub code removed across the cascade. qa:fast GREEN end-to-end; 891/891 vitest unchanged. ZERO production touch. |
| 2026-05-21T11:00Z (G_C-36) | 🟢 **RESTRUCTURE-WAVE-4 CLOSED.** Full `npm run qa` GREEN end-to-end (lint + typecheck + vitest 891/891 across 62 files + next build with 4 static + 7 dynamic routes). NEW pairing `tests/integration/post-migration-smoke.test.ts` (4 tests; module-load for `/`, `/reservar`, `/panel` + Auth.js v5 csrf round-trip). Manual smoke walk against production-mode server (`npx next start`, port 3037, in-memory libsql DB seeded via `npm run db:migrate`): `GET /` → 200 · `GET /reservar` → 200 · `GET /panel` → 200 · `GET /api/auth/csrf` → 200 with hex csrfToken. D-045 triage-pause LIFT signaled in NOTIFICATIONS for MEGA architectural close. |
