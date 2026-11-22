"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { call, useAgent } from "@/components/client";
import { PRIORITY_LABEL, STATUS_LABEL, describeMetric, type TicketJson } from "@/lib/format";

type View = "mine" | "unassigned" | "all";
const TABS: { key: View; label: string }[] = [
  { key: "mine", label: "My tickets" },
  { key: "unassigned", label: "Unassigned" },
  { key: "all", label: "Everyone's" },
];

export default function TicketsPage() {
  const agent = useAgent();
  const router = useRouter();
  const [view, setView] = useState<View>("mine");
  const [finished, setFinished] = useState(false);
  const [tickets, setTickets] = useState<TicketJson[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await call<{ tickets: TicketJson[] }>(`/api/tickets?view=${view}${finished ? "&finished=1" : ""}`);
      setTickets(r.tickets);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [view, finished]);

  useEffect(() => {
    setTickets(null);
    load();
    const t = setInterval(load, 15_000); // so you notice when someone else takes a ticket
    return () => clearInterval(t);
  }, [load]);

  async function take(id: number) {
    try {
      await call(`/api/tickets/${id}/take`, { method: "POST", body: {} });
      router.push(`/tickets/${id}`);
    } catch (e) {
      setError((e as Error).message);
      load();
    }
  }

  const late = tickets?.filter((t) => t.sla.late).length ?? 0;
  const waiting = tickets?.filter((t) => t.status === "waiting_customer").length ?? 0;

  return (
    <>
      <div className="row between">
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={view === t.key ? "tab on" : "tab"} onClick={() => setView(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={finished} onChange={(e) => setFinished(e.target.checked)} /> Show done and closed
        </label>
      </div>

      {tickets && (
        <p className="muted summary">
          {tickets.length} ticket{tickets.length === 1 ? "" : "s"}
          {late > 0 && <span className="pill late"> {late} late</span>}
          {waiting > 0 && <span className="pill paused"> {waiting} waiting on customer</span>}
          {view === "mine" && ` for ${agent.name}`}
        </p>
      )}
      {error && <p className="error">{error}</p>}

      {tickets === null ? (
        <p className="muted">Loading...</p>
      ) : tickets.length === 0 ? (
        <div className="card empty">Nothing here{view === "mine" ? ". Pick a ticket from the Unassigned tab." : "."}</div>
      ) : (
        <div className="table-wrap">
          <table className="tickets">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Reply</th>
                <th>Fix</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => {
                const reply = describeMetric(t.sla.response, "reply");
                const fix = describeMetric(t.sla.resolve, "fix");
                const cls = t.sla.late ? "late" : t.status === "waiting_customer" ? "waiting" : t.status === "resolved" || t.status === "closed" ? "finished" : "";
                return (
                  <tr key={t.id} className={cls} onClick={() => router.push(`/tickets/${t.id}`)}>
                    <td>
                      <div className="ref">{t.reference}</div>
                      <div className="subject">{t.subject}</div>
                      <div className="muted small">{t.customerName}</div>
                    </td>
                    <td>
                      <span className={`badge p-${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>
                    </td>
                    <td>
                      <span className={`badge s-${t.status}`}>{STATUS_LABEL[t.status]}</span>
                      {t.sla.late && <span className="badge late">LATE</span>}
                    </td>
                    <td>{t.assignee ? t.assignee.name : <span className="muted">Nobody</span>}</td>
                    <td className={`sla ${reply.tone}`}>{reply.text}</td>
                    <td className={`sla ${fix.tone}`}>{fix.text}</td>
                    <td>
                      {!t.assignee && t.status !== "resolved" && t.status !== "closed" && (
                        <button
                          className="btn small primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            take(t.id);
                          }}
                        >
                          Take
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
