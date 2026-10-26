import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import * as schema from "@claimpilot/db";
import {
  reviewDecisionSchema,
  type ReviewDecisionInput,
} from "@claimpilot/shared";
import { AuthGuard } from "../auth/auth.guard";
import { Roles, RolesGuard } from "../auth/roles.guard";
import { CurrentUser, type AuthUser } from "../auth/current-user";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ClaimsService } from "../claims/claims.service";
import { ReviewsService } from "./reviews.service";

const queueQuerySchema = z.object({
  status: z
    .string()
    .default("pending_review")
    .transform((s) => s.split(","))
    .pipe(z.array(z.enum(schema.claimStatus.enumValues))),
});

// Guards run in order: AuthGuard (who are you) then RolesGuard (may you).
@Controller("admin")
@UseGuards(AuthGuard, RolesGuard)
@Roles("reviewer")
export class ReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly claims: ClaimsService,
  ) {}

  @Get("claims")
  queue(
    @Query(new ZodValidationPipe(queueQuerySchema))
    q: z.infer<typeof queueQuerySchema>,
  ) {
    return this.reviews.queue(q.status);
  }

  @Get("claims/:id")
  detail(@Param("id", ParseUUIDPipe) id: string) {
    return this.reviews.detail(id);
  }

  @Post("claims/:id/decision")
  decide(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reviewDecisionSchema))
    body: ReviewDecisionInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reviews.decide({
      claimId: id,
      reviewerId: user.id,
      decision: body.decision,
      notes: body.notes,
      source: "admin",
    });
  }

  @Get("documents/:docId/content")
  async document(@Param("docId", ParseUUIDPipe) docId: string) {
    const { data, mimeType } = await this.claims.readDocument(docId);
    return new StreamableFile(data, { type: mimeType });
  }

  @Get("metrics")
  metrics() {
    return this.reviews.metrics();
  }
}
