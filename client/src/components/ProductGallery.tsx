import { useState } from "react";
import type { CatalogProductMedia } from "@sweet-juniper/shared";

export function ProductGallery({
  media,
  productName,
}: {
  media: CatalogProductMedia[];
  productName: string;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = media[selectedIndex];

  return (
    <div className="product-gallery">
      <div className="product-gallery__stage">
        {selected?.mediaType === "video" ? (
          <video controls playsInline poster={media.find((item) => item.mediaType === "image")?.url}>
            <source src={selected.url} />
            Your browser does not support video playback.
          </video>
        ) : (
          <img
            src={selected?.url || "/images/intro/juniper-star.svg"}
            alt={selected?.altText || productName}
          />
        )}
      </div>
      {media.length > 1 && (
        <div className="product-gallery__thumbs" aria-label="Product media">
          {media.map((item, index) => (
            <button
              aria-label={`Show ${item.mediaType === "video" ? "video" : `image ${index + 1}`}`}
              aria-pressed={selectedIndex === index}
              className={selectedIndex === index ? "is-selected" : ""}
              key={item.id}
              onClick={() => setSelectedIndex(index)}
              type="button"
            >
              {item.mediaType === "video" ? (
                <span className="product-gallery__video-thumb" aria-hidden="true">▶</span>
              ) : (
                <img src={item.url} alt="" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
