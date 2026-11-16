import multer from "multer";
import type { RequestHandler } from "express";
import type { Logger } from "pino";
import type {
  AdminLibraryMedia,
  AdminProductMedia,
  CloudinaryUploadLimits,
  ProductMediaType,
} from "@sweet-juniper/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  IMAGE_MIME_TYPES,
  UploadValidationError,
  VIDEO_MIME_TYPES,
} from "./cloudinary-service.js";
import type {
  CloudinaryMediaClient,
  CloudinaryResourceType,
} from "./cloudinary-service.js";

type PendingAsset =
  | { publicId: string; resourceType: CloudinaryResourceType }
  | { assetId: string; resourceType: CloudinaryResourceType };

interface MediaLibraryRow {
  id: string;
  media_type: ProductMediaType;
  cloudinary_asset_id: string;
  cloudinary_public_id: string | null;
  media_url: string;
  alt_text: string | null;
  poster_media_library_id: string | null;
  created_at: string;
  deleted_at: string | null;
  cleanup_pending_assets: PendingAsset[] | null;
  poster?: MediaLibraryRow | MediaLibraryRow[] | null;
}

interface ProductMediaAssignmentRow {
  id: string;
  product_id: string;
  media_library_id: string;
  sort_order: number;
  is_primary: boolean;
  poster_media_library_id: string | null;
  products?: { name: string } | Array<{ name: string }> | null;
  media?: MediaLibraryRow | MediaLibraryRow[] | null;
  poster?: MediaLibraryRow | MediaLibraryRow[] | null;
}

interface UploadFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export class MediaNotFoundError extends Error {}
export class MediaConflictError extends Error {}

const librarySelection =
  "id,media_type,cloudinary_asset_id,cloudinary_public_id,media_url,alt_text,poster_media_library_id,created_at,deleted_at,cleanup_pending_assets";
const assignmentSelection =
  "id,product_id,media_library_id,sort_order,is_primary,poster_media_library_id,products(name),media:media_library!product_media_media_library_id_fkey(id,media_type,cloudinary_asset_id,cloudinary_public_id,media_url,alt_text,poster_media_library_id,created_at,deleted_at,cleanup_pending_assets),poster:media_library!product_media_poster_media_library_id_fkey(id,media_type,cloudinary_asset_id,cloudinary_public_id,media_url,alt_text,poster_media_library_id,created_at,deleted_at,cleanup_pending_assets)";

function getPendingAssets(value: PendingAsset[] | null): PendingAsset[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (asset): asset is PendingAsset =>
      ((asset && "publicId" in asset && typeof asset.publicId === "string") ||
        (asset && "assetId" in asset && typeof asset.assetId === "string")) &&
      (asset.resourceType === "image" || asset.resourceType === "video"),
  );
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function mapLibrary(
  row: MediaLibraryRow,
  cloudinary: CloudinaryMediaClient,
): AdminLibraryMedia {
  const poster = one(row.poster);
  return {
    id: row.id,
    cloudinaryAssetId: row.cloudinary_asset_id,
    cloudinaryPublicId: row.cloudinary_public_id,
    mediaType: row.media_type,
    url: row.cloudinary_public_id
      ? cloudinary.deliveryUrl(row.cloudinary_public_id, row.media_type) || row.media_url
      : row.media_url,
    altText: row.alt_text,
    posterMediaId: row.poster_media_library_id,
    posterUrl: poster
      ? poster.cloudinary_public_id
        ? cloudinary.deliveryUrl(poster.cloudinary_public_id, "image") || poster.media_url
        : poster.media_url
      : null,
    isPrimary: false,
    sortOrder: 0,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    cleanupPendingAssets: getPendingAssets(row.cleanup_pending_assets),
  };
}

async function mapAssignment(
  row: ProductMediaAssignmentRow,
  cloudinary: CloudinaryMediaClient,
  hydrateLibraryRows: (rows: MediaLibraryRow[]) => Promise<MediaLibraryRow[]>,
): Promise<AdminProductMedia> {
  const rawMedia = one(row.media);
  const media = rawMedia
    ? (await hydrateLibraryRows([rawMedia]))[0]
    : null;
  const poster = one(row.poster);
  const product = one(row.products);
  if (!media) throw new Error("A product media assignment has no media library item.");
  const mapped = mapLibrary(media, cloudinary);
  return {
    ...mapped,
    id: media.id,
    productId: row.product_id,
    productName: product?.name || "",
    posterMediaId: row.poster_media_library_id || mapped.posterMediaId,
    posterUrl: poster
      ? poster.cloudinary_public_id
        ? cloudinary.deliveryUrl(poster.cloudinary_public_id, "image") || poster.media_url
        : poster.media_url
      : mapped.posterUrl,
    isPrimary: row.is_primary,
    sortOrder: row.sort_order,
  };
}

function contentContainsReference(value: unknown, references: Set<string>): boolean {
  if (typeof value === "string") return references.has(value);
  if (Array.isArray(value)) return value.some((entry) => contentContainsReference(entry, references));
  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([key, entry]) => references.has(key) || contentContainsReference(entry, references),
    );
  }
  return false;
}

export function createMediaService(
  supabase: SupabaseClient,
  cloudinary: CloudinaryMediaClient,
  logger: Logger,
) {
  const maxBytes = Math.max(cloudinary.imageMaxBytes, cloudinary.videoMaxBytes);
  const uploadMiddleware: RequestHandler = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (_request, file, callback) => {
      if (![...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES].includes(file.mimetype)) {
        callback(new UploadValidationError("This file format is not supported."));
        return;
      }
      callback(null, true);
    },
  }).single("file");

  async function audit(
    actorId: string,
    action: string,
    mediaId: string,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    const { error } = await supabase.from("admin_audit_logs").insert({
      actor_user_id: actorId,
      action,
      entity_type: "media_library",
      entity_id: mediaId,
      details,
    });
    if (error) throw error;
  }

  async function hydrateLibraryRows(rows: MediaLibraryRow[]): Promise<MediaLibraryRow[]> {
    const posterIds = [...new Set(
      rows
        .map((row) => row.poster_media_library_id)
        .filter((id): id is string => Boolean(id)),
    )];
    if (!posterIds.length) return rows;

    const { data, error } = await supabase
      .from("media_library")
      .select(librarySelection)
      .in("id", posterIds);
    if (error) throw error;
    const posters = new Map((data as MediaLibraryRow[]).map((row) => [row.id, row]));
    return rows.map((row) => ({
      ...row,
      poster: row.poster_media_library_id
        ? posters.get(row.poster_media_library_id) || null
        : null,
    }));
  }

  async function getLibraryMedia(mediaId: string): Promise<MediaLibraryRow> {
    const { data, error } = await supabase
      .from("media_library")
      .select(librarySelection)
      .eq("id", mediaId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new MediaNotFoundError("Media library item not found.");
    return (await hydrateLibraryRows([data as MediaLibraryRow]))[0];
  }

  async function getProductAssignment(
    productId: string,
    mediaId: string,
  ): Promise<ProductMediaAssignmentRow | null> {
    const { data, error } = await supabase
      .from("product_media")
      .select(assignmentSelection)
      .eq("product_id", productId)
      .eq("media_library_id", mediaId)
      .maybeSingle();
    if (error) throw error;
    return data as ProductMediaAssignmentRow | null;
  }

  async function deleteUploadedAsset(publicId: string, resourceType: CloudinaryResourceType) {
    try {
      await cloudinary.delete(publicId, resourceType);
    } catch (error) {
      logger.error({ err: error, publicId }, "Unattached Cloudinary upload could not be removed");
    }
  }

  async function uploadLibraryMedia(
    actorId: string,
    file: UploadFile,
    mediaType: CloudinaryResourceType,
    altText: string | null,
  ): Promise<AdminLibraryMedia> {
    if ((mediaType === "image" && !IMAGE_MIME_TYPES.includes(file.mimetype)) ||
        (mediaType === "video" && !VIDEO_MIME_TYPES.includes(file.mimetype))) {
      throw new UploadValidationError("The selected file type does not match the media type.");
    }
    const limit = mediaType === "image" ? cloudinary.imageMaxBytes : cloudinary.videoMaxBytes;
    if (file.size > limit) {
      throw new UploadValidationError(`This file exceeds the ${mediaType} upload size limit.`);
    }

    const uploaded = await cloudinary.upload(
      file.buffer,
      file.mimetype,
      mediaType,
      "sweet-juniper/media-library",
    );
    try {
      const { data, error } = await supabase
        .from("media_library")
        .insert({
          media_type: uploaded.resourceType,
          cloudinary_asset_id: uploaded.assetId,
          cloudinary_public_id: uploaded.publicId,
          media_url: uploaded.secureUrl,
          alt_text: altText,
        })
        .select(librarySelection)
        .single();
      if (error) throw error;
      const row = data as MediaLibraryRow;
      await audit(actorId, "media_library.uploaded", row.id, { mediaType });
      return mapLibrary(row, cloudinary);
    } catch (error) {
      await deleteUploadedAsset(uploaded.publicId, mediaType);
      throw error;
    }
  }

  async function replaceLibraryMedia(
    actorId: string,
    mediaId: string,
    file: UploadFile,
    mediaType: CloudinaryResourceType,
  ): Promise<{ media: AdminLibraryMedia; cleanupPending: number }> {
    const existing = await getLibraryMedia(mediaId);
    if (existing.deleted_at) throw new MediaConflictError("Removed media cannot be replaced.");
    if (existing.media_type !== mediaType) {
      throw new MediaConflictError("Replacement media must use the same media type.");
    }
    if ((mediaType === "image" && !IMAGE_MIME_TYPES.includes(file.mimetype)) ||
        (mediaType === "video" && !VIDEO_MIME_TYPES.includes(file.mimetype))) {
      throw new UploadValidationError("The selected file type does not match the media type.");
    }
    const limit = mediaType === "image" ? cloudinary.imageMaxBytes : cloudinary.videoMaxBytes;
    if (file.size > limit) {
      throw new UploadValidationError(`This file exceeds the ${mediaType} upload size limit.`);
    }

    const uploaded = await cloudinary.upload(
      file.buffer,
      file.mimetype,
      mediaType,
      "sweet-juniper/media-library",
    );
    const pending = [
      ...getPendingAssets(existing.cleanup_pending_assets),
      existing.cloudinary_public_id
        ? { publicId: existing.cloudinary_public_id, resourceType: existing.media_type }
        : { assetId: existing.cloudinary_asset_id, resourceType: existing.media_type },
    ];
    const { data, error } = await supabase
      .from("media_library")
      .update({
        cloudinary_asset_id: uploaded.assetId,
        cloudinary_public_id: uploaded.publicId,
        media_url: uploaded.secureUrl,
        cleanup_pending_assets: pending,
      })
      .eq("id", mediaId)
      .select(librarySelection)
      .single();
    if (error) {
      await deleteUploadedAsset(uploaded.publicId, mediaType);
      throw error;
    }
    let row = (await hydrateLibraryRows([data as MediaLibraryRow]))[0];
    await audit(actorId, "media_library.replaced", mediaId, { mediaType });
    const cleanupPending = await retryCleanup(row);
    if (cleanupPending > 0) row = await getLibraryMedia(mediaId);
    return { media: mapLibrary(row, cloudinary), cleanupPending };
  }

  async function listAllMedia(): Promise<AdminLibraryMedia[]> {
    const { data, error } = await supabase
      .from("media_library")
      .select(librarySelection)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) throw error;
    const rows = await hydrateLibraryRows(data as MediaLibraryRow[]);
    return rows.map((row) => mapLibrary(row, cloudinary));
  }

  async function listProductMedia(productId: string): Promise<AdminProductMedia[]> {
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id,name")
      .eq("id", productId)
      .maybeSingle();
    if (productError) throw productError;
    if (!product) throw new MediaNotFoundError("Product not found.");

    const { data, error } = await supabase
      .from("product_media")
      .select(assignmentSelection)
      .eq("product_id", productId)
      .order("is_primary", { ascending: false })
      .order("sort_order")
      .order("created_at");
    if (error) throw error;
    return Promise.all((data as ProductMediaAssignmentRow[]).map((row) =>
      mapAssignment({ ...row, products: product }, cloudinary, hydrateLibraryRows),
    ));
  }

  async function assertLibraryMediaUnassigned(row: MediaLibraryRow): Promise<void> {
    const { data: assignments, error: assignmentError } = await supabase
      .from("product_media")
      .select("id")
      .or(`media_library_id.eq.${row.id},poster_media_library_id.eq.${row.id}`)
      .limit(1);
    if (assignmentError) throw assignmentError;
    if (assignments?.length) {
      throw new MediaConflictError("Remove this media from its product or video poster assignments before deleting it.");
    }

    const { data: otherPosters, error: posterError } = await supabase
      .from("media_library")
      .select("id")
      .eq("poster_media_library_id", row.id)
      .limit(1);
    if (posterError) throw posterError;
    if (otherPosters?.length) {
      throw new MediaConflictError("Choose another poster before deleting this media.");
    }

    const { data: content, error: contentError } = await supabase
      .from("homepage_content")
      .select("content");
    if (contentError) throw contentError;
    const references = new Set([
      row.id,
      row.cloudinary_asset_id,
      row.cloudinary_public_id || "",
    ]);
    if (contentContainsReference(content, references)) {
      throw new MediaConflictError("This media is selected for homepage or gallery content. Choose another before deleting it.");
    }
  }

  async function retryCleanup(row: MediaLibraryRow): Promise<number> {
    const pending = getPendingAssets(row.cleanup_pending_assets);
    const remaining: PendingAsset[] = [];
    for (const asset of pending) {
      try {
        if ("publicId" in asset) {
          await cloudinary.delete(asset.publicId, asset.resourceType);
        } else {
          await cloudinary.deleteByAssetId(asset.assetId, asset.resourceType);
        }
      } catch (error) {
        logger.error(
          {
            err: error,
            mediaId: row.id,
            ...("publicId" in asset ? { publicId: asset.publicId } : { assetId: asset.assetId }),
          },
          "Cloudinary asset cleanup remains pending",
        );
        remaining.push(asset);
      }
    }

    if (remaining.length !== pending.length) {
      const { error } = await supabase
        .from("media_library")
        .update({ cleanup_pending_assets: remaining })
        .eq("id", row.id);
      if (error) throw error;
    }
    return remaining.length;
  }

  async function deleteLibraryMedia(actorId: string, mediaId: string): Promise<{ cleanupPending: number }> {
    let row = await getLibraryMedia(mediaId);
    if (!row.deleted_at) {
      await assertLibraryMediaUnassigned(row);
      const pending: PendingAsset[] = [
        ...getPendingAssets(row.cleanup_pending_assets),
        row.cloudinary_public_id
          ? { publicId: row.cloudinary_public_id, resourceType: row.media_type }
          : { assetId: row.cloudinary_asset_id, resourceType: row.media_type },
      ];
      const { data, error } = await supabase
        .from("media_library")
        .update({ deleted_at: new Date().toISOString(), cleanup_pending_assets: pending })
        .eq("id", mediaId)
        .select(librarySelection)
        .single();
      if (error) throw error;
      row = data as MediaLibraryRow;
      await audit(actorId, "media_library.removed", mediaId);
    }
    return { cleanupPending: await finishLibraryCleanup(row) };
  }

  async function finishLibraryCleanup(row: MediaLibraryRow): Promise<number> {
    const cleanupPending = await retryCleanup(row);
    if (cleanupPending === 0 && row.deleted_at) {
      const { error } = await supabase.from("media_library").delete().eq("id", row.id);
      if (error) throw error;
    }
    return cleanupPending;
  }

  async function retryLibraryMediaCleanup(
    actorId: string,
    mediaId: string,
  ): Promise<{ cleanupPending: number }> {
    const row = await getLibraryMedia(mediaId);
    if (!row.deleted_at) {
      throw new MediaConflictError("Media cleanup can only be retried after the library item is removed.");
    }
    const cleanupPending = await finishLibraryCleanup(row);
    await audit(actorId, "media_library.cleanup_retried", mediaId, { cleanupPending });
    return { cleanupPending };
  }

  async function updateLibraryMedia(
    actorId: string,
    mediaId: string,
    changes: { altText?: string | null; posterMediaId?: string | null },
  ): Promise<AdminLibraryMedia> {
    const existing = await getLibraryMedia(mediaId);
    if (existing.deleted_at) throw new MediaConflictError("Removed media cannot be edited.");
    let posterMediaId = changes.posterMediaId;
    if (posterMediaId) {
      if (posterMediaId === mediaId) throw new MediaConflictError("Media cannot be its own poster.");
      const poster = await getLibraryMedia(posterMediaId);
      if (poster.deleted_at || poster.media_type !== "image") {
        throw new MediaConflictError("Choose an active image from the Media Library as the video poster.");
      }
      if (existing.media_type !== "video") {
        throw new MediaConflictError("A poster can only be selected for video.");
      }
    }
    if (posterMediaId === null && existing.media_type !== "video") {
      throw new MediaConflictError("A poster can only be removed from video.");
    }
    const update = {
      ...(changes.altText === undefined ? {} : { alt_text: changes.altText }),
      ...(changes.posterMediaId === undefined ? {} : { poster_media_library_id: posterMediaId }),
    };
    const { data, error } = await supabase
      .from("media_library")
      .update(update)
      .eq("id", mediaId)
      .select(librarySelection)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new MediaNotFoundError("Media library item not found.");
    await audit(actorId, "media_library.updated", mediaId, changes);
    const row = (await hydrateLibraryRows([data as MediaLibraryRow]))[0];
    return mapLibrary(row, cloudinary);
  }

  async function addProductMedia(
    actorId: string,
    productId: string,
    mediaId: string,
  ): Promise<AdminProductMedia> {
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id,name")
      .eq("id", productId)
      .maybeSingle();
    if (productError) throw productError;
    if (!product) throw new MediaNotFoundError("Product not found.");

    const media = await getLibraryMedia(mediaId);
    if (media.deleted_at) throw new MediaConflictError("Removed media cannot be assigned.");
    const existing = await getProductAssignment(productId, mediaId);
    if (existing) throw new MediaConflictError("This media is already assigned to the product.");

    const { data: current, error: currentError } = await supabase
      .from("product_media")
      .select("sort_order,is_primary")
      .eq("product_id", productId)
      .order("sort_order", { ascending: false })
      .limit(1000);
    if (currentError) throw currentError;

    const isPrimary = media.media_type === "image" && !(current || []).some((item) => item.is_primary);
    const { data, error } = await supabase
      .from("product_media")
      .insert({
        product_id: productId,
        media_library_id: mediaId,
        is_primary: isPrimary,
        sort_order: current?.length ? current[0].sort_order + 1 : 0,
      })
      .select(assignmentSelection)
      .single();
    if (error) throw error;
    await audit(actorId, "product_media.assigned", mediaId, { productId });
    return mapAssignment(
      { ...(data as ProductMediaAssignmentRow), products: product },
      cloudinary,
      hydrateLibraryRows,
    );
  }

  async function updateProductMedia(
    actorId: string,
    productId: string,
    mediaId: string,
    changes: { sortOrder?: number; isPrimary?: boolean; posterMediaId?: string | null },
  ): Promise<AdminProductMedia> {
    const current = await getProductAssignment(productId, mediaId);
    if (!current) throw new MediaNotFoundError("Product media assignment not found.");
    const media = one(current.media);
    if (!media) throw new Error("A product media assignment has no library item.");
    if (changes.isPrimary && media.media_type !== "image") {
      throw new MediaConflictError("A video cannot be the primary product image.");
    }
    if (changes.posterMediaId) {
      const poster = await getLibraryMedia(changes.posterMediaId);
      if (poster.deleted_at || poster.media_type !== "image") {
        throw new MediaConflictError("Choose an active image from the Media Library as the video poster.");
      }
      if (media.media_type !== "video") {
        throw new MediaConflictError("A poster can only be selected for video.");
      }
    }
    if (changes.posterMediaId === null && media.media_type !== "video") {
      throw new MediaConflictError("A poster can only be removed from video.");
    }

    if (changes.isPrimary) {
      const { error: clearError } = await supabase
        .from("product_media")
        .update({ is_primary: false })
        .eq("product_id", productId);
      if (clearError) throw clearError;
    }
    const update = {
      ...(changes.sortOrder === undefined ? {} : { sort_order: changes.sortOrder }),
      ...(changes.isPrimary === undefined ? {} : { is_primary: changes.isPrimary }),
      ...(changes.posterMediaId === undefined
        ? {}
        : { poster_media_library_id: changes.posterMediaId }),
    };
    const { data, error } = await supabase
      .from("product_media")
      .update(update)
      .eq("product_id", productId)
      .eq("media_library_id", mediaId)
      .select(assignmentSelection)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new MediaNotFoundError("Product media assignment not found.");
    await audit(actorId, "product_media.updated", mediaId, { productId, ...changes });
    return mapAssignment(data as ProductMediaAssignmentRow, cloudinary, hydrateLibraryRows);
  }

  async function removeProductMedia(
    actorId: string,
    productId: string,
    mediaId: string,
  ): Promise<{ cleanupPending: number }> {
    const current = await getProductAssignment(productId, mediaId);
    if (!current) throw new MediaNotFoundError("Product media assignment not found.");
    const { error } = await supabase
      .from("product_media")
      .delete()
      .eq("product_id", productId)
      .eq("media_library_id", mediaId);
    if (error) throw error;

    if (current.is_primary) {
      const { data: nextPrimary, error: nextError } = await supabase
        .from("product_media")
        .select("media_library_id,media:media_library!product_media_media_library_id_fkey(media_type)")
        .eq("product_id", productId)
        .order("sort_order")
        .limit(1000);
      if (nextError) throw nextError;
      const next = (nextPrimary || []).find((row) =>
        one(row.media as { media_type: ProductMediaType } | { media_type: ProductMediaType }[])?.media_type === "image"
      );
      if (next) {
        const { error: primaryError } = await supabase
          .from("product_media")
          .update({ is_primary: true })
          .eq("product_id", productId)
          .eq("media_library_id", next.media_library_id);
        if (primaryError) throw primaryError;
      }
    }
    await audit(actorId, "product_media.unassigned", mediaId, { productId });
    return { cleanupPending: 0 };
  }

  function getUploadLimits(): CloudinaryUploadLimits {
    return {
      configured: cloudinary.configured,
      imageMaxBytes: cloudinary.imageMaxBytes,
      videoMaxBytes: cloudinary.videoMaxBytes,
      imageMimeTypes: IMAGE_MIME_TYPES,
      videoMimeTypes: VIDEO_MIME_TYPES,
    };
  }

  return {
    configured: cloudinary.configured,
    uploadMiddleware,
    getUploadLimits,
    uploadLibraryMedia,
    replaceLibraryMedia,
    listAllMedia,
    deleteLibraryMedia,
    retryLibraryMediaCleanup,
    updateLibraryMedia,
    addProductMedia,
    listProductMedia,
    updateProductMedia,
    removeProductMedia,
  };
}
