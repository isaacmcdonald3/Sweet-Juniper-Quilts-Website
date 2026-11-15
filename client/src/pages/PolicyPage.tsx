import { Link } from "react-router-dom";
import type { StorefrontHomepage } from "@sweet-juniper/shared";
import { getContentSection, getContentText } from "../utils/homepage-content";

interface PolicySection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

const policies: Record<"shipping" | "privacy", { title: string; sections: PolicySection[] }> = {
  privacy: {
    title: "Privacy Policy",
    sections: [
      {
        heading: "Information We Collect",
        paragraphs: [
          "When you interact with our Site, we collect only the personal information you voluntarily provide to us:",
          "We do not collect payment details.",
        ],
        bullets: ["Name", "Email Address", "Physical Address"],
      },
      {
        heading: "How We Use Your Information",
        paragraphs: [
          "We use the personal information we collect for the following purposes:",
        ],
        bullets: [
          "To communicate with you (e.g., responding to inquiries, sending updates, or fulfilling requests).",
          "To deliver products, services, or information you have asked for.",
          "To maintain internal records and improve our Site and customer service.",
        ],
      },
      {
        heading: "How We Share Your Information",
        paragraphs: [
          "We do not sell your personal information to third parties.",
          "We do not share, sell, or rent your name, email address, or physical address to third parties for cross-context behavioral advertising or monetary gain. We may only disclose your information:",
        ],
        bullets: [
          "To trusted service providers who help us operate our website or business (under strict confidentiality obligations).",
          "If required to do so by law, subpoena, or legal process, or to protect the safety, rights, or property of our business or others.",
        ],
      },
      {
        heading: "Your Rights and Choices",
        bullets: [
          "Access & Deletion: You have the right to request access to the personal data we hold about you and request its deletion.",
          "Opt-Out of Targeted Advertising/Sales: Because we do not sell your personal data or use it for targeted advertising, no separate “Do Not Sell” opt-out mechanism is required; however, you can always restrict or request the removal of your data from our systems.",
        ],
      },
    ],
  },
  shipping: {
    title: "Shipping & Returns Policy",
    sections: [
      {
        heading: "Order Processing Time",
        bullets: [
          "All orders are processed and shipped within 1–3 business days (Monday through Friday, excluding weekends and public holidays) after receiving your order confirmation email.",
          "You will receive another notification when your order has shipped, which will include a tracking number. (Note: It may take up to 48 hours for tracking information to update.)",
        ],
      },
      {
        heading: "Shipping Rates & Delivery Estimates",
        bullets: [
          "Domestic Shipping (US) via USPS:",
          "Standard Shipping (Estimated 2–5 business days): $8.00",
          "International Shipping: We currently do not ship internationally.",
        ],
      },
      {
        heading: "Lost or Delayed Packages",
        bullets: [
          "We are not responsible for packages delayed by the carrier or lost due to incorrect address information provided at checkout.",
          "If your tracking shows your package was delivered, but you haven't received it, please check with your neighbors or local carrier branch first, then contact us at sweetjuniperquilts@gmail.com.",
        ],
      },
      {
        heading: "Returns & Refunds Policy",
        bullets: [
          "All sales are final, and we do not provide refunds. However, if you are unsatisfied with your quilt or would like to inquire about an exchange, please contact us at sweetjuniperquilts@gmail.com.",
        ],
      },
    ],
  },
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPolicySections(value: unknown): value is PolicySection[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    return typeof record.heading === "string" &&
      (record.paragraphs === undefined || isStringArray(record.paragraphs)) &&
      (record.bullets === undefined || isStringArray(record.bullets));
  });
}

export function PolicyPage({
  data,
  policy,
}: {
  data: StorefrontHomepage;
  policy: "shipping" | "privacy";
}) {
  const section = getContentSection(data.content, policy);
  const defaults = policies[policy];
  const customSections = isPolicySections(section.sections) ? section.sections : null;
  const customBody = typeof section.body === "string" &&
    section.body.trim() &&
    section.body !== (policy === "shipping"
      ? "Shipping and returns information will be added here before checkout becomes available."
      : "Privacy information will be published here before customer information is collected.")
    ? section.body
    : null;

  return (
    <main className="page-main policy-page section-wrap">
      <p className="eyebrow">THE DETAILS</p>
      <h1>{getContentText(section, "title", defaults.title)}</h1>
      {customSections ? customSections.map((item) => (
        <section className="policy-page__section" key={item.heading}>
          <h2>{item.heading}</h2>
          {item.paragraphs?.map((paragraph, index) => <p key={`${item.heading}-p-${index}`}>{paragraph}</p>)}
          {item.bullets && (
            <ul>{item.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
          )}
        </section>
      )) : customBody ? (
        <p className="policy-page__body">{customBody}</p>
      ) : defaults.sections.map((item) => (
        <section className="policy-page__section" key={item.heading}>
          <h2>{item.heading}</h2>
          {item.paragraphs?.map((paragraph, index) => <p key={`${item.heading}-p-${index}`}>{paragraph}</p>)}
          {item.bullets && (
            <ul>{item.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
          )}
        </section>
      ))}
      <Link className="text-link" to="/">Back to Sweet Juniper Quilts</Link>
    </main>
  );
}
