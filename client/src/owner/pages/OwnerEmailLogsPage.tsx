import { useState } from "react";
import { Link } from "react-router-dom";
import type { AdminEmailLog } from "@sweet-juniper/shared";
import { requestAdminJson } from "../../services/admin-api";
import { useAdminResource } from "../use-admin-resource";

const statuses = ["all", "queued", "sending", "sent", "delivered", "failed", "bounced", "complained"];

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

export function OwnerEmailLogsPage() {
  const [status, setStatus] = useState("all");
  const logs = useAdminResource<AdminEmailLog[]>(`/api/admin/email-logs?status=${status}`);
  const [retryingId, setRetryingId] = useState("");
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");

  async function retry(id: string) {
    setRetryingId(id);
    setMessage("");
    setActionError("");
    try {
      await requestAdminJson<{ queued: boolean }>(`/api/admin/email-logs/${id}/retry`, { method: "POST" });
      setMessage("The email was returned to the queue. Temporary delivery failures retry automatically.");
      logs.reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The email could not be queued for retry.");
    } finally {
      setRetryingId("");
    }
  }

  return (
    <section className="owner-page">
      <div className="owner-page__heading">
        <div><p className="eyebrow">CUSTOMER CARE</p><h1>Email logs</h1></div>
      </div>
      <p className="owner-help-note">
        Email attempts are saved independently of orders. Temporary failures retry automatically; permanent failures are not retried.
      </p>
      <div className="email-log-filters">
        <label>
          <span>Delivery status</span>
          <select onChange={(event) => setStatus(event.target.value)} value={status}>
            {statuses.map((value) => <option key={value} value={value}>{value === "all" ? "All statuses" : value}</option>)}
          </select>
        </label>
      </div>
      {message && <p className="owner-success" role="status">{message}</p>}
      {actionError && <p className="owner-error" role="alert">{actionError}</p>}
      {logs.loading ? <p className="owner-state" role="status">Loading email logs…</p> :
        logs.error ? <p className="owner-error" role="alert">{logs.error} <button className="text-link" onClick={logs.reload} type="button">Try again</button></p> :
          logs.data?.length ? (
            <div className="owner-table-wrap">
              <table className="owner-table email-log-table">
                <thead><tr><th>Type</th><th>Recipient</th><th>Status</th><th>Attempts</th><th>Last activity</th><th>Details</th></tr></thead>
                <tbody>
                  {logs.data.map((log) => (
                    <tr key={log.id}>
                      <td>{log.templateKey.replace(/_/g, " ")}{log.orderNumber ? <small><Link className="text-link" to={`/owner/orders?selected=${log.relatedOrderId}`}>Order #{log.orderNumber}</Link></small> : null}</td>
                      <td>{log.recipient || "Owner notification"}</td>
                      <td><span className="owner-status">{log.status}</span></td>
                      <td>{log.attemptCount} total <small>{log.cycleAttemptCount} / {log.maxAttempts} in cycle</small></td>
                      <td>{formatDate(log.lastAttemptAt || log.createdAt)}{log.sentAt && <small>Sent {formatDate(log.sentAt)}</small>}</td>
                      <td className="email-log-details">
                        {log.errorDetails && <span role="note">{log.errorDetails}</span>}
                        {log.status === "failed" && log.retryable && log.manualRetryCount < 2 && (
                          <button
                            className="button button--outline"
                            disabled={retryingId === log.id}
                            onClick={() => void retry(log.id)}
                            type="button"
                          >{retryingId === log.id ? "Queuing…" : "Retry"}</button>
                        )}
                        {!log.errorDetails && !log.retryable && <span>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="owner-empty-card">No email attempts match this status.</p>}
    </section>
  );
}
