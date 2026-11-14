import { StarMark } from "../../components/StarMark";

export function OwnerPlaceholderPage({ title, message }: { title: string; message: string }) {
  return (
    <section className="owner-page">
      <p className="eyebrow">SHOP ADMINISTRATION</p>
      <h1>{title}</h1>
      <div className="owner-empty-card"><StarMark /><p>{message}</p></div>
    </section>
  );
}
