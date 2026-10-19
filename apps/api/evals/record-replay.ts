import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  ImagePart,
  LlmProvider,
  LlmRequest,
  LlmResult,
} from "../src/llm/llm.interface";
import { MlClient } from "../src/agent/ml/ml.client";

// VCR-style cassettes for the eval suite.
//  record: call the real model AND save the response
//  replay: never touch the network; a missing cassette is an error
//  live:   call the real model, save nothing
// Why: CI must be deterministic, free and not need secrets. Replay still
// exercises every line of OUR code (parsing, cross-check, fraud, triage
// rules). A prompt change changes the cache key, so CI fails until someone
// re-records => prompt changes can't merge without a fresh live eval.
export type Mode = "record" | "replay" | "live";

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

export class CacheMiss extends Error {}

class Cassettes {
  constructor(private readonly dir: string, private readonly mode: Mode) {
    mkdirSync(dir, { recursive: true });
  }

  async through<T>(key: string, real: () => Promise<T>): Promise<T> {
    const file = path.join(this.dir, `${key.slice(0, 32)}.json`);
    if (this.mode === "replay") {
      if (!existsSync(file)) throw new CacheMiss(`no cassette ${path.basename(file)}`);
      return JSON.parse(readFileSync(file, "utf8")) as T;
    }
    const value = await real();
    if (this.mode === "record") writeFileSync(file, JSON.stringify(value, null, 1));
    return value;
  }
}

export class RecordReplayLlm implements LlmProvider {
  private readonly tape: Cassettes;

  constructor(
    private readonly real: LlmProvider | null,
    dir: string,
    mode: Mode,
    private readonly modelTag: string, // part of the key: new model => re-record
  ) {
    this.tape = new Cassettes(dir, mode);
  }

  private key(req: LlmRequest, images: ImagePart[] = []) {
    return sha(JSON.stringify({
      m: this.modelTag, n: req.name, s: req.system, p: req.prompt,
      i: images.map((img) => sha(img.data)),
    }));
  }

  private realOrThrow() {
    if (!this.real) throw new Error("live LLM not configured (GEMINI_API_KEY)");
    return this.real;
  }

  complete(req: LlmRequest): Promise<LlmResult<string>> {
    return this.tape.through(this.key(req), () => this.realOrThrow().complete(req));
  }
  extractJson(req: LlmRequest): Promise<LlmResult<unknown>> {
    return this.tape.through(this.key(req), () => this.realOrThrow().extractJson(req));
  }
  analyzeImages(req: LlmRequest & { images: ImagePart[] }): Promise<LlmResult<unknown>> {
    return this.tape.through(this.key(req, req.images), () => this.realOrThrow().analyzeImages(req));
  }
}

export class RecordReplayMl extends MlClient {
  private readonly tape: Cassettes;

  constructor(private readonly real: MlClient, dir: string, mode: Mode) {
    super(null, 0);
    this.tape = new Cassettes(dir, mode);
  }

  detect(images: { data: Buffer; mimeType: string }[]) {
    const key = sha(images.map((i) => sha(i.data)).join(","));
    return this.tape.through(key, () => this.real.detect(images));
  }
}
