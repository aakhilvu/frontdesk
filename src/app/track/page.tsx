"use client";
import { useState } from "react";
import Link from "next/link";
import { call } from "@/components/client";
import { fmtDate } from "@/lib/format";

interface PublicTicket {
  reference: string;
  subject: string;
  status: string;
  messages: { from: "you" | "support"; body: string; at: string }[];
}

/** What the customer sees. It comes from an API that has no access to internal notes. */
export default function TrackPage() {
  const [reference, setReference] = useState("");
  const [email, setEmail] = useState("");
  const [ticket, setTicket] = useState<PublicTicket | null>(null);
  const [error, setError] = useState("");

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setTicket(null);
    try {
      setTicket(await call<PublicTicket>("/api/public/ticket", { method: "POST", body: { reference, email } }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="center top">
      <div className="card narrow">
        <h1>Check your ticket</h1>
        <form className="form" onSubmit={lookup}>
          <label>
            Ticket number
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="INC-0002" required />
          </label>
          <label>
            Your email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <button className="btn primary">Show my ticket</button>
        </form>
        {error && <p className="error">{error}</p>}
        <p className="muted small">
          <Link href="/">Support team sign-in</Link>
        </p>
      </div>

      {ticket && (
        <div className="card narrow">
          <span className="ref">{ticket.reference}</span>
          <h2>{ticket.subject}</h2>
          <p>
            Status: <b>{ticket.status}</b>
          </p>
          <ol className="timeline">
            {ticket.messages.map((m, i) => (
              <li key={i} className={m.from === "you" ? "bubble customer" : "bubble agent"}>
                <div className="meta">
                  <b>{m.from === "you" ? "You" : "Arvo Support"}</b> &middot; {fmtDate(m.at)}
                </div>
                <div className="body">{m.body}</div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </main>
  );
}
