import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import AdminApp from "./AdminApp.jsx";
import "./index.css";

const root = ReactDOM.createRoot(document.getElementById("root"));

const isAdminRoute = window.location.pathname === "/admin" ||
  window.location.pathname.startsWith("/admin/");

root.render(
  <React.StrictMode>
    {isAdminRoute ? <AdminApp /> : <App />}
  </React.StrictMode>
);