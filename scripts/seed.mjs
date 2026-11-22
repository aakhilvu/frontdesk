// Loads the 9 agents and a handful of demo tickets. Usage: npm run db:seed
// Demo tickets are only added when the database has no tickets yet.
import pg from "pg";
import { loadEnv } from "./env.mjs";
import { workingMinutesBetween } from "../src/lib/worktime.ts"; // Node 24 runs .ts directly

loadEnv();

const AGENTS = [
  ["Meera Nair", "meera@arvo.example"],
  ["Priya Menon", "priya@arvo.example"],
  ["Ravi Kumar", "ravi@arvo.example"],
  ["Anjali Das", "anjali@arvo.example"],
  ["Suresh Pillai", "suresh@arvo.example"],
  ["Divya Thomas", "divya@arvo.example"],
  ["Arjun Varma", "arjun@arvo.example"],
  ["Neha Joseph", "neha@arvo.example"],
  ["Kiran Raj", "kiran@arvo.example"],
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

for (const [name, email] of AGENTS) {
  await client.query(`INSERT INTO agents (name, email) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`, [name, email]);
}
console.log(`Agents ready (${AGENTS.length}).`);

const { rows: existing } = await client.query(`SELECT count(*)::int AS n FROM tickets`);
if (existing[0].n > 0) {
  console.log("Tickets already exist, skipping demo tickets.");
  await client.end();
  process.exit(0);
}

const now = new Date();
const holidays = new Set((await client.query(`SELECT to_char(day,'YYYY-MM-DD') AS d FROM holidays`)).rows.map((r) => r.d));
const agentId = Object.fromEntries((await client.query(`SELECT id, split_part(name,' ',1) AS first FROM agents`)).rows.map((r) => [r.first, r.id]));

/** The moment `mins` working minutes before now (binary search on the working-time function). */
function workingAgo(mins) {
  let lo = now.getTime() - 120 * 86400_000;
  let hi = now.getTime();
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (workingMinutesBetween(new Date(mid), now, holidays) > mins) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}
const H = 60; // minutes
const D = 540; // one working day in minutes
const daysAgo = (n) => new Date(now.getTime() - n * 86400_000);

/**
 * Each ticket: when it was created, who owns it, and a list of things that happened.
 * An event is [when, type, ...details]. They are inserted in time order.
 */
const tickets = [
  {
    subject: "Nobody on our team can log in",
    customer: ["Sunil Jacob", "sunil@northwind.example"],
    priority: "urgent",
    desc: "Since this morning every login returns 'session expired'. The whole accounts team is blocked.",
    created: workingAgo(3 * H),
    status: "open",
    events: [],
  },
  {
    subject: "Invoice PDF shows the wrong GST number",
    customer: ["Lakshmi Iyer", "lakshmi@bluefern.example"],
    priority: "medium",
    desc: "The GST number on invoices generated since Monday is missing the last digit.",
    created: workingAgo(1 * D),
    assignee: "Ravi",
    status: "open",
    events: [
      [workingAgo(1 * D - 20), "assigned", "Ravi"],
      [workingAgo(1 * D - 60), "reply", "Ravi", "Thanks for reporting this. We can reproduce it and are checking the invoice template."],
      [workingAgo(1 * D - 90), "note", "Ravi", "TEAM ONLY: she is the CFO's assistant and escalates fast. Template bug is in the v2 invoice layout, ask Anjali before patching."],
    ],
  },
  {
    subject: "Export to Excel keeps timing out",
    customer: ["Rohit Shah", "rohit@kestrel.example"],
    priority: "medium",
    desc: "Exporting more than 5,000 rows fails after about 30 seconds.",
    created: workingAgo(4 * D),
    assignee: "Priya",
    status: "open",
    events: [
      [workingAgo(4 * D - 15), "assigned", "Priya"],
      [workingAgo(4 * D - 2 * H), "reply", "Priya", "We have found the slow query and are working on a fix."],
    ],
  },
  {
    subject: "How do I add a second admin user?",
    customer: ["Meghna Roy", "meghna@orchid.example"],
    priority: "low",
    desc: "We would like another person to be able to manage billing. Where is that setting?",
    created: workingAgo(3 * D),
    assignee: "Priya",
    status: "waiting_customer",
    statusSince: workingAgo(3 * D - 3 * H),
    events: [
      [workingAgo(3 * D - 10), "assigned", "Priya"],
      [workingAgo(3 * D - 3 * H), "reply", "Priya", "Which plan are you on? The steps differ for Basic and Team."],
      [workingAgo(3 * D - 3 * H), "status", "Priya", "open", "waiting_customer", "waiting_for_customer"],
    ],
  },
  {
    subject: "Can we get a dark theme?",
    customer: ["Tom Eapen", "tom@lumen.example"],
    priority: "low",
    desc: "Feature request: a dark theme for night shifts.",
    created: workingAgo(2 * H),
    status: "open",
    events: [],
  },
  {
    subject: "Escalation: reports page is down for us",
    customer: ["Farah Khan", "farah@zenith.example"],
    priority: "urgent",
    desc: "The reports page shows a blank screen. We first thought it was minor, but our month-end close depends on it.",
    created: workingAgo(2 * D),
    assignee: "Anjali",
    status: "open",
    events: [
      [workingAgo(2 * D - 10), "assigned", "Anjali"],
      [workingAgo(2 * D - 2 * H), "reply", "Anjali", "We are looking into it."],
      [workingAgo(1 * D), "priority", "Meera", "medium", "urgent"],
      [workingAgo(1 * D - 5), "note", "Meera", "TEAM ONLY: bumped to urgent, month-end close. Customer has been patient so far."],
    ],
    priorityStart: "medium",
  },
  {
    subject: "Password reset email never arrives",
    customer: ["Joel Mathew", "joel@harbor.example"],
    priority: "medium",
    desc: "I requested a reset three times and got nothing.",
    created: workingAgo(3 * D),
    assignee: "Ravi",
    status: "resolved",
    statusSince: daysAgo(2),
    events: [
      [workingAgo(3 * D - 10), "assigned", "Ravi"],
      [workingAgo(3 * D - 1 * H), "reply", "Ravi", "Please check spam. We have also re-sent the email from our side."],
      [workingAgo(3 * D - 3 * H), "customer", "Joel Mathew", "Found it in spam, thanks!"],
    ],
    resolvedAt: daysAgo(2),
  },
  {
    subject: "Wrong currency on quotes",
    customer: ["Nisha Paul", "nisha@aurum.example"],
    priority: "medium",
    desc: "Quotes show USD instead of INR.",
    created: workingAgo(10 * D),
    assignee: "Divya",
    status: "resolved",
    statusSince: daysAgo(9),
    events: [
      [workingAgo(10 * D - 10), "assigned", "Divya"],
      [workingAgo(10 * D - 1 * H), "reply", "Divya", "Fixed in the account settings. Please refresh."],
    ],
    resolvedAt: daysAgo(9),
  },
  {
    subject: "Need a copy of last year's invoices",
    customer: ["Sam George", "sam@delta.example"],
    priority: "low",
    desc: "Could you send FY 2025 invoices?",
    created: workingAgo(15 * D),
    assignee: "Kiran",
    status: "closed",
    statusSince: daysAgo(3),
    events: [
      [workingAgo(15 * D - 10), "assigned", "Kiran"],
      [workingAgo(14 * D), "reply", "Kiran", "Which email address should we send them to?"],
      [workingAgo(14 * D), "status", "Kiran", "open", "waiting_customer", "waiting_for_customer"],
    ],
    closedAt: daysAgo(3),
  },
];

let n = 0;
for (const t of tickets) {
  const { rows } = await client.query(
    `INSERT INTO tickets (customer_name, customer_email, subject, description, priority, status, assignee_id, status_since, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [t.customer[0], t.customer[1], t.subject, t.desc, t.priority, t.status, t.assignee ? agentId[t.assignee] : null, t.statusSince ?? t.created, t.created],
  );
  const id = rows[0].id;
  const ev = (type, at, actorType, actorId, data) =>
    client.query(`INSERT INTO ticket_events (ticket_id, type, actor_type, actor_id, data, created_at) VALUES ($1,$2,$3,$4,$5,$6)`, [
      id, type, actorType, actorId, JSON.stringify(data), at,
    ]);

  const initialPriority = t.priorityStart ?? t.priority;
  await ev("ticket_created", t.created, "agent", agentId.Meera, { priority: initialPriority });

  const items = [...t.events];
  if (t.resolvedAt) items.push([t.resolvedAt, "status", t.assignee, "open", "resolved", "marked_done"]);
  if (t.closedAt) items.push([t.closedAt, "status", "system", "waiting_customer", "closed", "no_customer_reply"]);
  items.sort((a, b) => a[0] - b[0]);

  for (const [at, kind, who, ...rest] of items) {
    if (kind === "assigned") await ev("assigned", at, "agent", agentId[who], { assignee_id: agentId[who] });
    else if (kind === "reply" || kind === "customer") {
      const dir = kind === "reply" ? "agent" : "customer";
      const m = await client.query(
        `INSERT INTO messages (ticket_id, direction, author_id, body, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [id, dir, kind === "reply" ? agentId[who] : null, rest[0], at],
      );
      if (kind === "reply") await ev("reply_sent", at, "agent", agentId[who], { message_id: Number(m.rows[0].id) });
      else await ev("customer_reply_received", at, "customer", null, { message_id: Number(m.rows[0].id) });
    } else if (kind === "note") {
      const m = await client.query(
        `INSERT INTO internal_notes (ticket_id, author_id, body, created_at) VALUES ($1,$2,$3,$4) RETURNING id`,
        [id, agentId[who], rest[0], at],
      );
      await ev("note_added", at, "agent", agentId[who], { note_id: Number(m.rows[0].id) });
    } else if (kind === "status") {
      const system = who === "system";
      await ev("status_changed", at, system ? "system" : "agent", system ? null : agentId[who], { from: rest[0], to: rest[1], reason: rest[2] });
    } else if (kind === "priority") {
      await ev("priority_changed", at, "agent", agentId[who], { from: rest[0], to: rest[1] });
    }
  }
  n++;
}
console.log(`Added ${n} demo tickets.`);
await client.end();

