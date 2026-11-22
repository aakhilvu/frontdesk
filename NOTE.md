# Note: what I did not finish, and why

**Not done on purpose, to stay within the scope of the brief:**

1. **No real login.** Agents pick their name from a list. Anyone who opens the site can act as any agent. This is enough to record *who* did something, but it does not stop someone pretending to be another agent. Real accounts (passwords or company SSO) are the first thing to add before real use. The cookie holding the agent id is also not signed.
2. **Customers cannot write to the system.** There is no email or chat intake. An agent records "customer wrote back" by hand. The customer page (`/track`) is read-only and is protected only by ticket number + email.
3. **Holidays have no screen.** They are rows in a `holidays` table, and the seeded list is a placeholder. Arvo's real festival calendar must be loaded.
4. **No way to hand a ticket to another agent.** Once taken, a ticket stays with its owner. A "reassign" action for the lead is a natural next step; it would just be another entry in the history.
5. **No search, paging or reports screen.** The list shows up to 500 tickets and the CSV export answers the managers' "which were late and why" question, but there is no dashboard.

**Known limits of what I did build:**

- **Tamper protection is in the database, not cryptographic.** Triggers stop the application and normal SQL from editing or deleting history, but a database administrator could still drop the triggers. A hash chain or write-once storage would be the next level.
- **Auto-close runs when tickets are read**, not on a timer. A ticket whose customer stayed silent is closed the next time anyone opens the list or the ticket (the status the screen shows is always correct). The closing time recorded is when it was noticed, not the exact moment the five days ended; the due moment is shown on the ticket.
- **The urgent rule is literal.** An urgent ticket logged at 18:15 has 15 minutes left to be "fixed the same working day". Meera may want a cut-off; it is a one-line change in `resolveTargetMin`.
- **Time zone is fixed to India (IST)**, which is fine for Arvo and has no daylight saving.
- **Screens refresh every 15 seconds**, not live. Two agents see each other's changes within that time; the server still guarantees only one can take a ticket.
- **Not tested:** the layout on a phone, and heavy load. Automated tests cover the time and SLA maths (unit tests) and the incident scenarios against a real database (`npm run smoke`). There are no browser tests.

**Rules I had to guess** (the story did not say) are listed in the README under "Decisions where the story gives no answer". The main ones: changing priority keeps the used time and applies the new target; reopen is 7 calendar days; "about three days" and "about one week" mean exactly 3 and 5 working days.
