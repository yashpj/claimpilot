import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiBlob } from "../lib/api";

export function AuthImage({ path, alt }: { path: string; alt: string }) {
  const { data: url, isError } = useQuery({
    queryKey: ["blob", path],
    queryFn: async () => URL.createObjectURL(await apiBlob(path)),
    staleTime: Infinity,
  });
  // Object URLs pin the blob in memory until revoked.
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  if (isError) return <div className="thumb placeholder muted">unavailable</div>;
  if (!url) return <div className="thumb placeholder">…</div>;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img className="thumb" src={url} alt={alt} />
    </a>
  );
}
