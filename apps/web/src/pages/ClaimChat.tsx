import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPost } from "../lib/api";

type Message = { role: string; text: string };

export default function ClaimChat() {
  const { id } = useParams();
  const [input, setInput] = useState("");
  const queryClient = useQueryClient();

  // Polling = ONE option. Cleanup, cancellation, caching: all handled.
  const { data, isLoading } = useQuery({
    queryKey: ["claim", id],
    queryFn: () => apiFetch<{ messages: Message[] }>(`/claims/${id}`),
    refetchInterval: 2000,
  });

  const sendMessage = useMutation({
    mutationFn: (text: string) => apiPost(`/claims/${id}/messages`, { text }),
    onSuccess: () => {
      // Force an immediate refetch instead of waiting for the next poll.
      queryClient.invalidateQueries({ queryKey: ["claim", id] });
    },
  });

  if (isLoading) return <p>Loading…</p>;

  return (
    <div>
      <h1>Claim {id}</h1>
      <div>
        {data?.messages.map((m, i) => (
          <p key={i}><b>{m.role}:</b> {m.text}</p>
        ))}
      </div>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={sendMessage.isPending}
      />
      <button
        onClick={() => { sendMessage.mutate(input); setInput(""); }}
        disabled={sendMessage.isPending}
      >
        Send
      </button>
    </div>
  );
}