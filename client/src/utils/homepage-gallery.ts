export type GalleryTileShape = "square" | "landscape" | "portrait";
export type GalleryOrderKey = "galleryDesktopOrder" | "galleryMobileOrder";
export type GalleryShapeKey = "galleryDesktopShapes" | "galleryMobileShapes";

export const galleryTileShapes: Array<{ value: GalleryTileShape; label: string }> = [
  { value: "square", label: "Square" },
  { value: "landscape", label: "Landscape rectangle" },
  { value: "portrait", label: "Portrait rectangle" },
];

export function galleryMediaIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string"))];
}

export function galleryOrder(
  home: Record<string, unknown>,
  orderKey: GalleryOrderKey,
  selectedIds: string[],
): string[] {
  const savedOrder = galleryMediaIds(home[orderKey]).filter((id) => selectedIds.includes(id));
  return [...savedOrder, ...selectedIds.filter((id) => !savedOrder.includes(id))];
}

export function galleryShape(home: Record<string, unknown>, shapesKey: GalleryShapeKey, mediaId: string): GalleryTileShape {
  const savedShapes = home[shapesKey];
  if (!savedShapes || typeof savedShapes !== "object" || Array.isArray(savedShapes)) return "square";
  const shape = (savedShapes as Record<string, unknown>)[mediaId];
  return shape === "landscape" || shape === "portrait" || shape === "square" ? shape : "square";
}

export function galleryColumns(value: unknown, fallback: 1 | 2 | 3 | 4): 1 | 2 | 3 | 4 {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : fallback;
}
