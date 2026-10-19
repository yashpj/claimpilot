import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import * as schema from "@claimpilot/db";
import { PLANS, type PlanType } from "@claimpilot/shared";
import { DRIZZLE, type Db } from "../database/database.module";
import { pgErrorCode } from "../common/pg-error";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async processStripeEvent(event: Stripe.Event) {
    try {
      await this.db.transaction(async (tx) => {
        // Claim the event. Duplicate → unique violation → we bail out.
        await tx.insert(schema.processedWebhookEvents).values({
          eventId: event.id,
        });

        if (event.type === "checkout.session.completed") {
          const session = event.data.object;
          await this.activatePolicy(tx, session);
        }
        // Other event types: recorded as processed, no action. Intentional.
      });
    } catch (err) {
      if (pgErrorCode(err) === "23505") {
        // Postgres unique_violation
        this.logger.log({
          msg: "Duplicate webhook ignored",
          eventId: event.id,
        });
        return; // Not an error. Idempotency working.
      }
      throw err;
    }
  }

  private async activatePolicy(tx: Tx, session: Stripe.Checkout.Session) {
    const policyId = session.metadata?.policyId;
    if (!policyId) {
      this.logger.error({
        msg: "Session missing policyId metadata",
        sessionId: session.id,
      });
      return;
    }

    const [policy] = await tx
      .select()
      .from(schema.policies)
      .where(eq(schema.policies.id, policyId));

    if (!policy) {
      this.logger.error({ msg: "Policy not found for session", policyId });
      return;
    }

    const plan = PLANS[policy.planType as PlanType];
    const start = new Date();
    const end = new Date(start);
    end.setMonth(end.getMonth() + plan.coverageMonths);

    await tx
      .update(schema.policies)
      .set({
        status: "active",
        coverageStart: start,
        coverageEnd: end,
        stripeCustomerId:
          typeof session.customer === "string" ? session.customer : null,
      })
      .where(eq(schema.policies.id, policyId));

    this.logger.log({ msg: "Policy activated", policyId });
  }
}
