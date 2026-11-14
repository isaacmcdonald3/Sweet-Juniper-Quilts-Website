import { useState, type FormEvent } from "react";
import type { AdminHomepageMedia, AdminProductMedia, CloudinaryUploadLimits } from "@sweet-juniper/shared";
import { requestAdminJson, uploadAdminFile } from "../../services/admin-api";
import { useAdminResource } from "../use-admin-resource";

export function OwnerMediaPage() {
  const media = useAdminResource<AdminProductMedia[]>("/api/admin/media");
  const homepageMedia = useAdminResource<AdminHomepageMedia[]>("/api/admin/homepage-media");
  const limits = useAdminResource<CloudinaryUploadLimits>("/api/admin/media/limits");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [altText, setAltText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  async function uploadHomepageAsset(event: FormEvent<HTMLFormElement>) {
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
      await uploadAdminFile<AdminHomepageMedia>(
        "/api/admin/homepage-media",
        file,
        { mediaType, altText },
        setProgress,
      );
      setFile(null);
      setAltText("");
      form.reset();
      setMessage("Homepage media was uploaded and is available to select in Homepage management.");
      homepageMedia.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The homepage media could not be uploaded.");
    } finally {
      setUploading(false);
    }
  }

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
        Upload images and videos for homepage areas here, or manage product media below. Cloudinary files are not included in database backups.
      </p>
      {message && <p className="owner-success" role="status">{message}</p>}
      {error && <p className="owner-error" role="alert">{error}</p>}
      <section className="owner-panel owner-edit-form">
        <div className="owner-panel__heading"><h2>Homepage media</h2></div>
        <p className="owner-help-note">These files are independent of products. After upload, assign them to the hero, story, or promotion area in Homepage management.</p>
        {limits.error && <p className="owner-error" role="alert">{limits.error}</p>}
        {limits.data && !limits.data.configured && <p className="owner-notice" role="status">Cloudinary uploads are not configured yet.</p>}
        <form className="owner-form-grid" onSubmit={(event) => void uploadHomepageAsset(event)}>
          <label>
            <span>Media type</span>
            <select onChange={(event) => { setMediaType(event.target.value as "image" | "video"); setFile(null); }} value={mediaType}>
              <option value="image">Image</option>
              <option value="video">Video</option>
            </select>
          </label>
          <label><span>File</span><input accept={mediaType === "image" ? "image/jpeg,image/png,image/webp,image/avif" : "video/mp4,video/webm,video/quicktime"} key={mediaType} onChange={(event) => setFile(event.target.files?.[0] || null)} required type="file" /></label>
          <label className="owner-form-grid__wide"><span>Alt text (optional)</span><input maxLength={500} onChange={(event) => setAltText(event.target.value)} value={altText} /></label>
          <button className="button button--primary owner-form-grid__wide" disabled={uploading || !limits.data?.configured} type="submit">{uploading ? `Uploading… ${progress}%` : "Upload homepage media"}</button>
        </form>
        {homepageMedia.loading ? <p className="owner-state" role="status">Loading homepage media…</p> : homepageMedia.error ? (
          <p className="owner-error" role="alert">{homepageMedia.error} <button className="text-link" onClick={homepageMedia.reload} type="button">Try again</button></p>
        ) : homepageMedia.data?.length ? (
          <div className="owner-media-grid">
            {homepageMedia.data.map((item) => (
              <article className="owner-media-card" key={item.id}>
                {item.mediaType === "video"
                  ? <video controls playsInline preload="metadata"><source src={item.url} /></video>
                  : <img alt={item.altText || ""} loading="lazy" src={item.url} />}
                <div className="owner-media-card__body">
                  <h3>Homepage asset</h3>
                  <p className="owner-status">{item.mediaType}</p>
                  {item.altText && <p>{item.altText}</p>}
                  <code>{item.cloudinaryAssetId}</code>
                </div>
              </article>
            ))}
          </div>
        ) : <p className="owner-empty-card">No homepage media has been uploaded.</p>}
      </section>
      <div className="owner-panel__heading"><h2>Product media</h2></div>
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
