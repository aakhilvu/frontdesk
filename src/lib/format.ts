import type { Priority, Status } from "./sla";

// Shapes of the JSON the API returns (dates arrive as ISO strings).
export interface MetricJson {
  targetMin: number;
  usedMin: number;
  done: boolean;
  breached: boolean;
  dueAt: string | null;
  paused: boolean;
}
export interface TicketJson {
  id: number;
  reference: string;
  subject: string;
  customerName: string;
  customerEmail: string;
  priority: Priority;
  status: Status;
  assignee: { id: number; name: string } | null;
  createdAt: string;
  statusSince: string;
  sla: { response: MetricJson; resolve: MetricJson; late: boolean; everBreached: boolean };
  autoCloseAt: string | null;
  canReopen: boolean;
}

const TZ = "Asia/Kolkata";

export function fmtDate(iso: string | Date, seconds = false): string {
  return (
    new Date(iso).toLocaleString("en-IN", {
      timeZone: TZ,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: seconds ? "2-digit" : undefined,
      hour12: false,
    }) + (seconds ? " IST" : "")
  );
}

/** Short form for tables: "Mon 23 Nov, 11:00". */
export function fmtShort(iso: string | Date): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Working minutes as "4h 30m". A working day is 9h, so we stay in hours to avoid confusion. */
export function fmtWork(min: number): string {
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export const STATUS_LABEL = {
  open: "Open",
  waiting_customer: "Waiting on customer",
  resolved: "Done",
  closed: "Closed",
} as const;

export const PRIORITY_LABEL = { urgent: "Urgent", medium: "Medium", low: "Low" } as const;

export interface SlaCell {
  tone: "ok" | "late" | "paused" | "done" | "doneLate";
  text: string;
}

/** One short line describing a metric, used in the list and on the ticket page. */
export function describeMetric(m: MetricJson, kind: "reply" | "fix"): SlaCell {
  if (m.done) {
    if (kind === "reply") return m.breached ? { tone: "doneLate", text: "Replied late" } : { tone: "done", text: "Replied on time" };
    return m.breached ? { tone: "doneLate", text: "Done, was late" } : { tone: "done", text: "Done on time" };
  }
  if (m.breached) return { tone: "late", text: `Late by ${fmtWork(m.usedMin - m.targetMin)}` };
  if (m.paused) return { tone: "paused", text: "Clock paused" };
  if (m.dueAt) return { tone: "ok", text: `Due ${fmtShort(m.dueAt)}` };
  return { tone: "paused", text: "-" };
}
