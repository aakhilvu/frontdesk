import { api } from "@/lib/api";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = api(async () => ({
  agents: await query(`SELECT id, name FROM agents ORDER BY name`),
}));
