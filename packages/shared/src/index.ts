export interface StorefrontCategory {
  id: string;
  name: string;
  slug: string;
}

export interface StorefrontProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  media: Array<{
    url: string;
    altText: string | null;
  }>;
}

export interface StorefrontBootstrap {
  shopName: string;
  welcomeMessage: string;
  categories: StorefrontCategory[];
  featuredProducts: StorefrontProduct[];
}

export interface CatalogCategory extends StorefrontCategory {
  description: string | null;
}

export type ProductFulfillmentType = "ready_to_ship" | "made_to_order";
export type ProductMediaType = "image" | "video";

export interface CatalogProductMedia {
  id: string;
  cloudinaryAssetId: string;
  mediaType: ProductMediaType;
  url: string;
  altText: string | null;
  posterUrl: string | null;
  isPrimary: boolean;
  sortOrder: number;
}

export interface CatalogProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  subcategory: string | null;
  categoryId: string | null;
  category: CatalogCategory | null;
  inventoryQuantity: number;
  fulfillmentType: ProductFulfillmentType;
  isFeatured: boolean;
  media: CatalogProductMedia[];
}

export interface ProductListFilters {
  categoryId?: string;
  featured?: boolean;
}

export interface StorefrontHomepage {
  content: Record<string, unknown>;
  categories: CatalogCategory[];
  featuredProducts: CatalogProduct[];
  mediaLibrary?: CatalogProductMedia[];
  publishedSections?: Record<string, boolean>;
}

export interface AdminProductMedia extends CatalogProductMedia {
  productId: string;
  productName: string;
  cloudinaryPublicId: string;
  posterCloudinaryAssetId: string | null;
  posterCloudinaryPublicId: string | null;
  deletedAt: string | null;
  cleanupPendingAssets: Array<
    | { publicId: string; resourceType: "image" | "video" }
    | { assetId: string; resourceType: "image" | "video" }
  >;
}

export interface AdminHomepageMedia extends CatalogProductMedia {
  deletedAt: string | null;
  cleanupPendingAssets: Array<
    | { publicId: string; resourceType: "image" | "video" }
    | { assetId: string; resourceType: "image" | "video" }
  >;
}

export interface CloudinaryUploadLimits {
  configured: boolean;
  imageMaxBytes: number;
  videoMaxBytes: number;
  imageMimeTypes: string[];
  videoMimeTypes: string[];
}

export interface AdminProduct extends CatalogProduct {
  isPublished: boolean;
  archivedAt: string | null;
  lowInventoryThreshold: number;
  createdAt: string;
}

export interface AdminCategory extends CatalogCategory {
  isPublished: boolean;
  sortOrder: number;
}

export interface AdminOrderSummary {
  id: string;
  orderNumber: number;
  status: string;
  paymentStatus: string;
  customerName: string;
  customerEmail: string;
  totalAmount: number;
  currency: string;
  fulfillmentStatus: string;
  createdAt: string;
}

export interface AdminEmailLog {
  id: string;
  recipient: string | null;
  recipientRole: "customer" | "owner";
  templateKey: string;
  status: "queued" | "sending" | "sent" | "delivered" | "failed" | "bounced" | "complained";
  relatedOrderId: string | null;
  orderNumber: number | null;
  providerMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  cycleAttemptCount: number;
  manualRetryCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  sentAt: string | null;
  errorDetails: string | null;
  retryable: boolean;
}

export interface AdminOrder extends AdminOrderSummary {
  shippingAddress: Record<string, unknown>;
  shippingCarrier: string | null;
  trackingNumber: string | null;
  subtotal: number;
  shippingAmount: number;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  items: Array<{
    id: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  payments: Array<{
    id: string;
    provider: string;
    providerOrderId: string | null;
    providerTransactionId: string | null;
    status: string;
    refundStatus: string;
    amount: number;
    currency: string;
    createdAt: string;
  }>;
}

export interface AdminOverview {
  publishedProductCount: number;
  totalOrderCount: number;
  recentOrders: AdminOrderSummary[];
  inventoryAlerts: AdminProduct[];
}

export interface AdminHomepageContent {
  contentKey: string;
  content: unknown;
  isPublished: boolean;
}
