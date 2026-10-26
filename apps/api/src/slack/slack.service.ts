import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OnEvent } from "@nestjs/event-emitter";
import { App, type BlockAction, type ButtonAction } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import { FLAGS, type Decision, type TriageFlag } from "@claimpilot/shared";
import { CLAIM_TRIAGED, type ClaimTriagedEvent } from "../claims/claims.events";
import {
  ReviewsService,
  type AssessmentOutput,
} from "../reviews/reviews.service";
import { StorageService } from "../storage/storage.service";
import { NestReceiver } from "./nest.receiver";

const ACTIONS: Record<string, Decision> = {
  claim_approve: "approved",
  claim_deny: "denied",
};

// Priority claims -> review channel with Approve / Deny / Request info.
// Disabled (no-op) unless all SLACK_* vars are set, so dev/CI never need it.
@Injectable()
export class SlackService implements OnModuleInit {
  private readonly logger = new Logger(SlackService.name);
  private app: App | null = null;
  receiver: NestReceiver | null = null;
  private channel = "";
  private webOrigin = "";
  // Slack user id -> our reviewer user id. A button click is an authz
  // decision too: an unmapped Slack user can't decide claims.
  private reviewers: Record<string, string> = {};

  constructor(
    private readonly config: ConfigService,
    private readonly reviews: ReviewsService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit() {
    const token = this.config.get<string>("SLACK_BOT_TOKEN");
    const secret = this.config.get<string>("SLACK_SIGNING_SECRET");
    this.channel = this.config.get<string>("SLACK_REVIEW_CHANNEL") ?? "";
    if (!token || !secret || !this.channel) {
      this.logger.log(
        "Slack disabled (SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET / SLACK_REVIEW_CHANNEL unset)",
      );
      return;
    }
    this.reviewers = JSON.parse(
      this.config.get<string>("SLACK_REVIEWER_MAP") ?? "{}",
    ) as Record<string, string>;
    this.webOrigin = this.config.get<string>("WEB_ORIGIN") ?? "";
    this.receiver = new NestReceiver(secret);
    this.app = new App({ token, receiver: this.receiver });
    this.registerHandlers(this.app);
  }

  get enabled() {
    return this.app !== null;
  }

  @OnEvent(CLAIM_TRIAGED)
  async onTriaged(e: ClaimTriagedEvent) {
    if (!this.app || e.priority !== "priority") return;
    try {
      await this.postClaim(e.claimId);
    } catch (err) {
      // Notification failure must never affect the claim; the admin queue
      // is the source of truth, Slack is a convenience.
      this.logger.error({
        msg: "slack post failed",
        claimId: e.claimId,
        err: String(err),
      });
    }
  }

  private async postClaim(claimId: string) {
    const d = await this.reviews.detail(claimId);
    const out = d.assessments[0]?.output as AssessmentOutput | undefined;
    const photo = d.documents.find((doc) => doc.type === "damage_photo");
    const photoUrl = photo
      ? await this.storage.signedUrl(photo.storagePath, 7 * 24 * 3600)
      : null;
    const amount =
      d.claim.claimedAmount === null
        ? "—"
        : `$${(d.claim.claimedAmount / 100).toFixed(2)}`;
    const flags =
      (out?.flags ?? [])
        .map((f) => `• ${FLAGS[f as TriageFlag]?.label ?? f}`)
        .join("\n") || "none";

    const blocks: KnownBlock[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `Priority claim ${claimId.slice(0, 8)}`,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Vehicle*\n${d.vehicle.year} ${d.vehicle.make} ${d.vehicle.model}`,
          },
          { type: "mrkdwn", text: `*Claimed*\n${amount}` },
          {
            type: "mrkdwn",
            text: `*Agent suggests*\n${out?.recommendation ?? "—"}`,
          },
          {
            type: "mrkdwn",
            text: `*Incident*\n${d.claim.incidentDescription ?? "—"}`,
          },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Why it's priority*\n${flags}` },
      },
      ...(out?.vlm?.summary
        ? [
            {
              type: "context" as const,
              elements: [
                { type: "mrkdwn" as const, text: `VLM: ${out.vlm.summary}` },
              ],
            },
          ]
        : []),
      ...(photoUrl
        ? [
            {
              type: "image" as const,
              image_url: photoUrl,
              alt_text: "damage photo",
            },
          ]
        : []),
      {
        type: "actions",
        block_id: "decision",
        elements: [
          {
            type: "button",
            action_id: "claim_approve",
            text: { type: "plain_text", text: "Approve" },
            style: "primary",
            value: claimId,
          },
          {
            type: "button",
            action_id: "claim_deny",
            text: { type: "plain_text", text: "Deny" },
            style: "danger",
            value: claimId,
          },
          {
            type: "button",
            action_id: "claim_more_info",
            text: { type: "plain_text", text: "Request info" },
            value: claimId,
          },
          ...(this.webOrigin
            ? [
                {
                  type: "button" as const,
                  action_id: "open_admin",
                  text: { type: "plain_text" as const, text: "Open" },
                  url: `${this.webOrigin}/admin/claims/${claimId}`,
                },
              ]
            : []),
        ],
      },
    ];

    await this.app!.client.chat.postMessage({
      channel: this.channel,
      text: `Priority claim ${claimId.slice(0, 8)} needs review`, // fallback for notifications
      blocks,
    });
  }

  private registerHandlers(app: App) {
    for (const [actionId, decision] of Object.entries(ACTIONS)) {
      app.action<BlockAction<ButtonAction>>(
        actionId,
        async ({ ack, body, action, client, respond }) => {
          await ack();
          const reviewerId = this.reviewers[body.user.id];
          if (!reviewerId) {
            await respond({
              response_type: "ephemeral",
              replace_original: false,
              text: "You're not registered as a reviewer.",
            });
            return;
          }
          const claimId = action.value ?? "";
          try {
            await this.reviews.decide({
              claimId,
              reviewerId,
              decision,
              source: "slack",
            });
            await client.chat.update({
              channel: body.channel?.id ?? this.channel,
              ts: body.message?.ts ?? "",
              text: `Claim ${claimId.slice(0, 8)}: ${decision} by <@${body.user.id}>`,
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `Claim \`${claimId.slice(0, 8)}\` *${decision}* by <@${body.user.id}>`,
                  },
                },
              ],
            });
          } catch (err) {
            await respond({
              response_type: "ephemeral",
              replace_original: false,
              text: `Couldn't record decision: ${String(err)}`,
            });
          }
        },
      );
    }

    // "Request info" needs a note for the customer => open a modal.
    app.action<BlockAction<ButtonAction>>(
      "claim_more_info",
      async ({ ack, body, action, client }) => {
        await ack();
        await client.views.open({
          trigger_id: body.trigger_id,
          view: {
            type: "modal",
            callback_id: "more_info_modal",
            private_metadata: JSON.stringify({
              claimId: action.value,
              channel: body.channel?.id,
              ts: body.message?.ts,
            }),
            title: { type: "plain_text", text: "Request more info" },
            submit: { type: "plain_text", text: "Send to customer" },
            blocks: [
              {
                type: "input",
                block_id: "notes",
                label: {
                  type: "plain_text",
                  text: "What do you need from the customer?",
                },
                element: {
                  type: "plain_text_input",
                  action_id: "value",
                  multiline: true,
                },
              },
            ],
          },
        });
      },
    );

    app.view("more_info_modal", async ({ ack, body, view, client }) => {
      const reviewerId = this.reviewers[body.user.id];
      if (!reviewerId) {
        await ack({
          response_action: "errors",
          errors: { notes: "You're not registered as a reviewer." },
        });
        return;
      }
      await ack();
      const meta = JSON.parse(view.private_metadata) as {
        claimId: string;
        channel?: string;
        ts?: string;
      };
      const notes = view.state.values.notes?.value?.value ?? "";
      await this.reviews.decide({
        claimId: meta.claimId,
        reviewerId,
        decision: "more_info",
        notes,
        source: "slack",
      });
      if (meta.channel && meta.ts) {
        await client.chat.update({
          channel: meta.channel,
          ts: meta.ts,
          text: `Claim ${meta.claimId.slice(0, 8)}: more info requested`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `Claim \`${meta.claimId.slice(0, 8)}\`: *more info requested* by <@${body.user.id}>\n> ${notes}`,
              },
            },
          ],
        });
      }
    });

    // Link button: Slack still sends an action; ack it so Slack doesn't show an error.
    app.action("open_admin", async ({ ack }) => {
      await ack();
    });
  }
}
