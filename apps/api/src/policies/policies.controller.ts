import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { createPolicySchema, type CreatePolicyInput } from "@claimpilot/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, type AuthUser } from "../auth/current-user";
import { PoliciesService } from "./policies.service";

@Controller("policies")
@UseGuards(AuthGuard)
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.policies.list(user.id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createPolicySchema)) body: CreatePolicyInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.policies.create(user.id, body);
  }

  @Post(":id/checkout")
  checkout(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.policies.createCheckoutSession(user.id, id);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.policies.findOne(user.id, id);
  }
}
