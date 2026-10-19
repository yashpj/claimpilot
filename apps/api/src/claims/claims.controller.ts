import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { ClaimsService } from "./claims.service";

@Controller("claims")
@UseGuards(AuthGuard)
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Post()
  create(@Body() body: { policyId: string }, @Req() req: any) {
    return this.claims.create(req.user.id, body.policyId);
  }

  @Get(":id")
  get(@Param("id") id: string, @Req() req: any) {
    return this.claims.getClaim(req.user.id, id);
  }

  @Post(":id/messages")
  message(
    @Param("id") id: string,
    @Body() body: { text: string },
    @Req() req: any,
  ) {
    return this.claims.sendMessage(req.user.id, id, body.text);
  }
}
