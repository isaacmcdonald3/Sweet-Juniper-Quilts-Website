import { useState } from "react";
import type { AdminProductMedia, CloudinaryUploadLimits } from "@sweet-juniper/shared";
import { AdminApiError, requestAdminJson, uploadAdminFile } from "../../services/admin-api";
import { useAdminResource } from "../use-admin-resource";

const imageAccept = "image/jpeg,image/png,image/webp,image/avif";
const videoAccept = "video/mp4,video/webm,video/quicktime";

function formatBytes(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 })} MB`
    : `${Math.round(bytes / 1000)} KB`;
}

export function ProductMediaManager({ productId }: { productId: string }) {
  const media = useAdminResource<AdminProductMedia[]>(`/api/admin/products/${productId}/media`);
  const limits = useAdminResource<CloudinaryUploadLimits>("/api/admin/media/limits");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const activeMedia = (media.data || []).filter((entry) => !entry.deletedAt);
  const firstMovableIndex = activeMedia[0]?.isPrimary ? 1 : 0;

  async function uploadFiles(files: FileList | File[], replacementId?: string) {
    const selected = Array.from(files);
    if (!selected.length) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      for (let index = 0; index < selected.length; index += 1) {
        const file = selected[index];
        const mediaType = file.type.startsWith("video/") ? "video" : "image";
        const maxBytes = mediaType === "image" ? limits.data?.imageMaxBytes : limits.data?.videoMaxBytes;
        if (!limits.data?.configured) throw new AdminApiError("Cloudinary is not configured on the API yet.", 503);
        if (!file.type || file.size > (maxBytes || 0)) {
          throw new AdminApiError(`${file.name} is not a supported file or exceeds its size limit.`, 400);
        }
        setProgress(`Uploading ${index + 1} of ${selected.length}: 0%`);
        await uploadAdminFile<{ media: AdminProductMedia; cleanupPending: number }>(
          `/api/admin/products/${productId}/media`,
          file,
          {
            mediaType,
            altText: mediaType === "image" ? file.name.replace(/\.[^.]+$/, "") : "",
            ...(replacementId ? { replaceMediaId: replacementId } : {}),
          },
          (percent) => setProgress(`Uploading ${index + 1} of ${selected.length}: ${percent}%`),
        );
      }
      setMessage(selected.length === 1 ? "Media uploaded successfully." : `${selected.length} files uploaded successfully.`);
      media.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The media upload could not be completed.");
      media.reload();
    } finally {
      setProgress("");
      setBusy(false);
    }
  }

  async function removePoster(item: AdminProductMedia) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await requestAdminJson<{ cleanupPending: number }>(
        `/api/admin/products/${productId}/media/${item.id}/poster`,
        { method: "DELETE" },
      );
      setMessage(result.cleanupPending ? "Poster removed; Cloudinary cleanup is pending." : "Video poster removed.");
      media.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The video poster could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  async function update(item: AdminProductMedia, body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await requestAdminJson(`/api/admin/products/${productId}/media/${item.id}`, {
        method: "PATCH",
        body,
      });
      setMessage(success);
      media.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Media details could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: AdminProductMedia) {
    if (!window.confirm("Remove this media from the product? The Cloudinary asset will be cleaned up securely.")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await requestAdminJson<{ cleanupPending: number }>(
        `/api/admin/products/${productId}/media/${item.id}`,
        { method: "DELETE" },
      );
      setMessage(
        result.cleanupPending
          ? "The media was removed from the shop; Cloudinary cleanup is pending. You can retry it below."
          : "Media removed successfully.",
      );
      media.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Media could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  async function updatePoster(item: AdminProductMedia, file: File) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await uploadAdminFile<{ cleanupPending: number }>(
        `/api/admin/products/${productId}/media/${item.id}/poster`,
        file,
        {},
        (percent) => setProgress(`Uploading poster: ${percent}%`),
      );
      setMessage(result.cleanupPending ? "Poster updated; old asset cleanup is pending." : "Video poster updated.");
      media.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The video poster could not be uploaded.");
    } finally {
      setProgress("");
      setBusy(false);
    }
  }

  async function retryCleanup(item: AdminProductMedia) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await requestAdminJson<{ cleanupPending: number }>(
        `/api/admin/media/${item.id}/retry-cleanup`,
        { method: "POST" },
      );
      setMessage(result.cleanupPending ? "Some Cloudinary cleanup is still pending. Try again later." : "Cloudinary cleanup completed.");
      media.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cloudinary cleanup could not be retried.");
    } finally {
      setBusy(false);
    }
  }

  async function move(item: AdminProductMedia, direction: -1 | 1) {
    const active = (media.data || []).filter((entry) => !entry.deletedAt);
    const index = active.findIndex((entry) => entry.id === item.id);
    const neighbor = active[index + direction];
    if (!neighbor) return;
    setBusy(true);
    setError("");
    try {
      await requestAdminJson(`/api/admin/products/${productId}/media/${item.id}`, {
        method: "PATCH",
        body: { sortOrder: neighbor.sortOrder },
      });
      await requestAdminJson(`/api/admin/products/${productId}/media/${neighbor.id}`, {
        method: "PATCH",
        body: { sortOrder: item.sortOrder },
      });
      setMessage("Media order updated.");
      media.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Media order could not be updated.");
      media.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="owner-panel product-media-manager" aria-labelledby={`media-title-${productId}`}>
      <div className="owner-panel__heading">
        <div>
          <h3 id={`media-title-${productId}`}>Product photos and videos</h3>
          <p>Uploads are sent through the owner-authorized API and stored in Cloudinary, not on Render.</p>
        </div>
      </div>
      {message && <p className="owner-success" role="status">{message}</p>}
      {error && <p className="owner-error" role="alert">{error}</p>}
      {progress && <p className="owner-state" role="status">{progress}</p>}
      {limits.loading ? <p className="owner-state">Checking upload settings…</p> : limits.error ? (
        <p className="owner-error" role="alert">{limits.error}</p>
      ) : !limits.data?.configured ? (
        <p className="owner-help-note">Configure the server-only Cloudinary credentials to enable media uploads.</p>
      ) : (
        <label className="owner-upload-control">
          <span>Add photos up to {formatBytes(limits.data.imageMaxBytes)} or videos up to {formatBytes(limits.data.videoMaxBytes)} each</span>
          <input
            accept={`${limits.data.imageMimeTypes.join(",")},${limits.data.videoMimeTypes.join(",")}`}
            disabled={busy}
            multiple
            onChange={(event) => {
              if (event.currentTarget.files) void uploadFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
            type="file"
          />
        </label>
      )}
      {media.loading ? <p className="owner-state">Loading product media…</p> : media.error ? (
        <p className="owner-error" role="alert">{media.error}</p>
      ) : media.data?.length ? (
        <div className="owner-media-grid">
          {media.data.map((item) => (
            <article className={`owner-media-card ${item.deletedAt ? "owner-media-card--removed" : ""}`} key={item.id}>
              {item.deletedAt ? (
                <div className="owner-media-card__placeholder">Removed from storefront</div>
              ) : item.mediaType === "video" ? (
                <video controls playsInline poster={item.posterUrl || undefined} preload="metadata">
                  <source src={item.url} />
                </video>
              ) : (
                <img alt={item.altText || ""} loading="lazy" src={item.url} />
              )}
              <div className="owner-media-card__body">
                <p className="owner-status">{item.deletedAt ? "Removed" : item.isPrimary ? "Primary image" : item.mediaType}</p>
                {!item.deletedAt && (
                  <>
                    <label>
                      <span>Alt text</span>
                      <input
                        defaultValue={item.altText || ""}
                        disabled={busy}
                        maxLength={500}
                        onBlur={(event) => {
                          const altText = event.currentTarget.value.trim() || null;
                          if (altText !== item.altText) void update(item, { altText }, "Alt text saved.");
                        }}
                      />
                    </label>
                    <div className="owner-media-card__actions">
                      {item.mediaType === "image" && !item.isPrimary && (
                        <button className="text-link" disabled={busy} onClick={() => void update(item, { isPrimary: true }, "Primary image updated.")} type="button">Set primary</button>
                      )}
                      {!item.isPrimary && (
                        <>
                          <button className="text-link" disabled={busy || activeMedia.findIndex((entry) => entry.id === item.id) <= firstMovableIndex} onClick={() => void move(item, -1)} type="button">Move up</button>
                          <button className="text-link" disabled={busy || activeMedia.findIndex((entry) => entry.id === item.id) >= activeMedia.length - 1} onClick={() => void move(item, 1)} type="button">Move down</button>
                        </>
                      )}
                      <label className="text-link owner-media-card__file-action">
                        Replace
                        <input
                          accept={item.mediaType === "image" ? imageAccept : videoAccept}
                          disabled={busy}
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            if (file) void uploadFiles([file], item.id);
                            event.currentTarget.value = "";
                          }}
                          type="file"
                        />
                      </label>
                      {item.mediaType === "video" && (
                        <label className="text-link owner-media-card__file-action">
                          {item.posterUrl ? "Replace poster" : "Add poster"}
                          <input
                            accept={imageAccept}
                            disabled={busy}
                            onChange={(event) => {
                              const file = event.currentTarget.files?.[0];
                              if (file) void updatePoster(item, file);
                              event.currentTarget.value = "";
                            }}
                            type="file"
                          />
                        </label>
                      )}
                      {item.mediaType === "video" && item.posterUrl && (
                        <button className="text-link" disabled={busy} onClick={() => void removePoster(item)} type="button">Remove poster</button>
                      )}
                      <button className="text-link" disabled={busy} onClick={() => void remove(item)} type="button">Remove</button>
                    </div>
                  </>
                )}
                {item.cleanupPendingAssets.length > 0 && (
                  <div className="owner-cleanup-notice">
                    <p>{item.cleanupPendingAssets.length} Cloudinary asset(s) still need cleanup.</p>
                    <button className="text-link" disabled={busy} onClick={() => void retryCleanup(item)} type="button">Retry cleanup</button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : <p className="owner-empty-card">No product media uploaded yet.</p>}
    </section>
  );
}
