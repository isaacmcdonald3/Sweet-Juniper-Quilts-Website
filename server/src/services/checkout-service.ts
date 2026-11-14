import type { SupabaseClient } from "@supabase/supabase-js";

type CheckoutConfig = {
  paypalClientId?: string;
  paypalClientSecret?: string;
  paypalMode: "sandbox" | "live";
  paypalLivePaymentsEnabled: boolean;
  paypalWebhookId?: string;
  shippingAmount: number;
  clientOrigin: string;
};

type CheckoutItemRequest = { productId: string; quantity: number };
type CustomerDetails = {
  name: string;
  email: string;
  address: {
    addressLine1: string;
    addressLine2: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
  };
};

type ReservationItem = {
  product_id: string | null;
  product_name_snapshot: string;
  quantity: number;
  unit_price: number | string;
  line_total: number | string;
};

type Reservation = {
  id: string;
  status: string;
  customer_name: string;
  customer_email: string;
  shipping_address: Record<string, string>;
  subtotal: number | string;
  shipping_amount: number | string;
  total_amount: number | string;
  currency: string;
  paypal_order_id: string | null;
  expires_at: string;
  items: ReservationItem[];
};

type PaypalCapture = {
  id: string;
  status: string;
  amount: { currency_code: string; value: string };
};

type PaypalOrder = {
  id: string;
  status: string;
  intent?: string;
  purchase_units?: Array<{
    custom_id?: string;
    reference_id?: string;
    amount?: {
      currency_code: string;
      value: string;
      breakdown?: {
        item_total?: { currency_code: string; value: string };
        shipping?: { currency_code: string; value: string };
      };
    };
    payments?: { captures?: PaypalCapture[] };
  }>;
};

function money(value: number | string): string {
  return Number(value).toFixed(2);
}

function getPaypalBaseUrl(mode: CheckoutConfig["paypalMode"]): string {
  return mode === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
}

export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function createCheckoutService(supabase: SupabaseClient, config: CheckoutConfig) {
  function isConfigured(): boolean {
    return Boolean(
      config.paypalClientId &&
      config.paypalClientSecret &&
      config.paypalWebhookId &&
      (config.paypalMode === "sandbox" || config.paypalLivePaymentsEnabled),
    );
  }

  function requirePaypalCredentials(): { clientId: string; clientSecret: string } {
    if (!isConfigured()) {
      throw new CheckoutError(
        config.paypalMode === "live"
          ? "Live payments are disabled until Sandbox testing is complete."
          : "PayPal Sandbox is not configured yet.",
        503,
      );
    }
    if (!config.paypalClientId || !config.paypalClientSecret) {
      throw new CheckoutError("PayPal credentials are incomplete.", 503);
    }
    return { clientId: config.paypalClientId, clientSecret: config.paypalClientSecret };
  }

  async function paypalRequest<T>(
    path: string,
    options: { method?: string; body?: unknown; requestId?: string } = {},
  ): Promise<T> {
    const { clientId, clientSecret } = requirePaypalCredentials();
    const tokenResponse = await fetch(`${getPaypalBaseUrl(config.paypalMode)}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenResponse.ok) {
      throw new CheckoutError("PayPal could not authorize this payment. Please try again.", 502);
    }
    const token = (await tokenResponse.json()) as { access_token?: string };
    if (!token.access_token) throw new CheckoutError("PayPal authorization was incomplete.", 502);

    const response = await fetch(`${getPaypalBaseUrl(config.paypalMode)}${path}`, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        "Content-Type": "application/json",
        ...(options.requestId ? { "PayPal-Request-Id": options.requestId } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new CheckoutError("PayPal could not complete this request. Please try again.", 502);
    }
    return (await response.json()) as T;
  }

  async function readReservation(id: string): Promise<Reservation | null> {
    const { data, error } = await supabase
      .from("checkout_reservations")
      .select("id,status,customer_name,customer_email,shipping_address,subtotal,shipping_amount,total_amount,currency,paypal_order_id,expires_at,checkout_reservation_items(product_id,product_name_snapshot,quantity,unit_price,line_total)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const { checkout_reservation_items, ...reservation } = data;
    return { ...reservation, items: checkout_reservation_items } as Reservation;
  }

  async function createOrder(
    idempotencyKey: string,
    customer: CustomerDetails,
    items: CheckoutItemRequest[],
  ): Promise<{
    reservationId: string;
    paypalOrderId: string;
    clientId: string;
    subtotal: string;
    shippingAmount: string;
    amount: string;
    items: Array<{ name: string; quantity: number; unitPrice: string; lineTotal: string }>;
  }> {
    const { clientId } = requirePaypalCredentials();
    const { data, error } = await supabase.rpc("create_checkout_reservation", {
      p_idempotency_key: idempotencyKey,
      p_customer_name: customer.name,
      p_customer_email: customer.email,
      p_shipping_address: customer.address,
      p_items: items,
      p_shipping_amount: config.shippingAmount,
      p_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
    if (error) {
      if (error.message.includes("OUT_OF_STOCK")) {
        throw new CheckoutError("One or more items no longer have enough stock. Please review your cart.");
      }
      if (error.message.includes("PRODUCT_UNAVAILABLE")) {
        throw new CheckoutError("One or more products are no longer available. Please review your cart.");
      }
      if (error.message.includes("CUSTOM_ORDERS_BY_EMAIL")) {
        throw new CheckoutError("Custom-made pieces are arranged by email. Please contact sweetjuniperquilts@gmail.com.");
      }
      if (error.message.includes("CHECKOUT_ALREADY_PROCESSED")) {
        throw new CheckoutError("This checkout attempt has expired. Please start checkout again.", 409);
      }
      if (error.message.includes("INVALID_CHECKOUT")) {
        throw new CheckoutError("Checkout details are invalid.");
      }
      throw error;
    }
    const reservation = data as Reservation;
    if (!["pending", "capturing"].includes(reservation.status) || new Date(reservation.expires_at).getTime() <= Date.now()) {
      throw new CheckoutError("This checkout attempt has already been processed.", 409);
    }
    if (reservation.paypal_order_id) {
      return {
        reservationId: reservation.id,
        paypalOrderId: reservation.paypal_order_id,
        clientId,
        subtotal: money(reservation.subtotal),
        shippingAmount: money(reservation.shipping_amount),
        amount: money(reservation.total_amount),
        items: reservation.items.map((item) => ({
          name: item.product_name_snapshot,
          quantity: item.quantity,
          unitPrice: money(item.unit_price),
          lineTotal: money(item.line_total),
        })),
      };
    }

    try {
      const paypalOrder = await paypalRequest<PaypalOrder>("/v2/checkout/orders", {
        method: "POST",
        requestId: `sjq-create-${reservation.id}`,
        body: {
          intent: "CAPTURE",
          purchase_units: [{
            reference_id: reservation.id,
            custom_id: reservation.id,
            amount: {
              currency_code: reservation.currency,
              value: money(reservation.total_amount),
              breakdown: {
                item_total: { currency_code: reservation.currency, value: money(reservation.subtotal) },
                shipping: { currency_code: reservation.currency, value: money(reservation.shipping_amount) },
              },
            },
            items: reservation.items.map((item) => ({
              name: item.product_name_snapshot.slice(0, 127),
              quantity: String(item.quantity),
              category: "PHYSICAL_GOODS",
              unit_amount: {
                currency_code: reservation.currency,
                value: money(item.unit_price),
              },
            })),
          }],
          application_context: {
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            return_url: `${config.clientOrigin}/checkout`,
            cancel_url: `${config.clientOrigin}/checkout?cancelled=1`,
          },
        },
      });
      if (!paypalOrder.id) throw new CheckoutError("PayPal did not return an order reference.", 502);
      const { data: attached, error: attachError } = await supabase.rpc("set_checkout_paypal_order", {
        p_reservation_id: reservation.id,
        p_paypal_order_id: paypalOrder.id,
      });
      if (attachError) throw attachError;
      if (!attached) throw new CheckoutError("The inventory reservation expired. Please try again.", 409);
      return {
        reservationId: reservation.id,
        paypalOrderId: paypalOrder.id,
        clientId,
        subtotal: money(reservation.subtotal),
        shippingAmount: money(reservation.shipping_amount),
        amount: money(reservation.total_amount),
        items: reservation.items.map((item) => ({
          name: item.product_name_snapshot,
          quantity: item.quantity,
          unitPrice: money(item.unit_price),
          lineTotal: money(item.line_total),
        })),
      };
    } catch (error) {
      const { error: releaseError } = await supabase.rpc("release_checkout_reservation", {
        p_reservation_id: reservation.id,
        p_status: "failed",
      });
      if (releaseError) {
        throw new AggregateError(
          [error, releaseError],
          "PayPal order creation failed and the inventory reservation could not be released.",
        );
      }
      throw error;
    }
  }

  async function verifyPaypalOrder(orderId: string, reservation: Reservation): Promise<{
    captureId: string;
    amount: string;
    currency: string;
  }> {
    const order = await paypalRequest<PaypalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    const unit = order.purchase_units?.[0];
    if (
      order.id !== orderId ||
      order.status !== "COMPLETED" ||
      order.intent !== "CAPTURE" ||
      order.purchase_units?.length !== 1 ||
      unit?.custom_id !== reservation.id ||
      unit.reference_id !== reservation.id ||
      unit.amount?.currency_code !== reservation.currency ||
      unit.amount.value !== money(reservation.total_amount) ||
      unit.amount.breakdown?.item_total?.value !== money(reservation.subtotal) ||
      unit.amount.breakdown?.shipping?.value !== money(reservation.shipping_amount)
    ) {
      throw new CheckoutError("PayPal payment details could not be verified.", 409);
    }
    const capture = unit.payments?.captures?.find((item) => item.status === "COMPLETED");
    if (!capture || capture.amount.currency_code !== reservation.currency || capture.amount.value !== money(reservation.total_amount)) {
      throw new CheckoutError("PayPal did not confirm the full payment.", 409);
    }
    return { captureId: capture.id, amount: capture.amount.value, currency: capture.amount.currency_code };
  }

  async function captureOrder(
    reservationId: string,
    paypalOrderId: string,
  ): Promise<{ orderNumber: number; total: number }> {
    requirePaypalCredentials();
    const reservation = await readReservation(reservationId);
    if (!reservation || reservation.paypal_order_id !== paypalOrderId) {
      throw new CheckoutError("This payment does not match the checkout session.", 404);
    }
    if (reservation.status === "cancelled" || reservation.status === "expired" || reservation.status === "failed") {
      throw new CheckoutError("This checkout reservation has expired. Please start again.", 409);
    }

    if (reservation.status === "pending" || reservation.status === "capturing") {
      const { data: captureStarted, error: captureStartError } = await supabase.rpc("begin_checkout_capture", {
        p_reservation_id: reservation.id,
      });
      if (captureStartError) throw captureStartError;
      if (!captureStarted) {
        throw new CheckoutError("This inventory reservation expired. Please start checkout again.", 409);
      }
      try {
        await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
          method: "POST",
          requestId: `sjq-capture-${reservation.id}`,
          body: {},
        });
      } catch {
        // A prior capture may have succeeded even if its response was lost; GET below is authoritative.
      }
    }
    const verified = await verifyPaypalOrder(paypalOrderId, reservation);
    const { data, error } = await supabase.rpc("complete_checkout_reservation", {
      p_reservation_id: reservation.id,
      p_paypal_order_id: paypalOrderId,
      p_paypal_capture_id: verified.captureId,
      p_capture_amount: verified.amount,
      p_capture_currency: verified.currency,
    });
    if (error) {
      if (error.message.includes("RESERVATION_EXPIRED")) {
        throw new CheckoutError("The inventory hold expired before payment was verified. Please contact the shop.", 409);
      }
      if (error.message.includes("CAPTURE_AMOUNT_MISMATCH")) {
        throw new CheckoutError("The captured payment does not match the order total. Please contact the shop.", 409);
      }
      throw error;
    }
    const result = data as { order_number: number };
    return { orderNumber: Number(result.order_number), total: Number(reservation.total_amount) };
  }

  async function cancelOrder(reservationId: string, paypalOrderId: string): Promise<void> {
    const reservation = await readReservation(reservationId);
    if (!reservation || reservation.paypal_order_id !== paypalOrderId) {
      throw new CheckoutError("This checkout session could not be found.", 404);
    }
    if (reservation.status === "completed") {
      throw new CheckoutError("This payment has already completed and cannot be cancelled here.", 409);
    }
    if (reservation.status === "capturing") {
      throw new CheckoutError("Payment processing has started and this checkout can no longer be cancelled.", 409);
    }
    const { error } = await supabase.rpc("release_checkout_reservation", {
      p_reservation_id: reservation.id,
      p_status: "cancelled",
    });
    if (error) throw error;
  }

  async function expireReservations(): Promise<void> {
    const { error } = await supabase.rpc("expire_checkout_reservations");
    if (error) throw error;
  }

  async function refundOrder(orderId: string, cancelled: boolean): Promise<void> {
    const { data, error } = await supabase
      .from("orders")
      .select("id,status,paypal_capture_id,payments(provider_transaction_id,status)")
      .eq("id", orderId)
      .maybeSingle();
    if (error) throw error;
    if (!data || !data.paypal_capture_id || !["paid", "processing"].includes(data.status)) {
      throw new CheckoutError("Only a completed, refundable PayPal payment can be refunded.", 409);
    }
    const refund = await paypalRequest<{ id: string; status: string }>(
      `/v2/payments/captures/${encodeURIComponent(data.paypal_capture_id)}/refund`,
      { method: "POST", requestId: `sjq-refund-${orderId}`, body: {} },
    );
    if (!refund.id || refund.status !== "COMPLETED") {
      throw new CheckoutError("PayPal has not confirmed the refund. Check the PayPal dashboard before retrying.", 502);
    }
    const { data: recorded, error: recordError } = await supabase.rpc("record_paypal_refund", {
      p_paypal_capture_id: data.paypal_capture_id,
      p_refund_id: refund.id,
      p_cancelled: cancelled,
    });
    if (recordError) throw recordError;
    if (!recorded) throw new CheckoutError("PayPal confirmed the refund, but the order record could not be updated.", 500);
  }

  async function verifyWebhook(
    headers: Record<string, string | undefined>,
    event: Record<string, unknown>,
  ): Promise<boolean> {
    if (!config.paypalWebhookId) return false;
    const requiredHeaders = {
      auth_algo: headers["paypal-auth-algo"],
      cert_url: headers["paypal-cert-url"],
      transmission_id: headers["paypal-transmission-id"],
      transmission_sig: headers["paypal-transmission-sig"],
      transmission_time: headers["paypal-transmission-time"],
    };
    if (Object.values(requiredHeaders).some((value) => !value)) return false;
    try {
      const result = await paypalRequest<{ verification_status?: string }>(
        "/v1/notifications/verify-webhook-signature",
        {
          method: "POST",
          body: { ...requiredHeaders, webhook_id: config.paypalWebhookId, webhook_event: event },
        },
      );
      return result.verification_status === "SUCCESS";
    } catch {
      return false;
    }
  }

  async function handleWebhook(event: Record<string, unknown>): Promise<void> {
    const eventId = typeof event.id === "string" ? event.id : "";
    const eventType = typeof event.event_type === "string" ? event.event_type : "";
    if (!eventId || !eventType) throw new CheckoutError("PayPal webhook event is invalid.");

    const { error: eventError } = await supabase
      .from("paypal_webhook_events")
      .upsert({ event_id: eventId, event_type: eventType }, { onConflict: "event_id", ignoreDuplicates: true });
    if (eventError) throw eventError;

    const resource = event.resource as Record<string, unknown> | undefined;
    if (!resource) return;
    if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
      const related = resource.supplementary_data as { related_ids?: { order_id?: string } } | undefined;
      const paypalOrderId = related?.related_ids?.order_id;
      if (typeof paypalOrderId !== "string") return;
      const { data, error } = await supabase
        .from("checkout_reservations")
        .select("id,status")
        .eq("paypal_order_id", paypalOrderId)
        .maybeSingle();
      if (error) throw error;
      if (data && ["pending", "capturing"].includes(data.status)) {
        const reservation = await readReservation(data.id);
        if (reservation) {
          const verified = await verifyPaypalOrder(paypalOrderId, reservation);
          if (typeof resource.id === "string" && resource.id !== verified.captureId) {
            throw new CheckoutError("PayPal webhook capture does not match the verified order.", 409);
          }
          await supabase.rpc("complete_checkout_reservation", {
            p_reservation_id: reservation.id,
            p_paypal_order_id: paypalOrderId,
            p_paypal_capture_id: verified.captureId,
            p_capture_amount: verified.amount,
            p_capture_currency: verified.currency,
          }).then(({ error: completeError }) => {
            if (completeError) throw completeError;
          });
        }
      }
    } else if (eventType === "PAYMENT.CAPTURE.DENIED") {
      const related = resource.supplementary_data as { related_ids?: { order_id?: string } } | undefined;
      const paypalOrderId = related?.related_ids?.order_id;
      if (typeof paypalOrderId !== "string") return;
      const { data: reservation, error } = await supabase
        .from("checkout_reservations")
        .select("id,status")
        .eq("paypal_order_id", paypalOrderId)
        .maybeSingle();
      if (error) throw error;
      if (reservation && ["pending", "capturing"].includes(reservation.status)) {
        const { error: releaseError } = await supabase.rpc("release_checkout_reservation", {
          p_reservation_id: reservation.id,
          p_status: "failed",
        });
        if (releaseError) throw releaseError;
      }
    } else if (eventType === "PAYMENT.CAPTURE.REFUNDED") {
      const captureId = typeof resource.id === "string" ? resource.id : "";
      const { data: payment, error } = await supabase
        .from("payments")
        .select("amount,provider_transaction_id")
        .eq("provider", "paypal")
        .eq("provider_transaction_id", captureId)
        .maybeSingle();
      if (error) throw error;
      const refundedAmount = (resource.amount as { value?: string } | undefined)?.value;
      if (payment && resource.status === "REFUNDED" && refundedAmount && money(refundedAmount) === money(payment.amount)) {
        const { error: refundError } = await supabase.rpc("record_paypal_refund", {
          p_paypal_capture_id: captureId,
          p_refund_id: null,
          p_cancelled: false,
        });
        if (refundError) throw refundError;
      }
    }
  }

  return {
    isConfigured,
    getPublicConfig: () => ({
      configured: isConfigured(),
      clientId: isConfigured() ? config.paypalClientId : null,
      mode: config.paypalMode,
      shippingAmount: config.shippingAmount,
    }),
    createOrder,
    captureOrder,
    cancelOrder,
    expireReservations,
    refundOrder,
    verifyWebhook,
    handleWebhook,
  };
}

export type CheckoutService = ReturnType<typeof createCheckoutService>;
