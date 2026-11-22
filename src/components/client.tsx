"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export async function call<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface Agent {
  id: number;
  name: string;
}

const AgentContext = createContext<Agent | null>(null);
export const useAgent = () => useContext(AgentContext)!;

/** Shows the "who are you?" screen until an agent is chosen, then renders the app with a header. */
export function AgentGate({ children }: { children: ReactNode }) {
  const [agent, setAgent] = useState<Agent | null | undefined>(undefined);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState("");
  const path = usePathname();

  useEffect(() => {
    call<{ agent: Agent | null }>("/api/session")
      .then((r) => setAgent(r.agent))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (agent === null) call<{ agents: Agent[] }>("/api/agents").then((r) => setAgents(r.agents)).catch((e) => setError(e.message));
  }, [agent]);

  async function choose(id: number) {
    try {
      const r = await call<{ agent: Agent }>("/api/session", { method: "POST", body: { agentId: id } });
      setAgent(r.agent);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function signOut() {
    await call("/api/session", { method: "DELETE" });
    setAgent(null);
  }

  if (agent === undefined) {
    return <main className="center">{error ? <p className="error">{error}</p> : <p className="muted">Loading...</p>}</main>;
  }

  if (agent === null) {
    return (
      <main className="center">
        <div className="card narrow">
          <h1>Frontdesk</h1>
          <p className="muted">Who are you? Every action is recorded under your name.</p>
          {error && <p className="error">{error}</p>}
          <div className="agent-grid">
            {agents.map((a) => (
              <button key={a.id} className="btn" onClick={() => choose(a.id)}>
                {a.name}
              </button>
            ))}
          </div>
          <p className="muted small">
            Customer? <Link href="/track">Check your ticket</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <AgentContext.Provider value={agent}>
      <header className="topbar">
        <Link href="/" className="brand">
          Frontdesk
        </Link>
        <nav>
          <Link href="/" className={path === "/" ? "active" : ""}>
            Tickets
          </Link>
          <Link href="/tickets/new" className={path === "/tickets/new" ? "active" : ""}>
            New ticket
          </Link>
          <a href="/api/tickets/export">Export CSV</a>
          <Link href="/track">Customer view</Link>
        </nav>
        <div className="who">
          {agent.name}{" "}
          <button className="link" onClick={signOut}>
            Switch
          </button>
        </div>
      </header>
      <main className="page">{children}</main>
    </AgentContext.Provider>
  );
}
