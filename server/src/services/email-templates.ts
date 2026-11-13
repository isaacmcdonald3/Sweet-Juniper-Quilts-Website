export type EmailTemplateKey =
  | "customer_order_confirmation"
  | "customer_payment_confirmation"
  | "customer_shipping_confirmation"
  | "customer_cancellation"
  | "customer_refund"
  | "owner_new_paid_order"
  | "owner_customer_contact";

export interface EmailOrder {
  orderNumber: number;
  customerName: string;
  customerEmail: string;
  shippingAddress: Record<string, unknown>;
  subtotal: number;
  shippingAmount: number;
  totalAmount: number;
  currency: string;
  shippingCarrier: string | null;
  trackingNumber: string | null;
  items: Array<{
    name: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const supportEmail = "sweetjuniperquilts@gmail.com";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character);
}

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}

function addressLines(address: Record<string, unknown>): string[] {
  return Object.values(address).filter(
    (value): value is string => typeof value === "string" && Boolean(value.trim()),
  );
}

function trackingUrl(carrier: string | null, trackingNumber: string): string | null {
  const tracking = encodeURIComponent(trackingNumber);
  switch (carrier?.trim().toLowerCase()) {
    case "usps":
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tracking}`;
    case "ups":
      return `https://www.ups.com/track?tracknum=${tracking}`;
    case "fedex":
      return `https://www.fedex.com/fedextrack/?trknbr=${tracking}`;
    case "dhl":
      return `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${tracking}`;
    default:
      return null;
  }
}

function layout(title: string, content: string, baseUrl: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f1e8;color:#293d32;font-family:Georgia,serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f1e8;padding:28px 12px">
      <tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fffdf8;border:1px solid #e3d9cb">
        <tr><td style="padding:28px 34px;background:#344a3c;color:#fffaf1"><div style="font-size:13px;letter-spacing:3px;color:#f2c99e">SWEET JUNIPER QUILTS</div><div style="margin-top:12px;font-size:28px">${escapeHtml(title)}</div></td></tr>
        <tr><td style="padding:30px 34px;font-size:16px;line-height:1.65">${content}</td></tr>
        <tr><td style="padding:20px 34px;border-top:1px solid #e3d9cb;color:#64695d;font:14px/1.6 Arial,sans-serif">Questions? <a href="mailto:${supportEmail}" style="color:#76533e">${supportEmail}</a><br><a href="${escapeHtml(baseUrl)}" style="color:#76533e">Visit Sweet Juniper Quilts</a></td></tr>
      </table></td></tr>
    </table>
  </body></html>`;
}

function orderItems(order: EmailOrder): string {
  return order.items.map((item) => `
    <tr>
      <td style="padding:10px 6px;border-bottom:1px solid #e9e2d7">${escapeHtml(item.name)}<br><small style="color:#777367">${escapeHtml(item.sku)}</small></td>
      <td align="center" style="padding:10px 6px;border-bottom:1px solid #e9e2d7">${item.quantity}</td>
      <td align="right" style="padding:10px 6px;border-bottom:1px solid #e9e2d7">${formatCurrency(item.lineTotal, order.currency)}</td>
    </tr>`).join("");
}

function orderSummary(order: EmailOrder, includeAddress = true): string {
  const address = addressLines(order.shippingAddress);
  const shippingAddress = includeAddress
    ? `<h3 style="margin:26px 0 6px;font-size:17px">Shipping address</h3><p style="margin:0">${address.map(escapeHtml).join("<br>")}</p>`
    : "";
  return `<p>Order <strong>#${order.orderNumber}</strong></p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font:14px/1.5 Arial,sans-serif">
      <thead><tr><th align="left">Item</th><th>Qty</th><th align="right">Price</th></tr></thead>
      <tbody>${orderItems(order)}</tbody>
      <tfoot>
        <tr><td colspan="2" align="right" style="padding:7px">Subtotal</td><td align="right">${formatCurrency(order.subtotal, order.currency)}</td></tr>
        <tr><td colspan="2" align="right" style="padding:7px">Shipping</td><td align="right">${formatCurrency(order.shippingAmount, order.currency)}</td></tr>
        <tr><td colspan="2" align="right" style="padding:9px;font-weight:bold">Total</td><td align="right" style="font-weight:bold">${formatCurrency(order.totalAmount, order.currency)}</td></tr>
      </tfoot>
    </table>
    ${shippingAddress}`;
}

export function renderEmail(
  key: EmailTemplateKey,
  order: EmailOrder | null,
  contact: { name: string; email: string; message: string } | null,
  baseUrl: string,
): RenderedEmail {
  if (key === "owner_customer_contact") {
    if (!contact) throw new Error("Contact submission details are unavailable.");
    const subject = "New customer message";
    const html = layout(subject, `<p><strong>${escapeHtml(contact.name)}</strong> · <a href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a></p><p style="white-space:pre-wrap">${escapeHtml(contact.message)}</p>`, baseUrl);
    return { subject, html, text: `${subject}\n${contact.name} (${contact.email})\n\n${contact.message}` };
  }
  if (!order) throw new Error("Order details are unavailable.");

  const summary = orderSummary(order);
  const orderLabel = `Order #${order.orderNumber}`;
  let title: string;
  let subject: string;
  let intro: string;
  let plainIntro: string;
  switch (key) {
    case "customer_order_confirmation":
      title = "Thank you for your order";
      subject = `Order confirmation ${orderLabel}`;
      intro = `Hello ${escapeHtml(order.customerName)}, your order is safely recorded. Here are the details for your records.`;
      plainIntro = `Hello ${order.customerName}, your order is safely recorded. Here are the details for your records.`;
      break;
    case "customer_payment_confirmation":
      title = "Payment received";
      subject = `Payment received for ${orderLabel}`;
      intro = `Hello ${escapeHtml(order.customerName)}, your payment was confirmed. Thank you for supporting our little studio.`;
      plainIntro = `Hello ${order.customerName}, your payment was confirmed. Thank you for supporting our little studio.`;
      break;
    case "customer_shipping_confirmation": {
      title = "Your order is on its way";
      subject = `Shipping confirmation ${orderLabel}`;
      const link = order.trackingNumber ? trackingUrl(order.shippingCarrier, order.trackingNumber) : null;
      const tracking = order.trackingNumber
        ? `Tracking number: ${escapeHtml(order.trackingNumber)}${link ? ` · <a href="${link}" style="color:#76533e">Track package</a>` : ""}`
        : "Your tracking details will be shared when available.";
      intro = `Hello ${escapeHtml(order.customerName)}, your order has shipped${order.shippingCarrier ? ` with ${escapeHtml(order.shippingCarrier)}` : ""}.<br>${tracking}`;
      plainIntro = `Hello ${order.customerName}, your order has shipped${order.shippingCarrier ? ` with ${order.shippingCarrier}` : ""}.${order.trackingNumber ? ` Tracking number: ${order.trackingNumber}${link ? ` · Track package: ${link}` : ""}` : " Your tracking details will be shared when available."}`;
      break;
    }
    case "customer_cancellation":
      title = "Order cancelled";
      subject = `Cancellation update ${orderLabel}`;
      intro = `Hello ${escapeHtml(order.customerName)}, your order was cancelled. Any applicable refund has been recorded by PayPal.`;
      plainIntro = `Hello ${order.customerName}, your order was cancelled. Any applicable refund has been recorded by PayPal.`;
      break;
    case "customer_refund":
      title = "Refund confirmed";
      subject = `Refund update ${orderLabel}`;
      intro = `Hello ${escapeHtml(order.customerName)}, your refund was confirmed. PayPal may take a few business days to post it to your account.`;
      plainIntro = `Hello ${order.customerName}, your refund was confirmed. PayPal may take a few business days to post it to your account.`;
      break;
    case "owner_new_paid_order":
      title = "New paid order";
      subject = `New paid order ${orderLabel}`;
      intro = `${escapeHtml(order.customerName)} (${escapeHtml(order.customerEmail)}) placed a successfully paid order.`;
      plainIntro = `${order.customerName} (${order.customerEmail}) placed a successfully paid order.`;
      break;
    default: {
      const exhaustive: never = key;
      throw new Error(`Unknown email template: ${exhaustive}`);
    }
  }
  const html = layout(title, `<p>${intro}</p>${key === "owner_new_paid_order" ? orderSummary(order, false) : summary}`, baseUrl);
  const textItems = order.items.map((item) =>
    `${item.name} (${item.sku}) × ${item.quantity}: ${formatCurrency(item.lineTotal, order.currency)}`,
  );
  const addressText = key === "owner_new_paid_order"
    ? ""
    : `\nShipping address: ${addressLines(order.shippingAddress).join(", ")}`;
  const text = `${title}\n${plainIntro}\n${orderLabel}\n${textItems.join("\n")}\nSubtotal: ${formatCurrency(order.subtotal, order.currency)}\nShipping: ${formatCurrency(order.shippingAmount, order.currency)}\nTotal: ${formatCurrency(order.totalAmount, order.currency)}${addressText}\nContact: ${supportEmail}`;
  return { subject, html, text };
}
