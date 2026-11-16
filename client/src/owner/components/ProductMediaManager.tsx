import { useMemo, useState } from "react";
import type { AdminLibraryMedia, AdminProductMedia } from "@sweet-juniper/shared";
import { requestAdminJson } from "../../services/admin-api";
import { useAdminResource } from "../use-admin-resource";

function mediaDisplayName(item: AdminLibraryMedia): string {
  return item.originalFilename
    || item.altText
    || item.cloudinaryPublicId?.split("/").pop()
    || item.cloudinaryAssetId;
}

export function ProductMediaManager({ productId }: { productId: string }) {
  const media = useAdminResource<AdminProductMedia[]>(`/api/admin/products/${productId}/media`);
  const library = useAdminResource<AdminLibraryMedia[]>("/api/admin/media");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const assignedIds = useMemo(() => new Set((media.data || []).map((item) => item.id)), [media.data]);
  const available = (library.data || []).filter((item) => !item.deletedAt);
  const activeMedia = media.data || [];
  const imageOptions = (library.data || []).filter((item) => item.mediaType === "image" && !item.deletedAt);

  async function assignSelected() {
    if (!selectedIds.length) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      for (const mediaId of selectedIds) {
        await requestAdminJson<AdminProductMedia>(`/api/admin/products/${productId}/media`, {
          method: "POST",
          body: { mediaId },
        });
      }
      setSelectedIds([]);
      setMessage(selectedIds.length === 1 ? "Media assigned to this product." : `${selectedIds.length} media items assigned to this product.`);
      media.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Media could not be assigned.");
      media.reload();
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
      setError(cause instanceof Error ? cause.message : "Product media could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: AdminProductMedia) {
    if (!window.confirm("Remove this media assignment from the product? The library item and Cloudinary original will remain available.")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await requestAdminJson(`/api/admin/products/${productId}/media/${item.id}`, { method: "DELETE" });
      setMessage("Media was removed from the product. It remains in the Media Library.");
      media.reload();
      library.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The product media assignment could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  async function move(item: AdminProductMedia, direction: -1 | 1) {
    const index = activeMedia.findIndex((entry) => entry.id === item.id);
    const neighbor = activeMedia[index + direction];
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
      setMessage("Product media order updated.");
      media.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Product media order could not be updated.");
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
          <p>Choose existing items from Media. Assignments do not create or upload copies.</p>
        </div>
      </div>
      {message && <p className="owner-success" role="status">{message}</p>}
      {error && <p className="owner-error" role="alert">{error}</p>}
      {library.loading ? <p className="owner-state">Loading Media Library…</p> : library.error ? (
        <p className="owner-error" role="alert">{library.error} <button className="text-link" onClick={library.reload} type="button">Try again</button></p>
      ) : available.length ? (
        <div className="owner-media-picker">
          {available.map((item) => {
            const isAssigned = assignedIds.has(item.id);
            const isSelected = selectedIds.includes(item.id);
            const mediaName = mediaDisplayName(item);
            return (
              <label
                className={`owner-media-option ${isAssigned ? "owner-media-option--assigned" : ""}`}
                key={item.id}
              >
                <input
                  aria-label={`${mediaName}, ${item.mediaType === "image" ? "Photo" : "Video"}, ${isAssigned ? "assigned" : "available"}`}
                  checked={isAssigned || isSelected}
                  disabled={busy}
                  onChange={(event) => {
                    if (isAssigned) {
                      const assignment = activeMedia.find((assigned) => assigned.id === item.id);
                      if (assignment && !event.target.checked) void remove(assignment);
                      return;
                    }
                    setSelectedIds((current) =>
                      event.target.checked
                        ? [...current, item.id]
                        : current.filter((id) => id !== item.id)
                    );
                  }}
                  type="checkbox"
                />
                <span className="owner-media-option__name">{mediaName}</span>
                <span className="owner-media-option__type">{item.mediaType === "image" ? "Photo" : "Video"}</span>
                <span className="owner-media-option__status">
                  {isAssigned ? "Assigned · uncheck to remove" : isSelected ? "Selected" : "Available"}
                </span>
              </label>
            );
          })}
          <button className="button button--outline owner-media-picker__submit" disabled={busy || !selectedIds.length} onClick={() => void assignSelected()} type="button">
            {busy ? "Assigning…" : `Assign selected media${selectedIds.length ? ` (${selectedIds.length})` : ""}`}
          </button>
        </div>
      ) : <p className="owner-empty-card">Upload media in the Media tab to assign it to this product.</p>}

      {media.loading ? <p className="owner-state">Loading product assignments…</p> : media.error ? (
        <p className="owner-error" role="alert">{media.error}</p>
      ) : activeMedia.length ? (
        <div className="owner-media-grid">
          {activeMedia.map((item, index) => (
            <article className="owner-media-card" key={item.id}>
              {item.mediaType === "video" ? (
                <video aria-label={item.altText || "Product video"} controls playsInline poster={item.posterUrl || undefined} preload="metadata">
                  <source src={item.url} />
                </video>
              ) : (
                <img alt={item.altText || ""} loading="lazy" src={item.url} />
              )}
              <div className="owner-media-card__body">
                <p className="owner-status">{item.isPrimary ? "Primary image" : item.mediaType}</p>
                {item.mediaType === "image" && !item.isPrimary && (
                  <button className="text-link" disabled={busy} onClick={() => void update(item, { isPrimary: true }, "Primary product image updated.")} type="button">
                    Set primary image
                  </button>
                )}
                {item.mediaType === "video" && (
                  <label>
                    <span>Video poster</span>
                    <select
                      disabled={busy}
                      onChange={(event) => void update(item, { posterMediaId: event.target.value || null }, "Product video poster updated.")}
                      value={item.posterMediaId || ""}
                    >
                      <option value="">Use the library default</option>
                      {imageOptions.filter((image) => image.id !== item.id).map((image) => (
                        <option key={image.id} value={image.id}>{image.altText || image.cloudinaryAssetId}</option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="owner-media-card__actions">
                  <button className="text-link" disabled={busy || index === 0} onClick={() => void move(item, -1)} type="button">Move up</button>
                  <button className="text-link" disabled={busy || index === activeMedia.length - 1} onClick={() => void move(item, 1)} type="button">Move down</button>
                  <button className="text-link" disabled={busy} onClick={() => void remove(item)} type="button">Remove assignment</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : <p className="owner-empty-card">No media is assigned to this product.</p>}
    </section>
  );
}
