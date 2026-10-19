import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";

export const STRIPE = Symbol("STRIPE");

@Global()
@Module({
  providers: [
    {
      provide: STRIPE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Stripe(config.getOrThrow("STRIPE_SECRET_KEY")),
    },
  ],
  exports: [STRIPE],
})
export class StripeModule {}
