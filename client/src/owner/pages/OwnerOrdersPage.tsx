import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AdminOrder, AdminOrderSummary } from "@sweet-juniper/shared";
import { requestAdminJson } from "../../services/admin-api";
import { useAdminResource } from "../use-admin-resource";

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
}

export function OwnerOrdersPage() {
  const orders = useAdminResource<AdminOrderSummary[]>("/api/admin/orders");
  const [searchParams] = useSearchParams();
  const selectedId = searchParams.get("selected");
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!selectedId) {
      setOrder(null);
      return () => { active = false; };
    }
    setDetailLoading(true);
    setDetailError("");
    requestAdminJson<AdminOrder>(`/api/admin/orders/${selectedId}`)
      .then((result) => { if (active) setOrder(result); })
      .catch((cause: unknown) => { if (active) setDetailError(cause instanceof Error ? cause.message : "Order details could not be loaded."); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId]);

  return (
    <section className="owner-page">
      <div className="owner-page__heading"><div><p className="eyebrow">CUSTOMER PURCHASES</p><h1>Orders</h1></div></div>
      <p className="owner-help-note">Payments are shown as recorded by the payment provider. This dashboard cannot mark a payment as paid.</p>
      {orders.loading ? <p className="owner-state" role="status">Loading orders…</p> : orders.error ? <p className="owner-error" role="alert">{orders.error} <button className="text-link" onClick={orders.reload} type="button">Try again</button></p> : orders.data?.length ? (
        <div className="owner-table-wrap">
          <table className="owner-table">
            <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Fulfillment</th><th>Total</th><th>Placed</th></tr></thead>
            <tbody>{orders.data.map((item) => (
              <tr className={selectedId === item.id ? "owner-table__selected" : ""} key={item.id}>
                <td><Link className="text-link" to={`/owner/orders?selected=${item.id}`}>#{item.orderNumber}</Link></td>
                <td><strong>{item.customerName}</strong><small>{item.customerEmail}</small></td>
                <td><span className="owner-status">{item.status}</span></td>
                <td>{item.fulfillmentStatus}</td>
                <td>{formatCurrency(item.totalAmount, item.currency)}</td>
                <td>{new Date(item.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="owner-empty-card">No orders yet. Order details will appear here after checkout is introduced.</p>}
      {selectedId && (
        <section className="owner-panel owner-order-detail">
          <div className="owner-panel__heading"><h2>Order details</h2><Link className="text-link" to="/owner/orders">Close details</Link></div>
          {detailLoading ? <p role="status">Loading order details…</p> : detailError ? <p className="owner-error" role="alert">{detailError}</p> : order ? (
            <>
              <p><strong>Order #{order.orderNumber}</strong> · {order.customerName} · {order.customerEmail}</p>
              <h3>Items</h3>
              <ul className="owner-order-items">{order.items.map((item) => <li key={item.id}>{item.productName} ({item.sku}) × {item.quantity}<strong>{formatCurrency(item.lineTotal, order.currency)}</strong></li>)}</ul>
              <h3>Shipping</h3>
              <p>{Object.values(order.shippingAddress).filter((value) => typeof value === "string").join(", ") || "No shipping address recorded."}</p>
              <p>{order.shippingCarrier || "Carrier not assigned"} · {order.trackingNumber || "Tracking not assigned"}</p>
              <h3>Payment records</h3>
              {order.payments.length ? <ul className="owner-order-items">{order.payments.map((payment) => <li key={payment.id}>{payment.provider} · {payment.status}<strong>{formatCurrency(payment.amount, payment.currency)}</strong></li>)}</ul> : <p>No payment records yet.</p>}
            </>
          ) : null}
        </section>
      )}
    </section>
  );
}
