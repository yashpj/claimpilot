import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { apiFetch, apiPost } from "../lib/api";
import { useNavigate } from "react-router-dom";

type Policy = { id: string; status: string; planType: string; premium: number };

export default function PolicyDetail() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const justPaid = searchParams.get("paid") === "1";

  useEffect(() => {
    let cancelled = false;
    apiFetch<Policy>(`/policies/${id}`)
      .then((p) => { if (!cancelled) setPolicy(p); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [id]);

  async function pay() {
    const { url } = await apiPost<{ url: string }>(`/policies/${id}/checkout`, {});
    window.location.href = url;   // hand off to Stripe
  }

  async function fileClaim() {
    const claim = await apiPost<{ id: string }>("/claims", { policyId: policy.id });
    navigate(`/claims/${claim.id}`);
  }
// render when policy.status === "active":
// <button onClick={fileClaim}>File a claim</button>
  if (error) return <p>Error: {error}</p>;
  if (!policy) return <p>Loading…</p>;

  return (
    <div>
      <h1>Policy {policy.id}</h1>
      <p>Status: {policy.status}</p>
      <p>Premium: ${(policy.premium / 100).toFixed(2)}</p>

      {justPaid && policy.status === "pending_payment" && (
        <p>Payment received — activating your policy…</p>
      )}

      {policy.status === "pending_payment" && !justPaid && (
        <button onClick={pay}>Pay now</button>
      )}

      {policy.status === "active" && (
        <button onClick={fileClaim}>File a claim</button>
      )}

    </div>
  );
}