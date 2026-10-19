import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DRIZZLE, type Db } from "../database/database.module";

// Two probes, two questions (k8s wires them separately):
// - live:  "is the process wedged?"  -> restart the pod if not. No deps!
//          If liveness checked the DB, a DB outage would restart every pod
//          in a loop and make things worse.
// - ready: "can I serve traffic right now?" -> pull from the Service if not.
@Controller("health")
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  @Get("live")
  live() {
    return { status: "ok" };
  }

  @Get("ready")
  async ready() {
    try {
      await this.db.execute(sql`select 1`);
      return { status: "ok" };
    } catch {
      throw new ServiceUnavailableException({ status: "db_unavailable" });
    }
  }
}
