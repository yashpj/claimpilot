import { useEffect, useState } from "react";
import { apiFetch } from "./lib/api";

export default function App() {
  const [data, setData] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false; // guards against setting state after unmount

    apiFetch("/policies")
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err) => { if (!cancelled) setError(err as Error); })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; }; // cleanup on unmount
  }, []); // [] = run once on mount

  if (isLoading) return <p>Loading…</p>;
  if (error) return <p>Error: {error.message}</p>;

  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}