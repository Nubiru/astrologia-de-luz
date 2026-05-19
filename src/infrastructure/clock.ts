// System clock adapter. Spec anchor: S-2 §7.2.4 row 1316 + Clock port body.
//
// W4-3a: trivial production clock. Tests substitute `{ now: () => fixedDate }`
// at the composition root — never import systemClock in tests when time
// determinism matters.

import type { Clock } from '@/domain/booking/ports';

export const systemClock: Clock = { now: () => new Date() };
