import multer from "multer";
import type { RequestHandler } from "express";
import type { Logger } from "pino";
import type { AdminHomepageMedia, AdminProductMedia, CloudinaryUploadLimits } from "@sweet-juniper/shared";
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

interface ProductMediaRow {
  id: string;
  product_id: string;
  media_type: CloudinaryResourceType;
  cloudinary_asset_id: string;
  cloudinary_public_id: string | null;
  media_url: string;
  alt_text: string | null;
  is_primary: boolean;
  sort_order: number;
  poster_cloudinary_asset_id: string | null;
  poster_cloudinary_public_id: string | null;
  poster_url: string | null;
  deleted_at: string | null;
  cleanup_pending_assets: PendingAsset[] | null;
  products?: { name: string } | Array<{ name: string }> | null;
}

interface HomepageMediaRow {
  id: string;
  media_type: CloudinaryResourceType;
  cloudinary_asset_id: string;
  cloudinary_public_id: string;
  media_url: string;
  alt_text: string | null;
  created_at: string;
  deleted_at: string | null;
  cleanup_pending_assets: PendingAsset[] | null;
}

interface UploadFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export class MediaNotFoundError extends Error {}
export class MediaConflictError extends Error {}

const mediaSelection =
  "id,product_id,media_type,cloudinary_asset_id,cloudinary_public_id,media_url,alt_text,is_primary,sort_order,poster_cloudinary_asset_id,poster_cloudinary_public_id,poster_url,deleted_at,cleanup_pending_assets,products(name)";

function getPendingAssets(value: PendingAsset[] | null): PendingAsset[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (asset): asset is PendingAsset =>
      ((asset && "publicId" in asset && typeof asset.publicId === "string") ||
        (asset && "assetId" in asset && typeof asset.assetId === "string")) &&
      (asset.resourceType === "image" || asset.resourceType === "video"),
  );
}

function mapMedia(
  row: ProductMediaRow,
  cloudinary: CloudinaryMediaClient,
  productName?: string,
): AdminProductMedia {
  const product = Array.isArray(row.products) ? row.products[0] : row.products;
  return {
    id: row.id,
    productId: row.product_id,
    productName: productName || product?.name || "",
    cloudinaryAssetId: row.cloudinary_asset_id,
    cloudinaryPublicId: row.cloudinary_public_id || "",
    mediaType: row.media_type,
    url: row.cloudinary_public_id
      ? cloudinary.deliveryUrl(row.cloudinary_public_id, row.media_type) || row.media_url
      : row.media_url,
    altText: row.alt_text,
    posterCloudinaryAssetId: row.poster_cloudinary_asset_id,
    posterCloudinaryPublicId: row.poster_cloudinary_public_id,
    posterUrl: row.poster_cloudinary_asset_id
      ? row.poster_cloudinary_public_id
        ? cloudinary.deliveryUrl(row.poster_cloudinary_public_id, "image") || row.poster_url
        : row.poster_url
      : row.poster_url,
    isPrimary: row.is_primary,
    sortOrder: row.sort_order,
    deletedAt: row.deleted_at,
    cleanupPendingAssets: getPendingAssets(row.cleanup_pending_assets),
  };
}

function mapHomepageMedia(row: HomepageMediaRow, cloudinary: CloudinaryMediaClient): AdminHomepageMedia {
  return {
    id: row.id,
    cloudinaryAssetId: row.cloudinary_asset_id,
    mediaType: row.media_type,
    url: cloudinary.deliveryUrl(row.cloudinary_public_id, row.media_type) || row.media_url,
    altText: row.alt_text,
    posterUrl: null,
    isPrimary: false,
    sortOrder: 0,
    deletedAt: row.deleted_at,
    cleanupPendingAssets: getPendingAssets(row.cleanup_pending_assets),
  };
}

function contentContainsReference(value: unknown, references: Set<string>): boolean {
  if (typeof value === "string") return references.has(value);
  if (Array.isArray(value)) return value.some((entry) => contentContainsReference(entry, references));
  if (value && typeof value === "object") {
    return Object.values(value).some((entry) => contentContainsReference(entry, references));
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

  async function getActiveMedia(productId: string, mediaId: string): Promise<ProductMediaRow | null> {
    const { data, error } = await supabase
      .from("product_media")
      .select(mediaSelection)
      .eq("product_id", productId)
      .eq("id", mediaId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    return data as ProductMediaRow | null;
  }

  async function audit(
    actorId: string,
    action: string,
    mediaId: string,
    details: Record<string, unknown> = {},
    entityType = "product_media",
  ): Promise<void> {
    const { error } = await supabase.from("admin_audit_logs").insert({
      actor_user_id: actorId,
      action,
      entity_type: entityType,
      entity_id: mediaId,
      details,
    });
    if (error) throw error;
  }

  async function retryCleanup(row: ProductMediaRow): Promise<number> {
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
            ...( "publicId" in asset ? { publicId: asset.publicId } : { assetId: asset.assetId }),
          },
          "Cloudinary asset cleanup remains pending",
        );
        remaining.push(asset);
      }
    }

    if (remaining.length !== pending.length) {
      const { error } = await supabase
        .from("product_media")
        .update({ cleanup_pending_assets: remaining })
        .eq("id", row.id);
      if (error) throw error;
    }
    return remaining.length;
  }

  async function removeUploadedAsset(publicId: string, resourceType: CloudinaryResourceType) {
    try {
      await cloudinary.delete(publicId, resourceType);
    } catch (error) {
      logger.error({ err: error, publicId }, "Unattached Cloudinary upload could not be removed");
    }
  }

  async function uploadProductMedia(
    actorId: string,
    productId: string,
    file: UploadFile,
    mediaType: CloudinaryResourceType,
    altText: string | null,
    replaceMediaId?: string,
  ) {
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id,name")
      .eq("id", productId)
      .maybeSingle();
    if (productError) throw productError;
    if (!product) throw new MediaNotFoundError("Product not found.");

    if ((mediaType === "image" && !IMAGE_MIME_TYPES.includes(file.mimetype)) ||
        (mediaType === "video" && !VIDEO_MIME_TYPES.includes(file.mimetype))) {
      throw new UploadValidationError("The selected file type does not match the media type.");
    }
    const limit = mediaType === "image" ? cloudinary.imageMaxBytes : cloudinary.videoMaxBytes;
    if (file.size > limit) {
      throw new UploadValidationError(`This file exceeds the ${mediaType} upload size limit.`);
    }

    const existing = replaceMediaId ? await getActiveMedia(productId, replaceMediaId) : null;
    if (replaceMediaId && !existing) throw new MediaNotFoundError("Product media not found.");
    if (existing && existing.media_type !== mediaType) {
      throw new MediaConflictError("Replacement media must use the same media type.");
    }
    if (existing) await assertNotReferenced(existing);

    const uploaded = await cloudinary.upload(
      file.buffer,
      file.mimetype,
      mediaType,
      `sweet-juniper/products/${productId}`,
    );
    const oldAssets: PendingAsset[] = existing
      ? [
          ...getPendingAssets(existing.cleanup_pending_assets),
          existing.cloudinary_public_id
            ? { publicId: existing.cloudinary_public_id, resourceType: existing.media_type }
            : { assetId: existing.cloudinary_asset_id, resourceType: existing.media_type },
        ]
      : [];
    let row: ProductMediaRow | null = null;
    try {
      if (existing) {
        const { data, error } = await supabase
          .from("product_media")
          .update({
            cloudinary_asset_id: uploaded.assetId,
            cloudinary_public_id: uploaded.publicId,
            media_url: uploaded.secureUrl,
            alt_text: altText ?? existing.alt_text,
            cleanup_pending_assets: oldAssets,
          })
          .eq("id", existing.id)
          .select(mediaSelection)
          .single();
        if (error) throw error;
        row = data as ProductMediaRow;
      } else {
        const { data: currentMedia, error: currentError } = await supabase
          .from("product_media")
          .select("sort_order,is_primary")
          .eq("product_id", productId)
          .is("deleted_at", null)
          .order("sort_order", { ascending: false })
          .limit(1000);
        if (currentError) throw currentError;

        const isPrimary =
          mediaType === "image" && !(currentMedia || []).some((item) => item.is_primary);
        const { data, error } = await supabase
          .from("product_media")
          .insert({
            product_id: productId,
            media_type: mediaType,
            cloudinary_asset_id: uploaded.assetId,
            cloudinary_public_id: uploaded.publicId,
            media_url: uploaded.secureUrl,
            alt_text: altText,
            is_primary: isPrimary,
            sort_order: currentMedia?.length ? currentMedia[0].sort_order + 1 : 0,
          })
          .select(mediaSelection)
          .single();
        if (error) throw error;
        row = data as ProductMediaRow;
      }
    } catch (error) {
      await removeUploadedAsset(uploaded.publicId, mediaType);
      throw error;
    }

    if (!row) throw new Error("The uploaded media could not be saved.");
    await audit(actorId, existing ? "product_media.replaced" : "product_media.uploaded", row.id, {
      productId,
      mediaType,
    });
    const cleanupPending = await retryCleanup(row);
    if (cleanupPending > 0) {
      const { data, error } = await supabase
        .from("product_media")
        .select(mediaSelection)
        .eq("id", row.id)
        .single();
      if (error) throw error;
      row = data as ProductMediaRow;
    }
    return { media: mapMedia(row, cloudinary, product.name), cleanupPending };
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
      .select(mediaSelection)
      .eq("product_id", productId)
      .order("is_primary", { ascending: false })
      .order("sort_order")
      .order("created_at");
    if (error) throw error;
    return (data as ProductMediaRow[]).map((row) => mapMedia(row, cloudinary, product.name));
  }

  async function listAllMedia(): Promise<AdminProductMedia[]> {
    const { data, error } = await supabase
      .from("product_media")
      .select(mediaSelection)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw error;
    return (data as ProductMediaRow[]).map((row) => mapMedia(row, cloudinary));
  }

  async function listHomepageMedia(): Promise<AdminHomepageMedia[]> {
    const { data, error } = await supabase
      .from("homepage_media")
      .select("id,media_type,cloudinary_asset_id,cloudinary_public_id,media_url,alt_text,created_at,deleted_at,cleanup_pending_assets")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw error;
    return (data as HomepageMediaRow[]).map((row) => mapHomepageMedia(row, cloudinary));
  }

  async function cleanupHomepageMedia(row: HomepageMediaRow): Promise<number> {
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
          "Homepage Cloudinary asset cleanup remains pending",
        );
        remaining.push(asset);
      }
    }

    if (remaining.length > 0) {
      if (remaining.length !== pending.length) {
        const { error } = await supabase
          .from("homepage_media")
          .update({ cleanup_pending_assets: remaining })
          .eq("id", row.id);
        if (error) throw error;
      }
      return remaining.length;
    }

    const { error } = await supabase.from("homepage_media").delete().eq("id", row.id);
    if (error) throw error;
    return 0;
  }

  async function uploadHomepageMedia(
    actorId: string,
    file: UploadFile,
    mediaType: CloudinaryResourceType,
    altText: string | null,
  ): Promise<AdminHomepageMedia> {
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
      "sweet-juniper/homepage",
    );
    let row: HomepageMediaRow;
    try {
      const { data, error } = await supabase
        .from("homepage_media")
        .insert({
          media_type: uploaded.resourceType,
          cloudinary_asset_id: uploaded.assetId,
          cloudinary_public_id: uploaded.publicId,
          media_url: uploaded.secureUrl,
          alt_text: altText,
        })
        .select("id,media_type,cloudinary_asset_id,cloudinary_public_id,media_url,alt_text,created_at,deleted_at,cleanup_pending_assets")
        .single();
      if (error) throw error;
      row = data as HomepageMediaRow;
    } catch (error) {
      await removeUploadedAsset(uploaded.publicId, mediaType);
      throw error;
    }

    await audit(actorId, "homepage_media.uploaded", row.id, { mediaType }, "homepage_media");
    return mapHomepageMedia(row, cloudinary);
  }

  async function removeHomepageMedia(actorId: string, mediaId: string): Promise<{ cleanupPending: number }> {
    const selection = "id,media_type,cloudinary_asset_id,cloudinary_public_id,media_url,alt_text,created_at,deleted_at,cleanup_pending_assets";
    const { data, error } = await supabase
      .from("homepage_media")
      .select(selection)
      .eq("id", mediaId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new MediaNotFoundError("Homepage media not found.");
    let row = data as HomepageMediaRow;

    if (!row.deleted_at) {
      const { data: content, error: contentError } = await supabase
        .from("homepage_content")
        .select("content");
      if (contentError) throw contentError;
      const references = new Set([row.id, row.cloudinary_asset_id, row.cloudinary_public_id]);
      if (contentContainsReference(content, references)) {
        throw new MediaConflictError("This media is selected on the homepage. Choose another before deleting it.");
      }

      const assets: PendingAsset[] = [
        ...getPendingAssets(row.cleanup_pending_assets),
        { publicId: row.cloudinary_public_id, resourceType: row.media_type },
      ];
      const { data: removed, error: updateError } = await supabase
        .from("homepage_media")
        .update({
          deleted_at: new Date().toISOString(),
          cleanup_pending_assets: assets,
        })
        .eq("id", mediaId)
        .select(selection)
        .single();
      if (updateError) throw updateError;
      row = removed as HomepageMediaRow;
      await audit(actorId, "homepage_media.removed", mediaId, {}, "homepage_media");
    }

    return { cleanupPending: await cleanupHomepageMedia(row) };
  }

  async function retryHomepageMediaCleanup(actorId: string, mediaId: string): Promise<{ cleanupPending: number }> {
    const selection = "id,media_type,cloudinary_asset_id,cloudinary_public_id,media_url,alt_text,created_at,deleted_at,cleanup_pending_assets";
    const { data, error } = await supabase
      .from("homepage_media")
      .select(selection)
      .eq("id", mediaId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new MediaNotFoundError("Homepage media not found.");
    const row = data as HomepageMediaRow;
    if (!row.deleted_at) {
      throw new MediaConflictError("Homepage media cleanup can only be retried after the asset is removed.");
    }
    const cleanupPending = await cleanupHomepageMedia(row);
    await audit(actorId, "homepage_media.cleanup_retried", mediaId, { cleanupPending }, "homepage_media");
    return { cleanupPending };
  }

  async function updateProductMedia(
    actorId: string,
    productId: string,
    mediaId: string,
    changes: { altText?: string | null; sortOrder?: number; isPrimary?: boolean },
  ) {
    const current = await getActiveMedia(productId, mediaId);
    if (!current) throw new MediaNotFoundError("Product media not found.");
    if (changes.isPrimary && current.media_type !== "image") {
      throw new MediaConflictError("A video cannot be the primary product image.");
    }

    if (changes.isPrimary) {
      const { error: clearError } = await supabase
        .from("product_media")
        .update({ is_primary: false })
        .eq("product_id", productId)
        .eq("media_type", "image")
        .is("deleted_at", null);
      if (clearError) throw clearError;
    }
    const update = {
      ...(changes.altText === undefined ? {} : { alt_text: changes.altText }),
      ...(changes.sortOrder === undefined ? {} : { sort_order: changes.sortOrder }),
      ...(changes.isPrimary === undefined ? {} : { is_primary: changes.isPrimary }),
    };
    const { data, error } = await supabase
      .from("product_media")
      .update(update)
      .eq("id", mediaId)
      .eq("product_id", productId)
      .is("deleted_at", null)
      .select(mediaSelection)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new MediaNotFoundError("Product media not found.");
    await audit(actorId, "product_media.updated", mediaId, changes);
    return mapMedia(data as ProductMediaRow, cloudinary);
  }

  async function assertNotReferenced(media: ProductMediaRow): Promise<void> {
    const { data, error } = await supabase
      .from("homepage_content")
      .select("content");
    if (error) throw error;
    const references = new Set([
      media.id,
      media.cloudinary_asset_id,
      media.cloudinary_public_id || media.cloudinary_asset_id,
    ]);
    if (
      media.poster_cloudinary_asset_id &&
      contentContainsReference(
        data,
        new Set([
          media.poster_cloudinary_asset_id,
          media.poster_cloudinary_public_id || media.poster_cloudinary_asset_id,
        ]),
      )
    ) {
      throw new MediaConflictError("This media's poster is selected on the homepage. Choose another first.");
    }
    if (contentContainsReference(data, references)) {
      throw new MediaConflictError("This media is selected on the homepage. Choose another before removing it.");
    }
  }

  async function removeProductMedia(actorId: string, productId: string, mediaId: string) {
    const current = await getActiveMedia(productId, mediaId);
    if (!current) throw new MediaNotFoundError("Product media not found.");
    await assertNotReferenced(current);

    const assets: PendingAsset[] = [
      ...getPendingAssets(current.cleanup_pending_assets),
      current.cloudinary_public_id
        ? { publicId: current.cloudinary_public_id, resourceType: current.media_type }
        : { assetId: current.cloudinary_asset_id, resourceType: current.media_type },
      ...(current.poster_cloudinary_asset_id
        ? [current.poster_cloudinary_public_id
            ? { publicId: current.poster_cloudinary_public_id, resourceType: "image" as const }
            : { assetId: current.poster_cloudinary_asset_id, resourceType: "image" as const }]
        : []),
    ];
    const { data, error } = await supabase
      .from("product_media")
      .update({
        deleted_at: new Date().toISOString(),
        is_primary: false,
        cleanup_pending_assets: assets,
      })
      .eq("id", mediaId)
      .select(mediaSelection)
      .single();
    if (error) throw error;

    if (current.is_primary) {
      const { data: nextPrimary, error: nextError } = await supabase
        .from("product_media")
        .select("id")
        .eq("product_id", productId)
        .eq("media_type", "image")
        .is("deleted_at", null)
        .order("sort_order")
        .limit(1)
        .maybeSingle();
      if (nextError) throw nextError;
      if (nextPrimary) {
        const { error: primaryError } = await supabase
          .from("product_media")
          .update({ is_primary: true })
          .eq("id", nextPrimary.id);
        if (primaryError) throw primaryError;
      }
    }

    await audit(actorId, "product_media.removed", mediaId, { productId });
    return { cleanupPending: await retryCleanup(data as ProductMediaRow) };
  }

  async function setVideoPoster(
    actorId: string,
    productId: string,
    mediaId: string,
    file: UploadFile,
  ) {
    const current = await getActiveMedia(productId, mediaId);
    if (!current) throw new MediaNotFoundError("Product media not found.");
    if (current.media_type !== "video") {
      throw new MediaConflictError("A poster can only be added to a video.");
    }
    if (!IMAGE_MIME_TYPES.includes(file.mimetype) || file.size > cloudinary.imageMaxBytes) {
      throw new UploadValidationError("The poster must be a supported image within the image size limit.");
    }

    const uploaded = await cloudinary.upload(
      file.buffer,
      file.mimetype,
      "image",
      `sweet-juniper/products/${productId}/posters`,
    );
    const oldAssets = getPendingAssets(current.cleanup_pending_assets);
    if (current.poster_cloudinary_asset_id) {
      oldAssets.push({
        publicId: current.poster_cloudinary_public_id || current.poster_cloudinary_asset_id,
        resourceType: "image",
      });
    }
    let row: ProductMediaRow;
    try {
      const { data, error } = await supabase
        .from("product_media")
        .update({
          poster_cloudinary_asset_id: uploaded.assetId,
          poster_cloudinary_public_id: uploaded.publicId,
          poster_url: uploaded.secureUrl,
          cleanup_pending_assets: oldAssets,
        })
        .eq("id", mediaId)
        .select(mediaSelection)
        .single();
      if (error) throw error;
      row = data as ProductMediaRow;
    } catch (error) {
      await removeUploadedAsset(uploaded.publicId, "image");
      throw error;
    }
    await audit(actorId, "product_media.poster_updated", mediaId, { productId });
    const cleanupPending = await retryCleanup(row);
    if (cleanupPending > 0) {
      const { data, error } = await supabase
        .from("product_media")
        .select(mediaSelection)
        .eq("id", row.id)
        .single();
      if (error) throw error;
      row = data as ProductMediaRow;
    }
    return { media: mapMedia(row, cloudinary), cleanupPending };
  }

  async function removeVideoPoster(actorId: string, productId: string, mediaId: string) {
    const current = await getActiveMedia(productId, mediaId);
    if (!current) throw new MediaNotFoundError("Product media not found.");
    if (!current.poster_cloudinary_asset_id) return { cleanupPending: getPendingAssets(current.cleanup_pending_assets).length };

    const pending = [
      ...getPendingAssets(current.cleanup_pending_assets),
      current.poster_cloudinary_public_id
        ? { publicId: current.poster_cloudinary_public_id, resourceType: "image" as const }
        : { assetId: current.poster_cloudinary_asset_id, resourceType: "image" as const },
    ];
    const { data, error } = await supabase
      .from("product_media")
      .update({
        poster_cloudinary_asset_id: null,
        poster_cloudinary_public_id: null,
        poster_url: null,
        cleanup_pending_assets: pending,
      })
      .eq("id", mediaId)
      .select(mediaSelection)
      .single();
    if (error) throw error;
    await audit(actorId, "product_media.poster_removed", mediaId, { productId });
    return { cleanupPending: await retryCleanup(data as ProductMediaRow) };
  }

  async function retryProductMediaCleanup(actorId: string, mediaId: string) {
    const { data, error } = await supabase
      .from("product_media")
      .select(mediaSelection)
      .eq("id", mediaId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new MediaNotFoundError("Product media not found.");
    const row = data as ProductMediaRow;
    const cleanupPending = await retryCleanup(row);
    await audit(actorId, "product_media.cleanup_retried", mediaId, { cleanupPending });
    return { cleanupPending };
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
    uploadProductMedia,
    listProductMedia,
    listAllMedia,
    listHomepageMedia,
    uploadHomepageMedia,
    removeHomepageMedia,
    retryHomepageMediaCleanup,
    updateProductMedia,
    removeProductMedia,
    setVideoPoster,
    removeVideoPoster,
    retryProductMediaCleanup,
  };
}
