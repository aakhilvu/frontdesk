import { api, readJson, requireAgent } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { createTicket, listTickets, type View } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export const GET = api(async (req) => {
  const agent = await requireAgent();
  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "mine";
  if (view !== "mine" && view !== "unassigned" && view !== "all") throw new HttpError(400, "Unknown view");
  const tickets = await listTickets(view as View, agent.id, url.searchParams.get("finished") === "1");
  return { tickets };
});

export const POST = api(async (req) => {
  const agent = await requireAgent();
  const id = await createTicket(agent.id, await readJson(req));
  return Response.json({ id }, { status: 201 });
});
