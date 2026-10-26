import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./api";

export type Me = { id: string; email?: string; role: "customer" | "reviewer" };

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/me"), staleTime: 60_000 });
}
