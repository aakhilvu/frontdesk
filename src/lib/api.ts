import { cookies } from "next/headers";
import { query } from "./db";
import { HttpError } from "./errors";
import type { Agent } from "./tickets";

export const AGENT_COOKIE = "fd_agent";

/**
 * Who is calling? The agent picked on the sign-in screen, stored in a cookie.
 * This is identification, not security (see README): it makes every action
 * traceable to a named agent, which is what the history needs.
 */
export async function currentAgent(): Promise<Agent | null> {
  const raw = (await cookies()).get(AGENT_COOKIE)?.value;
  const id = Number(raw);
  if (!raw || !Number.isInteger(id)) return null;
  const rows = await query<Agent>(`SELECT id, name FROM agents WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function requireAgent(): Promise<Agent> {
  const a = await currentAgent();
  if (!a) throw new HttpError(401, "Please choose who you are first");
  return a;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function ticketId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1 || id > 2_000_000_000) throw new HttpError(404, "Ticket not found");
  return id;
}

/** Turns thrown HttpErrors into JSON error responses; everything else becomes a generic 500. */
export function api<Ctx = unknown>(handler: (req: Request, ctx: Ctx) => Promise<Response | object>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      const out = await handler(req, ctx);
      return out instanceof Response ? out : Response.json(out, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      console.error(e);
      return Response.json({ error: "Something went wrong on our side" }, { status: 500 });
    }
  };
}
