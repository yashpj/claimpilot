import { createHmac } from "node:crypto";
import { App } from "@slack/bolt";
import { NestReceiver } from "./nest.receiver";

const SECRET = "test-signing-secret";

function signed(body: string, ts = Math.floor(Date.now() / 1000)) {
  const sig =
    "v0=" +
    createHmac("sha256", SECRET).update(`v0:${ts}:${body}`).digest("hex");
  return { "x-slack-signature": sig, "x-slack-request-timestamp": String(ts) };
}

describe("NestReceiver (Slack signature verification)", () => {
  const receiver = new NestReceiver(SECRET);
  // `authorize` instead of `token`: no auth.test call to Slack from a unit test.
  const app = new App({
    receiver,
    authorize: async () => ({
      botToken: "xoxb-test",
      botId: "B1",
      botUserId: "U0",
    }),
  });
  const handled: string[] = [];
  app.action("claim_approve", async ({ ack, action }) => {
    await ack();
    handled.push((action as { value: string }).value);
  });

  it("rejects a bad signature", async () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "x" });
    const res = await receiver.handle(body, {
      "x-slack-signature": "v0=nope",
      "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a replayed (old) request even with a valid signature", async () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "x" });
    const res = await receiver.handle(
      body,
      signed(body, Math.floor(Date.now() / 1000) - 3600),
    );
    expect(res.status).toBe(401);
  });

  it("answers Slack's url_verification challenge", async () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "abc" });
    expect(await receiver.handle(body, signed(body))).toEqual({
      status: 200,
      body: { challenge: "abc" },
    });
  });

  it("routes a form-encoded button click to the Bolt action handler", async () => {
    const payload = {
      type: "block_actions",
      user: { id: "U1" },
      team: { id: "T1" },
      api_app_id: "A1",
      token: "t",
      trigger_id: "tr",
      container: { type: "message" },
      actions: [
        {
          type: "button",
          action_id: "claim_approve",
          block_id: "decision",
          value: "claim-123",
          action_ts: "1",
        },
      ],
    };
    const body = new URLSearchParams({
      payload: JSON.stringify(payload),
    }).toString();
    const res = await receiver.handle(body, signed(body));
    expect(res.status).toBe(200);
    expect(handled).toEqual(["claim-123"]);
  });
});
