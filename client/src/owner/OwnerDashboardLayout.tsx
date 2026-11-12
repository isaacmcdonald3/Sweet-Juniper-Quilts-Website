import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useOwnerAuth } from "./owner-auth";

const ownerLinks = [
  { to: "/owner", label: "Overview", end: true },
  { to: "/owner/products", label: "Products" },
  { to: "/owner/categories", label: "Categories" },
  { to: "/owner/orders", label: "Orders" },
  { to: "/owner/homepage", label: "Homepage" },
  { to: "/owner/media", label: "Media" },
  { to: "/owner/email-logs", label: "Email logs" },
  { to: "/owner/settings", label: "Settings" },
];

export function OwnerDashboardLayout() {
  const { session, signOut } = useOwnerAuth();
  const [logoutError, setLogoutError] = useState("");
  const navigate = useNavigate();

  async function logout() {
    setLogoutError("");
    try {
      await signOut();
      navigate("/owner/login", { replace: true });
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : "Sign out could not be completed.");
    }
  }

  return (
    <div className="owner-shell">
      <aside className="owner-sidebar">
        <a className="owner-sidebar__brand" href="/">
          <span className="brand__mark" aria-hidden="true">✳</span>
          <span>Sweet Juniper <small>OWNER STUDIO</small></span>
        </a>
        <nav aria-label="Owner navigation" className="owner-nav">
          {ownerLinks.map(({ to, label, end }) => (
            <NavLink end={end} key={to} to={to}>{label}</NavLink>
          ))}
        </nav>
        <a className="owner-sidebar__shop" href="/">View customer shop ↗</a>
      </aside>
      <div className="owner-main">
        <header className="owner-topbar">
          <span>Shop administration</span>
          <div className="owner-topbar__account">
            <span>{session?.user.email}</span>
            <button className="button button--outline" onClick={() => void logout()} type="button">Sign out</button>
          </div>
        </header>
        {logoutError && <p className="owner-error owner-error--banner" role="alert">{logoutError}</p>}
        <div className="owner-content"><Outlet /></div>
      </div>
    </div>
  );
}
