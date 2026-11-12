import { useState } from "react";
import type { AdminProductMedia } from "@sweet-juniper/shared";
import { requestAdminJson } from "../../services/admin-api";
import { useAdminResource } from "../use-admin-resource";

export function OwnerMediaPage() {
  const media = useAdminResource<AdminProductMedia[]>("/api/admin/media");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function retry(item: AdminProductMedia) {
    setBusyId(item.id);
    setError("");
    setMessage("");
    try {
      const result = await requestAdminJson<{ cleanupPending: number }>(
        `/api/admin/media/${item.id}/retry-cleanup`,
        { method: "POST" },
      );
      setMessage(result.cleanupPending
        ? `Cleanup is still pending for ${item.productName}.`
        : `Cloudinary cleanup completed for ${item.productName}.`);
      media.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cleanup could not be retried.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="owner-page">
      <div className="owner-page__heading">
        <div><p className="eyebrow">CLOUDINARY ASSET RECORDS</p><h1>Media library</h1></div>
      </div>
      <p className="owner-help-note">
        Product media and asset IDs are recorded here for inventory and backup planning. Database backups do not include the files stored in Cloudinary.
      </p>
      {message && <p className="owner-success" role="status">{message}</p>}
      {error && <p className="owner-error" role="alert">{error}</p>}
      {media.loading ? <p className="owner-state" role="status">Loading media library…</p> : media.error ? (
        <p className="owner-error" role="alert">{media.error} <button className="text-link" onClick={media.reload} type="button">Try again</button></p>
      ) : media.data?.length ? (
        <div className="owner-media-grid">
          {media.data.map((item) => (
            <article className={`owner-media-card ${item.deletedAt ? "owner-media-card--removed" : ""}`} key={item.id}>
              {item.deletedAt ? (
                <div className="owner-media-card__placeholder">Removed from storefront</div>
              ) : item.mediaType === "video" ? (
                <video controls playsInline poster={item.posterUrl || undefined} preload="metadata"><source src={item.url} /></video>
              ) : (
                <img alt={item.altText || ""} loading="lazy" src={item.url} />
              )}
              <div className="owner-media-card__body">
                <h2>{item.productName || "Product"}</h2>
                <p className="owner-status">{item.deletedAt ? "Removed" : item.isPrimary ? "Primary image" : item.mediaType}</p>
                <code>{item.cloudinaryAssetId}</code>
                {item.posterCloudinaryAssetId && <small>Poster: <code>{item.posterCloudinaryAssetId}</code></small>}
                {item.cleanupPendingAssets.length > 0 && (
                  <div className="owner-cleanup-notice">
                    <p>{item.cleanupPendingAssets.length} asset(s) pending cleanup.</p>
                    <button className="text-link" disabled={busyId === item.id} onClick={() => void retry(item)} type="button">
                      {busyId === item.id ? "Retrying…" : "Retry cleanup"}
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : <p className="owner-empty-card">No Cloudinary media has been added.</p>}
    </section>
  );
}
