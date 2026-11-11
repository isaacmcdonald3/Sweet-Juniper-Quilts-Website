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
