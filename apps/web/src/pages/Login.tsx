import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate("/home");
    });
  }, [navigate]);

  async function signIn() {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    else navigate("/home");
  }

  async function signUp() {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) setError(error.message);
    else navigate("/home");
  }

  return (
    <div>
      <h1>ClaimPilot</h1>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="password" />
      <button onClick={signIn}>Sign in</button>
      <button onClick={signUp}>Sign up</button>
      {error && <p>{error}</p>}
    </div>
  );
}

