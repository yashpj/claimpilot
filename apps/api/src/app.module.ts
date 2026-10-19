import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { DatabaseModule } from "./database/database.module";
import { PoliciesModule } from "./policies/policies.module";
import { StripeModule } from "./stripe/stripe.module";
import { WebhooksModule } from "./webhooks/webhooks.module";
import { AgentModule } from "./agent/agent.module";
import { LlmModule } from "./llm/llm.module";
import { ClaimsModule } from "./claims/claims.module";
import { StorageModule } from "./storage/storage.module";
import { HealthController } from "./health/health.controller";
import { ReviewsModule } from "./reviews/reviews.module";
import { MeController } from "./auth/me.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), // loads .env into process.env, app-wide
    // In-process events decouple "a claim was triaged" from who cares
    // (Slack, metrics). Not a queue: if the pod dies mid-emit the event is
    // lost, which is acceptable for notifications (the queue is the DB).
    EventEmitterModule.forRoot(),
    DatabaseModule,
    StripeModule,
    PoliciesModule,
    WebhooksModule,
    AgentModule,
    LlmModule,
    ClaimsModule,
    StorageModule,
    ReviewsModule,
  ],
  controllers: [HealthController, MeController],
})
export class AppModule {}
