import { AIMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { AgentDeps } from "../deps";
import type { ClaimStateType, ClaimStateUpdate } from "../state";
import { traceIdOf, usageOf } from "../usage";
import {
  DOC_EXTRACTION_SYSTEM,
  docExtractionSchema,
  type DocExtraction,
} from "../analysis/doc-extraction";

// What documents a claim requires.
const REQUIRED = ["damagePhotos", "license", "registration"] as const;
const LABELS: Record<(typeof REQUIRED)[number], string> = {
  damagePhotos: "photos of the damage",
  license: "your driver's license",
  registration: "your vehicle registration",
};

export function docCount(docs: ClaimStateType["documents"]) {
  return (
    docs.damagePhotos.length +
    (docs.license ? 1 : 0) +
    (docs.registration ? 1 : 0)
  );
}

export function makeDocumentsNode({ llm, storage, triageConfig }: AgentDeps) {
  return async function documentsNode(
    state: ClaimStateType,
    config?: RunnableConfig,
  ): Promise<ClaimStateUpdate> {
    const docs = state.documents;
    const have = {
      damagePhotos: docs.damagePhotos.length > 0,
      license: !!docs.license,
      registration: !!docs.registration,
    };
    const missing = REQUIRED.filter((d) => !have[d]);

    if (missing.length > 0) {
      // Progress = a new document arrived since this node last ran. Only a
      // customer turn can be "no progress"; arriving here straight from
      // intake (last message is ours) is not a turn.
      const progressed = docCount(docs) > state.docsSeen;
      const customerTurn = state.messages.at(-1)?.getType() === "human";
      const noProgressTurns =
        progressed || !customerTurn ? 0 : state.noProgressTurns + 1;

      if (noProgressTurns >= triageConfig.maxNoProgressTurns) {
        return {
          phase: "analysis",
          flags: ["conversation_stalled"],
          noProgressTurns,
          docsSeen: docCount(docs),
          messages: [
            new AIMessage(
              "I'll pass your claim to our team with what we have so far — a reviewer will follow up here.",
            ),
          ],
        };
      }

      // Acknowledge what arrived, ask for what's missing.
      const got = [
        docs.damagePhotos.length
          ? `${docs.damagePhotos.length} damage photo${docs.damagePhotos.length > 1 ? "s" : ""}`
          : null,
        docs.license ? "your license" : null,
        docs.registration ? "your registration" : null,
      ].filter(Boolean);
      const ack = got.length ? `I have ${got.join(", ")}. ` : "";
      return {
        phase: "documents",
        noProgressTurns,
        docsSeen: docCount(docs),
        messages: [
          new AIMessage(
            `${ack}Please upload: ${missing.map((m) => LABELS[m]).join(", ")}.`,
          ),
        ],
      };
    }

    // All present: extract structured fields from license + registration.
    let docExtraction: DocExtraction;
    const results = [];
    try {
      const images = await Promise.all([
        storage.getImage(docs.license!),
        storage.getImage(docs.registration!),
      ]);
      const res = await llm.analyzeImages({
        name: "documents.extract",
        traceId: traceIdOf(config),
        system: DOC_EXTRACTION_SYSTEM,
        prompt: "Extract the fields from these two documents.",
        images,
      });
      results.push(res);
      const parsed = docExtractionSchema.safeParse(res.value);
      docExtraction = parsed.success
        ? { status: "complete", ...parsed.data }
        : { status: "failed", error: "extraction output failed validation" };
    } catch (err) {
      docExtraction = { status: "failed", error: String(err).slice(0, 200) };
    }

    return {
      phase: "analysis",
      noProgressTurns: 0,
      docsSeen: docCount(docs),
      docExtraction,
      usage: usageOf(...results),
      messages: [
        new AIMessage(
          "Thanks, I have all your documents. I'm reviewing the photos now.",
        ),
      ],
    };
  };
}
