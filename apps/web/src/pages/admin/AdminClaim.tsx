import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Decision } from "@claimpilot/shared";
import { apiFetch, apiPost } from "../../lib/api";
import { flagLabel, money, usd } from "../../lib/format";
import { AuthImage } from "../../components/AuthImage";

type Assessment = {
  id: string; createdAt: string; tokenCost: number | null; latencyMs: number | null;
  modelVersions: Record<string, unknown>;
  output: {
    priority: string; recommendation: string; flags: string[];
    analysisStatus: string; analysisErrors: string[];
    vlm: { summary: string; matches_description: boolean; confidence: number; severity_estimate: string; damage_locations: string[]; flags: string[] } | null;
    crossCheck: { agree: boolean; detail: string } | null;
    docExtraction: { status: string; license?: Record<string, unknown>; registration?: Record<string, unknown> } | null;
    additionalInfo: string[];
  };
};
type Detail = {
  claim: { id: string; status: string; priority: string; claimedAmount: number | null; incidentDate: string | null; incidentLocation: string | null; incidentDescription: string | null; createdAt: string };
  vehicle: { make: string; model: string; year: number; registration: string; declaredValue: number };
  policy: { planType: string; coverageStart: string | null; coverageEnd: string | null };
  customer: { email: string };
  assessments: Assessment[];
  documents: { id: string; type: string; sha256: string; exifCaptureDate: string | null }[];
  events: { id: string; actor: string; eventType: string; payload: unknown; createdAt: string }[];
  reviews: { id: string; decision: string; notes: string | null; overturnedAgent: boolean; createdAt: string }[];
  transcript: { role: string; text: string }[];
};

export default function AdminClaim() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  const { data, error } = useQuery({
    queryKey: ["admin-claim", id],
    queryFn: () => apiFetch<Detail>(`/admin/claims/${id}`),
  });

  const decide = useMutation({
    mutationFn: (decision: Decision) => apiPost(`/admin/claims/${id}/decision`, { decision, notes: notes || undefined }),
    onSuccess: () => {
      setNotes("");
      void queryClient.invalidateQueries({ queryKey: ["admin-claim", id] });
      void queryClient.invalidateQueries({ queryKey: ["admin-queue"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-metrics"] });
    },
  });

  if (error) return <p className="error">{error.message}</p>;
  if (!data) return <p>Loading…</p>;

  const { claim, vehicle, assessments, documents } = data;
  const a = assessments[0];
  const decidable = ["pending_review", "more_info_requested"].includes(claim.status);

  return (
    <div className="admin-claim">
      <h2>
        Claim {claim.id.slice(0, 8)} <span className={`badge ${claim.priority}`}>{claim.priority}</span>{" "}
        <span className={`badge ${claim.status}`}>{claim.status.replaceAll("_", " ")}</span>
      </h2>

      <section className="grid">
        <div>
          <h3>Incident</h3>
          <p><b>Date:</b> {claim.incidentDate ? new Date(claim.incidentDate).toLocaleDateString() : "—"}</p>
          <p><b>Where:</b> {claim.incidentLocation ?? "—"}</p>
          <p><b>What:</b> {claim.incidentDescription ?? "—"}</p>
          <p><b>Claimed:</b> {money(claim.claimedAmount)} (declared value {money(vehicle.declaredValue)})</p>
          <p><b>Vehicle:</b> {vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.registration}</p>
          <p><b>Customer:</b> {data.customer.email} · plan {data.policy.planType}</p>
        </div>

        <div>
          <h3>Agent assessment</h3>
          {!a && <p className="muted">No assessment yet.</p>}
          {a && (
            <>
              <p>Suggests <b>{a.output.recommendation}</b> · analysis {a.output.analysisStatus}</p>
              {a.output.flags.length > 0 && (
                <ul className="flags">{a.output.flags.map((f) => <li key={f}><b>{f}</b> — {flagLabel(f)}</li>)}</ul>
              )}
              {a.output.vlm && (
                <p>
                  <b>VLM:</b> {a.output.vlm.summary} <br />
                  matches description: {String(a.output.vlm.matches_description)} · confidence {a.output.vlm.confidence} ·
                  severity {a.output.vlm.severity_estimate} · {a.output.vlm.damage_locations.join(", ") || "no damage located"}
                </p>
              )}
              {a.output.crossCheck && <p><b>Cross-check:</b> {a.output.crossCheck.detail}</p>}
              {a.output.analysisErrors.length > 0 && <p className="muted">Errors: {a.output.analysisErrors.join("; ")}</p>}
              {a.output.docExtraction?.status === "complete" && (
                <p className="muted">
                  License: {JSON.stringify(a.output.docExtraction.license)} <br />
                  Registration: {JSON.stringify(a.output.docExtraction.registration)}
                </p>
              )}
              {a.output.additionalInfo.length > 0 && <p><b>Customer added:</b> {a.output.additionalInfo.join(" / ")}</p>}
              <p className="muted">
                cost {usd(a.tokenCost)} · latency {a.latencyMs ?? "—"}ms · {JSON.stringify(a.modelVersions)}
                {assessments.length > 1 && ` · ${assessments.length} assessments (re-analysed)`}
              </p>
            </>
          )}
        </div>
      </section>

      <h3>Documents</h3>
      <div className="docs">
        {documents.map((d) => (
          <figure key={d.id}>
            <AuthImage path={`/admin/documents/${d.id}/content`} alt={d.type} />
            <figcaption>
              {d.type.replace("_", " ")}
              {d.exifCaptureDate && <> · taken {new Date(d.exifCaptureDate).toLocaleDateString()}</>}
            </figcaption>
          </figure>
        ))}
      </div>

      <h3>Decision</h3>
      {data.reviews.map((r) => (
        <p key={r.id}>
          <b>{r.decision}</b> {r.notes && `— ${r.notes}`} {r.overturnedAgent && <span className="flag">overturned agent</span>}{" "}
          <small className="muted">{new Date(r.createdAt).toLocaleString()}</small>
        </p>
      ))}
      {decidable && (
        <div className="decide">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (required for 'request more info'; shown to the customer)" />
          <div>
            <button onClick={() => decide.mutate("approved")} disabled={decide.isPending}>Approve</button>
            <button onClick={() => decide.mutate("denied")} disabled={decide.isPending}>Deny</button>
            <button onClick={() => decide.mutate("more_info")} disabled={decide.isPending || !notes.trim()}>Request more info</button>
          </div>
          {decide.error && <p className="error">{decide.error.message}</p>}
        </div>
      )}

      <section className="grid">
        <div>
          <h3>Conversation</h3>
          <div className="messages small">
            {data.transcript.map((m, i) => <p key={i} className={`msg ${m.role}`}>{m.text}</p>)}
          </div>
        </div>
        <div>
          <h3>Audit log</h3>
          <ol className="audit">
            {data.events.map((e) => (
              <li key={e.id}>
                <small>{new Date(e.createdAt).toLocaleString()}</small> <b>{e.eventType}</b> <i>{e.actor.split(":")[0]}</i>
                {!["user_message", "agent_message"].includes(e.eventType) && <code>{JSON.stringify(e.payload)}</code>}
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
