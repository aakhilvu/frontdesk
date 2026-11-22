import { api, readJson } from "@/lib/api";
import { getPublicTicket } from "@/lib/tickets";

export const dynamic = "force-dynamic";

/**
 * The customer's view of a ticket. No agent sign-in, but the customer must give
 * the ticket reference AND the email on the ticket. Internal notes are never read here.
 */
export const POST = api(async (req) => {
  const { reference, email } = await readJson(req);
  return getPublicTicket(String(reference ?? ""), String(email ?? ""));
});
