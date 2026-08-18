import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { LlmProvider } from "../llm/llm.interface";
import * as schema from "@claimpilot/db";
import { StorageService } from "src/storage/storage.service";

export type AgentDeps = {
  db: PostgresJsDatabase<typeof schema>;
  llm: LlmProvider;
  storage: StorageService;
};