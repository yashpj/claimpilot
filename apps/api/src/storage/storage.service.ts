import type { ImagePart } from "../llm/llm.interface";

// Storage is an interface with two drivers:
// - "supabase": Supabase Storage (deployed; spec §2)
// - "local": files on disk (local dev, CI, evals; no cloud account needed)
// Callers depend on this abstract class (also the DI token), never a driver.
export abstract class StorageService {
  abstract put(path: string, data: Buffer, mimeType: string): Promise<void>;
  abstract get(path: string): Promise<{ data: Buffer; mimeType: string }>;
  // Short-lived public URL (Slack needs one to show a photo). Local driver
  // has no public URL, so it returns null and callers degrade gracefully.
  abstract signedUrl(path: string, ttlSeconds: number): Promise<string | null>;

  async getImage(path: string): Promise<ImagePart> {
    const { data, mimeType } = await this.get(path);
    return { data: data.toString("base64"), mimeType };
  }
}
