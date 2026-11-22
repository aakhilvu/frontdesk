# Frontdesk

A small support-ticket system for Arvo Systems' nine support agents. It replaces the shared spreadsheet and WhatsApp group.
Built from the story in *Hiring Test - Full Stack Developer*: a Next.js app (screens and API) with a PostgreSQL database.

- Live URL: https://frontdesk-sage.vercel.app
- What I did not finish, and why: see [NOTE.md](./NOTE.md)

## What it does

- **One screen for agents**: "My tickets", "Unassigned", "Everyone's". Late tickets are red and first; tickets waiting on the customer are purple with a paused clock.
- **Ticket page**: reply to the customer, write a team-only note, record that the customer wrote back, change priority, mark done, reopen.
- **A real history**: every action is stored with who did it and the exact time. Nothing can be edited or deleted afterwards.
- **Customer view** (`/track`): a customer sees only the conversation, never internal notes.
- **CSV export** of all tickets with working time used and whether each was late.

## The rules I found in the story

The brief gives no requirements list, so these are the rules I read out of Meera's notes and the three incident reports. Where the story is silent I made a call and wrote it down here.

| # | Rule | Where it comes from | Where it lives |
|---|------|---------------------|----------------|
| 1 | Urgent: reply in 2 working hours, fix by end of the same working day. Medium: reply in 4.5h (half a day), fix in 3 working days. Low: reply in 1 working day, fix in 5 working days. | Meera, first paragraph. "About" values are taken as exactly these numbers. | `src/lib/sla.ts` |
| 2 | Time only counts 09:30-18:30, Monday-Friday, minus holidays (India time). A ticket arriving Friday 18:00 is not late on Sunday. | "Working hours, not normal clock hours" | `src/lib/worktime.ts`, `holidays` table |
| 3 | Setting a ticket to **waiting on customer** pauses the clock. When the customer replies it continues where it left off. | "That week is not our fault" | `runningSegments()` in `sla.ts` |
| 4 | After **5 working days** of customer silence the ticket is closed automatically by "System". | "about one working week" | `sweepAutoClose()` in `tickets.ts` |
| 5 | A ticket marked done can be **reopened for 7 calendar days**. After that the agent must create a new ticket. A closed (auto-closed) ticket is also not reopened: the customer starts a new one. | "only for about one week... After that it is a new ticket" | `canReopen()`, `changeStatus()` |
| 6 | **Only one agent can take a ticket**, and only the owner can reply to the customer. The take is a single locked database step, so two clicks at once cannot both win. Other agents can still add internal notes. | INC-0291 | `takeTicket()`, `replyToCustomer()` |
| 7 | **Internal notes never reach a customer.** They are in their own table; the customer API, the ticket list, the CSV export and the history log never read note text. | INC-0304 | `internal_notes` table, `getPublicTicket()` |
| 8 | **The record cannot be changed.** History, messages and notes are append-only (database triggers block UPDATE, DELETE and TRUNCATE). Timestamps come from the database clock, not the browser. | INC-0318 | `db/schema.sql` |
| 9 | Agents see which tickets are **late** and which are **waiting on the customer** on the list screen. | "on one screen" | `src/app/(app)/page.tsx` |

### Decisions where the story gives no answer

- **Changing priority mid-way** (Meera's open question): the clock is **not** reset. Working time already used stays, and the new priority's target applies from the original start. So escalating an old ticket to urgent can make it late at once. This is fair to the customer and stops a ticket being re-labelled to dodge being late. The change is recorded in the history. A reply that was already sent is judged against the priority it had at that time.
- **"Fix the same working day"** is taken literally: urgent fix is due at 18:30 on the working day the clock started. A ticket that arrives out of hours starts at 09:30 on the next working day.
- **Reopening** continues the same clock (time used before is kept), because the customer is still unhappy about the same problem.
- **Holidays**: the list is a table. I seeded a few fixed-date public holidays as placeholders; Arvo has to supply its real festival calendar (`INSERT INTO holidays (day, name) VALUES ('2027-03-14', 'Holi');`).
- **Sign-in**: a "who are you?" picker with the nine agents, no passwords. It identifies who did what, it is **not security**. See NOTE.md.
- **Customers** do not write into the system themselves. An agent records "customer wrote back" (that is what email or chat integration would do later).

## Run it locally

You need Node 22.18 or newer (the seed script runs a .ts file directly; Node 24 is what I used) and any PostgreSQL (a free [Neon](https://neon.tech) database works well, or a local install).

```bash
npm install
cp .env.example .env.local        # then put your connection string in DATABASE_URL
npm run db:setup                  # creates the tables
npm run db:seed                   # 9 agents + 9 demo tickets
npm run dev                       # http://localhost:3000
```

Use `npm run db:setup -- --reset` to wipe everything and start over (the tables refuse edits, so the only way to clear them is to drop them).

Try this: sign in as one agent, open another browser as a second agent, and click **Take** on the same ticket in both. Only one will win.
Customer view: go to `/track`, enter `INC-0002` and `lakshmi@bluefern.example`. The internal note on that ticket does not appear.

### Tests

```bash
npm test                          # unit tests for working hours, SLA, pause, auto-close, reopen
npm run smoke                     # end-to-end checks against a running app (see below)
node scripts/smoke.mjs https://YOUR-URL.vercel.app   # the same checks against the live site
```

`smoke` plays the three incidents: two agents taking one ticket at once, a private note checked in the list, the export and the customer view, and the history record. It creates one ticket called "Smoke test ticket".

## Deploy (Vercel + Neon)

1. Create a free Neon project and copy its connection string (the **pooled** one).
2. Run `DATABASE_URL=... npm run db:setup` and `npm run db:seed` once from your machine (or set it in `.env.local`).
3. Push this folder to GitHub, import it in Vercel, and add the environment variable `DATABASE_URL`.
4. Deploy. No other settings are needed.

## How it is built

```
src/lib/worktime.ts   working-hours arithmetic (pure functions)
src/lib/sla.ts        SLA targets, pause logic, auto-close, reopen window (pure functions)
src/lib/tickets.ts    all database reads and writes, one transaction per action
src/app/api/...       thin HTTP routes (JSON); every route except /api/public needs a signed-in agent
src/app/(app)/...     agent screens: list, ticket, new ticket
src/app/track         customer view
db/schema.sql         tables, constraints, append-only triggers
scripts/              setup, seed, smoke test
```

How lateness is worked out: a ticket's SLA is **derived from its history**, not stored. The clock runs while the ticket is "open", pauses while "waiting on customer", stops when done. Used working time is summed over the running periods and compared with the target. That is why Arvo can finally answer "which tickets were late and why": the ticket page shows the target, the time used, and every pause in the history.

### API (all JSON, agent cookie required unless noted)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/agents` | list agents (no sign-in) |
| GET / POST / DELETE | `/api/session` | current agent / sign in / sign out |
| GET | `/api/tickets?view=mine\|unassigned\|all&finished=1` | list with SLA state |
| POST | `/api/tickets` | create a ticket |
| GET | `/api/tickets/:id` | ticket + full history (includes internal notes, agents only) |
| POST | `/api/tickets/:id/take` | take the ticket (409 if someone already did) |
| POST | `/api/tickets/:id/reply` | reply to the customer `{ body, waitForCustomer? }` (owner only) |
| POST | `/api/tickets/:id/note` | internal note `{ body }` |
| POST | `/api/tickets/:id/customer-reply` | record a customer message `{ body }` |
| POST | `/api/tickets/:id/status` | `{ status: "resolved" \| "waiting_customer" \| "open" }` (`open` = reopen) |
| POST | `/api/tickets/:id/priority` | `{ priority: "urgent" \| "medium" \| "low" }` |
| GET | `/api/tickets/export` | CSV, no notes and no message text |
| POST | `/api/public/ticket` | customer view `{ reference, email }` (no sign-in) |
