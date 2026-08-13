import { Inject, Injectable } from "@nestjs/common";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_STORAGE } from "./storage.module";
import type { ImagePart } from "../llm/llm.interface";

const BUCKET = "claim-documents";

@Injectable()
export class StorageService {
  constructor(@Inject(SUPABASE_STORAGE) private readonly supabase: SupabaseClient) {}

  async getImage(path: string): Promise<ImagePart> {
    const { data, error } = await this.supabase.storage.from(BUCKET).download(path);
    if (error || !data) throw new Error(`download failed for ${path}: ${error?.message}`);
    const buffer = Buffer.from(await data.arrayBuffer());
    return { data: buffer.toString("base64"), mimeType: data.type || "image/jpeg" };
  }
}