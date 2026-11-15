import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { CatalogProductMedia, StorefrontHomepage } from "@sweet-juniper/shared";
import { getContentSection, getContentText } from "../utils/homepage-content";
import {
  galleryColumns,
  galleryMediaIds,
  galleryOrder,
  galleryShape,
} from "../utils/homepage-gallery";

export function GalleryPage({ data }: { data: StorefrontHomepage }) {
  const home = getContentSection(data.content, "home");
  const selectedIds = galleryMediaIds(home.galleryMediaIds);
  const desktopOrder = galleryOrder(home, "galleryDesktopOrder", selectedIds);
  const mobileOrder = galleryOrder(home, "galleryMobileOrder", selectedIds);
  const mediaById = new Map((data.mediaLibrary || []).map((media) => [media.id, media] as const));
  const media = desktopOrder
    .map((id) => mediaById.get(id))
    .filter((item): item is CatalogProductMedia => Boolean(item));
  const mobilePositions = new Map(mobileOrder.map((id, index) => [id, index] as const));
  const savedDesktopColumns = galleryColumns(home.galleryDesktopColumns, 3);
  const desktopColumns = savedDesktopColumns === 1 ? 3 : savedDesktopColumns;
  const savedMobileColumns = galleryColumns(home.galleryMobileColumns, 2);
  const mobileColumns = savedMobileColumns > 2 ? 2 : savedMobileColumns;
  const showCaptions = home.galleryShowCaptions !== false;

  return (
    <main className="page-main section-wrap gallery-page">
      <Link className="back-link" to="/">← Back to the studio</Link>
      <div className="page-intro page-intro--compact">
        <p className="eyebrow">{getContentText(home, "galleryEyebrow", "A CLOSER LOOK")}</p>
        <h1>{getContentText(home, "galleryTitle", "Around the studio")}</h1>
        <p>{getContentText(home, "galleryDescription", "Browse photos and videos from our studio.")}</p>
      </div>
      {media.length ? (
        <div className={`gallery-page__grid gallery-page__grid--columns-${desktopColumns} gallery-page__grid--mobile-columns-${mobileColumns}`}>
          {media.map((item) => {
            const mobilePosition = mobilePositions.get(item.id) ?? mobileOrder.length;
            const style: CSSProperties & { "--gallery-mobile-order": number } = {
              "--gallery-mobile-order": mobilePosition,
            };
            const shapeClass = `gallery-page__item--${galleryShape(home, "galleryDesktopShapes", item.id)} gallery-page__item--mobile-${galleryShape(home, "galleryMobileShapes", item.id)}`;
            return (
              <figure
                className={`gallery-page__item ${shapeClass}`}
                key={item.id}
                style={style}
              >
                {item.mediaType === "video" ? (
                  <video controls playsInline poster={item.posterUrl || undefined} preload="metadata">
                    <source src={item.url} />
                    Your browser does not support video playback.
                  </video>
                ) : (
                  <img alt={item.altText || ""} loading="lazy" src={item.url} />
                )}
                {showCaptions && item.altText && <figcaption>{item.altText}</figcaption>}
              </figure>
            );
          })}
        </div>
      ) : (
        <p className="gentle-empty">The studio gallery is being prepared. Please check back soon.</p>
      )}
    </main>
  );
}
