import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "./database/database.module";
import { PoliciesModule } from "./policies/policies.module";
import { StripeModule } from "./stripe/stripe.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), // loads .env into process.env, app-wide
    DatabaseModule,
    StripeModule,
    PoliciesModule,
  ],
})
export class AppModule {}