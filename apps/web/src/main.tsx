import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import Buy from "./pages/Buy";
import PolicyDetail from "./pages/PolicyDetail";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/buy" element={<Buy />} />
        <Route path="/policies/:id" element={<PolicyDetail />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);