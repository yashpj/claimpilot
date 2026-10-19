import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Buy from "./pages/Buy";
import PolicyDetail from "./pages/PolicyDetail";
import ClaimChat from "./pages/ClaimChat";
import AdminQueue from "./pages/admin/AdminQueue";
import AdminClaim from "./pages/admin/AdminClaim";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/home" element={<Home />} />
            <Route path="/buy" element={<Buy />} />
            <Route path="/policies/:id" element={<PolicyDetail />} />
            <Route path="/claims/:id" element={<ClaimChat />} />
            <Route path="/admin" element={<AdminQueue />} />
            <Route path="/admin/claims/:id" element={<AdminClaim />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
