import { useEffect, useMemo, useState } from "react";
import type {
  AdminHomepageContent,
  AdminLibraryMedia,
} from "@sweet-juniper/shared";
import { requestAdminJson } from "../../services/admin-api";
import {
  galleryColumns,
  galleryMediaIds,
  galleryOrder,
  galleryShape,
  galleryTileShapes,
  type GalleryOrderKey,
  type GalleryShapeKey,
  type GalleryTileShape,
} from "../../utils/homepage-gallery";
import { useAdminResource } from "../use-admin-resource";

type ContentObject = Record<string, unknown>;

function asObject(value: unknown): ContentObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ContentObject
    : {};
}

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function contentRow(rows: AdminHomepageContent[], key: string): AdminHomepageContent | undefined {
  return rows.find((row) => row.contentKey === key);
}

export function OwnerGalleryPage() {
  const content = useAdminResource<AdminHomepageContent[]>("/api/admin/homepage-content");
  const mediaLibrary = useAdminResource<AdminLibraryMedia[]>("/api/admin/media");
  const [home, setHome] = useState<ContentObject | null>(null);
  const [isPublished, setIsPublished] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!content.data) return;
    const row = contentRow(content.data, "home");
    setHome(asObject(row?.content));
    setIsPublished(row?.isPublished ?? true);
  }, [content.data]);

  const mediaOptions = useMemo(
    () => (mediaLibrary.data || []).filter((item) => !item.deletedAt),
    [mediaLibrary.data],
  );

  function updateHome(key: string, value: unknown) {
    setHome((current) => {
      if (!current) return current;
      const next = { ...current };
      if (value === undefined || value === "") delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function toggleGalleryMedia(mediaId: string, selected: boolean) {
    setHome((current) => {
      if (!current) return current;
      const selectedIds = galleryMediaIds(current.galleryMediaIds);
      const nextIds = selected
        ? selectedIds.includes(mediaId) ? selectedIds : [...selectedIds, mediaId]
        : selectedIds.filter((id) => id !== mediaId);
      const desktopOrder = galleryOrder(current, "galleryDesktopOrder", selectedIds)
        .filter((id) => selected || id !== mediaId);
      const mobileOrder = galleryOrder(current, "galleryMobileOrder", selectedIds)
        .filter((id) => selected || id !== mediaId);
      const next: ContentObject = {
        ...current,
        galleryMediaIds: nextIds,
        galleryDesktopOrder: selected && !selectedIds.includes(mediaId) ? [...desktopOrder, mediaId] : desktopOrder,
        galleryMobileOrder: selected && !selectedIds.includes(mediaId) ? [...mobileOrder, mediaId] : mobileOrder,
      };
      if (!selected) {
        for (const key of ["galleryDesktopShapes", "galleryMobileShapes"]) {
          const shapes = { ...asObject(next[key]) };
          delete shapes[mediaId];
          next[key] = shapes;
        }
      }
      return next;
    });
  }

  function moveGalleryMedia(orderKey: GalleryOrderKey, mediaId: string, direction: -1 | 1) {
    setHome((current) => {
      if (!current) return current;
      const order = galleryOrder(current, orderKey, galleryMediaIds(current.galleryMediaIds));
      const index = order.indexOf(mediaId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= order.length) return current;
      [order[index], order[target]] = [order[target], order[index]];
      return { ...current, [orderKey]: order };
    });
  }

  function setGalleryShape(shapesKey: GalleryShapeKey, mediaId: string, shape: GalleryTileShape) {
    setHome((current) => current ? {
      ...current,
      [shapesKey]: { ...asObject(current[shapesKey]), [mediaId]: shape },
    } : current);
  }

  function renderGalleryOrder(
    order: string[],
    orderKey: GalleryOrderKey,
    shapesKey: GalleryShapeKey,
    breakpointName: string,
  ) {
    return (
      <div className="owner-gallery-order">
        <h3>{breakpointName} order and tile shapes</h3>
        <ol>
          {order.map((mediaId, index) => {
            const item = mediaOptions.find((media) => media.id === mediaId);
            if (!item) return null;
            return (
              <li key={mediaId}>
                <span>{index + 1}. {item.altText || item.mediaType}</span>
                <div className="owner-gallery-order__actions">
                  <button className="text-link" disabled={busy || index === 0} onClick={() => moveGalleryMedia(orderKey, mediaId, -1)} type="button">Move up</button>
                  <button className="text-link" disabled={busy || index === order.length - 1} onClick={() => moveGalleryMedia(orderKey, mediaId, 1)} type="button">Move down</button>
                </div>
                <label>
                  <span>{breakpointName} tile shape</span>
                  <select
                    disabled={busy}
                    onChange={(event) => setGalleryShape(shapesKey, mediaId, event.target.value as GalleryTileShape)}
                    value={galleryShape(home || {}, shapesKey, mediaId)}
                  >
                    {galleryTileShapes.map((shape) => <option key={shape.value} value={shape.value}>{shape.label}</option>)}
                  </select>
                </label>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  async function saveGallery() {
    if (!home) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await requestAdminJson<void>("/api/admin/homepage-content/home", {
        method: "PUT",
        body: { content: home, isPublished },
      });
      setMessage("Gallery settings were saved.");
      content.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gallery settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const selectedIds = galleryMediaIds(home?.galleryMediaIds);
  const desktopOrder = galleryOrder(home || {}, "galleryDesktopOrder", selectedIds);
  const mobileOrder = galleryOrder(home || {}, "galleryMobileOrder", selectedIds);
  const savedDesktopColumns = galleryColumns(home?.galleryDesktopColumns, 3);
  const desktopColumns = savedDesktopColumns === 1 ? 3 : savedDesktopColumns;
  const savedMobileColumns = galleryColumns(home?.galleryMobileColumns, 2);
  const mobileColumns = savedMobileColumns > 2 ? 2 : savedMobileColumns;
  const loadError = content.error || mediaLibrary.error;

  return (
    <section className="owner-page">
      <div className="owner-page__heading">
        <div><p className="eyebrow">CUSTOMIZE THE SHOP</p><h1>Gallery</h1></div>
      </div>
      <p className="owner-help-note">
        Select media and arrange the full customer gallery. The homepage preview shows up to five selected items.
      </p>
      {message && <p className="owner-success" role="status">{message}</p>}
      {error && <p className="owner-error" role="alert">{error}</p>}
      {loadError && (
        <p className="owner-error" role="alert">
          {loadError}
          <button className="text-link" onClick={() => { content.reload(); mediaLibrary.reload(); }} type="button">Try again</button>
        </p>
      )}
      {!home || content.loading || mediaLibrary.loading ? (
        <p className="owner-state" role="status">Loading gallery and media content…</p>
      ) : (
        <section className="owner-panel owner-homepage-editor">
          <div className="owner-panel__heading"><h2>Gallery content and layout</h2></div>
          <div className="owner-form-grid">
            <label><span>Eyebrow</span><input disabled={busy} maxLength={100} onChange={(event) => updateHome("galleryEyebrow", event.target.value)} value={asText(home.galleryEyebrow, "A CLOSER LOOK")} /></label>
            <label><span>Heading</span><input disabled={busy} maxLength={180} onChange={(event) => updateHome("galleryTitle", event.target.value)} value={asText(home.galleryTitle, "Around the studio")} /></label>
            <label className="owner-form-grid__wide"><span>Gallery introduction (optional)</span><textarea disabled={busy} maxLength={500} onChange={(event) => updateHome("galleryDescription", event.target.value)} rows={2} value={asText(home.galleryDescription)} /></label>
            <label><span>Desktop columns</span><select disabled={busy} onChange={(event) => updateHome("galleryDesktopColumns", Number(event.target.value))} value={desktopColumns}><option value={2}>2 columns</option><option value={3}>3 columns</option><option value={4}>4 columns</option></select></label>
            <label><span>Mobile columns</span><select disabled={busy} onChange={(event) => updateHome("galleryMobileColumns", Number(event.target.value))} value={mobileColumns}><option value={1}>1 column</option><option value={2}>2 columns</option></select></label>
          </div>
          {mediaOptions.length ? (
            <div className="owner-gallery-options">
              {mediaOptions.map((item) => (
                <label className="owner-gallery-option" key={item.id}>
                  <input
                    checked={selectedIds.includes(item.id)}
                    disabled={busy}
                    onChange={(event) => toggleGalleryMedia(item.id, event.target.checked)}
                    type="checkbox"
                  />
                  {item.mediaType === "video"
                    ? <video muted playsInline preload="metadata"><source src={item.url} /></video>
                    : <img alt={item.altText || ""} loading="lazy" src={item.url} />}
                  <span>{item.altText || item.mediaType}</span>
                </label>
              ))}
            </div>
          ) : <p className="owner-empty-card">Upload media in the Media tab before selecting Gallery items.</p>}
          {selectedIds.length ? (
            <div className="owner-gallery-organizers">
              {renderGalleryOrder(desktopOrder, "galleryDesktopOrder", "galleryDesktopShapes", "Desktop")}
              {renderGalleryOrder(mobileOrder, "galleryMobileOrder", "galleryMobileShapes", "Mobile")}
            </div>
          ) : <p className="owner-help-note">Select media to arrange its order and tile shape for desktop and mobile.</p>}
          <label className="owner-checkbox"><input checked={asObject(home.sectionVisibility).gallery !== false} disabled={busy} onChange={(event) => updateHome("sectionVisibility", { ...asObject(home.sectionVisibility), gallery: event.target.checked })} type="checkbox" /> Show the gallery preview on the homepage</label>
          <button className="button button--primary" disabled={busy} onClick={() => void saveGallery()} type="button">{busy ? "Saving…" : "Save gallery"}</button>
        </section>
      )}
    </section>
  );
}
