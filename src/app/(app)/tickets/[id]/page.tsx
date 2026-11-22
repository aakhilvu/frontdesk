"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { call, useAgent } from "@/components/client";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  describeMetric,
  fmtDate,
  fmtWork,
  type MetricJson,
  type TicketJson,
} from "@/lib/format";

interface TimelineItem {
  id: number;
  type: string;
  at: string;
  actor: { type: "agent" | "customer" | "system"; name: string | null };
  data: Record<string, string | number>;
  message?: string;
  note?: string;
}
interface Detail {
  ticket: TicketJson;
  description: string;
  timeline: TimelineItem[];
}

type Tab = "reply" | "note" | "customer";

const REASON: Record<string, string> = {
  waiting_for_customer: "waiting for the customer's answer",
  customer_replied: "the customer replied",
  marked_done: "marked as done",
  reopened: "reopened",
  no_customer_reply: "no customer reply for 5 working days",
};

export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const agent = useAgent();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("reply");
  const [text, setText] = useState("");
  const [waiting, setWaiting] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await call<Detail>(`/api/tickets/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  async function act(path: string, body: unknown = {}, after?: () => void) {
    setBusy(true);
    setError("");
    try {
      await call(`/api/tickets/${id}/${path}`, { method: "POST", body });
      after?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      load();
    }
  }

  if (!data) return error ? <p className="error">{error}</p> : <p className="muted">Loading...</p>;

  const { ticket: t } = data;
  const finished = t.status === "resolved" || t.status === "closed";
  const mine = t.assignee?.id === agent.id;
  const canReply = mine && !finished;

  function send() {
    const done = () => {
      setText("");
      setWaiting(false);
    };
    if (tab === "reply") act("reply", { body: text, waitForCustomer: waiting }, done);
    else if (tab === "note") act("note", { body: text }, done);
    else act("customer-reply", { body: text }, done);
  }

  const reopenUntil = new Date(new Date(t.statusSince).getTime() + 7 * 86400_000);

  return (
    <>
      <p className="small">
        <Link href="/">&larr; All tickets</Link>
      </p>
      <div className="row between wrap">
        <div>
          <span className="ref">{t.reference}</span>
          <h1 className="title">{t.subject}</h1>
        </div>
        <div className="row">
          <span className={`badge p-${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>
          <span className={`badge s-${t.status}`}>{STATUS_LABEL[t.status]}</span>
          {t.sla.late && <span className="badge late">LATE</span>}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="layout">
        <section>
          <div className="card composer">
            {!t.assignee && !finished ? (
              <div className="row between">
                <span>Nobody owns this ticket yet. Take it to reply to the customer.</span>
                <button className="btn primary" disabled={busy} onClick={() => act("take")}>
                  Take this ticket
                </button>
              </div>
            ) : (
              <>
                <div className="tabs">
                  <button className={tab === "reply" ? "tab on" : "tab"} onClick={() => setTab("reply")}>
                    Reply to customer
                  </button>
                  <button className={tab === "note" ? "tab on note" : "tab"} onClick={() => setTab("note")}>
                    Internal note
                  </button>
                  {!finished && (
                    <button className={tab === "customer" ? "tab on" : "tab"} onClick={() => setTab("customer")}>
                      Customer wrote back
                    </button>
                  )}
                </div>

                {tab === "reply" && !canReply ? (
                  <p className="muted">
                    {finished
                      ? "This ticket is finished. Reopen it to reply."
                      : `Only ${t.assignee?.name} can reply to the customer. You can still leave an internal note.`}
                  </p>
                ) : (
                  <>
                    <div className={tab === "note" ? "banner note" : tab === "customer" ? "banner" : "banner reply"}>
                      {tab === "note"
                        ? "Team only. The customer will never see this."
                        : tab === "customer"
                          ? "Record what the customer sent you. This restarts the clock if we were waiting."
                          : `This is sent to ${t.customerName} (${t.customerEmail}).`}
                    </div>
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      rows={4}
                      placeholder={tab === "note" ? "Write a note for the team..." : tab === "customer" ? "What did the customer say?" : "Write your reply..."}
                    />
                    <div className="row between">
                      {tab === "reply" ? (
                        <label className="check">
                          <input type="checkbox" checked={waiting} onChange={(e) => setWaiting(e.target.checked)} /> I'm waiting for their answer (pauses the clock)
                        </label>
                      ) : (
                        <span />
                      )}
                      <button className={tab === "note" ? "btn note" : "btn primary"} disabled={busy || !text.trim()} onClick={send}>
                        {tab === "note" ? "Save internal note" : tab === "customer" ? "Save customer message" : "Send reply"}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          <h2>History</h2>
          <ol className="timeline">
            <li className="bubble customer">
              <div className="meta">
                <b>{t.customerName}</b> wrote &middot; {fmtDate(t.createdAt, true)}
              </div>
              <div className="body">{data.description}</div>
            </li>
            {data.timeline.map((e) => (
              <Event key={e.id} e={e} />
            ))}
          </ol>
        </section>

        <aside>
          <div className="card">
            <h3>Clock</h3>
            <Metric label="First reply" m={t.sla.response} kind="reply" />
            <Metric label="Fix" m={t.sla.resolve} kind="fix" />
            <p className="muted small">Working time only: 9:30 to 18:30, Monday to Friday, no holidays.</p>
            {t.status === "waiting_customer" && t.autoCloseAt && (
              <p className="small">
                Clock is paused while we wait. If the customer stays silent, this ticket closes on <b>{fmtDate(t.autoCloseAt)}</b>.
              </p>
            )}
            {t.status === "resolved" &&
              (t.canReopen ? (
                <p className="small">The customer can ask to reopen it until {fmtDate(reopenUntil)}.</p>
              ) : (
                <p className="small">The reopen window has passed. A new ticket is needed.</p>
              ))}
            {t.status === "closed" && <p className="small">Closed. If the customer writes again, create a new ticket.</p>}
          </div>

          <div className="card">
            <h3>Details</h3>
            <dl>
              <dt>Customer</dt>
              <dd>
                {t.customerName}
                <br />
                <span className="muted small">{t.customerEmail}</span>
              </dd>
              <dt>Owner</dt>
              <dd>{t.assignee ? t.assignee.name : "Nobody yet"}</dd>
              <dt>Created</dt>
              <dd>{fmtDate(t.createdAt)}</dd>
              <dt>Priority</dt>
              <dd>
                <select
                  value={t.priority}
                  disabled={busy || finished}
                  onChange={(e) => act("priority", { priority: e.target.value })}
                >
                  <option value="urgent">Urgent</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </dd>
            </dl>
            <p className="muted small">Changing priority keeps the time already used and applies the new target. It is recorded in the history.</p>
          </div>

          <div className="card actions">
            {t.assignee && mine && !finished && (
              <button className="btn" disabled={busy} onClick={() => act("status", { status: "resolved" })}>
                Mark as done
              </button>
            )}
            {t.status === "open" && mine && (
              <button className="btn" disabled={busy} onClick={() => act("status", { status: "waiting_customer" })}>
                Waiting on customer
              </button>
            )}
            {t.status === "resolved" && t.canReopen && (
              <button className="btn" disabled={busy} onClick={() => act("status", { status: "open" })}>
                Reopen (customer unhappy)
              </button>
            )}
            {!finished && t.assignee && !mine && <p className="muted small">{t.assignee.name} owns this ticket.</p>}
          </div>
        </aside>
      </div>
    </>
  );
}

function Metric({ label, m, kind }: { label: string; m: MetricJson; kind: "reply" | "fix" }) {
  const c = describeMetric(m, kind);
  return (
    <div className="metric">
      <div className="row between">
        <b>{label}</b>
        <span className={`sla ${c.tone}`}>{c.text}</span>
      </div>
      <div className="muted small">
        Used {fmtWork(m.usedMin)} of {fmtWork(m.targetMin)} allowed
      </div>
      <div className="bar">
        <div className={m.breached ? "fill late" : "fill"} style={{ width: `${Math.min(100, (m.usedMin / m.targetMin) * 100)}%` }} />
      </div>
    </div>
  );
}

function Event({ e }: { e: TimelineItem }) {
  const who = e.actor.type === "system" ? "System" : (e.actor.name ?? "Someone");
  const when = fmtDate(e.at, true);

  if (e.message !== undefined) {
    const fromCustomer = e.type === "customer_reply_received";
    return (
      <li className={fromCustomer ? "bubble customer" : "bubble agent"}>
        <div className="meta">
          <b>{who}</b> {fromCustomer ? "wrote back" : "replied to the customer"} &middot; {when}
        </div>
        <div className="body">{e.message}</div>
      </li>
    );
  }
  if (e.note !== undefined) {
    return (
      <li className="bubble note">
        <div className="meta">
          <b>{who}</b> &middot; <span className="lock">INTERNAL NOTE, TEAM ONLY</span> &middot; {when}
        </div>
        <div className="body">{e.note}</div>
      </li>
    );
  }

  let text = "";
  const d = e.data;
  switch (e.type) {
    case "ticket_created":
      text = `Ticket created by ${who} with ${d.priority} priority`;
      break;
    case "assigned":
      text = `${d.assignee ?? who} took this ticket`;
      break;
    case "status_changed":
      text = `${who}: ${STATUS_LABEL[d.from as keyof typeof STATUS_LABEL]} to ${STATUS_LABEL[d.to as keyof typeof STATUS_LABEL]} (${REASON[String(d.reason)] ?? d.reason})`;
      break;
    case "priority_changed":
      text = `${who} changed priority from ${d.from} to ${d.to}`;
      break;
    default:
      text = `${who}: ${e.type}`;
  }
  return (
    <li className="event">
      {text} <span className="muted">&middot; {when}</span>
    </li>
  );
}
