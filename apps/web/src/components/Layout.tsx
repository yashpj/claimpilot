import { Link, Outlet, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useMe } from "../lib/me";

export default function Layout() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await supabase.auth.signOut();
    queryClient.clear(); // never show the previous user's cached data
    navigate("/");
  }

  return (
    <>
      <nav>
        <b>ClaimPilot</b>
        <Link to="/home">My policies</Link>
        <Link to="/buy">Buy a policy</Link>
        {me?.role === "reviewer" && <Link to="/admin">Review queue</Link>}
        <span className="spacer" />
        <small>{me?.email}</small>
        <button onClick={signOut}>Sign out</button>
      </nav>
      <main>
        <Outlet />
      </main>
    </>
  );
}
