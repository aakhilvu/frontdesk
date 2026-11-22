// End-to-end check of the rules in the brief, against a running app.
// Usage: node scripts/smoke.mjs [baseUrl]      (default http://localhost:3000)
// It creates its own ticket, so it is safe to run against the live site.
const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
let failures = 0;

function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + extra}`);
  if (!ok) failures++;
}

/** A tiny client that keeps its own cookie, so we can act as different agents. */
function client() {
  let cookie = "";
  return async (path, method = "GET", body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text };
  };
}

const anon = client();
const a = client();
const b = client();

const { json: ag } = await anon("/api/agents");
const [agentA, agentB] = ag.agents;
check("9 agents are available", ag.agents.length === 9, String(ag.agents.length));
check("tickets need a signed-in agent", (await anon("/api/tickets")).status === 401);
await a("/api/session", "POST", { agentId: agentA.id });
await b("/api/session", "POST", { agentId: agentB.id });

// ---- create a ticket
const SECRET = `SECRET-TEAM-NOTE-${Date.now()}`;
const email = `smoke${Date.now()}@example.com`;
const created = await a("/api/tickets", "POST", {
  customerName: "Smoke Test", customerEmail: email, subject: "Smoke test ticket", description: "Please ignore, automated check.", priority: "medium",
});
check("ticket can be created", created.status === 201, created.text);
const id = created.json.id;
const T = (p) => `/api/tickets/${id}${p}`;

// ---- INC-0291: two agents take the same ticket at once
const [t1, t2] = await Promise.all([a(T("/take"), "POST", {}), b(T("/take"), "POST", {})]);
const codes = [t1.status, t2.status].sort();
check("INC-0291: exactly one of two simultaneous takes wins", codes[0] === 200 && codes[1] === 409, JSON.stringify(codes));
const loser = t1.status === 409 ? t1 : t2;
check("the loser is told who has the ticket", /already taken/.test(loser.json.error), loser.text);
const owner = t1.status === 200 ? a : b;
const other = t1.status === 200 ? b : a;

check("INC-0291: a non-owner cannot reply to the customer", (await other(T("/reply"), "POST", { body: "I will answer too" })).status === 403);
check("the owner can reply", (await owner(T("/reply"), "POST", { body: "Hello, we are looking into it." })).status === 200);

// ---- INC-0304: private notes never leave the team
check("any agent can add an internal note", (await other(T("/note"), "POST", { body: SECRET })).status === 200);
const detail = await owner(T(""));
check("agents see the note on the ticket page", detail.text.includes(SECRET));
const list = await owner("/api/tickets?view=all&finished=1");
check("INC-0304: note is not in the ticket list", !list.text.includes(SECRET));
const csv = await owner("/api/tickets/export");
check("INC-0304: note is not in the CSV export", csv.status === 200 && !csv.text.includes(SECRET));
const pub = await anon("/api/public/ticket", "POST", { reference: `INC-${String(id).padStart(4, "0")}`, email });
check("customer view works with reference + email", pub.status === 200 && pub.json.messages.length === 2, pub.text);
check("INC-0304: note is not in the customer view", !pub.text.includes(SECRET));
check("customer view hides the ticket from a wrong email", (await anon("/api/public/ticket", "POST", { reference: `INC-${String(id).padStart(4, "0")}`, email: "x@y.com" })).status === 404);
const eventsOnly = JSON.stringify(detail.json.timeline.filter((e) => e.type === "note_added").map((e) => e.data));
check("the history event stores no note text", !eventsOnly.includes(SECRET), eventsOnly);

// ---- waiting on the customer
check("owner sends a question and waits", (await owner(T("/reply"), "POST", { body: "Which browser?", waitForCustomer: true })).status === 200);
let d = (await owner(T(""))).json;
check("ticket is now waiting on the customer with a paused clock", d.ticket.status === "waiting_customer" && d.ticket.sla.resolve.paused);
check("a customer reply resumes it", (await owner(T("/customer-reply"), "POST", { body: "Chrome." })).status === 200);
d = (await owner(T(""))).json;
check("status is open again", d.ticket.status === "open");

// ---- priority change keeps history
check("priority can be changed", (await owner(T("/priority"), "POST", { priority: "urgent" })).status === 200);
d = (await owner(T(""))).json;
check("priority change is in the history", d.timeline.some((e) => e.type === "priority_changed" && e.data.to === "urgent"));

// ---- done / reopen
check("owner marks it done", (await owner(T("/status"), "POST", { status: "resolved" })).status === 200);
check("the customer cannot be replied to while done", (await owner(T("/reply"), "POST", { body: "x" })).status === 409);
check("it can be reopened within the week", (await other(T("/status"), "POST", { status: "open" })).status === 200);

// ---- the record is complete and ordered
d = (await owner(T(""))).json;
const types = d.timeline.map((e) => e.type);
check("history has who/when for every event", d.timeline.every((e) => e.at && (e.actor.name || e.actor.type)), JSON.stringify(types));
check("history order is right", types[0] === "ticket_created" && types.includes("assigned") && types.includes("reply_sent"), types.join(","));

check("input is validated", (await a("/api/tickets", "POST", { customerName: "", customerEmail: "bad", subject: "", description: "", priority: "x" })).status === 400);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed.");
console.log(`Created ticket INC-${String(id).padStart(4, "0")} on ${BASE}`);
process.exit(failures ? 1 : 0);
