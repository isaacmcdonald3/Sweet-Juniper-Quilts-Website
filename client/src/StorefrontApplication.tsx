import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import type { StorefrontHomepage } from "@sweet-juniper/shared";
import { SiteLayout } from "./components/SiteLayout";
import { CartProvider } from "./hooks/cart-context";
import { CartPage } from "./pages/CartPage";
import { CatalogPage } from "./pages/CatalogPage";
import { HomePage } from "./pages/HomePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PolicyPage } from "./pages/PolicyPage";
import { ProductDetailPage } from "./pages/ProductDetailPage";

export function StorefrontApplication({ data }: { data: StorefrontHomepage }) {
  const location = useLocation();

  useEffect(() => {
    if (!location.hash) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
  }, [location.hash, location.pathname]);

  return (
    <CartProvider>
      <Routes>
        <Route element={<SiteLayout data={data} />}>
          <Route path="/" element={<HomePage data={data} />} />
          <Route path="/catalog" element={<CatalogPage data={data} />} />
          <Route path="/products/:slug" element={<ProductDetailPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/policies/shipping-returns" element={<PolicyPage data={data} policy="shipping" />} />
          <Route path="/policies/privacy" element={<PolicyPage data={data} policy="privacy" />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </CartProvider>
  );
}
