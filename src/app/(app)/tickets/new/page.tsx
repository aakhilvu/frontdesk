"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { call } from "@/components/client";

export default function NewTicketPage() {
  const router = useRouter();
  const [f, setF] = useState({ customerName: "", customerEmail: "", subject: "", description: "", priority: "medium" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await call<{ id: number }>("/api/tickets", { method: "POST", body: f });
      router.push(`/tickets/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h1>New ticket</h1>
      <p className="muted">Log a problem the customer reported. The clock starts now (or at 9:30 on the next working day).</p>
      <label>
        Customer name
        <input value={f.customerName} onChange={set("customerName")} required maxLength={120} />
      </label>
      <label>
        Customer email
        <input type="email" value={f.customerEmail} onChange={set("customerEmail")} required maxLength={200} />
      </label>
      <label>
        Subject
        <input value={f.subject} onChange={set("subject")} required maxLength={200} />
      </label>
      <label>
        What happened
        <textarea value={f.description} onChange={set("description")} rows={5} required maxLength={10000} />
      </label>
      <label>
        How bad is it?
        <select value={f.priority} onChange={set("priority")}>
          <option value="urgent">Urgent: the customer cannot work at all</option>
          <option value="medium">Medium: a real problem, but they can work around it</option>
          <option value="low">Low: a question or a small request</option>
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy}>
        Create ticket
      </button>
    </form>
  );
}
