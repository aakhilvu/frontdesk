import {
  type Holidays,
  WORK_DAY_MIN,
  addWorkingMinutes,
  endOfWorkingDay,
  nextWorkingInstant,
  workingMinutesBetween,
} from "./worktime";

export type Priority = "urgent" | "medium" | "low";
export type Status = "open" | "waiting_customer" | "resolved" | "closed";

export const PRIORITIES: Priority[] = ["urgent", "medium", "low"];

/**
 * Meera's promises, converted to working minutes (a working day = 9h = 540 min).
 *   urgent: reply in 2 working hours, fix the same working day
 *   medium: reply in half a day (4.5h),  fix in 3 working days
 *   low:    reply in 1 working day,       fix in 5 working days
 * Urgent "fix" is special: it is "until 18:30 on the working day the clock started",
 * so its minutes depend on the ticket. See resolveTargetMin().
 */
export const RESPONSE_TARGET_MIN: Record<Priority, number> = {
  urgent: 120,
  medium: WORK_DAY_MIN / 2,
  low: WORK_DAY_MIN,
};
const RESOLVE_TARGET_MIN = { medium: 3 * WORK_DAY_MIN, low: 5 * WORK_DAY_MIN } as const;

/** A waiting-on-customer ticket is closed after this much working time of silence (5 working days). */
export const AUTO_CLOSE_MIN = 5 * WORK_DAY_MIN;
/** A resolved ticket can be reopened for this long (calendar time). Afterwards it is a new ticket. */
export const REOPEN_WINDOW_MS = 7 * 24 * 3600_000;

export function canReopen(resolvedAt: Date, now: Date): boolean {
  return now.getTime() - resolvedAt.getTime() <= REOPEN_WINDOW_MS;
}

export function autoCloseDueAt(waitingSince: Date, holidays: Holidays): Date {
  return addWorkingMinutes(waitingSince, AUTO_CLOSE_MIN, holidays);
}

export function shouldAutoClose(waitingSince: Date, now: Date, holidays: Holidays): boolean {
  return workingMinutesBetween(waitingSince, now, holidays) >= AUTO_CLOSE_MIN;
}

/**
 * Working minutes allowed for the fix.
 * Urgent: from the moment the clock starts until 18:30 that same working day.
 * The clock starts at `createdAt`, or at the next 09:30 if the ticket arrived out of hours.
 * The target never depends on the *current* priority's start, only on when the ticket arrived,
 * so escalating an old ticket to urgent can make it late immediately (decision documented in README).
 */
export function resolveTargetMin(priority: Priority, createdAt: Date, holidays: Holidays): number {
  if (priority !== "urgent") return RESOLVE_TARGET_MIN[priority];
  const start = nextWorkingInstant(createdAt, holidays);
  return workingMinutesBetween(start, endOfWorkingDay(start), holidays);
}

export interface Segment {
  start: Date;
  end: Date | null; // null = still running
}

/**
 * The clock runs only while the ticket is "open". It is paused while we wait for the customer
 * (and stops once resolved/closed). Reopening starts it again where it left off.
 */
export function runningSegments(createdAt: Date, changes: { at: Date; to: Status }[]): Segment[] {
  const segs: Segment[] = [];
  let runningFrom: Date | null = createdAt;
  for (const c of changes) {
    if (c.to === "open") {
      if (!runningFrom) runningFrom = c.at;
    } else if (runningFrom) {
      segs.push({ start: runningFrom, end: c.at });
      runningFrom = null;
    }
  }
  if (runningFrom) segs.push({ start: runningFrom, end: null });
  return segs;
}

/** Working minutes the clock has actually been running, up to `t`. */
export function consumedAt(segs: Segment[], t: Date, h: Holidays): number {
  let sum = 0;
  for (const s of segs) {
    if (s.start >= t) break;
    const end = s.end && s.end < t ? s.end : t;
    sum += workingMinutesBetween(s.start, end, h);
  }
  return sum;
}

/** When the clock will hit `targetMin` if it keeps running. null if it is not running now. */
export function dueAt(segs: Segment[], targetMin: number, h: Holidays): Date | null {
  let remaining = targetMin;
  for (const s of segs) {
    if (!s.end) return addWorkingMinutes(s.start, remaining, h);
    const avail = workingMinutesBetween(s.start, s.end, h);
    if (remaining <= avail) return addWorkingMinutes(s.start, remaining, h);
    remaining -= avail;
  }
  return null;
}

export interface SlaInput {
  createdAt: Date;
  status: Status;
  priority: Priority;
  /** Priority the ticket had when it was created. */
  initialPriority: Priority;
  priorityChanges: { at: Date; to: Priority }[];
  statusChanges: { at: Date; to: Status }[];
  firstReplyAt: Date | null;
}

export interface SlaMetric {
  targetMin: number;
  usedMin: number;
  /** Goal reached (replied / resolved). */
  done: boolean;
  /** Used more working time than allowed. */
  breached: boolean;
  /** When it is/was due, if the clock is running. null while paused or stopped. */
  dueAt: Date | null;
  paused: boolean;
}

export interface SlaResult {
  response: SlaMetric;
  resolve: SlaMetric;
  /** Currently late: an unmet goal has already used up its time. */
  late: boolean;
  /** Was late at some point (even if finished now). Used for exports and reports. */
  everBreached: boolean;
}

function priorityAt(input: SlaInput, t: Date): Priority {
  let p = input.initialPriority;
  for (const c of input.priorityChanges) if (c.at <= t) p = c.to;
  return p;
}

export function computeSla(input: SlaInput, now: Date, h: Holidays): SlaResult {
  const segs = runningSegments(input.createdAt, input.statusChanges);
  const terminal = input.status === "resolved" || input.status === "closed";
  const paused = input.status === "waiting_customer";

  // Response: judged against the priority in force when the reply was sent.
  const respDone = input.firstReplyAt !== null;
  const respPriority = respDone ? priorityAt(input, input.firstReplyAt!) : input.priority;
  const respTarget = RESPONSE_TARGET_MIN[respPriority];
  const respUsed = consumedAt(segs, input.firstReplyAt ?? now, h);
  const response: SlaMetric = {
    targetMin: respTarget,
    usedMin: respUsed,
    done: respDone,
    breached: respUsed > respTarget,
    dueAt: respDone || paused || terminal ? null : dueAt(segs, respTarget, h),
    paused: !respDone && paused,
  };

  // Resolution: judged against the current priority, using all working time spent so far.
  const resTarget = resolveTargetMin(input.priority, input.createdAt, h);
  const resUsed = consumedAt(segs, now, h);
  const resolve: SlaMetric = {
    targetMin: resTarget,
    usedMin: resUsed,
    done: terminal,
    breached: resUsed > resTarget,
    dueAt: terminal || paused ? null : dueAt(segs, resTarget, h),
    paused,
  };

  return {
    response,
    resolve,
    late: !terminal && ((!response.done && response.breached) || (!resolve.done && resolve.breached)),
    everBreached: response.breached || resolve.breached,
  };
}
