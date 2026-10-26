import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiFetch, apiPost } from "../lib/api";
import { money } from "../lib/format";

type Policy = { id: string; status: string; planType: string; premium: number; coverageStart: string | null; coverageEnd: string | null };

export default function PolicyDetail() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const justPaid = searchParams.get("paid") === "1";

  const { data: policy, error } = useQuery({
    queryKey: ["policy", id],
    queryFn: () => apiFetch<Policy>(`/policies/${id}`),
    // Back from Stripe but the webhook hasn't landed yet: poll until it does.
    // (The webhook, not this redirect, is what activates the policy.)
    refetchInterval: (q) => (justPaid && q.state.data?.status === "pending_payment" ? 1500 : false),
  });

  const pay = useMutation({
    mutationFn: () => apiPost<{ url: string }>(`/policies/${id}/checkout`, {}),
    onSuccess: ({ url }) => { window.location.href = url; }, // hand off to Stripe
  });

  const fileClaim = useMutation({
    mutationFn: () => apiPost<{ id: string }>("/claims", { policyId: id }),
    onSuccess: (claim) => navigate(`/claims/${claim.id}`),
  });

  if (error) return <p className="error">{error.message}</p>;
  if (!policy) return <p>Loading…</p>;

  return (
    <div>
      <h2>Policy {policy.id.slice(0, 8)}</h2>
      <p>Status: <span className={`badge ${policy.status}`}>{policy.status}</span></p>
      <p>Premium: {money(policy.premium)}</p>
      {policy.coverageEnd && (
        <p>Coverage: {new Date(policy.coverageStart!).toLocaleDateString()} – {new Date(policy.coverageEnd).toLocaleDateString()}</p>
      )}

      {justPaid && policy.status === "pending_payment" && <p>Payment received — activating your policy…</p>}
      {policy.status === "pending_payment" && !justPaid && (
        <button onClick={() => pay.mutate()} disabled={pay.isPending}>Pay now</button>
      )}
      {policy.status === "active" && (
        <button onClick={() => fileClaim.mutate()} disabled={fileClaim.isPending}>File a claim</button>
      )}
      {(pay.error || fileClaim.error) && <p className="error">{(pay.error ?? fileClaim.error)?.message}</p>}
    </div>
  );
}
