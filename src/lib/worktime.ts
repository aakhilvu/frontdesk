/**
 * Working-time arithmetic.
 *
 * Arvo works 09:30-18:30 (India time), Monday to Friday, minus holidays.
 * All SLA maths is done in "working minutes" so that weekends, nights and
 * holidays never count against the team.
 *
 * India has no daylight saving, so a fixed +05:30 offset is exact.
 */
export const IST_OFFSET_MIN = 330;
export const DAY_START_MIN = 9 * 60 + 30; // 09:30
export const DAY_END_MIN = 18 * 60 + 30; // 18:30
export const WORK_DAY_MIN = DAY_END_MIN - DAY_START_MIN; // 540 = 9h

const MIN = 60_000;
const DAY = 1440; // minutes

/** Set of "YYYY-MM-DD" strings (India calendar dates) that are holidays. */
export type Holidays = ReadonlySet<string>;

// Work in "IST minutes": minutes since epoch, shifted so that integer
// division by 1440 gives the India calendar day.
const toIst = (d: Date) => d.getTime() / MIN + IST_OFFSET_MIN;
const fromIst = (m: number) => new Date((m - IST_OFFSET_MIN) * MIN);

function dayKey(dayIndex: number): string {
  return new Date(dayIndex * DAY * MIN).toISOString().slice(0, 10);
}

function isWorkingDay(dayIndex: number, holidays: Holidays): boolean {
  // 1970-01-01 (day 0) was a Thursday (4).
  const dow = (((dayIndex + 4) % 7) + 7) % 7;
  if (dow === 0 || dow === 6) return false;
  return !holidays.has(dayKey(dayIndex));
}

/** The first working instant at or after `d` (09:30 next working day if outside hours). */
export function nextWorkingInstant(d: Date, holidays: Holidays): Date {
  let t = toIst(d);
  let day = Math.floor(t / DAY);
  for (;;) {
    if (isWorkingDay(day, holidays)) {
      const open = day * DAY + DAY_START_MIN;
      const close = day * DAY + DAY_END_MIN;
      if (t < open) return fromIst(open);
      if (t < close) return fromIst(t);
    }
    day += 1;
    t = day * DAY; // midnight of the next day; the loop moves it to opening time
  }
}

/** End (18:30) of the working day that contains `d`. `d` must be a working instant. */
export function endOfWorkingDay(d: Date): Date {
  const day = Math.floor(toIst(d) / DAY);
  return fromIst(day * DAY + DAY_END_MIN);
}

/** Working minutes between two instants (0 if b <= a). Fractional minutes are kept. */
export function workingMinutesBetween(a: Date, b: Date, holidays: Holidays): number {
  const s = toIst(a);
  const e = toIst(b);
  if (e <= s) return 0;
  let total = 0;
  for (let day = Math.floor(s / DAY); day <= Math.floor(e / DAY); day++) {
    if (!isWorkingDay(day, holidays)) continue;
    const lo = Math.max(s, day * DAY + DAY_START_MIN);
    const hi = Math.min(e, day * DAY + DAY_END_MIN);
    if (hi > lo) total += hi - lo;
  }
  return total;
}

/**
 * The instant at which `minutes` of working time have passed since `start`.
 * Landing exactly on closing time returns 18:30 (not the next morning).
 */
export function addWorkingMinutes(start: Date, minutes: number, holidays: Holidays): Date {
  let cur = nextWorkingInstant(start, holidays);
  let remaining = minutes;
  for (;;) {
    const t = toIst(cur);
    const day = Math.floor(t / DAY);
    const close = day * DAY + DAY_END_MIN;
    const left = close - t;
    if (remaining <= left) return fromIst(t + remaining);
    remaining -= left;
    cur = nextWorkingInstant(fromIst(close), holidays); // jumps to the next working day's 09:30
  }
}
