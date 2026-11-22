import { describe, expect, it } from "vitest";
import { addWorkingMinutes, workingMinutesBetween, nextWorkingInstant } from "@/lib/worktime";
import {
  AUTO_CLOSE_MIN,
  autoCloseDueAt,
  canReopen,
  computeSla,
  resolveTargetMin,
  shouldAutoClose,
  type SlaInput,
} from "@/lib/sla";

// 20 Nov 2026 is a Friday. All times below are India time.
const ist = (s: string) => new Date(`${s.replace(" ", "T")}:00+05:30`);
const none = new Set<string>();
const show = (d: Date | null) =>
  d ? new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 16).replace("T", " ") : null;

function input(over: Partial<SlaInput> = {}): SlaInput {
  return {
    createdAt: ist("2026-11-16 10:00"), // Monday
    status: "open",
    priority: "medium",
    initialPriority: "medium",
    priorityChanges: [],
    statusChanges: [],
    firstReplyAt: null,
    ...over,
  };
}

describe("working time", () => {
  it("does not count weekends: Friday 18:00 ticket is not late on Sunday morning", () => {
    const created = ist("2026-11-20 18:00");
    // 2 working hours: 30 min on Friday + 90 min on Monday
    expect(show(addWorkingMinutes(created, 120, none))).toBe("2026-11-23 11:00");
    const sla = computeSla(input({ createdAt: created, priority: "urgent", initialPriority: "urgent" }), ist("2026-11-22 09:00"), none);
    expect(sla.late).toBe(false);
    expect(sla.response.usedMin).toBe(30);
  });

  it("starts the clock on Monday 09:30 for a Saturday ticket", () => {
    expect(show(nextWorkingInstant(ist("2026-11-21 14:00"), none))).toBe("2026-11-23 09:30");
    expect(show(addWorkingMinutes(ist("2026-11-21 14:00"), 120, none))).toBe("2026-11-23 11:30");
  });

  it("skips holidays", () => {
    const h = new Set(["2026-11-23"]); // Monday off
    expect(show(nextWorkingInstant(ist("2026-11-21 14:00"), h))).toBe("2026-11-24 09:30");
    expect(workingMinutesBetween(ist("2026-11-20 18:00"), ist("2026-11-24 10:00"), h)).toBe(30 + 30);
  });

  it("landing exactly on closing time stays on that day", () => {
    expect(show(addWorkingMinutes(ist("2026-11-16 09:30"), 540, none))).toBe("2026-11-16 18:30");
  });
});

describe("SLA targets", () => {
  it("urgent fix is due 18:30 on the working day the clock started", () => {
    const created = ist("2026-11-17 10:00");
    expect(resolveTargetMin("urgent", created, none)).toBe(510);
    const sla = computeSla(input({ createdAt: created, priority: "urgent", initialPriority: "urgent" }), ist("2026-11-17 11:00"), none);
    expect(show(sla.resolve.dueAt)).toBe("2026-11-17 18:30");
    expect(show(sla.response.dueAt)).toBe("2026-11-17 12:00");
  });

  it("medium: reply in 4.5h, fix in 3 working days", () => {
    const sla = computeSla(input(), ist("2026-11-16 10:30"), none);
    expect(show(sla.response.dueAt)).toBe("2026-11-16 14:30");
    expect(show(sla.resolve.dueAt)).toBe("2026-11-19 10:00"); // Mon 10:00 + 27h
  });

  it("low: reply in 1 working day, fix in 5 working days", () => {
    const sla = computeSla(input({ priority: "low", initialPriority: "low" }), ist("2026-11-16 10:30"), none);
    expect(show(sla.response.dueAt)).toBe("2026-11-17 10:00");
    expect(show(sla.resolve.dueAt)).toBe("2026-11-23 10:00");
  });

  it("flags a ticket late once the working time is used up", () => {
    const now = ist("2026-11-16 15:00"); // 5h on a medium ticket with no reply (limit 4.5h)
    const sla = computeSla(input(), now, none);
    expect(sla.response.breached).toBe(true);
    expect(sla.late).toBe(true);
  });
});

describe("waiting on the customer", () => {
  const waiting = [{ at: ist("2026-11-16 12:00"), to: "waiting_customer" as const }];

  it("pauses the clock: a week of silence is not our fault", () => {
    const sla = computeSla(
      input({ status: "waiting_customer", statusChanges: waiting, firstReplyAt: ist("2026-11-16 12:00") }),
      ist("2026-11-23 12:00"),
      none,
    );
    expect(sla.resolve.usedMin).toBe(120);
    expect(sla.resolve.paused).toBe(true);
    expect(sla.late).toBe(false);
    expect(sla.resolve.dueAt).toBeNull();
  });

  it("resumes where it left off when the customer replies", () => {
    const changes = [...waiting, { at: ist("2026-11-23 12:00"), to: "open" as const }];
    const sla = computeSla(input({ statusChanges: changes, firstReplyAt: ist("2026-11-16 12:00") }), ist("2026-11-23 13:00"), none);
    expect(sla.resolve.usedMin).toBe(180);
    // 25h left from Mon 12:00: 6.5h Mon + 9h Tue + 9h Wed + 0.5h Thu
    expect(show(sla.resolve.dueAt)).toBe("2026-11-26 10:00");
  });

  it("closes after five working days of silence, not five calendar days", () => {
    const since = ist("2026-11-20 18:00"); // Friday
    expect(AUTO_CLOSE_MIN).toBe(2700);
    expect(show(autoCloseDueAt(since, none))).toBe("2026-11-27 18:00");
    expect(shouldAutoClose(since, ist("2026-11-25 18:00"), none)).toBe(false); // 5 calendar days
    expect(shouldAutoClose(since, ist("2026-11-27 17:59"), none)).toBe(false);
    expect(shouldAutoClose(since, ist("2026-11-27 18:00"), none)).toBe(true);
  });
});

describe("priority changes (decision: keep the clock, apply the new target)", () => {
  it("escalating an old ticket to urgent makes it late straight away", () => {
    const sla = computeSla(
      input({ priority: "urgent", priorityChanges: [{ at: ist("2026-11-18 10:00"), to: "urgent" }] }),
      ist("2026-11-18 10:00"),
      none,
    );
    expect(sla.resolve.breached).toBe(true); // 2 working days used, urgent allowed 8.5h
    expect(sla.late).toBe(true);
  });

  it("judges an already-sent reply against the priority it had at the time", () => {
    const sla = computeSla(
      input({
        priority: "urgent",
        priorityChanges: [{ at: ist("2026-11-16 15:00"), to: "urgent" }],
        firstReplyAt: ist("2026-11-16 13:00"), // 3h: fine for medium (4.5h), too slow for urgent (2h)
      }),
      ist("2026-11-16 16:00"),
      none,
    );
    expect(sla.response.targetMin).toBe(270);
    expect(sla.response.breached).toBe(false);
  });

  it("lowering priority relaxes the target", () => {
    const sla = computeSla(input({ priority: "low", priorityChanges: [{ at: ist("2026-11-16 11:00"), to: "low" }] }), ist("2026-11-18 10:00"), none);
    expect(sla.resolve.breached).toBe(false);
  });
});

describe("reopening", () => {
  it("is allowed for a week after resolution, then it is a new ticket", () => {
    const resolved = ist("2026-11-16 12:00");
    expect(canReopen(resolved, ist("2026-11-23 11:59"))).toBe(true);
    expect(canReopen(resolved, ist("2026-11-23 12:01"))).toBe(false);
  });

  it("a resolved ticket is never shown as late", () => {
    const sla = computeSla(
      input({ status: "resolved", statusChanges: [{ at: ist("2026-11-20 12:00"), to: "resolved" }], firstReplyAt: ist("2026-11-16 11:00") }),
      ist("2026-11-30 12:00"),
      none,
    );
    expect(sla.late).toBe(false);
    expect(sla.resolve.done).toBe(true);
  });
});
