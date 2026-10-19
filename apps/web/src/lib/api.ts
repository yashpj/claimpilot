import { supabase } from "./supabase";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function authHeader(): Promise<Record<string, string>> {
  // getSession() reads the cached session (localStorage) and refreshes the
  // access token if it has expired, so every request carries a valid JWT.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Surface the API's error message (Nest puts it in `message`), not just "400".
async function toError(res: Response) {
  let detail = res.statusText;
  try {
    const body = (await res.json()) as { message?: unknown };
    if (body.message) detail = typeof body.message === "string" ? body.message : JSON.stringify(body.message);
  } catch {
    /* non-JSON error body */
  }
  return new Error(`${res.status} ${detail}`);
}

export async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: await authHeader() });
  if (!res.ok) throw await toError(res);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toError(res);
  return res.json() as Promise<T>;
}

// multipart/form-data: let the browser set Content-Type (with the boundary).
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: await authHeader(),
    body: form,
  });
  if (!res.ok) throw await toError(res);
  return res.json() as Promise<T>;
}

// <img src> can't send an Authorization header, so protected images are
// fetched as blobs and shown via an object URL (see AuthImage).
export async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(`${API_URL}${path}`, { headers: await authHeader() });
  if (!res.ok) throw await toError(res);
  return res.blob();
}
