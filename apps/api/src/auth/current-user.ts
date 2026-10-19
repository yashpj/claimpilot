import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

export type AuthUser = { id: string; email?: string };
export type AuthedRequest = Request & { user: AuthUser };

// @CurrentUser() user: AuthUser. Typed instead of `@Req() req: any`.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<AuthedRequest>().user,
);
