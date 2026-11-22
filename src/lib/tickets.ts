import type { PoolClient } from "pg";
import { query, tx } from "./db";
import { HttpError } from "./errors";
import {
  type Priority,
  type SlaResult,
  type Status,
  PRIORITIES,
  autoCloseDueAt,
  canReopen,
  computeSla,
  shouldAutoClose,
} from "./sla";
import type { Holidays } from "./worktime";

// ---------- types ----------

interface TicketRow {
  id: number;
  customer_name: string;
  customer_email: string;
  subject: string;
  description: string;
  priority: Priority;
  status: Status;
  assignee_id: number | null;
  assignee_name: string | null;
  status_since: Date;
  created_at: Date;
}

export interface Agent {
  id: number;
  name: string;
}

export interface TicketSummary {
  id: number;
  reference: string;
  subject: string;
  customerName: string;
  customerEmail: string;
  priority: Priority;
  status: Status;
  assignee: Agent | null;
  createdAt: Date;
  statusSince: Date;
  sla: SlaResult;
  /** When a waiting-on-customer ticket will be closed automatically. */
  autoCloseAt: Date | null;
  /** True while a resolved ticket can still be reopened. */
  canReopen: boolean;
}

export type TimelineItem = {
  id: number;
  type: string;
  at: Date;
  actor: { type: "agent" | "customer" | "system"; name: string | null };
  data: Record<string, unknown>;
  /** Present on customer-visible messages. */
  message?: string;
  /** Present on internal notes. Only the agent-only detail endpoint ever returns these. */
  note?: string;
};

export const reference = (id: number) => `INC-${String(id).padStart(4, "0")}`;

const TICKET_SELECT = `
  SELECT t.*, a.name AS assignee_name
  FROM tickets t LEFT JOIN agents a ON a.id = t.assignee_id`;

// ---------- holidays ----------

let holidayCache: { at: number; set: Holidays } | null = null;

export async function loadHolidays(): Promise<Holidays> {
  if (holidayCache && Date.now() - holidayCache.at < 60_000) return holidayCache.set;
  const rows = await query<{ day: string }>(`SELECT to_char(day, 'YYYY-MM-DD') AS day FROM holidays`);
  holidayCache = { at: Date.now(), set: new Set(rows.map((r) => r.day)) };
  return holidayCache.set;
}

// ---------- reading ----------

type EventRow = { ticket_id: number; type: string; data: Record<string, string>; created_at: Date };

async function toSummaries(rows: TicketRow[], now: Date): Promise<TicketSummary[]> {
  if (rows.length === 0) return [];
  const holidays = await loadHolidays();
  const events = await query<EventRow>(
    `SELECT ticket_id, type, data, created_at FROM ticket_events
     WHERE ticket_id = ANY($1) AND type IN ('status_changed', 'priority_changed', 'reply_sent')
     ORDER BY id`,
    [rows.map((r) => r.id)],
  );
  const byTicket = new Map<number, EventRow[]>();
  for (const e of events) byTicket.set(e.ticket_id, [...(byTicket.get(e.ticket_id) ?? []), e]);

  return rows.map((t) => {
    const ev = byTicket.get(t.id) ?? [];
    const priorityEvents = ev.filter((e) => e.type === "priority_changed");
    const sla = computeSla(
      {
        createdAt: t.created_at,
        status: t.status,
        priority: t.priority,
        initialPriority: (priorityEvents[0]?.data.from as Priority) ?? t.priority,
        priorityChanges: priorityEvents.map((e) => ({ at: e.created_at, to: e.data.to as Priority })),
        statusChanges: ev.filter((e) => e.type === "status_changed").map((e) => ({ at: e.created_at, to: e.data.to as Status })),
        firstReplyAt: ev.find((e) => e.type === "reply_sent")?.created_at ?? null,
      },
      now,
      holidays,
    );
    return {
      id: t.id,
      reference: reference(t.id),
      subject: t.subject,
      customerName: t.customer_name,
      customerEmail: t.customer_email,
      priority: t.priority,
      status: t.status,
      assignee: t.assignee_id ? { id: t.assignee_id, name: t.assignee_name! } : null,
      createdAt: t.created_at,
      statusSince: t.status_since,
      sla,
      autoCloseAt: t.status === "waiting_customer" ? autoCloseDueAt(t.status_since, holidays) : null,
      canReopen: t.status === "resolved" && canReopen(t.status_since, now),
    };
  });
}

/** Most urgent first: late, then soonest due, then waiting on customer, then finished. */
function rank(t: TicketSummary): [number, number] {
  if (t.status === "closed") return [4, 0];
  if (t.status === "resolved") return [3, 0];
  if (t.status === "waiting_customer") return [t.sla.late ? 0 : 2, 0];
  const due = [t.sla.response.done ? null : t.sla.response.dueAt, t.sla.resolve.dueAt]
    .filter((d): d is Date => !!d)
    .map((d) => d.getTime());
  return [t.sla.late ? 0 : 1, due.length ? Math.min(...due) : 0];
}

export type View = "mine" | "unassigned" | "all";

export async function listTickets(view: View, agentId: number, includeFinished: boolean): Promise<TicketSummary[]> {
  await sweepAutoClose();
  const where: string[] = [];
  const params: unknown[] = [];
  if (view === "mine") {
    params.push(agentId);
    where.push(`t.assignee_id = $${params.length}`);
  } else if (view === "unassigned") {
    where.push(`t.assignee_id IS NULL`);
  }
  if (!includeFinished) where.push(`t.status IN ('open', 'waiting_customer')`);
  const rows = await query<TicketRow>(
    `${TICKET_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY t.id DESC LIMIT 500`,
    params,
  );
  const list = await toSummaries(rows, new Date());
  return list.sort((a, b) => {
    const [ra, da] = rank(a);
    const [rb, db] = rank(b);
    return ra - rb || da - db || b.id - a.id;
  });
}

export async function getTicket(id: number): Promise<{ ticket: TicketSummary; description: string; timeline: TimelineItem[] }> {
  await sweepAutoClose();
  const rows = await query<TicketRow>(`${TICKET_SELECT} WHERE t.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, "Ticket not found");
  const [ticket] = await toSummaries(rows, new Date());

  // Agent-only: joins message bodies AND internal note bodies into one timeline.
  const ev = await query<{
    id: string;
    type: string;
    actor_type: "agent" | "customer" | "system";
    actor_name: string | null;
    data: Record<string, unknown>;
    created_at: Date;
    message_body: string | null;
    note_body: string | null;
  }>(
    `SELECT e.id, e.type, e.actor_type, a.name AS actor_name, e.data, e.created_at,
            m.body AS message_body, n.body AS note_body
     FROM ticket_events e
     LEFT JOIN agents a ON a.id = e.actor_id
     LEFT JOIN messages m ON m.id = (e.data->>'message_id')::bigint
     LEFT JOIN internal_notes n ON n.id = (e.data->>'note_id')::bigint
     WHERE e.ticket_id = $1 ORDER BY e.id`,
    [id],
  );
  const agents = await query<{ id: number; name: string }>(`SELECT id, name FROM agents`);
  const nameOf = (v: unknown) => agents.find((a) => a.id === Number(v))?.name ?? null;

  const timeline = ev.map((e): TimelineItem => {
    const item: TimelineItem = {
      id: Number(e.id),
      type: e.type,
      at: e.created_at,
      actor: { type: e.actor_type, name: e.actor_type === "customer" ? rows[0].customer_name : e.actor_name },
      data: e.data,
    };
    if (e.type === "assigned") item.data = { ...e.data, assignee: nameOf(e.data.assignee_id) };
    if (e.message_body !== null) item.message = e.message_body;
    if (e.note_body !== null) item.note = e.note_body;
    return item;
  });
  return { ticket, description: rows[0].description, timeline };
}

// ---------- writing ----------

/** Lock the ticket row, then run `fn` with a timestamp taken from the database clock after the lock. */
async function withTicket<T>(
  id: number,
  fn: (c: PoolClient, t: TicketRow, at: Date) => Promise<T>,
): Promise<T> {
  return tx(async (c) => {
    const found = await c.query<TicketRow>(
      `SELECT t.*, NULL::text AS assignee_name FROM tickets t WHERE t.id = $1 FOR UPDATE`,
      [id],
    );
    if (!found.rows[0]) throw new HttpError(404, "Ticket not found");
    const at = (await c.query<{ t: Date }>(`SELECT clock_timestamp() AS t`)).rows[0].t;
    return fn(c, found.rows[0], at);
  });
}

type Actor = { type: "agent"; id: number } | { type: "system" } | { type: "customer" };

async function emit(c: PoolClient, ticketId: number, type: string, actor: Actor, at: Date, data: object = {}) {
  await c.query(
    `INSERT INTO ticket_events (ticket_id, type, actor_type, actor_id, data, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [ticketId, type, actor.type, actor.type === "agent" ? actor.id : null, JSON.stringify(data), at],
  );
}

async function setStatus(c: PoolClient, t: TicketRow, to: Status, actor: Actor, at: Date, reason: string) {
  await c.query(`UPDATE tickets SET status = $2, status_since = $3 WHERE id = $1`, [t.id, to, at]);
  await emit(c, t.id, "status_changed", actor, at, { from: t.status, to, reason });
}

const isFinished = (s: Status) => s === "resolved" || s === "closed";

export function text(v: unknown, field: string, max: number): string {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `${field} is required`);
  if (v.trim().length > max) throw new HttpError(400, `${field} is too long (max ${max} characters)`);
  return v.trim();
}

export async function createTicket(
  agentId: number,
  input: Record<string, unknown>,
): Promise<number> {
  const customerName = text(input.customerName, "Customer name", 120);
  const customerEmail = text(input.customerEmail, "Customer email", 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) throw new HttpError(400, "Customer email is not valid");
  const subject = text(input.subject, "Subject", 200);
  const description = text(input.description, "Description", 10_000);
  if (!PRIORITIES.includes(input.priority as Priority)) throw new HttpError(400, "Priority must be urgent, medium or low");

  return tx(async (c) => {
    const at = (await c.query<{ t: Date }>(`SELECT clock_timestamp() AS t`)).rows[0].t;
    const r = await c.query<{ id: number }>(
      `INSERT INTO tickets (customer_name, customer_email, subject, description, priority, status_since, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
      [customerName, customerEmail, subject, description, input.priority, at],
    );
    await emit(c, r.rows[0].id, "ticket_created", { type: "agent", id: agentId }, at, { priority: input.priority });
    return r.rows[0].id;
  });
}

/** "Take this ticket". Safe against two agents clicking at once: the row lock lets exactly one win. */
export async function takeTicket(id: number, agentId: number) {
  return withTicket(id, async (c, t, at) => {
    if (isFinished(t.status)) throw new HttpError(409, "This ticket is already finished");
    if (t.assignee_id) {
      const who = (await c.query<{ name: string }>(`SELECT name FROM agents WHERE id = $1`, [t.assignee_id])).rows[0]?.name;
      throw new HttpError(409, `${who ?? "Another agent"} has already taken this ticket`);
    }
    await c.query(`UPDATE tickets SET assignee_id = $2 WHERE id = $1`, [id, agentId]);
    await emit(c, id, "assigned", { type: "agent", id: agentId }, at, { assignee_id: agentId });
  });
}

function requireAssignee(t: TicketRow, agentId: number) {
  if (!t.assignee_id) throw new HttpError(409, "Take this ticket first");
  if (t.assignee_id !== agentId) throw new HttpError(403, "Only the agent who owns this ticket can do that");
}

export async function replyToCustomer(id: number, agentId: number, body: unknown, waitForCustomer: boolean) {
  const msg = text(body, "Reply", 10_000);
  return withTicket(id, async (c, t, at) => {
    requireAssignee(t, agentId);
    if (isFinished(t.status)) throw new HttpError(409, "This ticket is finished. Reopen it first.");
    const m = await c.query<{ id: string }>(
      `INSERT INTO messages (ticket_id, direction, author_id, body, created_at) VALUES ($1,'agent',$2,$3,$4) RETURNING id`,
      [id, agentId, msg, at],
    );
    await emit(c, id, "reply_sent", { type: "agent", id: agentId }, at, { message_id: Number(m.rows[0].id) });
    if (waitForCustomer && t.status === "open") await setStatus(c, t, "waiting_customer", { type: "agent", id: agentId }, at, "waiting_for_customer");
  });
}

export async function addNote(id: number, agentId: number, body: unknown) {
  const note = text(body, "Note", 10_000);
  return withTicket(id, async (c, _t, at) => {
    const n = await c.query<{ id: string }>(
      `INSERT INTO internal_notes (ticket_id, author_id, body, created_at) VALUES ($1,$2,$3,$4) RETURNING id`,
      [id, agentId, note, at],
    );
    // Only the note's id goes into the history, never its text.
    await emit(c, id, "note_added", { type: "agent", id: agentId }, at, { note_id: Number(n.rows[0].id) });
  });
}

/** An agent records that the customer wrote back. This restarts a paused clock. */
export async function recordCustomerReply(id: number, agentId: number, body: unknown) {
  const msg = text(body, "Customer message", 10_000);
  return withTicket(id, async (c, t, at) => {
    if (t.status === "resolved") throw new HttpError(409, "This ticket is marked done. Use Reopen if the customer is unhappy.");
    if (t.status === "closed") throw new HttpError(409, "This ticket is closed. Please create a new ticket.");
    const m = await c.query<{ id: string }>(
      `INSERT INTO messages (ticket_id, direction, author_id, body, created_at) VALUES ($1,'customer',NULL,$2,$3) RETURNING id`,
      [id, msg, at],
    );
    await emit(c, id, "customer_reply_received", { type: "customer" }, at, { message_id: Number(m.rows[0].id), recorded_by: agentId });
    if (t.status === "waiting_customer") await setStatus(c, t, "open", { type: "customer" }, at, "customer_replied");
  });
}

export async function changeStatus(id: number, agentId: number, to: unknown) {
  return withTicket(id, async (c, t, at) => {
    const actor: Actor = { type: "agent", id: agentId };
    if (to === "resolved") {
      requireAssignee(t, agentId);
      if (isFinished(t.status)) throw new HttpError(409, "This ticket is already finished");
      return setStatus(c, t, "resolved", actor, at, "marked_done");
    }
    if (to === "waiting_customer") {
      requireAssignee(t, agentId);
      if (t.status !== "open") throw new HttpError(409, "Only an open ticket can be set to waiting on the customer");
      return setStatus(c, t, "waiting_customer", actor, at, "waiting_for_customer");
    }
    if (to === "open") {
      if (t.status === "closed") throw new HttpError(409, "This ticket was closed. Please create a new ticket.");
      if (t.status !== "resolved") throw new HttpError(409, "Only a finished ticket can be reopened");
      if (!canReopen(t.status_since, at))
        throw new HttpError(409, "This ticket was marked done more than a week ago, so it can't be reopened. Please create a new ticket.");
      return setStatus(c, t, "open", actor, at, "reopened");
    }
    throw new HttpError(400, "Status must be resolved, waiting_customer or open");
  });
}

export async function changePriority(id: number, agentId: number, to: unknown) {
  if (!PRIORITIES.includes(to as Priority)) throw new HttpError(400, "Priority must be urgent, medium or low");
  return withTicket(id, async (c, t, at) => {
    if (isFinished(t.status)) throw new HttpError(409, "This ticket is finished");
    if (t.priority === to) throw new HttpError(400, `Priority is already ${to}`);
    await c.query(`UPDATE tickets SET priority = $2 WHERE id = $1`, [id, to]);
    await emit(c, id, "priority_changed", { type: "agent", id: agentId }, at, { from: t.priority, to });
  });
}

/**
 * Close tickets whose customer has been silent for 5 working days.
 * Runs whenever tickets are read, so no scheduler is needed; the database clock decides.
 */
export async function sweepAutoClose() {
  const waiting = await query<{ id: number; status_since: Date }>(
    `SELECT id, status_since FROM tickets WHERE status = 'waiting_customer'`,
  );
  if (waiting.length === 0) return;
  const holidays = await loadHolidays();
  const now = new Date();
  for (const w of waiting) {
    if (!shouldAutoClose(w.status_since, now, holidays)) continue;
    await withTicket(w.id, async (c, t, at) => {
      if (t.status !== "waiting_customer" || !shouldAutoClose(t.status_since, at, holidays)) return;
      await setStatus(c, t, "closed", { type: "system" }, at, "no_customer_reply");
    });
  }
}

// ---------- customer-facing view and export ----------

/**
 * What a customer may see. Built only from the `messages` table, so internal notes
 * cannot appear here: they are not even queried.
 */
export async function getPublicTicket(ref: string, email: string) {
  const m = /^INC-(\d{1,9})$/i.exec(ref.trim());
  const id = m ? Number(m[1]) : NaN;
  const rows = Number.isFinite(id)
    ? await query<{ id: number; subject: string; description: string; status: Status; created_at: Date }>(
        `SELECT id, subject, description, status, created_at FROM tickets
         WHERE id = $1 AND lower(customer_email) = lower($2)`,
        [id, email.trim()],
      )
    : [];
  if (!rows[0]) throw new HttpError(404, "No ticket found for that reference and email");
  const msgs = await query<{ direction: "agent" | "customer"; body: string; created_at: Date }>(
    `SELECT direction, body, created_at FROM messages WHERE ticket_id = $1 ORDER BY id`,
    [id],
  );
  const label: Record<Status, string> = {
    open: "We are working on it",
    waiting_customer: "Waiting for your reply",
    resolved: "Done",
    closed: "Closed",
  };
  return {
    reference: reference(id),
    subject: rows[0].subject,
    status: label[rows[0].status],
    createdAt: rows[0].created_at,
    messages: [
      { from: "you", body: rows[0].description, at: rows[0].created_at },
      ...msgs.map((x) => ({ from: x.direction === "agent" ? "support" : "you", body: x.body, at: x.created_at })),
    ],
  };
}

const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of every ticket and whether it was late. Contains no notes and no message bodies. */
export async function exportCsv(): Promise<string> {
  await sweepAutoClose();
  const rows = await query<TicketRow>(`${TICKET_SELECT} ORDER BY t.id`);
  const list = await toSummaries(rows, new Date());
  const replies = await query<{ ticket_id: number; at: Date }>(
    `SELECT ticket_id, min(created_at) AS at FROM ticket_events WHERE type = 'reply_sent' GROUP BY ticket_id`,
  );
  const firstReply = new Map(replies.map((r) => [r.ticket_id, r.at]));
  const head = [
    "reference", "subject", "customer", "priority", "status", "assignee", "created_at", "first_reply_at",
    "status_since", "response_working_min_used", "response_target_min", "resolve_working_min_used",
    "resolve_target_min", "late_now", "was_ever_late",
  ];
  const lines = list
    .sort((a, b) => a.id - b.id)
    .map((t) =>
      [
        t.reference, t.subject, t.customerName, t.priority, t.status, t.assignee?.name, t.createdAt,
        firstReply.get(t.id), t.statusSince, Math.round(t.sla.response.usedMin), t.sla.response.targetMin,
        Math.round(t.sla.resolve.usedMin), t.sla.resolve.targetMin, t.sla.late, t.sla.everBreached,
      ].map(csvCell).join(","),
    );
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
