import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PLANS, type PlanType } from "@claimpilot/shared";
import { apiPost } from "../lib/api";

export default function Buy() {
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("2020");
  const [registration, setRegistration] = useState("");
  const [declaredValue, setDeclaredValue] = useState("2000000");
  const [planType, setPlanType] = useState<PlanType>("comprehensive");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const policy = await apiPost<{ id: string }>("/policies", {
        vehicle: {
          make,
          model,
          year: Number(year),
          registration,
          declaredValueCents: Number(declaredValue),
        },
        planType,
      });
      navigate(`/policies/${policy.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1>Buy a policy</h1>
      <input value={make} onChange={(e) => setMake(e.target.value)} placeholder="make" />
      <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="model" />
      <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="year" />
      <input value={registration} onChange={(e) => setRegistration(e.target.value)} placeholder="registration" />
      <input value={declaredValue} onChange={(e) => setDeclaredValue(e.target.value)} placeholder="declared value (cents)" />

      {Object.entries(PLANS).map(([key, plan]) => (
        <label key={key}>
          <input
            type="radio"
            checked={planType === key}
            onChange={() => setPlanType(key as PlanType)}
          />
          {plan.name} — ${(plan.premiumCents / 100).toFixed(2)}
        </label>
      ))}

      <button onClick={submit} disabled={submitting}>
        {submitting ? "Creating…" : "Continue"}
      </button>
      {error && <p>{error}</p>}
    </div>
  );
}