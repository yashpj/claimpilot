import { Inject, Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "@prometheus-io/client";
import { sql } from "drizzle-orm";
import { DRIZZLE, type Db } from "../database/database.module";
import {
  CLAIM_CREATED,
  CLAIM_TRIAGED,
  type ClaimTriagedEvent,
} from "../claims/claims.events";
import {
  CLAIM_DECIDED,
  type ClaimDecidedEvent,
} from "../reviews/reviews.events";

// One registry per process; Prometheus scrapes every pod and sums.
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request latency",
    // `route` is the route TEMPLATE (/claims/:id), never the raw URL: one
    // series per claim id would explode Prometheus' memory (cardinality).
    labelNames: ["method", "route", "status"],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    registers: [this.registry],
  });

  readonly llmCalls = new Counter({
    name: "llm_calls_total",
    help: "LLM calls by call site and outcome",
    labelNames: ["name", "model", "outcome"],
    registers: [this.registry],
  });

  readonly llmLatency = new Histogram({
    name: "llm_call_duration_seconds",
    help: "LLM call latency",
    labelNames: ["name", "model"],
    buckets: [0.5, 1, 2, 5, 10, 20, 30, 60],
    registers: [this.registry],
  });

  readonly llmCost = new Counter({
    name: "llm_cost_micro_usd_total",
    help: "Nominal LLM cost in micro-USD",
    labelNames: ["model"],
    registers: [this.registry],
  });

  readonly claimsCreated = new Counter({
    name: "claims_created_total",
    help: "Claims started",
    registers: [this.registry],
  });

  readonly claimsTriaged = new Counter({
    name: "claims_triaged_total",
    help: "Claims triaged by the agent",
    labelNames: ["priority", "recommendation"],
    registers: [this.registry],
  });

  readonly claimsDecided = new Counter({
    name: "claims_decided_total",
    help: "Human review decisions",
    labelNames: ["decision", "overturned"],
    registers: [this.registry],
  });

  constructor(@Inject(DRIZZLE) db: Db) {
    collectDefaultMetrics({ register: this.registry });

    // Funnel from the DB at scrape time: correct across restarts and pods
    // (counters reset when a pod restarts; the table doesn't). Dashboards use
    // max() across pods since every pod reports the same numbers.
    new Gauge({
      name: "claims_by_status",
      help: "Current number of claims in each status",
      labelNames: ["status"],
      registers: [this.registry],
      async collect() {
        const rows = await db.execute<{ status: string; n: number }>(
          sql`select status, count(*)::int as n from claims group by status`,
        );
        this.reset();
        for (const r of rows) this.set({ status: r.status }, r.n);
      },
    });
  }

  @OnEvent(CLAIM_CREATED)
  onCreated() {
    this.claimsCreated.inc();
  }

  @OnEvent(CLAIM_TRIAGED)
  onTriaged(e: ClaimTriagedEvent) {
    this.claimsTriaged.inc({
      priority: e.priority,
      recommendation: e.recommendation,
    });
  }

  @OnEvent(CLAIM_DECIDED)
  onDecided(e: ClaimDecidedEvent) {
    this.claimsDecided.inc({
      decision: e.decision,
      overturned: String(e.overturned),
    });
  }
}
