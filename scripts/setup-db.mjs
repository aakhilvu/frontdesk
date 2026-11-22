// Creates the tables. Usage: npm run db:setup   (add -- --reset to wipe everything first)
import fs from "node:fs";
import pg from "pg";
import { loadEnv } from "./env.mjs";

loadEnv();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
if (process.argv.includes("--reset")) {
  await client.query(`DROP TABLE IF EXISTS ticket_events, messages, internal_notes, tickets, holidays, agents CASCADE`);
  console.log("Dropped existing tables.");
}
await client.query(fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
await client.end();
console.log("Schema is ready.");
