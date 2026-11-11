import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CatalogCategory,
  CatalogProduct,
  ProductListFilters,
  StorefrontBootstrap,
  StorefrontHomepage,
} from "@sweet-juniper/shared";

const productSelection =
  "id,name,slug,description,price,sku,category_id,inventory_quantity,fulfillment_type,is_featured,categories(id,name,slug,description),product_media(id,media_type,media_url,alt_text,is_primary,sort_order)";

function mapCategory(category: {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}): CatalogCategory {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
  };
}

function mapProduct(row: {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number | string;
  sku: string;
  category_id: string | null;
  inventory_quantity: number;
  fulfillment_type: "ready_to_ship" | "made_to_order";
  is_featured: boolean;
  categories: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
  } | Array<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
  }> | null;
  product_media: Array<{
    id: string;
    media_type: "image" | "video";
    media_url: string;
    alt_text: string | null;
    is_primary: boolean;
    sort_order: number;
  }> | null;
}): CatalogProduct {
  const media = (row.product_media || [])
    .map((item) => ({
      id: item.id,
      mediaType: item.media_type,
      url: item.media_url,
      altText: item.alt_text,
      isPrimary: item.is_primary,
      sortOrder: item.sort_order,
    }))
    .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || left.sortOrder - right.sortOrder);
  const category = Array.isArray(row.categories) ? row.categories[0] : row.categories;

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description || "",
    price: Number(row.price),
    sku: row.sku,
    categoryId: row.category_id,
    category: category ? mapCategory(category) : null,
    inventoryQuantity: row.inventory_quantity,
    fulfillmentType: row.fulfillment_type,
    isFeatured: row.is_featured,
    media,
  };
}

export function createStorefrontService(supabase: SupabaseClient) {
  async function checkDatabase(): Promise<boolean> {
    const { error } = await supabase.from("products").select("id", { head: true, count: "exact" }).limit(0);
    return !error;
  }

  async function listCategories(): Promise<CatalogCategory[]> {
    const { data, error } = await supabase
      .from("categories")
      .select("id,name,slug,description")
      .eq("is_published", true)
      .order("sort_order");
    if (error) throw error;
    return data.map(mapCategory);
  }

  async function listProducts(filters: ProductListFilters = {}): Promise<CatalogProduct[]> {
    let query = supabase
      .from("products")
      .select(productSelection)
      .eq("is_published", true)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
    if (filters.featured !== undefined) query = query.eq("is_featured", filters.featured);

    const { data, error } = await query;
    if (error) throw error;
    return data.map(mapProduct);
  }

  async function getProduct(slug: string): Promise<CatalogProduct | null> {
    const { data, error } = await supabase
      .from("products")
      .select(productSelection)
      .eq("slug", slug)
      .eq("is_published", true)
      .is("archived_at", null)
      .maybeSingle();
    if (error) throw error;
    return data ? mapProduct(data) : null;
  }

  async function loadHomepage(): Promise<StorefrontHomepage> {
    const [categories, featuredProducts, contentResult] = await Promise.all([
      listCategories(),
      listProducts({ featured: true }),
      supabase
        .from("homepage_content")
        .select("content_key,content")
        .eq("is_published", true),
    ]);

    if (contentResult.error) throw contentResult.error;
    const content = Object.fromEntries(
      contentResult.data.map((row) => [row.content_key, row.content as unknown]),
    );
    return { content, categories, featuredProducts };
  }

  async function loadBootstrap(): Promise<StorefrontBootstrap> {
    const [categories, featuredProducts, welcomeResult] = await Promise.all([
      listCategories(),
      listProducts({ featured: true }),
      supabase
        .from("homepage_content")
        .select("content")
        .eq("content_key", "welcome")
        .eq("is_published", true)
        .maybeSingle(),
    ]);

    if (welcomeResult.error) throw welcomeResult.error;
    const welcome = welcomeResult.data?.content;
    return {
      shopName: "Sweet Juniper Quilts",
      welcomeMessage: typeof welcome === "string" ? welcome : "A little warmth, stitched to last.",
      categories: categories.map(({ id, name, slug }) => ({ id, name, slug })),
      featuredProducts: featuredProducts.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        currency: "USD",
        media: product.media.map(({ url, altText }) => ({ url, altText })),
      })),
    };
  }

  return { checkDatabase, listCategories, listProducts, getProduct, loadHomepage, loadBootstrap };
}
