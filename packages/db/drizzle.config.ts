import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/*.ts",
  out: "./drizzle",              // generated SQL migrations land here
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});