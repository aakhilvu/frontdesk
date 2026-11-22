import { api, readJson, requireAgent, ticketId } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import {
  addNote,
  changePriority,
  changeStatus,
  recordCustomerReply,
  replyToCustomer,
  takeTicket,
} from "@/lib/tickets";

export const dynamic = "force-dynamic";

/** POST /api/tickets/:id/{take|reply|note|customer-reply|status|priority} */
export const POST = api(async (req, ctx: { params: Promise<{ id: string; action: string }> }) => {
  const agent = await requireAgent();
  const { id: rawId, action } = await ctx.params;
  const id = ticketId(rawId);
  const body = await readJson(req);

  switch (action) {
    case "take":
      await takeTicket(id, agent.id);
      break;
    case "reply":
      await replyToCustomer(id, agent.id, body.body, body.waitForCustomer === true);
      break;
    case "note":
      await addNote(id, agent.id, body.body);
      break;
    case "customer-reply":
      await recordCustomerReply(id, agent.id, body.body);
      break;
    case "status":
      await changeStatus(id, agent.id, body.status);
      break;
    case "priority":
      await changePriority(id, agent.id, body.priority);
      break;
    default:
      throw new HttpError(404, "Unknown action");
  }
  return { ok: true };
});
