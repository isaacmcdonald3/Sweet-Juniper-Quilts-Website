import { useEffect, useMemo, useState, type FormEvent } from "react";
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
  const [search, setSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [fulfillmentFilter, setFulfillmentFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");

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

  const filteredOrders = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return (orders.data || []).filter((item) => {
      const matchesSearch = !term ||
        String(item.orderNumber).includes(term) ||
        item.customerName.toLocaleLowerCase().includes(term) ||
        item.customerEmail.toLocaleLowerCase().includes(term);
      return matchesSearch &&
        (!paymentFilter || item.paymentStatus === paymentFilter) &&
        (!fulfillmentFilter || item.fulfillmentStatus === fulfillmentFilter);
    });
  }, [fulfillmentFilter, orders.data, paymentFilter, search]);

  async function saveFulfillment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setActionError("");
    setActionMessage("");
    try {
      const updated = await requestAdminJson<AdminOrder>(`/api/admin/orders/${order.id}/fulfillment`, {
        method: "PATCH",
        body: {
          fulfillmentStatus: String(data.get("fulfillmentStatus")),
          shippingCarrier: String(data.get("shippingCarrier") || "").trim() || null,
          trackingNumber: String(data.get("trackingNumber") || "").trim() || null,
        },
      });
      setOrder(updated);
      setActionMessage("Fulfillment details were saved.");
      orders.reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Fulfillment details could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function refundOrder(cancelled: boolean) {
    if (!order) return;
    const action = cancelled ? "cancel and fully refund" : "fully refund";
    if (!window.confirm(`Are you sure you want to ${action} order #${order.orderNumber}? PayPal will process the refund.`)) return;
    setBusy(true);
    setActionError("");
    setActionMessage("");
    try {
      await requestAdminJson<void>(`/api/admin/orders/${order.id}/refund`, {
        method: "POST",
        body: { cancelled },
      });
      const updated = await requestAdminJson<AdminOrder>(`/api/admin/orders/${order.id}`);
      setOrder(updated);
      setActionMessage(cancelled ? "The order was cancelled and refunded by PayPal." : "The refund was confirmed by PayPal.");
      orders.reload();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "PayPal could not confirm the refund.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="owner-page">
      <div className="owner-page__heading"><div><p className="eyebrow">CUSTOMER PURCHASES</p><h1>Orders</h1></div></div>
      <p className="owner-help-note">Payment status is verified by PayPal. This dashboard cannot manually mark a payment as paid, refunded, or cancelled.</p>
      <div className="owner-order-filters">
        <label><span>Search orders</span><input onChange={(event) => setSearch(event.target.value)} placeholder="Order number, customer, or email" type="search" value={search} /></label>
        <label><span>Payment status</span><select onChange={(event) => setPaymentFilter(event.target.value)} value={paymentFilter}><option value="">All payment statuses</option><option value="captured">Captured</option><option value="refunded">Refunded</option><option value="failed">Failed</option><option value="created">Created</option></select></label>
        <label><span>Fulfillment status</span><select onChange={(event) => setFulfillmentFilter(event.target.value)} value={fulfillmentFilter}><option value="">All fulfillment statuses</option><option value="unfulfilled">Unfulfilled</option><option value="processing">Processing</option><option value="shipped">Shipped</option><option value="fulfilled">Fulfilled</option><option value="returned">Returned</option></select></label>
      </div>
      {orders.loading ? <p className="owner-state" role="status">Loading orders…</p> : orders.error ? <p className="owner-error" role="alert">{orders.error} <button className="text-link" onClick={orders.reload} type="button">Try again</button></p> : orders.data?.length ? (
        filteredOrders.length ? <div className="owner-table-wrap">
          <table className="owner-table">
            <thead><tr><th>Order</th><th>Customer</th><th>Payment</th><th>Fulfillment</th><th>Total</th><th>Placed</th></tr></thead>
            <tbody>{filteredOrders.map((item) => (
              <tr className={selectedId === item.id ? "owner-table__selected" : ""} key={item.id}>
                <td><Link className="text-link" to={`/owner/orders?selected=${item.id}`}>#{item.orderNumber}</Link></td>
                <td><strong>{item.customerName}</strong><small>{item.customerEmail}</small></td>
                <td><span className="owner-status">{item.paymentStatus}</span></td>
                <td>{item.fulfillmentStatus}</td>
                <td>{formatCurrency(item.totalAmount, item.currency)}</td>
                <td>{new Date(item.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}</tbody>
          </table>
        </div> : <p className="owner-empty-card">No orders match the selected search and filters.</p>
      ) : <p className="owner-empty-card">No orders yet. Completed PayPal purchases will appear here.</p>}
      {selectedId && (
        <section className="owner-panel owner-order-detail">
          <div className="owner-panel__heading"><h2>Order details</h2><Link className="text-link" to="/owner/orders">Close details</Link></div>
          {detailLoading ? <p role="status">Loading order details…</p> : detailError ? <p className="owner-error" role="alert">{detailError}</p> : order ? (
            <>
              <p><strong>Order #{order.orderNumber}</strong> · {order.customerName} · <a href={`mailto:${order.customerEmail}`}>{order.customerEmail}</a></p>
              <p>Placed {new Date(order.createdAt).toLocaleString()} · Order status: {order.status} · Payment status: {order.paymentStatus}</p>
              <h3>Items</h3>
              <ul className="owner-order-items">{order.items.map((item) => <li key={item.id}>{item.productName} ({item.sku}) × {item.quantity} · {formatCurrency(item.unitPrice, order.currency)} each<strong>{formatCurrency(item.lineTotal, order.currency)}</strong></li>)}</ul>
              <p>Subtotal {formatCurrency(order.subtotal, order.currency)} · Shipping {formatCurrency(order.shippingAmount, order.currency)} · Total <strong>{formatCurrency(order.totalAmount, order.currency)}</strong></p>
              <h3>Shipping</h3>
              <p>{Object.values(order.shippingAddress).filter((value) => typeof value === "string" && value.trim()).join(", ") || "No shipping address recorded."}</p>
              <p>{order.shippingCarrier || "Carrier not assigned"} · {order.trackingNumber || "Tracking not assigned"}</p>
              <form className="owner-order-fulfillment" onSubmit={(event) => void saveFulfillment(event)}>
                <label><span>Fulfillment status</span><select defaultValue={order.fulfillmentStatus} name="fulfillmentStatus"><option value="processing">Processing</option><option value="shipped">Shipped</option><option value="fulfilled">Fulfilled</option><option value="returned">Returned</option></select></label>
                <label><span>Shipping carrier</span><input defaultValue={order.shippingCarrier || ""} maxLength={100} name="shippingCarrier" /></label>
                <label><span>Tracking number</span><input defaultValue={order.trackingNumber || ""} maxLength={150} name="trackingNumber" /></label>
                <button className="button button--primary" disabled={busy || ["refunded", "cancelled"].includes(order.status)} type="submit">{busy ? "Saving…" : "Save fulfillment"}</button>
              </form>
              <h3>Payment records</h3>
              {order.payments.length ? <ul className="owner-order-items">{order.payments.map((payment) => <li key={payment.id}>{payment.provider} · {payment.status} · refund: {payment.refundStatus}<small>PayPal order {payment.providerOrderId || "—"} · capture {payment.providerTransactionId || "—"}</small><strong>{formatCurrency(payment.amount, payment.currency)}</strong></li>)}</ul> : <p>No payment records yet.</p>}
              <p>PayPal order: {order.paypalOrderId || "—"} · capture: {order.paypalCaptureId || "—"}</p>
              {actionMessage && <p className="owner-success" role="status">{actionMessage}</p>}
              {actionError && <p className="owner-error" role="alert">{actionError}</p>}
              {["paid", "processing"].includes(order.status) && <div className="owner-order-actions">
                <button className="button button--outline" disabled={busy} onClick={() => void refundOrder(false)} type="button">Issue full refund</button>
                <button className="button button--outline" disabled={busy} onClick={() => void refundOrder(true)} type="button">Cancel and refund</button>
              </div>}
            </>
          ) : null}
        </section>
      )}
    </section>
  );
}
