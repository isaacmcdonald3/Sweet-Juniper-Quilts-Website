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
