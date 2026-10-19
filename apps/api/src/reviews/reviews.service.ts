import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import * as schema from "@claimpilot/db";
import type { Decision, Recommendation } from "@claimpilot/shared";
import { DRIZZLE, type Db } from "../database/database.module";
import { AgentService } from "../agent/agent.service";
import { ClaimsService } from "../claims/claims.service";

type ClaimStatus = (typeof schema.claimStatus.enumValues)[number];

const STATUS_BY_DECISION: Record<Decision, ClaimStatus> = {
  approved: "approved",
  denied: "denied",
  more_info: "more_info_requested",
};

// Decision vs the agent's advisory recommendation. A disagreement is an
// "overturn": the primary agent-quality metric (spec §5).
const AGREES: Record<Decision, Recommendation> = {
  approved: "approve",
  denied: "deny",
  more_info: "more_info",
};

const DECIDABLE: ClaimStatus[] = ["pending_review", "more_info_requested"];

export const CLAIM_DECIDED = "claim.decided";
export type ClaimDecidedEvent = {
  claimId: string;
  decision: Decision;
  overturned: boolean;
};

export type AssessmentOutput = {
  priority: "priority" | "standard";
  recommendation: Recommendation;
  flags: string[];
  reasons: string[];
  vlm: {
    summary?: string;
    matches_description?: boolean;
    confidence?: number;
  } | null;
  crossCheck: { agree: boolean; detail: string } | null;
};

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly agent: AgentService,
    private readonly claims: ClaimsService,
    private readonly events: EventEmitter2,
  ) {}

  // Review queue: priority first, then oldest first (FIFO within a lane).
  async queue(statuses: ClaimStatus[]) {
    const latest = this.db
      .selectDistinctOn([schema.claimAssessments.claimId], {
        claimId: schema.claimAssessments.claimId,
        output: schema.claimAssessments.output,
        tokenCost: schema.claimAssessments.tokenCost,
      })
      .from(schema.claimAssessments)
      .orderBy(
        schema.claimAssessments.claimId,
        desc(schema.claimAssessments.createdAt),
      )
      .as("latest");

    const rows = await this.db
      .select({
        claim: schema.claims,
        vehicle: schema.vehicles,
        output: latest.output,
        tokenCost: latest.tokenCost,
      })
      .from(schema.claims)
      .innerJoin(
        schema.policies,
        eq(schema.claims.policyId, schema.policies.id),
      )
      .innerJoin(
        schema.vehicles,
        eq(schema.policies.vehicleId, schema.vehicles.id),
      )
      .leftJoin(latest, eq(latest.claimId, schema.claims.id))
      .where(inArray(schema.claims.status, statuses))
      .orderBy(
        sql`case when ${schema.claims.priority} = 'priority' then 0 else 1 end`,
        asc(schema.claims.createdAt),
      )
      .limit(200);

    return rows.map((r) => {
      const out = r.output as AssessmentOutput | null;
      return {
        ...r.claim,
        vehicle: `${r.vehicle.year} ${r.vehicle.make} ${r.vehicle.model}`,
        recommendation: out?.recommendation ?? null,
        flags: out?.flags ?? [],
        costMicroUsd: r.tokenCost,
      };
    });
  }

  async detail(claimId: string) {
    const [row] = await this.db
      .select({
        claim: schema.claims,
        policy: schema.policies,
        vehicle: schema.vehicles,
        customer: { id: schema.users.id, email: schema.users.email },
      })
      .from(schema.claims)
      .innerJoin(
        schema.policies,
        eq(schema.claims.policyId, schema.policies.id),
      )
      .innerJoin(
        schema.vehicles,
        eq(schema.policies.vehicleId, schema.vehicles.id),
      )
      .innerJoin(schema.users, eq(schema.policies.userId, schema.users.id))
      .where(eq(schema.claims.id, claimId));
    if (!row) throw new NotFoundException();

    const [assessments, documents, events, reviews, transcript] =
      await Promise.all([
        this.db
          .select()
          .from(schema.claimAssessments)
          .where(eq(schema.claimAssessments.claimId, claimId))
          .orderBy(desc(schema.claimAssessments.createdAt)),
        this.db
          .select()
          .from(schema.claimDocuments)
          .where(eq(schema.claimDocuments.claimId, claimId))
          .orderBy(asc(schema.claimDocuments.createdAt)),
        this.db
          .select()
          .from(schema.claimEvents)
          .where(eq(schema.claimEvents.claimId, claimId))
          .orderBy(asc(schema.claimEvents.createdAt)),
        this.db
          .select()
          .from(schema.reviews)
          .where(eq(schema.reviews.claimId, claimId))
          .orderBy(desc(schema.reviews.createdAt)),
        this.claims.transcript(claimId),
      ]);

    return { ...row, assessments, documents, events, reviews, transcript };
  }

  async decide(input: {
    claimId: string;
    reviewerId: string;
    decision: Decision;
    notes?: string;
    source: "admin" | "slack";
  }) {
    const { claimId, reviewerId, decision, notes, source } = input;
    const message = customerMessage(decision, notes);

    const result = await this.db.transaction(async (tx) => {
      // FOR UPDATE: the admin UI and a Slack button clicked at the same
      // moment must not both decide. The second waits, then sees the new
      // status and gets a 409.
      const [claim] = await tx
        .select()
        .from(schema.claims)
        .where(eq(schema.claims.id, claimId))
        .for("update");
      if (!claim) throw new NotFoundException();
      if (!DECIDABLE.includes(claim.status)) {
        throw new ConflictException(
          `Claim is ${claim.status}; nothing to decide`,
        );
      }

      const [latest] = await tx
        .select({ output: schema.claimAssessments.output })
        .from(schema.claimAssessments)
        .where(eq(schema.claimAssessments.claimId, claimId))
        .orderBy(desc(schema.claimAssessments.createdAt))
        .limit(1);
      const recommendation = (latest?.output as AssessmentOutput | undefined)
        ?.recommendation;
      const overturned = recommendation
        ? AGREES[decision] !== recommendation
        : false;

      const [review] = await tx
        .insert(schema.reviews)
        .values({
          claimId,
          reviewerId,
          decision,
          notes,
          overturnedAgent: overturned,
        })
        .returning();

      const to = STATUS_BY_DECISION[decision];
      await tx
        .update(schema.claims)
        .set({ status: to })
        .where(eq(schema.claims.id, claimId));

      const actor = `reviewer:${reviewerId}`;
      await tx.insert(schema.claimEvents).values([
        {
          claimId,
          actor,
          eventType: "review_decision",
          payload: {
            reviewId: review.id,
            decision,
            notes,
            recommendation,
            overturned,
            source,
          },
        },
        {
          claimId,
          actor,
          eventType: "status_changed",
          payload: { from: claim.status, to },
        },
        // The customer sees this in their chat (transcript = event projection).
        {
          claimId,
          actor: "agent",
          eventType: "agent_message",
          payload: { text: message, phase: decision },
        },
      ]);
      return { review, overturned };
    });

    // Re-enter the graph (spec §4.5). The DB already committed the truth; if
    // this fails, ClaimsService reconciles phase from status on the next turn.
    try {
      await this.agent.applyDecision(claimId, decision, message);
    } catch (err) {
      this.logger.error({
        msg: "applyDecision failed; will reconcile",
        claimId,
        err: String(err),
      });
    }

    this.events.emit(CLAIM_DECIDED, {
      claimId,
      decision,
      overturned: result.overturned,
    } satisfies ClaimDecidedEvent);
    return result.review;
  }

  // The numbers that say whether the agent is any good (spec §5).
  async metrics() {
    const [reviews] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        overturned: sql<number>`count(*) filter (where ${schema.reviews.overturnedAgent})::int`,
      })
      .from(schema.reviews);

    const [triage] = await this.db.execute<{
      total: number;
      escalated: number;
      avg_cost: number | null;
    }>(sql`
      select count(*)::int as total,
             count(*) filter (where output->>'priority' = 'priority')::int as escalated,
             avg(token_cost)::float as avg_cost
      from (select distinct on (claim_id) claim_id, output, token_cost
            from claim_assessments order by claim_id, created_at desc) latest`);

    // Time to resolution: claim created -> first approve/deny, median hours.
    const [ttr] = await this.db.execute<{ median_hours: number | null }>(sql`
      select percentile_cont(0.5) within group (order by extract(epoch from (r.first_at - c.created_at)) / 3600)::float as median_hours
      from claims c
      join (select claim_id, min(created_at) as first_at from reviews
            where decision in ('approved', 'denied') group by claim_id) r on r.claim_id = c.id`);

    const funnel = await this.db
      .select({
        status: schema.claims.status,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.claims)
      .groupBy(schema.claims.status);

    return {
      overturnRate: reviews.total ? reviews.overturned / reviews.total : null,
      reviews: reviews.total,
      escalationRate: triage.total ? triage.escalated / triage.total : null,
      triaged: triage.total,
      avgCostUsdPerClaim:
        triage.avg_cost === null ? null : triage.avg_cost / 1_000_000,
      medianHoursToResolution: ttr?.median_hours ?? null,
      funnel: Object.fromEntries(funnel.map((f) => [f.status, f.count])),
    };
  }
}

function customerMessage(decision: Decision, notes?: string) {
  const note = notes ? `\n\nReviewer's note: ${notes}` : "";
  switch (decision) {
    case "approved":
      return `Good news — a reviewer has approved your claim.${note}`;
    case "denied":
      return `A reviewer has looked at your claim and was unable to approve it.${note}`;
    case "more_info":
      return `A reviewer needs a bit more information before deciding: ${notes ?? ""}\n\nYou can reply here or upload documents.`;
  }
}
