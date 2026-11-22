import { cookies } from "next/headers";
import { AGENT_COOKIE, api, currentAgent, readJson } from "@/lib/api";
import { query } from "@/lib/db";
import { HttpError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export const GET = api(async () => ({ agent: await currentAgent() }));

export const POST = api(async (req) => {
  const { agentId } = await readJson(req);
  const rows = await query<{ id: number; name: string }>(`SELECT id, name FROM agents WHERE id = $1`, [Number(agentId)]);
  if (!rows[0]) throw new HttpError(400, "Unknown agent");
  (await cookies()).set(AGENT_COOKIE, String(rows[0].id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return { agent: rows[0] };
});

export const DELETE = api(async () => {
  (await cookies()).delete(AGENT_COOKIE);
  return { ok: true };
});
