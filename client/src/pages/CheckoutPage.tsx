import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { formatPrice } from "../components/ProductCard";
import { useCart } from "../hooks/cart-context";
import { requestApi } from "../services/storefront-api";

interface PublicConfig {
  configured: boolean;
  clientId: string | null;
  mode: "sandbox" | "live";
  shippingAmount: number;
}

interface PreparedOrder {
  reservationId: string;
  paypalOrderId: string;
  clientId: string;
  subtotal: string;
  shippingAmount: string;
  amount: string;
  items: Array<{ name: string; sku: string; quantity: number; unitPrice: string; lineTotal: string }>;
}

interface CheckoutReceipt {
  orderNumber: number;
  total: number;
}

interface PaypalButtons {
  render: (container: HTMLElement) => Promise<void>;
}

interface PaypalSdk {
  Buttons: (options: {
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onCancel: () => void;
    onError: (error: Error) => void;
  }) => PaypalButtons;
}

declare global {
  interface Window {
    paypal?: PaypalSdk;
  }
}

async function requestJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await requestApi(path, undefined, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || "Checkout could not be completed. Please try again.");
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

function loadPaypalSdk(clientId: string): Promise<PaypalSdk> {
  if (window.paypal) return Promise.resolve(window.paypal);
  return new Promise((resolve, reject) => {
    const existing = document.getElementById("paypal-checkout-sdk") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => window.paypal ? resolve(window.paypal) : reject(new Error("PayPal could not load.")), { once: true });
      existing.addEventListener("error", () => reject(new Error("PayPal could not load. Check your connection and try again.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = "paypal-checkout-sdk";
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture`;
    script.async = true;
    script.onload = () => window.paypal ? resolve(window.paypal) : reject(new Error("PayPal could not load."));
    script.onerror = () => reject(new Error("PayPal could not load. Check your connection and try again."));
    document.head.append(script);
  });
}

export function CheckoutPage() {
  const { items, clear } = useCart();
  const buttonContainer = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [prepared, setPrepared] = useState<PreparedOrder | null>(null);
  const [receipt, setReceipt] = useState<CheckoutReceipt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [captureNeedsRetry, setCaptureNeedsRetry] = useState(false);

  useEffect(() => {
    let active = true;
    requestJson<PublicConfig>("/api/checkout/config")
      .then((result) => { if (active) setConfig(result); })
      .catch((cause: unknown) => {
        if (active) setConfigError(cause instanceof Error ? cause.message : "PayPal checkout could not be loaded.");
      });
    return () => { active = false; };
  }, []);

  async function cancelReservation(order: PreparedOrder) {
    await requestJson<void>("/api/checkout/cancel", {
      reservationId: order.reservationId,
      paypalOrderId: order.paypalOrderId,
    });
  }

  async function confirmPayment(paypalOrderId: string) {
    if (!prepared) return;
    setBusy(true);
    setError("");
    try {
      const result = await requestJson<CheckoutReceipt>("/api/checkout/capture", {
        reservationId: prepared.reservationId,
        paypalOrderId,
      });
      clear();
      setReceipt(result);
      setPrepared(null);
      setCaptureNeedsRetry(false);
    } catch (cause) {
      setCaptureNeedsRetry(true);
      setError(cause instanceof Error
        ? `${cause.message} Do not pay again. You can retry payment verification below.`
        : "Payment verification is still pending. Do not pay again; retry verification below.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!prepared || receipt || !buttonContainer.current || captureNeedsRetry) return;
    let active = true;
    const container = buttonContainer.current;
    void loadPaypalSdk(prepared.clientId)
      .then((paypal) => {
        if (!active) return;
        container.replaceChildren();
        return paypal.Buttons({
          createOrder: async () => prepared.paypalOrderId,
          onApprove: async (data) => { await confirmPayment(data.orderID); },
          onCancel: () => {
            void cancelReservation(prepared)
              .then(() => {
                if (active) {
                  setPrepared(null);
                  setError("Checkout was cancelled. No payment was taken, and your cart is unchanged.");
                }
              })
              .catch((cause: unknown) => {
                if (active) setError(cause instanceof Error ? cause.message : "Checkout was cancelled, but the inventory hold will expire automatically.");
              });
          },
          onError: () => {
            if (active) setError("PayPal could not continue. No payment has been confirmed. Your inventory hold will expire after 30 minutes.");
          },
        }).render(container);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "PayPal could not load.");
      });
    return () => {
      active = false;
      container.replaceChildren();
    };
  }, [captureNeedsRetry, prepared, receipt]);

  async function prepareCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config?.configured) {
      setError(configError || "PayPal Sandbox is not configured. Please contact the shop.");
      return;
    }
    if (items.length === 0) return;
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const order = await requestJson<PreparedOrder>("/api/checkout/orders", {
        idempotencyKey: crypto.randomUUID(),
        customer: {
          name: String(values.get("name") || ""),
          email: String(values.get("email") || ""),
          address: {
            addressLine1: String(values.get("addressLine1") || ""),
            addressLine2: String(values.get("addressLine2") || ""),
            city: String(values.get("city") || ""),
            region: String(values.get("region") || ""),
            postalCode: String(values.get("postalCode") || ""),
            country: String(values.get("country") || "US"),
          },
        },
        items: items.map(({ product, quantity }) => ({ productId: product.id, quantity })),
      });
      setPrepared(order);
      setCaptureNeedsRetry(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your order could not be prepared. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (receipt) {
    return (
      <main className="page-main section-wrap checkout-page">
        <p className="eyebrow">THANK YOU</p>
        <h1>Your order is confirmed.</h1>
        <p>Order #{receipt.orderNumber} · {formatPrice(receipt.total)}</p>
        <p>Your payment was verified by PayPal and your order has been recorded.</p>
        <Link className="button button--primary" to="/catalog">Continue exploring</Link>
      </main>
    );
  }

  if (items.length === 0 && !prepared) {
    return (
      <main className="page-main section-wrap checkout-page">
        <h1>Your bag is empty.</h1>
        <Link className="text-link" to="/cart">Return to your bag</Link>
      </main>
    );
  }

  return (
    <main className="page-main section-wrap checkout-page">
      <div className="page-intro page-intro--compact">
        <p className="eyebrow">SECURE CHECKOUT</p>
        <h1>Shipping details</h1>
        <p>{config?.configured && config.mode === "live" ? "PayPal Live checkout." : "PayPal Sandbox checkout."} Your payment is verified by our server before an order is confirmed.</p>
      </div>
      {config?.mode === "sandbox" && <p className="checkout-sandbox-note">Sandbox test checkout — no real payment will be taken.</p>}
      {error && <p className="owner-error" role="alert">{error}</p>}

      {!prepared ? (
        <form className="checkout-form" onSubmit={(event) => void prepareCheckout(event)}>
          <label><span>Full name</span><input autoComplete="name" maxLength={120} name="name" required /></label>
          <label><span>Email address</span><input autoComplete="email" maxLength={254} name="email" required type="email" /></label>
          <label className="checkout-form__wide"><span>Street address</span><input autoComplete="address-line1" maxLength={150} name="addressLine1" required /></label>
          <label className="checkout-form__wide"><span>Apartment, suite, etc. (optional)</span><input autoComplete="address-line2" maxLength={150} name="addressLine2" /></label>
          <label><span>City</span><input autoComplete="address-level2" maxLength={100} name="city" required /></label>
          <label><span>State / region</span><input autoComplete="address-level1" maxLength={100} name="region" required /></label>
          <label><span>Postal code</span><input autoComplete="postal-code" maxLength={24} name="postalCode" required /></label>
          <label><span>Country code</span><input autoComplete="country" defaultValue="US" maxLength={2} name="country" required /></label>
          <div className="checkout-form__wide checkout-review">
            <h2>Items in your bag</h2>
            <ul>{items.map(({ product, quantity }) => (
              <li key={product.id}>
                <span>{product.name} × {quantity}</span>
                <strong>{formatPrice(product.price * quantity)}</strong>
              </li>
            ))}</ul>
            <p>These are estimates from the catalog. The server will re-check current prices and stock and show your exact total before PayPal approval.</p>
          </div>
          <button className="button button--primary checkout-form__wide" disabled={busy || !config?.configured} type="submit">
            {busy ? "Checking availability…" : "Review secure payment"}
          </button>
          {!config?.configured && !configError && config && <p className="checkout-form__wide" role="status">PayPal is not fully configured. Sandbox credentials and a verified webhook are required.</p>}
        </form>
      ) : (
        <section className="checkout-review">
          <h2>Review your verified order</h2>
          <ul>{prepared.items.map((item) => (
            <li key={`${item.sku}-${item.name}`}>
              <span>{item.name} × {item.quantity} <small>{formatPrice(Number(item.unitPrice))} each</small></span>
              <strong>{formatPrice(Number(item.lineTotal))}</strong>
            </li>
          ))}</ul>
          <div><span>Subtotal</span><strong>{formatPrice(Number(prepared.subtotal))}</strong></div>
          <div><span>Shipping</span><strong>{formatPrice(Number(prepared.shippingAmount))}</strong></div>
          <div className="checkout-review__total"><span>Total (USD)</span><strong>{formatPrice(Number(prepared.amount))}</strong></div>
          <p>These prices and quantities were verified against the current database. Your items are held for 30 minutes while you complete PayPal checkout.</p>
          {captureNeedsRetry ? (
            <button className="button button--primary" disabled={busy} onClick={() => void confirmPayment(prepared.paypalOrderId)} type="button">
              {busy ? "Verifying payment…" : "Retry payment verification"}
            </button>
          ) : (
            <>
              <div aria-label="Pay with PayPal" className="paypal-buttons" ref={buttonContainer} />
              {busy && <p role="status">Verifying your PayPal payment…</p>}
            </>
          )}
          <button className="text-link" disabled={busy} onClick={() => {
            void cancelReservation(prepared)
              .then(() => { setPrepared(null); setError("Checkout cancelled. No payment was taken."); })
              .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "The checkout could not be cancelled."));
          }} type="button">Cancel and return to your bag</button>
        </section>
      )}
      <p className="checkout-contact">For custom crafts, email <a href="mailto:sweetjuniperquilts@gmail.com">sweetjuniperquilts@gmail.com</a>.</p>
      <Link className="text-link" to="/cart">Return to your bag</Link>
    </main>
  );
}
