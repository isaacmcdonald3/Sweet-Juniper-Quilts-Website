import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminEmailLog } from "@sweet-juniper/shared";
import type { Logger } from "pino";
import { renderEmail, type EmailOrder, type EmailTemplateKey } from "./email-templates.js";
import { verifyResendWebhookSignature } from "./resend-webhook.js";

type EmailStatus = "queued" | "sending" | "sent" | "delivered" | "failed" | "bounced" | "complained";
type RecipientRole = "customer" | "owner";

interface EmailConfig {
  apiKey?: string;
  from?: string;
  ownerEmail?: string;
  baseUrl?: string;
  webhookSecret?: string;
}

interface ClaimedEmail {
  id: string;
  claim_token: string;
  email_key: string;
  recipient: string | null;
  recipient_role: RecipientRole;
  template_key: EmailTemplateKey;
  related_order_id: string | null;
  related_contact_id: string | null;
  attempt_count: number;
}

interface EmailLogRow {
  id: string;
  recipient: string | null;
  recipient_role: RecipientRole;
  template_key: string;
  status: EmailStatus;
  related_order_id: string | null;
  related_contact_id: string | null;
  provider_message_id: string | null;
  created_at: string;
  updated_at: string;
  attempt_count: number;
  cycle_attempt_count: number;
  manual_retry_count: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  sent_at: string | null;
  error_details: string | null;
  retryable: boolean;
  orders: { order_number: number } | Array<{ order_number: number }> | null;
}

class EmailDataError extends Error {}

function mapEmailLog(row: EmailLogRow): AdminEmailLog {
  const order = Array.isArray(row.orders) ? row.orders[0] : row.orders;
  return {
    id: row.id,
    recipient: row.recipient,
    recipientRole: row.recipient_role,
    templateKey: row.template_key,
    status: row.status,
    relatedOrderId: row.related_order_id,
    orderNumber: order ? Number(order.order_number) : null,
    providerMessageId: row.provider_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attemptCount: row.attempt_count,
    cycleAttemptCount: row.cycle_attempt_count,
    manualRetryCount: row.manual_retry_count,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    lastAttemptAt: row.last_attempt_at,
    sentAt: row.sent_at,
    errorDetails: row.error_details,
    retryable: row.retryable,
  };
}

function orderEmail(row: Record<string, unknown>): EmailOrder {
  const items = row.order_items;
  if (!Array.isArray(items)) throw new EmailDataError("Order items are unavailable.");
  return {
    orderNumber: Number(row.order_number),
    customerName: String(row.customer_name),
    customerEmail: String(row.customer_email),
    shippingAddress: row.shipping_address as Record<string, unknown>,
    subtotal: Number(row.subtotal),
    shippingAmount: Number(row.shipping_amount),
    totalAmount: Number(row.total_amount),
    currency: String(row.currency),
    shippingCarrier: typeof row.shipping_carrier === "string" ? row.shipping_carrier : null,
    trackingNumber: typeof row.tracking_number === "string" ? row.tracking_number : null,
    items: items.map((item: Record<string, unknown>) => ({
      name: String(item.product_name_snapshot),
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price),
      lineTotal: Number(item.line_total),
    })),
  };
}

function retryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function createEmailService(
  supabase: SupabaseClient,
  config: EmailConfig,
  logger: Logger,
) {
  let processing = false;
  const isConfigured = () => Boolean(config.apiKey && config.from && config.ownerEmail && config.baseUrl);

  async function recordFailure(email: ClaimedEmail, message: string, retryable: boolean): Promise<void> {
    const { data, error } = await supabase.rpc("record_email_log_failure", {
      p_log_id: email.id,
      p_claim_token: email.claim_token,
      p_error_details: message,
      p_retryable: retryable,
    });
    if (error) throw error;
    if (!data) logger.warn({ emailLogId: email.id }, "Email attempt no longer owns its queue claim");
  }

  async function buildContent(email: ClaimedEmail) {
    let order: EmailOrder | null = null;
    let contact: { name: string; email: string; message: string } | null = null;
    if (email.related_order_id) {
      const { data, error } = await supabase
        .from("orders")
        .select("order_number,customer_name,customer_email,shipping_address,subtotal,shipping_amount,total_amount,currency,shipping_carrier,tracking_number,order_items(product_name_snapshot,quantity,unit_price,line_total)")
        .eq("id", email.related_order_id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new EmailDataError("Related order is unavailable.");
      order = orderEmail(data as unknown as Record<string, unknown>);
    } else if (email.related_contact_id) {
      const { data, error } = await supabase
        .from("contact_submissions")
        .select("customer_name,customer_email,message")
        .eq("id", email.related_contact_id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new EmailDataError("Related contact submission is unavailable.");
      contact = { name: data.customer_name, email: data.customer_email, message: data.message };
    }

    return renderEmail(email.template_key, order, contact, config.baseUrl as string);
  }

  async function sendOne(email: ClaimedEmail): Promise<void> {
    const recipient = email.recipient_role === "owner" ? config.ownerEmail : email.recipient;
    if (!recipient) {
      await recordFailure(email, "The email recipient is missing.", false);
      return;
    }

    let content;
    try {
      content = await buildContent(email);
    } catch (error) {
      const retryable = !(error instanceof EmailDataError) &&
        !(error instanceof Error && error.message.startsWith("Unknown email template"));
      await recordFailure(
        email,
        error instanceof Error ? error.message : "Email content could not be prepared.",
        retryable,
      );
      return;
    }

    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": email.email_key,
        },
        body: JSON.stringify({
          from: config.from,
          to: [recipient],
          subject: content.subject,
          html: content.html,
          text: content.text,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      await recordFailure(
        email,
        error instanceof Error ? error.message.slice(0, 1000) : "Resend could not be reached.",
        true,
      );
      return;
    }

    if (!response.ok) {
      const responseBody = await response.text();
      let detail = `Resend request failed with HTTP ${response.status}.`;
      try {
        const parsed = JSON.parse(responseBody) as { message?: unknown; name?: unknown };
        if (typeof parsed.message === "string") detail = parsed.message.slice(0, 1000);
        else if (typeof parsed.name === "string") detail = parsed.name.slice(0, 1000);
      } catch {
        detail = `${detail} ${responseBody.slice(0, 500)}`;
      }
      await recordFailure(email, detail, retryableHttpStatus(response.status));
      return;
    }

    let result: { id?: unknown };
    try {
      result = await response.json() as { id?: unknown };
    } catch (error) {
      await recordFailure(
        email,
        error instanceof Error ? error.message.slice(0, 1000) : "Resend returned an invalid response.",
        true,
      );
      return;
    }
    if (typeof result.id !== "string" || !result.id) {
      await recordFailure(email, "Resend accepted the request without returning a message ID.", false);
      return;
    }
    const { data, error } = await supabase.rpc("record_email_log_sent", {
      p_log_id: email.id,
      p_claim_token: email.claim_token,
      p_provider_message_id: result.id,
      p_recipient: recipient,
    });
    if (error) {
      logger.error({ err: error, emailLogId: email.id }, "Email was accepted but its delivery record could not be saved");
      return;
    }
    if (!data) logger.warn({ emailLogId: email.id }, "Email was sent after its queue claim expired");
  }

  async function processQueue(): Promise<void> {
    if (!isConfigured() || processing) return;
    processing = true;
    try {
      const { data, error } = await supabase.rpc("claim_email_logs", { p_batch_size: 10 });
      if (error) throw error;
      const emails = (data || []) as ClaimedEmail[];
      for (const email of emails) {
        try {
          await sendOne(email);
        } catch (error) {
          logger.error({ err: error, emailLogId: email.id }, "Email attempt could not be recorded");
        }
      }
    } finally {
      processing = false;
    }
  }

  async function listLogs(status?: string): Promise<AdminEmailLog[]> {
    let query = supabase
      .from("email_logs")
      .select("id,recipient,recipient_role,template_key,status,related_order_id,related_contact_id,provider_message_id,created_at,updated_at,attempt_count,cycle_attempt_count,manual_retry_count,max_attempts,next_attempt_at,last_attempt_at,sent_at,error_details,retryable,orders(order_number)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (status && status !== "all") query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw error;
    return (data as unknown as EmailLogRow[]).map(mapEmailLog);
  }

  async function retryLog(id: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("retry_email_log", { p_log_id: id });
    if (error) throw error;
    return Boolean(data);
  }

  async function createContactSubmission(input: {
    idempotencyKey: string;
    name: string;
    email: string;
    message: string;
  }): Promise<string> {
    const { data, error } = await supabase.rpc("create_contact_email_notification", {
      p_idempotency_key: input.idempotencyKey,
      p_customer_name: input.name,
      p_customer_email: input.email,
      p_message: input.message,
    });
    if (error) throw error;
    if (typeof data !== "string") throw new Error("Contact submission could not be recorded.");
    return data;
  }

  async function handleWebhook(
    eventId: string,
    event: { type: string; data?: { email_id?: unknown }; errorDetails?: string },
  ): Promise<void> {
    const emailId = event.data?.email_id;
    if (typeof emailId !== "string" || !emailId) throw new Error("Resend event is missing its email ID.");
    const { error } = await supabase.rpc("record_resend_webhook", {
      p_event_id: eventId,
      p_event_type: event.type,
      p_provider_message_id: emailId,
      p_error_details: event.errorDetails || null,
    });
    if (error) throw error;
  }

  function verifyWebhook(
    headers: { id?: string; timestamp?: string; signature?: string },
    rawBody: Buffer,
  ): boolean {
    return Boolean(
      config.webhookSecret &&
      verifyResendWebhookSignature(config.webhookSecret, headers, rawBody),
    );
  }

  return {
    isConfigured,
    isWebhookConfigured: () => Boolean(config.webhookSecret),
    processQueue,
    listLogs,
    retryLog,
    createContactSubmission,
    handleWebhook,
    verifyWebhook,
  };
}

export type EmailService = ReturnType<typeof createEmailService>;
