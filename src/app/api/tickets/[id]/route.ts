import { api, requireAgent, ticketId } from "@/lib/api";
import { getTicket } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export const GET = api(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  await requireAgent();
  return getTicket(ticketId((await ctx.params).id));
});
