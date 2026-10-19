import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "./database/database.module";
import { PoliciesModule } from "./policies/policies.module";
import { StripeModule } from "./stripe/stripe.module";
import { WebhooksModule } from "./webhooks/webhooks.module";
import { AgentModule } from "./agent/agent.module";
import { LlmModule } from "./llm/llm.module";
import { ClaimsModule } from "./claims/claims.module";
import { StorageModule } from "./storage/storage.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), // loads .env into process.env, app-wide
    DatabaseModule,
    StripeModule,
    PoliciesModule,
    WebhooksModule,
    AgentModule,
    LlmModule,
    ClaimsModule,
    StorageModule,
  ],
})
export class AppModule {}
