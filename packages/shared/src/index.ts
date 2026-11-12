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
  mediaType: ProductMediaType;
  url: string;
  altText: string | null;
  isPrimary: boolean;
  sortOrder: number;
}

export interface CatalogProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  sku: string;
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
  customerName: string;
  customerEmail: string;
  totalAmount: number;
  currency: string;
  fulfillmentStatus: string;
  createdAt: string;
}

export interface AdminOrder extends AdminOrderSummary {
  shippingAddress: Record<string, unknown>;
  shippingCarrier: string | null;
  trackingNumber: string | null;
  items: Array<{
    id: string;
    productName: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  payments: Array<{
    id: string;
    provider: string;
    status: string;
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
