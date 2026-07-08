import { Inject, Injectable } from "@nestjs/common";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@claimpilot/db";
import { DRIZZLE } from "../database/database.module";

@Injectable()
export class PoliciesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}
}