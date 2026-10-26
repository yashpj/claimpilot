import {
  Controller,
  HttpCode,
  NotFoundException,
  Post,
  Req,
  Res,
  type RawBodyRequest,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { SlackService } from "./slack.service";

// Slack's interactivity Request URL: https://<api>/slack/events
// No AuthGuard: the Slack signature IS the authentication (like Stripe).
@Controller("slack")
export class SlackController {
  constructor(private readonly slack: SlackService) {}

  @Post("events")
  @HttpCode(200)
  async events(@Req() req: RawBodyRequest<Request>, @Res() res: Response) {
    if (!this.slack.receiver) throw new NotFoundException();
    const { status, body } = await this.slack.receiver.handle(
      req.rawBody?.toString("utf8") ?? "",
      req.headers as Record<string, string | undefined>,
    );
    res.status(status).send(body);
  }
}
