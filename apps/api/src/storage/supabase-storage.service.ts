import type { createClient } from "@supabase/supabase-js";
import { StorageService } from "./storage.service";

const BUCKET = "claim-documents";

export class SupabaseStorageService extends StorageService {
  constructor(private readonly supabase: ReturnType<typeof createClient>) {
    super();
  }

  async put(path: string, data: Buffer, mimeType: string) {
    const { error } = await this.supabase.storage
      .from(BUCKET)
      .upload(path, data, { contentType: mimeType, upsert: false });
    if (error) throw new Error(`upload failed for ${path}: ${error.message}`);
  }

  async get(path: string) {
    const { data, error } = await this.supabase.storage
      .from(BUCKET)
      .download(path);
    if (error || !data) {
      throw new Error(`download failed for ${path}: ${error?.message}`);
    }
    return {
      data: Buffer.from(await data.arrayBuffer()),
      mimeType: data.type || "image/jpeg",
    };
  }

  async signedUrl(path: string, ttlSeconds: number) {
    const { data } = await this.supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, ttlSeconds);
    return data?.signedUrl ?? null;
  }
}
