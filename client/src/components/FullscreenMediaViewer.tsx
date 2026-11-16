import { useEffect, useRef } from "react";
import type { CatalogProductMedia } from "@sweet-juniper/shared";

interface FullscreenMediaViewerProps {
  media: CatalogProductMedia[];
  activeIndex: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  label: string;
}

export function FullscreenMediaViewer({
  media,
  activeIndex,
  onIndexChange,
  onClose,
  label,
}: FullscreenMediaViewerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const touchStartX = useRef<number | null>(null);
  const stateRef = useRef({ media, activeIndex, onIndexChange, onClose });
  stateRef.current = { media, activeIndex, onIndexChange, onClose };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      const current = stateRef.current;
      if (event.key === "Escape") {
        event.preventDefault();
        current.onClose();
      } else if (event.key === "ArrowLeft" && current.activeIndex !== null) {
        event.preventDefault();
        if (current.activeIndex > 0) current.onIndexChange(current.activeIndex - 1);
      } else if (event.key === "ArrowRight" && current.activeIndex !== null) {
        event.preventDefault();
        if (current.activeIndex < current.media.length - 1) current.onIndexChange(current.activeIndex + 1);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  if (activeIndex === null || !media[activeIndex]) return null;
  const currentIndex = activeIndex;
  const selected = media[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === media.length - 1;

  function finishSwipe(endX: number) {
    if (touchStartX.current === null) return;
    const distance = endX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(distance) < 55 || media.length < 2) return;
    if (distance > 0 && !isFirst) onIndexChange(currentIndex - 1);
    if (distance < 0 && !isLast) onIndexChange(currentIndex + 1);
  }

  return (
    <dialog
      aria-label={`${label} media viewer`}
      className="fullscreen-media-viewer"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      ref={dialogRef}
    >
      <button
        aria-label="Close media viewer"
        className="fullscreen-media-viewer__close"
        onClick={onClose}
        ref={closeButtonRef}
        type="button"
      >
        <span aria-hidden="true">×</span>
      </button>
      <div
        className="fullscreen-media-viewer__stage"
        onClick={(event) => event.stopPropagation()}
        onTouchEnd={(event) => finishSwipe(event.changedTouches[0]?.clientX ?? 0)}
        onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }}
      >
        {media.length > 1 && (
          <button
            aria-label="Previous media"
            className="fullscreen-media-viewer__nav fullscreen-media-viewer__nav--previous"
            disabled={isFirst}
            onClick={() => onIndexChange(activeIndex - 1)}
            type="button"
          >
            <span aria-hidden="true">‹</span>
          </button>
        )}
        {selected.mediaType === "video" ? (
          <video
            aria-label={selected.altText || `Video ${currentIndex + 1} of ${media.length}`}
            autoPlay={false}
            controls
            key={selected.id}
            playsInline
            poster={selected.posterUrl || undefined}
            preload="metadata"
          >
            <source src={selected.url} />
            Your browser does not support video playback.
          </video>
        ) : (
          <img
            alt={selected.altText || `Image ${currentIndex + 1} of ${media.length}`}
            key={selected.id}
            src={selected.url}
          />
        )}
        {media.length > 1 && (
          <button
            aria-label="Next media"
            className="fullscreen-media-viewer__nav fullscreen-media-viewer__nav--next"
            disabled={isLast}
            onClick={() => onIndexChange(activeIndex + 1)}
            type="button"
          >
            <span aria-hidden="true">›</span>
          </button>
        )}
      </div>
      {media.length > 1 && (
        <p aria-live="polite" className="fullscreen-media-viewer__position">
          {currentIndex + 1} / {media.length}
        </p>
      )}
    </dialog>
  );
}
