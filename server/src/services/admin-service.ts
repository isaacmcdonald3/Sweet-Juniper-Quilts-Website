import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AdminCategory,
  AdminHomepageContent,
  AdminOrder,
  AdminOrderSummary,
  AdminOverview,
  AdminProduct,
} from "@sweet-juniper/shared";
import type { ProductFulfillmentType } from "@sweet-juniper/shared";

const productSelection =
  "id,name,slug,description,price,sku,category_id,inventory_quantity,low_inventory_threshold,fulfillment_type,is_featured,is_published,archived_at,created_at,categories(id,name,slug,description),product_media(id,media_type,cloudinary_asset_id,media_url,alt_text,is_primary,sort_order,poster_cloudinary_asset_id,poster_url,deleted_at,cleanup_pending_assets)";

export class AdminConflictError extends Error {}

interface ProductInput {
  name: string;
  description: string;
  price: number;
  sku: string;
  categoryId: string | null;
  inventoryQuantity: number;
  lowInventoryThreshold: number;
  fulfillmentType: ProductFulfillmentType;
  isPublished: boolean;
  isFeatured: boolean;
  isArchived: boolean;
}

interface CategoryInput {
  name: string;
  description: string | null;
  sortOrder: number;
  isPublished: boolean;
}

interface CategoryRelationRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

interface ProductMediaRow {
  id: string;
  media_type: "image" | "video";
  cloudinary_asset_id: string;
  media_url: string;
  alt_text: string | null;
  is_primary: boolean;
  sort_order: number;
  poster_cloudinary_asset_id: string | null;
  poster_url: string | null;
  deleted_at: string | null;
  cleanup_pending_assets: Array<
    | { publicId: string; resourceType: "image" | "video" }
    | { assetId: string; resourceType: "image" | "video" }
  > | null;
}

interface AdminProductRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number | string;
  sku: string;
  category_id: string | null;
  inventory_quantity: number;
  low_inventory_threshold: number;
  fulfillment_type: ProductFulfillmentType;
  is_featured: boolean;
  is_published: boolean;
  archived_at: string | null;
  created_at: string;
  categories: CategoryRelationRow | CategoryRelationRow[] | null;
  product_media: ProductMediaRow[] | null;
}

interface AdminCategoryRow extends CategoryRelationRow {
  sort_order: number;
  is_published: boolean;
}

interface AdminOrderRow {
  id: string;
  order_number: number;
  status: string;
  customer_name: string;
  customer_email: string;
  total_amount: number | string;
  currency: string;
  fulfillment_status: string;
  created_at: string;
}

interface AdminOrderDetailRow extends AdminOrderRow {
  shipping_address: Record<string, unknown>;
  shipping_carrier: string | null;
  tracking_number: string | null;
  order_items: Array<{
    id: string;
    product_name_snapshot: string;
    product_sku_snapshot: string;
    quantity: number;
    unit_price: number | string;
    line_total: number | string;
  }>;
  payments: Array<{
    id: string;
    provider: string;
    status: string;
    amount: number | string;
    currency: string;
    created_at: string;
  }>;
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 150)
    .replace(/-$/g, "");
  if (!slug) throw new Error("Unable to create a URL slug from the supplied name.");
  return slug;
}

function mapProduct(row: AdminProductRow): AdminProduct {
  const category = Array.isArray(row.categories) ? row.categories[0] : row.categories;
  const media = (row.product_media || [])
    .filter((item) => !item.deleted_at)
    .map((item) => ({
      id: item.id,
      cloudinaryAssetId: item.cloudinary_asset_id,
      mediaType: item.media_type,
      url: item.media_url,
      altText: item.alt_text,
      posterUrl: item.poster_url,
      isPrimary: item.is_primary,
      sortOrder: item.sort_order,
    }))
    .sort((left, right) =>
      Number(right.isPrimary) - Number(left.isPrimary) || left.sortOrder - right.sortOrder,
    );

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description || "",
    price: Number(row.price),
    sku: row.sku,
    categoryId: row.category_id,
    category: category
      ? {
          id: category.id,
          name: category.name,
          slug: category.slug,
          description: category.description,
        }
      : null,
    inventoryQuantity: row.inventory_quantity,
    lowInventoryThreshold: row.low_inventory_threshold,
    fulfillmentType: row.fulfillment_type,
    isFeatured: row.is_featured,
    isPublished: row.is_published,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    media,
  };
}

function mapCategory(row: AdminCategoryRow): AdminCategory {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sortOrder: row.sort_order,
    isPublished: row.is_published,
  };
}

function mapOrderSummary(row: AdminOrderRow): AdminOrderSummary {
  return {
    id: row.id,
    orderNumber: Number(row.order_number),
    status: row.status,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    totalAmount: Number(row.total_amount),
    currency: row.currency,
    fulfillmentStatus: row.fulfillment_status,
    createdAt: row.created_at,
  };
}

function toProductRow(input: ProductInput, slug?: string) {
  return {
    name: input.name,
    ...(slug ? { slug } : {}),
    description: input.description,
    price: input.price,
    sku: input.sku,
    category_id: input.categoryId,
    inventory_quantity: input.inventoryQuantity,
    low_inventory_threshold: input.lowInventoryThreshold,
    fulfillment_type: input.fulfillmentType,
    is_published: input.isArchived ? false : input.isPublished,
    is_featured: input.isFeatured,
    archived_at: input.isArchived ? new Date().toISOString() : null,
  };
}

export function createAdminService(supabase: SupabaseClient) {
  async function audit(actorId: string, action: string, entityType: string, entityId: string | null) {
    const { error } = await supabase.from("admin_audit_logs").insert({
      actor_user_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
    });
    if (error) throw error;
  }

  async function listProducts(): Promise<AdminProduct[]> {
    const { data, error } = await supabase
      .from("products")
      .select(productSelection)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw error;
    return data.map(mapProduct);
  }

  async function listCategories(): Promise<AdminCategory[]> {
    const { data, error } = await supabase
      .from("categories")
      .select("id,name,slug,description,sort_order,is_published")
      .order("sort_order")
      .order("name");
    if (error) throw error;
    return data.map(mapCategory);
  }

  async function listHomepageContent(): Promise<AdminHomepageContent[]> {
    const { data, error } = await supabase
      .from("homepage_content")
      .select("content_key,content,is_published")
      .order("content_key");
    if (error) throw error;
    return data.map((row) => ({
      contentKey: row.content_key,
      content: row.content,
      isPublished: row.is_published,
    }));
  }

  async function listRecentOrders(): Promise<{ count: number; orders: AdminOrderSummary[] }> {
    const [countResult, ordersResult] = await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }),
      supabase
        .from("orders")
        .select("id,order_number,status,customer_name,customer_email,total_amount,currency,fulfillment_status,created_at")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    if (countResult.error) throw countResult.error;
    if (ordersResult.error) throw ordersResult.error;
    return { count: countResult.count || 0, orders: ordersResult.data.map(mapOrderSummary) };
  }

  async function listOrders(): Promise<AdminOrderSummary[]> {
    const { data, error } = await supabase
      .from("orders")
      .select("id,order_number,status,customer_name,customer_email,total_amount,currency,fulfillment_status,created_at")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw error;
    return data.map(mapOrderSummary);
  }

  async function getOverview(): Promise<AdminOverview> {
    const [products, orderResult] = await Promise.all([listProducts(), listRecentOrders()]);
    return {
      publishedProductCount: products.filter((product) => product.isPublished && !product.archivedAt).length,
      totalOrderCount: orderResult.count,
      recentOrders: orderResult.orders,
      inventoryAlerts: products.filter(
        (product) =>
          product.fulfillmentType === "ready_to_ship" &&
          product.inventoryQuantity <= product.lowInventoryThreshold &&
          !product.archivedAt,
      ),
    };
  }

  async function getOrder(id: string): Promise<AdminOrder | null> {
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id,order_number,status,customer_name,customer_email,total_amount,currency,fulfillment_status,created_at,shipping_address,shipping_carrier,tracking_number,order_items(id,product_name_snapshot,product_sku_snapshot,quantity,unit_price,line_total),payments(id,provider,status,amount,currency,created_at)",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    return {
      ...mapOrderSummary(data),
      shippingAddress: data.shipping_address,
      shippingCarrier: data.shipping_carrier,
      trackingNumber: data.tracking_number,
      items: data.order_items.map((item) => ({
        id: item.id,
        productName: item.product_name_snapshot,
        sku: item.product_sku_snapshot,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price),
        lineTotal: Number(item.line_total),
      })),
      payments: data.payments.map((payment) => ({
        id: payment.id,
        provider: payment.provider,
        status: payment.status,
        amount: Number(payment.amount),
        currency: payment.currency,
        createdAt: payment.created_at,
      })),
    };
  }

  async function createProduct(actorId: string, input: ProductInput): Promise<AdminProduct> {
    const { data, error } = await supabase
      .from("products")
      .insert(toProductRow(input, slugify(input.name)))
      .select(productSelection)
      .single();
    if (error) throw error;
    await audit(actorId, "product.created", "product", data.id);
    return mapProduct(data);
  }

  async function updateProduct(
    actorId: string,
    id: string,
    input: ProductInput,
  ): Promise<AdminProduct | null> {
    const { data, error } = await supabase
      .from("products")
      .update(toProductRow(input))
      .eq("id", id)
      .select(productSelection)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    await audit(actorId, input.isArchived ? "product.archived" : "product.updated", "product", id);
    return mapProduct(data);
  }

  async function createCategory(actorId: string, input: CategoryInput): Promise<AdminCategory> {
    const { data, error } = await supabase
      .from("categories")
      .insert({
        name: input.name,
        slug: slugify(input.name),
        description: input.description,
        sort_order: input.sortOrder,
        is_published: input.isPublished,
      })
      .select("id,name,slug,description,sort_order,is_published")
      .single();
    if (error) throw error;
    await audit(actorId, "category.created", "category", data.id);
    return mapCategory(data);
  }

  async function updateCategory(
    actorId: string,
    id: string,
    input: CategoryInput,
  ): Promise<AdminCategory | null> {
    const { data, error } = await supabase
      .from("categories")
      .update({
        name: input.name,
        slug: slugify(input.name),
        description: input.description,
        sort_order: input.sortOrder,
        is_published: input.isPublished,
      })
      .eq("id", id)
      .select("id,name,slug,description,sort_order,is_published")
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    await audit(actorId, "category.updated", "category", id);
    return mapCategory(data);
  }

  async function deleteCategory(actorId: string, id: string): Promise<boolean> {
    const { count, error: countError } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("category_id", id);
    if (countError) throw countError;
    if (count) throw new AdminConflictError("This category still has products. Hide it instead or move its products first.");

    const { data, error } = await supabase
      .from("categories")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return false;
    await audit(actorId, "category.deleted", "category", id);
    return true;
  }

  async function saveHomepageContent(
    actorId: string,
    contentKey: string,
    content: unknown,
    isPublished: boolean,
  ): Promise<void> {
    const { error } = await supabase.from("homepage_content").upsert(
      { content_key: contentKey, content, is_published: isPublished },
      { onConflict: "content_key" },
    );
    if (error) throw error;
    await audit(actorId, "homepage_content.saved", "homepage_content", contentKey);
  }

  return {
    getOverview,
    getOrder,
    listOrders,
    listProducts,
    listCategories,
    listHomepageContent,
    createProduct,
    updateProduct,
    createCategory,
    updateCategory,
    deleteCategory,
    saveHomepageContent,
  };
}
