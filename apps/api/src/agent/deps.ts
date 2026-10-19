import type { TriageConfig } from "@claimpilot/shared";
import type { Db } from "../database/database.module";
import type { LlmProvider } from "../llm/llm.interface";
import type { StorageService } from "../storage/storage.service";
import type { MlClient } from "./ml/ml.client";

// Everything a node needs, passed in. Nodes never `new` a client or read
// process.env, which is what lets the eval suite run the SAME node code
// with local images and a stub DB.
export type AgentDeps = {
  db: Db;
  llm: LlmProvider;
  storage: StorageService;
  ml: MlClient;
  triageConfig: TriageConfig;
  now: () => Date; // injectable clock: relative dates ("yesterday") + tests
};
