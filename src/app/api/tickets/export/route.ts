import { api, requireAgent } from "@/lib/api";
import { exportCsv } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export const GET = api(async () => {
  await requireAgent();
  return new Response(await exportCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="frontdesk-tickets.csv"',
      "Cache-Control": "no-store",
    },
  });
});
