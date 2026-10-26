// Runs committed SQL migrations using drizzle-orm's runtime migrator.
// Why not `drizzle-kit migrate`? drizzle-kit is a dev dependency; containers
// (k8s Job, CI) only ship production deps, so they run this compiled file.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  // max: 1 — the migrator takes an advisory lock and must keep one session.
  const client = postgres(url, { max: 1 });
  await migrate(drizzle(client), {
    migrationsFolder: path.join(__dirname, "..", "drizzle"),
  });
  await client.end();
  console.log("migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
