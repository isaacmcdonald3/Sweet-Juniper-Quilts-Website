import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import type { Logger } from "pino";

export type CloudinaryResourceType = "image" | "video";

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
export const VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

export interface CloudinaryAsset {
  assetId: string;
  publicId: string;
  secureUrl: string;
  bytes: number;
  resourceType: CloudinaryResourceType;
}

export interface CloudinaryMediaClient {
  readonly configured: boolean;
  readonly imageMaxBytes: number;
  readonly videoMaxBytes: number;
  upload(
    buffer: Buffer,
    mimeType: string,
    resourceType: CloudinaryResourceType,
    folder: string,
  ): Promise<CloudinaryAsset>;
  delete(publicId: string, resourceType: CloudinaryResourceType): Promise<void>;
  deleteByAssetId(assetId: string, resourceType: CloudinaryResourceType): Promise<void>;
  deliveryUrl(publicId: string, resourceType: CloudinaryResourceType): string;
}

export interface CloudinaryCredentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  imageMaxBytes: number;
  videoMaxBytes: number;
}

export interface CloudinaryUploadLimitsConfig {
  imageMaxBytes: number;
  videoMaxBytes: number;
}

export class CloudinaryUnavailableError extends Error {}
export class UploadValidationError extends Error {}

function allowedMimeTypes(resourceType: CloudinaryResourceType): string[] {
  return resourceType === "image" ? IMAGE_MIME_TYPES : VIDEO_MIME_TYPES;
}

function allowedFormats(resourceType: CloudinaryResourceType): string[] {
  return resourceType === "image" ? ["jpg", "jpeg", "png", "webp", "avif"] : ["mp4", "webm", "mov"];
}

export function createCloudinaryService(
  credentials: CloudinaryCredentials | undefined,
  logger: Logger,
  limits?: CloudinaryUploadLimitsConfig,
): CloudinaryMediaClient {
  if (credentials) {
    cloudinary.config({
      cloud_name: credentials.cloudName,
      api_key: credentials.apiKey,
      api_secret: credentials.apiSecret,
      secure: true,
    });
  }

  const imageMaxBytes = credentials?.imageMaxBytes ?? limits?.imageMaxBytes ?? 15_000_000;
  const videoMaxBytes = credentials?.videoMaxBytes ?? limits?.videoMaxBytes ?? 90_000_000;

  return {
    configured: Boolean(credentials),
    imageMaxBytes,
    videoMaxBytes,
    async upload(buffer, mimeType, resourceType, folder) {
      if (!credentials) throw new CloudinaryUnavailableError("Cloudinary uploads are not configured.");
      if (!allowedMimeTypes(resourceType).includes(mimeType)) {
        throw new UploadValidationError("This file format is not supported.");
      }

      const maxBytes = resourceType === "image" ? imageMaxBytes : videoMaxBytes;
      if (buffer.byteLength > maxBytes) {
        throw new UploadValidationError(
          `This file is larger than the ${resourceType} upload limit of ${maxBytes} bytes.`,
        );
      }

      return new Promise<CloudinaryAsset>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: resourceType,
            folder,
            public_id: randomUUID(),
            allowed_formats: allowedFormats(resourceType),
            overwrite: false,
            unique_filename: false,
          },
          (error, result) => {
            if (error || !result?.asset_id || !result.secure_url || !result.public_id) {
              logger.error({ err: error, resourceType, folder }, "Cloudinary upload failed");
              reject(new CloudinaryUnavailableError("The media upload could not be completed."));
              return;
            }
            resolve({
              assetId: result.asset_id,
              publicId: result.public_id,
              secureUrl: result.secure_url,
              bytes: result.bytes,
              resourceType,
            });
          },
        );
        stream.end(buffer);
      });
    },
    async delete(publicId, resourceType) {
      if (!credentials) throw new CloudinaryUnavailableError("Cloudinary uploads are not configured.");
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        invalidate: true,
      });
      if (result.result !== "ok" && result.result !== "not found") {
        throw new CloudinaryUnavailableError("The media cleanup could not be completed.");
      }
    },
    async deleteByAssetId(assetId, resourceType) {
      if (!credentials) throw new CloudinaryUnavailableError("Cloudinary uploads are not configured.");
      const response = await cloudinary.api.delete_resources_by_asset_ids([assetId], {
        resource_type: resourceType,
        invalidate: true,
      });
      const deletionResponse = response as typeof response & { deleted?: Record<string, string> };
      const result = deletionResponse.deleted?.[assetId];
      if (result !== "deleted" && result !== "not_found" && result !== "not found") {
        throw new CloudinaryUnavailableError("The media cleanup could not be completed.");
      }
    },
    deliveryUrl(publicId, resourceType) {
      if (!credentials) return "";
      return cloudinary.url(publicId, {
        secure: true,
        resource_type: resourceType,
        transformation:
          resourceType === "image"
            ? {
                quality: "auto",
                fetch_format: "auto",
                width: 1600,
                height: 1600,
                crop: "limit",
              }
            : { quality: "auto" },
      });
    },
  };
}
