import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PLANS, type PlanType } from "@claimpilot/shared";
import { apiFetch } from "../lib/api";
import { money } from "../lib/format";

type Policy = {
  id: string; status: string; planType: PlanType; premium: number;
  coverageEnd: string | null;
  vehicle: { make: string; model: string; year: number; registration: string };
};
type Claim = { id: string; policyId: string; status: string; createdAt: string; claimedAmount: number | null };

export default function Home() {
  const policies = useQuery({ queryKey: ["policies"], queryFn: () => apiFetch<Policy[]>("/policies") });
  const claims = useQuery({ queryKey: ["claims"], queryFn: () => apiFetch<Claim[]>("/claims") });

  if (policies.isLoading || claims.isLoading) return <p>Loading…</p>;
  if (policies.error) return <p className="error">{policies.error.message}</p>;

  return (
    <div>
      <h2>My policies</h2>
      {!policies.data?.length && <p>No policies yet. <Link to="/buy">Buy one</Link>.</p>}
      <table>
        <tbody>
          {policies.data?.map((p) => (
            <tr key={p.id}>
              <td><Link to={`/policies/${p.id}`}>{p.vehicle.year} {p.vehicle.make} {p.vehicle.model}</Link></td>
              <td>{PLANS[p.planType]?.name ?? p.planType}</td>
              <td><span className={`badge ${p.status}`}>{p.status}</span></td>
              <td>{money(p.premium)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>My claims</h2>
      {!claims.data?.length && <p>No claims.</p>}
      <table>
        <tbody>
          {claims.data?.map((c) => (
            <tr key={c.id}>
              <td><Link to={`/claims/${c.id}`}>Claim {c.id.slice(0, 8)}</Link></td>
              <td><span className={`badge ${c.status}`}>{c.status.replaceAll("_", " ")}</span></td>
              <td>{money(c.claimedAmount)}</td>
              <td>{new Date(c.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
