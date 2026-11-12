import { Link } from "react-router-dom";
import type { AdminOverview } from "@sweet-juniper/shared";
import { useAdminResource } from "../use-admin-resource";

export function OwnerDashboardHome() {
  const { data, loading, error, reload } = useAdminResource<AdminOverview>("/api/admin/overview");
  return (
    <section className="owner-page">
      <div className="owner-page__heading">
        <div><p className="eyebrow">YOUR STUDIO AT A GLANCE</p><h1>Overview</h1></div>
        <Link className="button button--primary" to="/owner/products">Manage products</Link>
      </div>
      {loading ? <p className="owner-state" role="status">Loading shop overview…</p> : error ? (
        <div className="owner-state owner-state--error" role="alert">{error} <button className="text-link" onClick={reload} type="button">Try again</button></div>
      ) : data ? (
        <>
          <div className="owner-stats">
            <article><span>Published products</span><strong>{data.publishedProductCount}</strong></article>
            <article><span>Total orders</span><strong>{data.totalOrderCount}</strong></article>
            <article><span>Inventory alerts</span><strong>{data.inventoryAlerts.length}</strong></article>
          </div>
          <div className="owner-panels">
            <section className="owner-panel">
              <div className="owner-panel__heading"><h2>Inventory to review</h2><Link to="/owner/products">All products</Link></div>
              {data.inventoryAlerts.length ? (
                <ul className="owner-alert-list">
                  {data.inventoryAlerts.map((product) => (
                    <li key={product.id}>
                      <Link to="/owner/products">{product.name}</Link>
                      <span>{product.inventoryQuantity} available · alert at {product.lowInventoryThreshold}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="owner-empty">No low-inventory products need attention.</p>}
            </section>
            <section className="owner-panel">
              <div className="owner-panel__heading"><h2>Recent orders</h2><Link to="/owner/orders">View all</Link></div>
              {data.recentOrders.length ? (
                <ul className="owner-alert-list">
                  {data.recentOrders.map((order) => (
                    <li key={order.id}>
                      <Link to={`/owner/orders?selected=${order.id}`}>Order #{order.orderNumber}</Link>
                      <span>{order.customerName} · {order.status}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="owner-empty">Orders will appear here when customers place them.</p>}
            </section>
          </div>
          <p className="owner-help-note">Sales totals are intentionally omitted until verified payment processing is available.</p>
        </>
      ) : null}
    </section>
  );
}
