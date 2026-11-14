import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CatalogCategory,
  CatalogProduct,
  ProductListFilters,
  StorefrontBootstrap,
  StorefrontHomepage,
} from "@sweet-juniper/shared";
import type { AdminHomepageMedia } from "@sweet-juniper/shared";
import type { CloudinaryMediaClient } from "./cloudinary-service.js";

const productSelection =
  "id,name,slug,description,price,category_id,subcategory,inventory_quantity,fulfillment_type,is_featured,categories(id,name,slug,description),product_media(id,media_type,cloudinary_asset_id,cloudinary_public_id,media_url,alt_text,is_primary,sort_order,poster_cloudinary_asset_id,poster_cloudinary_public_id,poster_url,deleted_at)";

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
  category_id: string | null;
  subcategory: string | null;
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
  }> | null;
}, cloudinary?: CloudinaryMediaClient): CatalogProduct {
  const media = (row.product_media || [])
    .filter((item) => !item.deleted_at)
    .map((item) => ({
      id: item.id,
      cloudinaryAssetId: item.cloudinary_asset_id,
      mediaType: item.media_type,
      url: item.cloudinary_public_id
        ? cloudinary?.deliveryUrl(item.cloudinary_public_id, item.media_type) || item.media_url
        : item.media_url,
      altText: item.alt_text,
      posterUrl: item.poster_cloudinary_asset_id
        ? item.poster_cloudinary_public_id
          ? cloudinary?.deliveryUrl(item.poster_cloudinary_public_id, "image") || item.poster_url
          : item.poster_url
        : null,
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
    subcategory: row.subcategory,
    categoryId: row.category_id,
    category: category ? mapCategory(category) : null,
    inventoryQuantity: row.inventory_quantity,
    fulfillmentType: row.fulfillment_type,
    isFeatured: row.is_featured,
    media,
  };
}

export function createStorefrontService(
  supabase: SupabaseClient,
  cloudinary?: CloudinaryMediaClient,
) {
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
      .eq("fulfillment_type", "ready_to_ship")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
    if (filters.featured !== undefined) query = query.eq("is_featured", filters.featured);

    const { data, error } = await query;
    if (error) throw error;
    return data.map((row) => mapProduct(row, cloudinary));
  }

  async function getProduct(slug: string): Promise<CatalogProduct | null> {
    const { data, error } = await supabase
      .from("products")
      .select(productSelection)
      .eq("slug", slug)
      .eq("is_published", true)
      .eq("fulfillment_type", "ready_to_ship")
      .is("archived_at", null)
      .maybeSingle();
    if (error) throw error;
    return data ? mapProduct(data, cloudinary) : null;
  }

  async function loadHomepage(): Promise<StorefrontHomepage> {
    const [categories, products, contentResult, homepageMediaResult] = await Promise.all([
      listCategories(),
      listProducts(),
      supabase
        .from("homepage_content")
        .select("content_key,content,is_published"),
      supabase
        .from("homepage_media")
        .select("id,media_type,cloudinary_asset_id,cloudinary_public_id,media_url,alt_text")
        .order("created_at", { ascending: false }),
    ]);

    if (contentResult.error) throw contentResult.error;
    if (homepageMediaResult.error) throw homepageMediaResult.error;
    const content = Object.fromEntries(
      contentResult.data
        .filter((row) => row.is_published)
        .map((row) => [row.content_key, row.content as unknown]),
    );
    const publishedSections = Object.fromEntries(
      contentResult.data.map((row) => [row.content_key, row.is_published]),
    );
    return {
      content,
      categories,
      featuredProducts: products.filter((product) => product.isFeatured),
      mediaLibrary: [
        ...products.flatMap((product) => product.media),
        ...(homepageMediaResult.data as Array<{
          id: string;
          media_type: "image" | "video";
          cloudinary_asset_id: string;
          cloudinary_public_id: string;
          media_url: string;
          alt_text: string | null;
        }>).map((item): AdminHomepageMedia => ({
          id: item.id,
          cloudinaryAssetId: item.cloudinary_asset_id,
          mediaType: item.media_type,
          url: cloudinary?.deliveryUrl(item.cloudinary_public_id, item.media_type) || item.media_url,
          altText: item.alt_text,
          posterUrl: null,
          isPrimary: false,
          sortOrder: 0,
        })),
      ],
      publishedSections,
    };
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
