export function OwnerPlaceholderPage({ title, message }: { title: string; message: string }) {
  return (
    <section className="owner-page">
      <p className="eyebrow">SHOP ADMINISTRATION</p>
      <h1>{title}</h1>
      <div className="owner-empty-card"><span aria-hidden="true">✳</span><p>{message}</p></div>
    </section>
  );
}
