import { useState, type FormEvent } from "react";
import type { AdminLibraryMedia, CloudinaryUploadLimits } from "@sweet-juniper/shared";
import { AdminApiError, requestAdminJson, uploadAdminFile } from "../../services/admin-api";
import { useAdminResource } from "../use-admin-resource";

const imageAccept = "image/jpeg,image/png,image/webp,image/avif";
const videoAccept = "video/mp4,video/webm,video/quicktime";

function formatBytes(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 })} MB`
    : `${Math.round(bytes / 1000)} KB`;
}

export function OwnerMediaPage() {
  const media = useAdminResource<AdminLibraryMedia[]>("/api/admin/media");
  const limits = useAdminResource<CloudinaryUploadLimits>("/api/admin/media/limits");
  const [file, setFile] = useState<File | null>(null);
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [altText, setAltText] = useState("");
  const [busyId, setBusyId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!file) {
      setError("Choose an image or video to upload.");
      return;
    }
    setUploading(true);
    setProgress(0);
    setError("");
    setMessage("");
    try {
      await uploadAdminFile<AdminLibraryMedia>(
        "/api/admin/media",
        file,
        { mediaType, altText },
        setProgress,
      );
      setFile(null);
      setAltText("");
      form.reset();
      setMessage("Media was uploaded to the central library.");
      media.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The media could not be uploaded.");
    } finally {
      setUploading(false);
    }
  }

  async function update(item: AdminLibraryMedia, body: Record<string, unknown>, success: string) {
    setBusyId(item.id);
    setError("");
    setMessage("");
    try {
      await requestAdminJson<AdminLibraryMedia>(`/api/admin/media/${item.id}`, {
        method: "PATCH",
        body,
      });
      setMessage(success);
      media.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Media details could not be updated.");
    } finally {
      setBusyId("");
    }
  }

  async function replace(item: AdminLibraryMedia, replacement: File) {
    if (replacement.type.startsWith("video/") !== (item.mediaType === "video")) {
      setError("Replacement media must use the same media type.");
      return;
    }
    setBusyId(item.id);
    setError("");
    setMessage("");
    try {
      const result = await uploadAdminFile<{ media: AdminLibraryMedia; cleanupPending: number }>(
        `/api/admin/media/${item.id}/replace`,
        replacement,
        { mediaType: item.mediaType },
        setProgress,
        "PUT",
      );
      setMessage(result.cleanupPending
        ? "Media was replaced; cleanup of the previous asset is pending."
        : "Media was replaced successfully.");
      media.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Media could not be replaced.");
    } finally {
      setProgress(0);
      setBusyId("");
    }
  }

  async function remove(item: AdminLibraryMedia) {
    if (!window.confirm("Delete this media from Cloudinary and the library? Items assigned to products, the homepage, or Gallery cannot be deleted until unassigned.")) return;
    setBusyId(item.id);
    setError("");
    setMessage("");
    try {
      const result = await requestAdminJson<{ cleanupPending: number }>(
        `/api/admin/media/${item.id}`,
        { method: "DELETE" },
      );
      setMessage(result.cleanupPending
        ? "Media was removed; Cloudinary cleanup is pending. Retry it below."
        : "Media was deleted from the library.");
      media.reload();
    } catch (cause) {
      setError(cause instanceof AdminApiError
        ? cause.message
        : cause instanceof Error ? cause.message : "Media could not be deleted.");
    } finally {
      setBusyId("");
    }
  }

  async function retryCleanup(item: AdminLibraryMedia) {
    setBusyId(item.id);
    setError("");
    setMessage("");
    try {
      const result = await requestAdminJson<{ cleanupPending: number }>(
        `/api/admin/media/${item.id}/retry-cleanup`,
        { method: "POST" },
      );
      setMessage(result.cleanupPending
        ? "Cloudinary cleanup is still pending. Try again later."
        : "Cloudinary cleanup completed.");
      media.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cloudinary cleanup could not be retried.");
    } finally {
      setBusyId("");
    }
  }

  const activeImages = (media.data || []).filter(
    (item) => item.mediaType === "image" && !item.deletedAt,
  );

  return (
    <section className="owner-page">
      <div className="owner-page__heading">
        <div><p className="eyebrow">CENTRAL ASSET LIBRARY</p><h1>Media</h1></div>
      </div>
      <p className="owner-help-note">
        Upload each photo or video once, then assign it to products, Gallery, or homepage content. Removing an assignment keeps the original media here.
      </p>
      {message && <p className="owner-success" role="status">{message}</p>}
      {error && <p className="owner-error" role="alert">{error}</p>}
      {limits.error && <p className="owner-error" role="alert">{limits.error}</p>}
      {limits.data && !limits.data.configured && (
        <p className="owner-notice" role="status">Cloudinary uploads are not configured yet.</p>
      )}
      <section className="owner-panel owner-edit-form">
        <div className="owner-panel__heading"><h2>Upload to Media Library</h2></div>
        <form className="owner-form-grid" onSubmit={(event) => void upload(event)}>
          <label>
            <span>Media type</span>
            <select
              onChange={(event) => {
                setMediaType(event.target.value as "image" | "video");
                setFile(null);
              }}
              value={mediaType}
            >
              <option value="image">Image</option>
              <option value="video">Video</option>
            </select>
          </label>
          <label>
            <span>File</span>
            <input
              accept={mediaType === "image" ? imageAccept : videoAccept}
              key={mediaType}
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              required
              type="file"
            />
            {limits.data?.configured && (
              <small>
                Up to {formatBytes(mediaType === "image" ? limits.data.imageMaxBytes : limits.data.videoMaxBytes)} per file.
              </small>
            )}
          </label>
          <label className="owner-form-grid__wide">
            <span>Alt text (optional, for accessibility)</span>
            <input maxLength={500} onChange={(event) => setAltText(event.target.value)} value={altText} />
          </label>
          <button
            className="button button--primary owner-form-grid__wide"
            disabled={uploading || !limits.data?.configured}
            type="submit"
          >
            {uploading ? `Uploading… ${progress}%` : "Upload media"}
          </button>
        </form>
      </section>
      {media.loading ? <p className="owner-state" role="status">Loading Media Library…</p> : media.error ? (
        <p className="owner-error" role="alert">{media.error} <button className="text-link" onClick={media.reload} type="button">Try again</button></p>
      ) : media.data?.length ? (
        <div className="owner-media-grid">
          {media.data.map((item) => (
            <article className={`owner-media-card ${item.deletedAt ? "owner-media-card--removed" : ""}`} key={item.id}>
              {item.deletedAt ? (
                <div className="owner-media-card__placeholder">Removed from library</div>
              ) : item.mediaType === "video" ? (
                <video aria-label={item.altText || "Video preview"} controls playsInline poster={item.posterUrl || undefined} preload="metadata">
                  <source src={item.url} />
                </video>
              ) : (
                <img alt={item.altText || ""} loading="lazy" src={item.url} />
              )}
              <div className="owner-media-card__body">
                <p className="owner-status">{item.deletedAt ? "Removed" : item.mediaType}</p>
                <code>{item.cloudinaryAssetId}</code>
                {!item.deletedAt && (
                  <>
                    <label>
                      <span>Alt text</span>
                      <input
                        defaultValue={item.altText || ""}
                        disabled={busyId === item.id}
                        maxLength={500}
                        onBlur={(event) => {
                          const nextAltText = event.currentTarget.value.trim() || null;
                          if (nextAltText !== item.altText) {
                            void update(item, { altText: nextAltText }, "Alt text saved.");
                          }
                        }}
                      />
                    </label>
                    {item.mediaType === "video" && (
                      <label>
                        <span>Default video poster</span>
                        <select
                          disabled={busyId === item.id}
                          onChange={(event) => void update(
                            item,
                            { posterMediaId: event.target.value || null },
                            "Video poster updated.",
                          )}
                          value={item.posterMediaId || ""}
                        >
                          <option value="">No poster</option>
                          {activeImages.filter((image) => image.id !== item.id).map((image) => (
                            <option key={image.id} value={image.id}>
                              {image.altText || image.cloudinaryAssetId}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <div className="owner-media-card__actions">
                      <label className="text-link owner-media-card__file-action">
                        Replace original
                        <input
                          accept={item.mediaType === "image" ? imageAccept : videoAccept}
                          disabled={busyId === item.id}
                          onChange={(event) => {
                            const replacement = event.currentTarget.files?.[0];
                            if (replacement) void replace(item, replacement);
                            event.currentTarget.value = "";
                          }}
                          type="file"
                        />
                      </label>
                      <button className="text-link" disabled={busyId === item.id} onClick={() => void remove(item)} type="button">
                        Delete from library
                      </button>
                    </div>
                  </>
                )}
                {item.deletedAt && item.cleanupPendingAssets.length > 0 && (
                  <div className="owner-cleanup-notice">
                    <p>{item.cleanupPendingAssets.length} asset(s) pending cleanup.</p>
                    <button className="text-link" disabled={busyId === item.id} onClick={() => void retryCleanup(item)} type="button">
                      {busyId === item.id ? "Retrying…" : "Retry cleanup"}
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : <p className="owner-empty-card">No media has been uploaded to the library.</p>}
    </section>
  );
}
