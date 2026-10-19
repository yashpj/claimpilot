import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { StorageService } from "./storage.service";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export class LocalStorageService extends StorageService {
  constructor(private readonly root: string) {
    super();
  }

  // Storage paths come from our own code (claimId/uuid.ext), but resolve and
  // check anyway so a bad path can never escape the root directory.
  private resolve(p: string) {
    const full = path.resolve(this.root, p);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) {
      throw new Error(`invalid storage path: ${p}`);
    }
    return full;
  }

  async put(p: string, data: Buffer) {
    const full = this.resolve(p);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async get(p: string) {
    const data = await readFile(this.resolve(p));
    const mimeType = MIME_BY_EXT[path.extname(p).toLowerCase()] ?? "image/jpeg";
    return { data, mimeType };
  }

  async signedUrl() {
    return null;
  }
}
