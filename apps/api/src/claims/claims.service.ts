import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import exifr from "exifr";
import * as schema from "@claimpilot/db";
import type { UploadDocumentsInput } from "@claimpilot/shared";
import { DRIZZLE, type Db } from "../database/database.module";
import { AgentService } from "../agent/agent.service";
import type { Phase } from "../agent/state";
import { StorageService } from "../storage/storage.service";

type ClaimStatus = (typeof schema.claimStatus.enumValues)[number];

// phase (agent's view) -> claims.status (everyone else's view).
const STATUS_BY_PHASE: Partial<Record<Phase, ClaimStatus>> = {
  intake: "intake",
  documents: "intake",
  analysis: "analysis",
  review: "pending_review",
  more_info: "more_info_requested",
};

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const ALLOWED_MIME = Object.keys(EXT_BY_MIME);
const CLOSED: ClaimStatus[] = ["approved", "denied", "draft"];
const PHASE_BY_DECIDED_STATUS: Partial<
  Record<ClaimStatus, "done" | "more_info">
> = {
  approved: "done",
  denied: "done",
  more_info_requested: "more_info",
};

export type UploadedFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

export const CLAIM_TRIAGED = "claim.triaged";
export type ClaimTriagedEvent = { claimId: string };

@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly agent: AgentService,
    private readonly storage: StorageService,
    private readonly events: EventEmitter2,
  ) {}

  // Start a claim against one of the caller's policies.
  async create(userId: string, policyId: string) {
    const [policy] = await this.db
      .select()
      .from(schema.policies)
      .where(
        and(
          eq(schema.policies.id, policyId),
          eq(schema.policies.userId, userId), // ownership in WHERE
        ),
      );
    if (!policy) throw new NotFoundException("Policy not found");

    const [claim] = await this.db
      .insert(schema.claims)
      .values({ policyId, status: "intake" })
      .returning();

    await this.db.insert(schema.claimEvents).values({
      claimId: claim.id,
      actor: `user:${userId}`,
      eventType: "claim_created",
      payload: { policyId },
    });

    return claim;
  }

  async list(userId: string) {
    return this.db
      .select({ claim: schema.claims })
      .from(schema.claims)
      .innerJoin(
        schema.policies,
        eq(schema.claims.policyId, schema.policies.id),
      )
      .where(eq(schema.policies.userId, userId))
      .orderBy(desc(schema.claims.createdAt))
      .then((rows) => rows.map((r) => r.claim));
  }

  // Authorization lives in the query: a claim you don't own is "not found",
  // never "forbidden" (don't confirm that someone else's claim id exists).
  async findOwned(userId: string, claimId: string) {
    const [row] = await this.db
      .select({ claim: schema.claims })
      .from(schema.claims)
      .innerJoin(
        schema.policies,
        eq(schema.claims.policyId, schema.policies.id),
      )
      .where(
        and(eq(schema.claims.id, claimId), eq(schema.policies.userId, userId)),
      );
    if (!row) throw new NotFoundException();
    return row.claim;
  }

  async getClaim(userId: string, claimId: string) {
    const claim = await this.findOwned(userId, claimId);
    const [messages, documents] = await Promise.all([
      this.transcript(claimId),
      this.db
        .select({
          id: schema.claimDocuments.id,
          type: schema.claimDocuments.type,
          createdAt: schema.claimDocuments.createdAt,
        })
        .from(schema.claimDocuments)
        .where(eq(schema.claimDocuments.claimId, claimId))
        .orderBy(asc(schema.claimDocuments.createdAt)),
    ]);
    return { claim, messages, documents };
  }

  // The chat transcript is a PROJECTION of the append-only event log.
  async transcript(claimId: string) {
    const events = await this.db
      .select()
      .from(schema.claimEvents)
      .where(eq(schema.claimEvents.claimId, claimId))
      .orderBy(asc(schema.claimEvents.createdAt));

    return events.flatMap((e) => {
      const p = e.payload as { text?: string; count?: number; type?: string };
      if (e.eventType === "user_message")
        return [{ role: "user", text: p.text ?? "", at: e.createdAt }];
      if (e.eventType === "agent_message")
        return [{ role: "agent", text: p.text ?? "", at: e.createdAt }];
      if (e.eventType === "document_uploaded") {
        return [
          {
            role: "user",
            text: `📎 Uploaded ${p.type?.replace("_", " ")}`,
            at: e.createdAt,
          },
        ];
      }
      return [];
    });
  }

  async sendMessage(userId: string, claimId: string, text: string) {
    // Decided claims still get a polite reply from the "closed" node.
    await this.findOwned(userId, claimId);
    await this.db.insert(schema.claimEvents).values({
      claimId,
      actor: `user:${userId}`,
      eventType: "user_message",
      payload: { text },
    });
    return this.runTurn(claimId, text);
  }

  async uploadDocuments(
    userId: string,
    claimId: string,
    input: UploadDocumentsInput,
    files: UploadedFile[],
  ) {
    const claim = await this.findOwned(userId, claimId);
    if (CLOSED.includes(claim.status)) {
      throw new ConflictException("This claim is closed");
    }

    for (const file of files) {
      const sha256 = createHash("sha256").update(file.buffer).digest("hex");
      const exifCaptureDate = await readCaptureDate(file.buffer);
      const path = `${claimId}/${randomUUID()}.${EXT_BY_MIME[file.mimetype]}`;

      await this.storage.put(path, file.buffer, file.mimetype);
      const [doc] = await this.db
        .insert(schema.claimDocuments)
        .values({
          claimId,
          storagePath: path,
          type: input.type,
          mimeType: file.mimetype,
          sha256,
          exifCaptureDate,
        })
        .returning({ id: schema.claimDocuments.id });

      await this.db.insert(schema.claimEvents).values({
        claimId,
        actor: `user:${userId}`,
        eventType: "document_uploaded",
        payload: {
          documentId: doc.id,
          type: input.type,
          sha256,
          exifCaptureDate,
        },
      });
    }

    const label = input.type.replace("_", " ");
    return this.runTurn(
      claimId,
      `(uploaded ${files.length} ${label}${files.length > 1 ? "s" : ""})`,
    );
  }

  async getDocumentContent(
    userId: string,
    claimId: string,
    documentId: string,
  ) {
    await this.findOwned(userId, claimId);
    return this.readDocument(documentId, claimId);
  }

  async readDocument(documentId: string, claimId?: string) {
    const [doc] = await this.db
      .select()
      .from(schema.claimDocuments)
      .where(
        and(
          eq(schema.claimDocuments.id, documentId),
          claimId ? eq(schema.claimDocuments.claimId, claimId) : undefined,
        ),
      );
    if (!doc) throw new NotFoundException();
    return this.storage.get(doc.storagePath);
  }

  // One agent turn, serialised per claim. Without the lock, uploading three
  // photos at once = three concurrent runs racing on one checkpoint thread.
  // pg_advisory_xact_lock works ACROSS API replicas (an in-memory mutex would
  // not) and is released automatically when the transaction ends.
  private async runTurn(claimId: string, text: string) {
    const result = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${claimId}))`);

      let before = await this.agent.getState(claimId);
      const [claim] = await tx
        .select({ status: schema.claims.status })
        .from(schema.claims)
        .where(eq(schema.claims.id, claimId));
      const expected = PHASE_BY_DECIDED_STATUS[claim.status];
      if (before && expected && before.phase !== expected) {
        await this.agent.syncPhase(claimId, expected);
        before = await this.agent.getState(claimId);
      }
      const documents = await this.hydrateDocuments(claimId);

      let after;
      try {
        after = await this.agent.runTurn({
          claimId,
          text,
          documents,
          traceId: randomUUID(),
        });
      } catch (err) {
        this.logger.error({
          msg: "agent run failed",
          claimId,
          err: String(err),
        });
        throw new ServiceUnavailableException(
          "The assistant is temporarily unavailable. Please try again.",
        );
      }

      // Every AI message produced in THIS run (a run can emit several).
      const seen = (before?.messages.length ?? 0) + 1;
      const replies = after.messages
        .slice(seen)
        .filter((m) => m.getType() === "ai")
        .map((m) =>
          typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        );
      for (const reply of replies) {
        await this.db.insert(schema.claimEvents).values({
          claimId,
          actor: "agent",
          eventType: "agent_message",
          payload: { text: reply, phase: after.phase },
        });
      }

      await this.project(claimId, before?.phase ?? "intake", after);
      return { after, beforePhase: before?.phase, replies };
    });

    if (result.beforePhase !== "review" && result.after.phase === "review") {
      this.events.emit(CLAIM_TRIAGED, { claimId } satisfies ClaimTriagedEvent);
    }
    return { replies: result.replies, phase: result.after.phase };
  }

  private async hydrateDocuments(claimId: string) {
    // Documents come from the DB (ground truth) on every run, never from
    // stale checkpoint state.
    const docs = await this.db
      .select()
      .from(schema.claimDocuments)
      .where(eq(schema.claimDocuments.claimId, claimId))
      .orderBy(asc(schema.claimDocuments.createdAt));
    return {
      damagePhotos: docs
        .filter((d) => d.type === "damage_photo")
        .map((d) => d.storagePath),
      license: docs.findLast((d) => d.type === "license")?.storagePath,
      registration: docs.findLast((d) => d.type === "registration")
        ?.storagePath,
    };
  }

  // Project agent state onto the claims row (+ audit every status change).
  private async project(
    claimId: string,
    beforePhase: Phase,
    after: Awaited<ReturnType<AgentService["runTurn"]>>,
  ) {
    const [claim] = await this.db
      .select()
      .from(schema.claims)
      .where(eq(schema.claims.id, claimId));
    let status: ClaimStatus = STATUS_BY_PHASE[after.phase] ?? claim.status;
    if (
      after.phase === "done" &&
      after.closedReason &&
      beforePhase !== "done"
    ) {
      // Failed coverage validation: never became a valid claim. "draft", not
      // "denied": the agent does not deny claims, it declines to file them.
      status = "draft";
    }

    const i = after.incident;
    await this.db
      .update(schema.claims)
      .set({
        status,
        incidentDate: i.date
          ? new Date(`${i.date}T12:00:00Z`)
          : claim.incidentDate,
        incidentLocation: i.location ?? claim.incidentLocation,
        incidentDescription: i.description ?? claim.incidentDescription,
        claimedAmount: i.claimedAmountCents ?? claim.claimedAmount,
      })
      .where(eq(schema.claims.id, claimId));

    if (status !== claim.status) {
      await this.db.insert(schema.claimEvents).values({
        claimId,
        actor: "agent",
        eventType: "status_changed",
        payload: {
          from: claim.status,
          to: status,
          reason: after.closedReason ?? undefined,
        },
      });
    }
  }
}

async function readCaptureDate(buffer: Buffer): Promise<Date | null> {
  try {
    const exif = (await exifr.parse(buffer, [
      "DateTimeOriginal",
      "CreateDate",
    ])) as { DateTimeOriginal?: Date; CreateDate?: Date } | undefined;
    const d = exif?.DateTimeOriginal ?? exif?.CreateDate;
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  } catch {
    return null; // no / corrupt EXIF is normal (messaging apps strip it)
  }
}
