import { useState, type FormEvent } from "react";
import type { AdminCategory, AdminProduct, ProductFulfillmentType } from "@sweet-juniper/shared";
import { AdminApiError, requestAdminJson } from "../../services/admin-api";
import { ProductMediaManager } from "../components/ProductMediaManager";
import { useAdminResource } from "../use-admin-resource";

interface ProductFields {
  name: string;
  description: string;
  price: number;
  sku: string;
  categoryId: string;
  inventoryQuantity: number;
  lowInventoryThreshold: number;
  fulfillmentType: ProductFulfillmentType;
  isPublished: boolean;
  isFeatured: boolean;
  isArchived: boolean;
}

function fieldsFromProduct(product?: AdminProduct): ProductFields {
  return {
    name: product?.name || "",
    description: product?.description || "",
    price: product?.price || 0,
    sku: product?.sku || "",
    categoryId: product?.categoryId || "",
    inventoryQuantity: product?.inventoryQuantity || 0,
    lowInventoryThreshold: product?.lowInventoryThreshold ?? 2,
    fulfillmentType: product?.fulfillmentType || "ready_to_ship",
    isPublished: product?.isPublished || false,
    isFeatured: product?.isFeatured || false,
    isArchived: Boolean(product?.archivedAt),
  };
}

function productPayload(fields: ProductFields) {
  return { ...fields, categoryId: fields.categoryId || null };
}

function productStatus(product: AdminProduct): string {
  if (product.archivedAt) return "Archived";
  if (!product.isPublished) return "Draft";
  if (product.fulfillmentType === "ready_to_ship" && product.inventoryQuantity === 0) return "Sold out";
  if (product.fulfillmentType === "ready_to_ship" && product.inventoryQuantity <= product.lowInventoryThreshold) return "Low inventory";
  return "Published";
}

export function OwnerProductsPage() {
  const products = useAdminResource<AdminProduct[]>("/api/admin/products");
  const categories = useAdminResource<AdminCategory[]>("/api/admin/categories");
  const [editing, setEditing] = useState<{ id: string | null; fields: ProductFields } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveProduct(fields: ProductFields, id = editing?.id) {
    const saved = await requestAdminJson<AdminProduct>(
      id ? `/api/admin/products/${id}` : "/api/admin/products",
      { method: id ? "PATCH" : "POST", body: productPayload(fields) },
    );
    setEditing(null);
    setMessage(id ? `${saved.name} was updated.` : `${saved.name} was created.`);
    products.reload();
  }

  async function performAction(product: AdminProduct, changes: Partial<ProductFields>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await saveProduct({ ...fieldsFromProduct(product), ...changes }, product.id);
    } catch (cause) {
      setError(cause instanceof AdminApiError ? cause.message : "The product could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    if (editing.fields.isArchived && !editing.id) {
      setError("A new product cannot be created as archived.");
      return;
    }
    if (editing.fields.isArchived && !products.data?.find((item) => item.id === editing.id)?.archivedAt) {
      if (!window.confirm("Archive this product? It will immediately disappear from the customer shop.")) return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await saveProduct(editing.fields);
    } catch (cause) {
      setError(cause instanceof AdminApiError ? cause.message : "The product could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const loadError = products.error || categories.error;
  return (
    <section className="owner-page">
      <div className="owner-page__heading">
        <div><p className="eyebrow">YOUR COLLECTION</p><h1>Products</h1></div>
        <button className="button button--primary" onClick={() => { setError(""); setEditing({ id: null, fields: fieldsFromProduct() }); }} type="button">Add product</button>
      </div>
      {message && <p className="owner-success" role="status">{message}</p>}
      {error && <p className="owner-error" role="alert">{error}</p>}
      {loadError && <p className="owner-error" role="alert">{loadError} <button className="text-link" onClick={() => { products.reload(); categories.reload(); }} type="button">Try again</button></p>}
      {editing && (
        <form className="owner-panel owner-edit-form" onSubmit={(event) => void submit(event)}>
          <div className="owner-panel__heading">
            <h2>{editing.id ? "Edit product" : "Create product"}</h2>
            <button className="button button--outline" onClick={() => setEditing(null)} type="button">Cancel</button>
          </div>
          <div className="owner-form-grid">
            <label><span>Product name</span><input maxLength={150} onChange={(event) => setEditing({ ...editing, fields: { ...editing.fields, name: event.target.value } })} required value={editing.fields.name} /></label>
            <label><span>SKU</span><input maxLength={64} onChange={(event) => setEditing({ ...editing, fields: { ...editing.fields, sku: event.target.value } })} required value={editing.fields.sku} /></label>
            <label><span>Price (USD)</span><input min="0" onChange={(event) => setEditing({ ...editing, fields: { ...editing.fields, price: Number(event.target.value) } })} required step="0.01" type="number" value={editing.fields.price} /></label>
            <label><span>Category</span><select onChange={(event) => setEditing({ ...editing, fields: { ...editing.fields, categoryId: event.target.value } })} value={editing.fields.categoryId}><option value="">Uncategorized</option>{(categories.data || []).map((category) => <option key={category.id} value={category.id}>{category.name}{category.isPublished ? "" : " (hidden)"}</option>)}</select></label>
            <label className="owner-form-grid__wide"><span>Description</span><textarea maxLength={5000} onChange={(event) => setEditing({ ...editing, fields: { ...editing.fields, description: event.target.value } })} rows={5} value={editing.fields.description} /></label>
            <label><span>Fulfillment</span><select onChange={(event) => setEditing({ ...editing, fields: { ...editing.fields, fulfillmentType: event.target.value as ProductFulfillmentType } })} value={editing.fields.fulfillmentType}><option value="ready_to_ship">Ready to ship</option><option value="made_to_order">Made to order</option></select></label>
            <label><span>Inventory quantity</span><input min="0" onChange={(event) => setEditing({ ...editing, fields: { ...editing.fields, inventoryQuantity: Number(event.target.value) } })} required type="number" value={editing.fields.inventoryQuantity} /></label>
            <label><span>Low inventory alert at</span><input min="0" onChange={(event) => setEditing({ ...editing, fields: { ...editing.fields, lowInventoryThreshold: Number(event.target.value) } })} required type="number" value={editing.fields.lowInventoryThreshold} /></label>
            <div className="owner-checkboxes">
              <label><input checked={editing.fields.isPublished && !editing.fields.isArchived} disabled={editing.fields.isArchived} onChange={(event) => setEditing({ ...editing, fields: { ...editing.fields, isPublished: event.target.checked } })} type="checkbox" /> Published in the shop</label>
              <label><input checked={editing.fields.isFeatured} onChange={(event) => setEditing({ ...editing, fields: { ...editing.fields, isFeatured: event.target.checked } })} type="checkbox" /> Featured on the homepage</label>
              {editing.id && <label><input checked={editing.fields.isArchived} onChange={(event) => setEditing({ ...editing, fields: { ...editing.fields, isArchived: event.target.checked, isPublished: event.target.checked ? false : editing.fields.isPublished } })} type="checkbox" /> Archived</label>}
            </div>
          </div>
          <button className="button button--primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save product"}</button>
          {editing.id && <ProductMediaManager productId={editing.id} />}
        </form>
      )}
      {products.loading ? <p className="owner-state" role="status">Loading products…</p> : products.data && (
        products.data.length ? (
          <div className="owner-table-wrap">
            <table className="owner-table">
              <thead><tr><th>Product</th><th>Status</th><th>Price</th><th>Inventory</th><th>Actions</th></tr></thead>
              <tbody>{products.data.map((product) => (
                <tr key={product.id}>
                  <td><strong>{product.name}</strong><small>{product.sku} · {product.category?.name || "Uncategorized"}</small></td>
                  <td><span className={`owner-status ${product.archivedAt ? "owner-status--muted" : ""}`}>{productStatus(product)}</span></td>
                  <td>${product.price.toFixed(2)}</td>
                  <td>{product.fulfillmentType === "made_to_order" ? "Made to order" : `${product.inventoryQuantity} available`}</td>
                  <td className="owner-table__actions">
                    <button className="text-link" onClick={() => { setError(""); setEditing({ id: product.id, fields: fieldsFromProduct(product) }); }} type="button">Edit</button>
                    {!product.archivedAt && <button className="text-link" disabled={busy} onClick={() => void performAction(product, { isPublished: !product.isPublished })} type="button">{product.isPublished ? "Unpublish" : "Publish"}</button>}
                    <button className="text-link" disabled={busy} onClick={() => void performAction(product, { isArchived: !product.archivedAt, isPublished: product.archivedAt ? false : false }, product.archivedAt ? undefined : "Archive this product? It will disappear from the public shop.")} type="button">{product.archivedAt ? "Restore" : "Archive"}</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="owner-empty-card">No products yet. Create your first product to begin building the catalog.</p>
      )}
    </section>
  );
}
