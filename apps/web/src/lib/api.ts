import { supabase } from "./supabase";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export async function apiFetch<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}