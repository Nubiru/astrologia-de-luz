# QA.md — Quality Assurance Tracking Ledger

**Owner**: MEGA (architect) → GAMMA (cleanup) → DELTA (sweep)
**Born**: 2026-05-18 (M-10) per lead directive *"all warnings and errors of qa are not acceptable. we fix all of them. we write the cleanest code possible"*
**Status**: ✅ GREEN

The QA gate (D-036) is `npm run qa = lint && typecheck && test && next build`. This file lists current state + every outstanding issue + ownership, and travels with the repo so any contributor sees the debt at a glance.

---

## Current state (snapshot 2026-05-19T13:30Z, post-G_C-25)

| Gate | Command | Status | Owner |
|------|---------|--------|-------|
| Biome lint + format | `npm run lint` | ✅ **0 errors + 0 warnings** | — |
| TypeScript | `npm run typecheck` | ✅ green | — |
| Vitest | `npm run test` | ✅ 782/782 (+56 new pairings since G_C-23) | — |
| Next build | `next build` | ✅ green (build exits 0 without prod env vars; lazy env getter per G_C-25) | — |
| **qa:fast** | `npm run qa:fast` | ✅ exit 0 (lint + typecheck + test) | — |
| **qa** | `npm run qa` | ✅ exit 0 (lint + typecheck + test + next build) | — |

**G_C-25 closed at 2026-05-19T13:30Z** with the env→getEnv() + db→getDb() lazy refactor. `next build` now passes without prod env vars because module-load no longer triggers zod validation; `/reservar` and `/panel` opt out of SSG via `dynamic = 'force-dynamic'` (they read DB / session per-request anyway). PRODUCTION runtime still requires real env vars — the validation just defers to first-access instead of import-time.

**G_C-23 closed at 2026-05-19T12:30Z** with 18 biome issues resolved (1 error + 17 warnings → 0 + 0). Per-file breakdown in the table below; full PAIRINGS AUDIT in the task result.

---

## Outstanding issues

None. All 18 issues resolved in G_C-23 (per-file breakdown below).

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
