import { Body, Controller, Post, UseGuards, UsePipes, Req, Param } from "@nestjs/common";
import { createPolicySchema, type CreatePolicyInput } from "@claimpilot/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuthGuard } from "../auth/auth.guard";
import { PoliciesService } from "./policies.service";

@Controller("policies")
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Post()
  @UseGuards(AuthGuard)
  @UsePipes(new ZodValidationPipe(createPolicySchema))
  create(@Body() body: CreatePolicyInput, @Req() req: any) {
    return this.policies.create(req.user.id, body);
  }

  @Post(":id/checkout")
  @UseGuards(AuthGuard)
  checkout(@Param("id") id: string, @Req() req: any) {
    return this.policies.createCheckoutSession(req.user.id, id);
  }
}