// CONTENT module barrel (S-1 §15.1).
// Three section files, one per pool, re-exported from this single entry point so that
// downstream code never imports `./public`, `./panel`, `./email` directly. Pool-isolation
// rule (CP-4 hook-3): pool-a writes public.ts, pool-b writes panel.ts, pool-c writes
// email.ts + this barrel.

export * from './public';
export * from './panel';
export * from './email';
