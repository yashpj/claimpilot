import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DOCUMENT_TYPES } from "@claimpilot/shared";
import { apiFetch, apiPost, apiUpload } from "../lib/api";

type Message = { role: string; text: string };
type ClaimView = {
  claim: { id: string; status: string };
  messages: Message[];
  documents: { id: string; type: string }[];
};

const CLOSED = ["approved", "denied", "draft"];

export default function ClaimChat() {
  const { id } = useParams();
  const [input, setInput] = useState("");
  const [docType, setDocType] = useState<(typeof DOCUMENT_TYPES)[number]>("damage_photo");
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["claim", id] });

  // Polling (no websockets, per spec): one option instead of setInterval +
  // cleanup + stale-response guards. Picks up reviewer decisions too.
  const { data, isLoading, error } = useQuery({
    queryKey: ["claim", id],
    queryFn: () => apiFetch<ClaimView>(`/claims/${id}`),
    refetchInterval: 2000,
  });

  const sendMessage = useMutation({
    mutationFn: (text: string) => apiPost(`/claims/${id}/messages`, { text }),
    onSuccess: refresh,
  });

  const upload = useMutation({
    mutationFn: (files: FileList) => {
      const form = new FormData();
      form.append("type", docType);
      Array.from(files).forEach((f) => form.append("files", f));
      return apiUpload(`/claims/${id}/documents`, form);
    },
    onSuccess: () => {
      if (fileRef.current) fileRef.current.value = "";
      return refresh();
    },
  });

  const count = data?.messages.length ?? 0;
  useEffect(() => bottomRef.current?.scrollIntoView({ block: "nearest" }), [count]);

  if (isLoading) return <p>Loading…</p>;
  if (error) return <p className="error">{error.message}</p>;

  const busy = sendMessage.isPending || upload.isPending;
  const closed = CLOSED.includes(data?.claim.status ?? "");

  return (
    <div className="chat">
      <h2>
        Claim {id?.slice(0, 8)}{" "}
        <span className={`badge ${data?.claim.status}`}>{data?.claim.status.replaceAll("_", " ")}</span>
      </h2>
      <div className="messages">
        {data?.messages.length === 0 && <p className="muted">Tell us what happened to start your claim.</p>}
        {data?.messages.map((m, i) => (
          <p key={i} className={`msg ${m.role}`}>{m.text}</p>
        ))}
        {busy && <p className="msg agent muted">…</p>}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim()) return;
          sendMessage.mutate(input);
          setInput("");
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} placeholder="Type a message" />
        <button disabled={busy}>Send</button>
      </form>

      {!closed && (
        <div className="upload">
          <select value={docType} onChange={(e) => setDocType(e.target.value as typeof docType)} disabled={busy}>
            {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
          </select>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={busy}
            onChange={(e) => e.target.files?.length && upload.mutate(e.target.files)}
          />
          <small className="muted">{data?.documents.length ?? 0} document(s) uploaded</small>
        </div>
      )}
      {(sendMessage.error || upload.error) && (
        <p className="error">{(sendMessage.error ?? upload.error)?.message}</p>
      )}
    </div>
  );
}
