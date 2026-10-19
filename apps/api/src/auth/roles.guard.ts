import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { eq } from "drizzle-orm";
import * as schema from "@claimpilot/db";
import { DRIZZLE, type Db } from "../database/database.module";
import type { AuthedRequest } from "./current-user";

type Role = (typeof schema.userRole.enumValues)[number];

const ROLES_KEY = "roles";
// @Roles("reviewer") is metadata; RolesGuard reads it via Reflector.
// This is why guards beat middleware for authz: they know which handler runs.
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

// Authentication (who are you?) is AuthGuard. This is authorization (what may
// you do?). Role lives in OUR users table, not the JWT: Supabase tokens don't
// carry our app roles, and a DB lookup means demoting a reviewer is instant.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DRIZZLE) private readonly db: Db,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const { user } = context.switchToHttp().getRequest<AuthedRequest>();
    const [row] = await this.db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, user.id));

    if (!row || !required.includes(row.role)) {
      throw new ForbiddenException("Insufficient role");
    }
    return true;
  }
}
