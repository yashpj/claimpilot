import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@claimpilot/db";
import { PLANS, PlanType, type CreatePolicyInput } from "@claimpilot/shared";
import { DRIZZLE } from "../database/database.module";
import { eq, and } from "drizzle-orm";
import Stripe from "stripe";
import { STRIPE } from "../stripe/stripe.module";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class PoliciesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(STRIPE) private readonly stripe: Stripe,
    private readonly config: ConfigService,
  ) {}

  async create(userId: string, input: CreatePolicyInput) {
    const plan = PLANS[input.planType];

    return this.db.transaction(async (tx) => {
      const [vehicle] = await tx
        .insert(schema.vehicles)
        .values({
          ownerId: userId,
          make: input.vehicle.make,
          model: input.vehicle.model,
          year: input.vehicle.year,
          registration: input.vehicle.registration,
          declaredValue: input.vehicle.declaredValueCents,
        })
        .returning();

      const [policy] = await tx
        .insert(schema.policies)
        .values({
          userId,
          vehicleId: vehicle.id,
          planType: input.planType,
          premium: plan.premiumCents,
          status: "pending_payment",
        })
        .returning();

      return policy;
    });
  }

  async createCheckoutSession(userId: string, policyId: string) {
    const [policy] = await this.db
      .select()
      .from(schema.policies)
      .where(
        and(
          eq(schema.policies.id, policyId),
          eq(schema.policies.userId, userId), // ownership check
        ),
      );

    if (!policy) throw new NotFoundException("Policy not found");
    if (policy.status !== "pending_payment") {
      throw new BadRequestException("Policy is not awaiting payment");
    }

    const plan = PLANS[policy.planType as PlanType];
    const webOrigin = this.config.getOrThrow("WEB_ORIGIN");

    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "cad",
            product_data: { name: `${plan.name} — Motor Insurance` },
            unit_amount: policy.premium, // from OUR db, not the client
          },
          quantity: 1,
        },
      ],
      metadata: { policyId: policy.id }, // ← the thread to the webhook
      success_url: `${webOrigin}/policies/${policy.id}?paid=1`,
      cancel_url: `${webOrigin}/policies/${policy.id}?cancelled=1`,
    });

    await this.db
      .update(schema.policies)
      .set({ stripeSessionId: session.id })
      .where(eq(schema.policies.id, policy.id));

    return { url: session.url };
  }

  async findOne(userId: string, policyId: string) {
    const [policy] = await this.db
      .select()
      .from(schema.policies)
      .where(
        and(
          eq(schema.policies.id, policyId),
          eq(schema.policies.userId, userId),
        ),
      );
    if (!policy) throw new NotFoundException();
    return policy;
  }
}
