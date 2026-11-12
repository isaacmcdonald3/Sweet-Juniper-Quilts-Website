import { useState, type FormEvent } from "react";
import type { AdminCategory } from "@sweet-juniper/shared";
import { AdminApiError, requestAdminJson } from "../../services/admin-api";
import { useAdminResource } from "../use-admin-resource";

interface CategoryFields {
  name: string;
  description: string;
  sortOrder: number;
  isPublished: boolean;
}

function categoryFields(category?: AdminCategory): CategoryFields {
  return {
    name: category?.name || "",
    description: category?.description || "",
    sortOrder: category?.sortOrder ?? 0,
    isPublished: category?.isPublished || false,
  };
}

export function OwnerCategoriesPage() {
  const categories = useAdminResource<AdminCategory[]>("/api/admin/categories");
  const [editing, setEditing] = useState<{ id: string | null; fields: CategoryFields } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await requestAdminJson<AdminCategory>(
        editing.id ? `/api/admin/categories/${editing.id}` : "/api/admin/categories",
        { method: editing.id ? "PATCH" : "POST", body: editing.fields },
      );
      setMessage(editing.id ? "Category updated." : "Category created.");
      setEditing(null);
      categories.reload();
    } catch (cause) {
      setError(cause instanceof AdminApiError ? cause.message : "The category could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(category: AdminCategory) {
    if (!window.confirm(`Permanently delete "${category.name}"? You can hide it instead.`)) return;
    setError("");
    setMessage("");
    try {
      await requestAdminJson<void>(`/api/admin/categories/${category.id}`, { method: "DELETE" });
      setMessage(`${category.name} was deleted.`);
      categories.reload();
    } catch (cause) {
      setError(cause instanceof AdminApiError ? cause.message : "The category could not be deleted.");
    }
  }

  return (
    <section className="owner-page">
      <div className="owner-page__heading">
        <div><p className="eyebrow">ORGANIZE THE COLLECTION</p><h1>Categories</h1></div>
        <button className="button button--primary" onClick={() => { setError(""); setEditing({ id: null, fields: categoryFields() }); }} type="button">Add category</button>
      </div>
      <p className="owner-help-note">Hiding a category removes it from public navigation. Products remain attached; deletion is blocked while any product uses it.</p>
      {message && <p className="owner-success" role="status">{message}</p>}
      {error && <p className="owner-error" role="alert">{error}</p>}
      {editing && (
        <form className="owner-panel owner-edit-form" onSubmit={(event) => void submit(event)}>
          <div className="owner-panel__heading"><h2>{editing.id ? "Edit category" : "Create category"}</h2><button className="button button--outline" onClick={() => setEditing(null)} type="button">Cancel</button></div>
          <div className="owner-form-grid">
            <label><span>Name</span><input maxLength={100} onChange={(event) => setEditing({ ...editing, fields: { ...editing.fields, name: event.target.value } })} required value={editing.fields.name} /></label>
            <label><span>Display order</span><input min="0" onChange={(event) => setEditing({ ...editing, fields: { ...editing.fields, sortOrder: Number(event.target.value) } })} required type="number" value={editing.fields.sortOrder} /></label>
            <label className="owner-form-grid__wide"><span>Description</span><textarea maxLength={1000} onChange={(event) => setEditing({ ...editing, fields: { ...editing.fields, description: event.target.value } })} rows={3} value={editing.fields.description} /></label>
            <label className="owner-checkbox"><input checked={editing.fields.isPublished} onChange={(event) => setEditing({ ...editing, fields: { ...editing.fields, isPublished: event.target.checked } })} type="checkbox" /> Visible in the customer shop</label>
          </div>
          <button className="button button--primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save category"}</button>
        </form>
      )}
      {categories.loading ? <p className="owner-state" role="status">Loading categories…</p> : categories.error ? <p className="owner-error" role="alert">{categories.error} <button className="text-link" onClick={categories.reload} type="button">Try again</button></p> : categories.data?.length ? (
        <div className="owner-table-wrap">
          <table className="owner-table">
            <thead><tr><th>Category</th><th>Order</th><th>Visibility</th><th>Actions</th></tr></thead>
            <tbody>{categories.data.map((category) => (
              <tr key={category.id}>
                <td><strong>{category.name}</strong><small>/{category.slug}{category.description ? ` · ${category.description}` : ""}</small></td>
                <td>{category.sortOrder}</td>
                <td><span className="owner-status">{category.isPublished ? "Visible" : "Hidden / archived"}</span></td>
                <td className="owner-table__actions">
                  <button className="text-link" onClick={() => setEditing({ id: category.id, fields: categoryFields(category) })} type="button">Edit / reorder</button>
                  <button className="text-link" onClick={() => void remove(category)} type="button">Delete</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="owner-empty-card">No categories yet. Add categories as your handmade collection grows.</p>}
    </section>
  );
}
