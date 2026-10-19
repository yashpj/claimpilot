import { Module } from "@nestjs/common";
import { ReviewsModule } from "../reviews/reviews.module";
import { SlackController } from "./slack.controller";
import { SlackService } from "./slack.service";

@Module({
  imports: [ReviewsModule],
  controllers: [SlackController],
  providers: [SlackService],
})
export class SlackModule {}
