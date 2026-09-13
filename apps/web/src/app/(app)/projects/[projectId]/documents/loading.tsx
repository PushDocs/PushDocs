import { SectionSkeleton } from "@/components/section-skeleton";

export default function LoadingDocuments() {
  return (
    <section className="page">
      <SectionSkeleton label="Открываем документы" />
    </section>
  );
}
