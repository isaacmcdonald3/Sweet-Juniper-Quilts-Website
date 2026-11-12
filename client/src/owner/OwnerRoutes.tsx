import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { OwnerCategoriesPage } from "./pages/OwnerCategoriesPage";
import { OwnerDashboardHome } from "./pages/OwnerDashboardHome";
import { OwnerHomepagePage } from "./pages/OwnerHomepagePage";
import { OwnerOrdersPage } from "./pages/OwnerOrdersPage";
import { OwnerPlaceholderPage } from "./pages/OwnerPlaceholderPage";
import { OwnerProductsPage } from "./pages/OwnerProductsPage";
import { OwnerDashboardLayout } from "./OwnerDashboardLayout";
import { useOwnerAuth } from "./owner-auth";

export function OwnerRoutes() {
  const { loading, session, signOut } = useOwnerAuth();
  const [logoutError, setLogoutError] = useState("");

  async function logoutUnauthorized() {
    try {
      await signOut();
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : "Sign out could not be completed.");
    }
  }

  if (loading) return <main className="owner-auth-state" role="status">Checking your sign-in…</main>;
  if (!session) return <Navigate to="/owner/login" replace />;
  if (session.user.app_metadata?.is_owner !== true) {
    return (
      <main className="owner-auth-state">
        <h1>Owner access required</h1>
        <p>This account is not authorized to use the owner dashboard.</p>
        {logoutError && <p className="owner-error" role="alert">{logoutError}</p>}
        <button className="button button--outline" onClick={() => void logoutUnauthorized()} type="button">Sign out</button>
      </main>
    );
  }

  return (
    <Routes>
      <Route element={<OwnerDashboardLayout />}>
        <Route index element={<OwnerDashboardHome />} />
        <Route path="products" element={<OwnerProductsPage />} />
        <Route path="categories" element={<OwnerCategoriesPage />} />
        <Route path="orders" element={<OwnerOrdersPage />} />
        <Route path="homepage" element={<OwnerHomepagePage />} />
        <Route path="media" element={<OwnerPlaceholderPage title="Media management" message="Secure Cloudinary uploads will be added in a later phase. Product media already remains available on public product records." />} />
        <Route path="email-logs" element={<OwnerPlaceholderPage title="Email logs" message="Transactional email delivery and its logs are scheduled for a later phase." />} />
        <Route path="settings" element={<OwnerPlaceholderPage title="Settings" message="Store and account settings will be added when their related workflows are introduced." />} />
        <Route path="*" element={<Navigate to="/owner" replace />} />
      </Route>
    </Routes>
  );
}
