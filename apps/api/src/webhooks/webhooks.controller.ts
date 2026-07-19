import { Controller, Post, Req, Headers, BadRequestException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Inject } from "@nestjs/common";
import Stripe from "stripe";
import { STRIPE } from "../stripe/stripe.module";
import { WebhooksService } from "./webhooks.service";

@Controller("webhooks")
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    @Inject(STRIPE) private readonly stripe: Stripe,
    private readonly config: ConfigService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Post("stripe")
  async handleStripe(
    @Req() req: any,
    @Headers("stripe-signature") signature: string,
  ) {
    let event: Stripe.Event;

    // 1. Verify it's really Stripe — over the RAW bytes.
    try {
      event = this.stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        this.config.getOrThrow("STRIPE_WEBHOOK_SECRET"),
      );
    } catch (err) {
      this.logger.warn({ msg: "Invalid webhook signature" });
      throw new BadRequestException("Invalid signature");
    }

    // 2. Process idempotently.
    await this.webhooks.processStripeEvent(event);

    // 3. Return 2xx fast, or Stripe retries.
    return { received: true };
  }
}