import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { eq } from "drizzle-orm";
import * as schema from "@claimpilot/db";
import { DRIZZLE, type Db } from "../database/database.module";
import { AuthGuard } from "./auth.guard";
import { CurrentUser, type AuthUser } from "./current-user";

// The UI asks "who am I / am I a reviewer?" to decide what to show. The
// API still enforces roles on every admin route; this is UX, not security.
@Controller("me")
@UseGuards(AuthGuard)
export class MeController {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  @Get()
  async me(@CurrentUser() user: AuthUser) {
    const [row] = await this.db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, user.id));
    return { id: user.id, email: user.email, role: row?.role ?? "customer" };
  }
}
