import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import { ago, flagLabel, money, usd } from "../../lib/format";

type QueueItem = {
  id: string; status: string; priority: string; createdAt: string;
  claimedAmount: number | null; vehicle: string;
  recommendation: string | null; flags: string[]; costMicroUsd: number | null;
};
type Metrics = {
  overturnRate: number | null; reviews: number;
  escalationRate: number | null; triaged: number;
  avgCostUsdPerClaim: number | null; medianHoursToResolution: number | null;
  funnel: Record<string, number>;
};

const TABS = {
  "To review": "pending_review",
  "Waiting on customer": "more_info_requested",
  Decided: "approved,denied",
} as const;

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

export default function AdminQueue() {
  const [tab, setTab] = useState<keyof typeof TABS>("To review");
  const queue = useQuery({
    queryKey: ["admin-queue", tab],
    queryFn: () => apiFetch<QueueItem[]>(`/admin/claims?status=${TABS[tab]}`),
    refetchInterval: 5000,
  });
  const metrics = useQuery({ queryKey: ["admin-metrics"], queryFn: () => apiFetch<Metrics>("/admin/metrics") });

  return (
    <div>
      <h2>Review queue</h2>
      {metrics.data && (
        <div className="stats">
          <div><b>{pct(metrics.data.overturnRate)}</b><small>overturn rate ({metrics.data.reviews} reviews)</small></div>
          <div><b>{pct(metrics.data.escalationRate)}</b><small>escalation rate ({metrics.data.triaged} triaged)</small></div>
          <div><b>{metrics.data.medianHoursToResolution?.toFixed(1) ?? "—"}h</b><small>median time to resolution</small></div>
          <div><b>{metrics.data.avgCostUsdPerClaim === null ? "—" : `$${metrics.data.avgCostUsdPerClaim.toFixed(4)}`}</b><small>avg LLM cost / claim</small></div>
        </div>
      )}

      <div className="tabs">
        {Object.keys(TABS).map((t) => (
          <button key={t} className={t === tab ? "active" : ""} onClick={() => setTab(t as keyof typeof TABS)}>{t}</button>
        ))}
      </div>

      {queue.error && <p className="error">{queue.error.message}</p>}
      <table>
        <thead>
          <tr><th>Priority</th><th>Claim</th><th>Vehicle</th><th>Amount</th><th>Agent suggests</th><th>Flags</th><th>Age</th><th>LLM cost</th></tr>
        </thead>
        <tbody>
          {queue.data?.map((c) => (
            <tr key={c.id}>
              <td><span className={`badge ${c.priority}`}>{c.priority}</span></td>
              <td><Link to={`/admin/claims/${c.id}`}>{c.id.slice(0, 8)}</Link></td>
              <td>{c.vehicle}</td>
              <td>{money(c.claimedAmount)}</td>
              <td>{c.recommendation ?? "—"}</td>
              <td>{c.flags.map((f) => <span key={f} className="flag" title={flagLabel(f)}>{f}</span>)}</td>
              <td>{ago(c.createdAt)}</td>
              <td>{usd(c.costMicroUsd)}</td>
            </tr>
          ))}
          {queue.data?.length === 0 && <tr><td colSpan={8} className="muted">Nothing here.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
