import { useState } from "react";
import type { AdminHomepageContent } from "@sweet-juniper/shared";
import { requestAdminJson } from "../../services/admin-api";
import { useAdminResource } from "../use-admin-resource";

interface ContentDraft {
  contentText: string;
  isPublished: boolean;
}

export function OwnerHomepagePage() {
  const content = useAdminResource<AdminHomepageContent[]>("/api/admin/homepage-content");
  const [drafts, setDrafts] = useState<Record<string, ContentDraft>>({});
  const [newKey, setNewKey] = useState("");
  const [newContent, setNewContent] = useState("{}");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");

  function getDraft(row: AdminHomepageContent): ContentDraft {
    return drafts[row.contentKey] || {
      contentText: JSON.stringify(row.content, null, 2),
      isPublished: row.isPublished,
    };
  }

  async function save(key: string, draft: ContentDraft): Promise<boolean> {
    let value: unknown;
    try {
      value = JSON.parse(draft.contentText) as unknown;
    } catch {
      setError(`“${key}” must contain valid JSON.`);
      return false;
    }

    setBusyKey(key);
    setError("");
    setMessage("");
    try {
      await requestAdminJson<void>(`/api/admin/homepage-content/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: { content: value, isPublished: draft.isPublished },
      });
      setMessage(`Homepage content “${key}” was saved.`);
      setDrafts((current) => { const next = { ...current }; delete next[key]; return next; });
      content.reload();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Homepage content could not be saved.");
      return false;
    } finally {
      setBusyKey("");
    }
  }

  async function createContent() {
    const key = newKey.trim().toLowerCase();
    if (await save(key, { contentText: newContent, isPublished: false })) setNewKey("");
  }

  return (
    <section className="owner-page">
      <div className="owner-page__heading"><div><p className="eyebrow">CUSTOMIZE THE SHOP</p><h1>Homepage content</h1></div></div>
      <p className="owner-help-note">Edit JSON content by section. Only published sections are shown publicly. Common keys include home, welcome, about, contact, shipping, and privacy.</p>
      {message && <p className="owner-success" role="status">{message}</p>}
      {error && <p className="owner-error" role="alert">{error}</p>}
      <div className="owner-panel owner-content-editor">
        <h2>Add a content section</h2>
        <label><span>Section key</span><input maxLength={64} onChange={(event) => setNewKey(event.target.value)} placeholder="for example, about" value={newKey} /></label>
        <label><span>JSON content</span><textarea onChange={(event) => setNewContent(event.target.value)} rows={4} value={newContent} /></label>
        <button className="button button--primary" disabled={!newKey.trim() || Boolean(busyKey)} onClick={() => void createContent()} type="button">Add section</button>
      </div>
      {content.loading ? <p className="owner-state" role="status">Loading homepage content…</p> : content.error ? <p className="owner-error" role="alert">{content.error} <button className="text-link" onClick={content.reload} type="button">Try again</button></p> : content.data?.length ? (
        <div className="owner-content-sections">{content.data.map((row) => {
          const draft = getDraft(row);
          return (
            <section className="owner-panel owner-content-editor" key={row.contentKey}>
              <div className="owner-panel__heading"><h2>{row.contentKey}</h2><span className="owner-status">{draft.isPublished ? "Published" : "Draft / hidden"}</span></div>
              <label><span>JSON content</span><textarea spellCheck={false} onChange={(event) => setDrafts((current) => ({ ...current, [row.contentKey]: { ...draft, contentText: event.target.value } }))} rows={7} value={draft.contentText} /></label>
              <label className="owner-checkbox"><input checked={draft.isPublished} onChange={(event) => setDrafts((current) => ({ ...current, [row.contentKey]: { ...draft, isPublished: event.target.checked } }))} type="checkbox" /> Publish this section on the customer site</label>
              <button className="button button--primary" disabled={Boolean(busyKey)} onClick={() => void save(row.contentKey, draft)} type="button">{busyKey === row.contentKey ? "Saving…" : "Save section"}</button>
            </section>
          );
        })}</div>
      ) : <p className="owner-empty-card">No homepage content sections have been created yet.</p>}
    </section>
  );
}
