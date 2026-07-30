import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import Buy from "./pages/Buy";
import PolicyDetail from "./pages/PolicyDetail";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ClaimChat from "./pages/ClaimChat";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/buy" element={<Buy />} />
        <Route path="/policies/:id" element={<PolicyDetail />} />
        <Route path="/claims/:id" element={<ClaimChat />} />
      </Routes>
    </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);