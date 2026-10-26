import { isValidSlackRequest, type App, type Receiver } from "@slack/bolt";

// Bolt normally owns an HTTP server (ExpressReceiver). We already have one
// (Nest), and Nest's body parser has consumed the stream, so a custom
// Receiver - an official Bolt extension point - takes the raw body from a
// Nest controller, verifies Slack's signature over it, and hands the event to
// Bolt. Listener code (app.action, app.view) stays idiomatic Bolt.
export class NestReceiver implements Receiver {
  private app?: App;

  constructor(private readonly signingSecret: string) {}

  init(app: App) {
    this.app = app;
  }
  start() {
    return Promise.resolve();
  }
  stop() {
    return Promise.resolve();
  }

  async handle(rawBody: string, headers: Record<string, string | undefined>) {
    const valid = isValidSlackRequest({
      signingSecret: this.signingSecret,
      body: rawBody,
      headers: {
        "x-slack-signature": headers["x-slack-signature"] ?? "",
        // Timestamp is checked too (5 min window): stops replayed requests.
        "x-slack-request-timestamp": Number(
          headers["x-slack-request-timestamp"] ?? 0,
        ),
      },
    });
    if (!valid || !this.app) return { status: 401, body: "" };

    // Interactivity posts form-encoded `payload=<json>`; Events API posts JSON.
    const form = new URLSearchParams(rawBody);
    const body = (
      form.has("payload")
        ? JSON.parse(form.get("payload")!)
        : JSON.parse(rawBody)
    ) as Record<string, unknown>;
    if (body.type === "url_verification")
      return { status: 200, body: { challenge: body.challenge } };

    let ackBody: unknown = "";
    // Process before responding (Slack allows 3s): our handlers are a DB
    // transaction + one Slack API call, well inside that.
    await this.app.processEvent({
      body,
      ack: async (response?: unknown) => {
        ackBody = response ?? "";
      },
    });
    return { status: 200, body: ackBody };
  }
}
