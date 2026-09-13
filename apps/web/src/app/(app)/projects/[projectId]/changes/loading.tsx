import { SectionSkeleton } from "@/components/section-skeleton";

export default function LoadingChanges() {
  return (
    <section className="page">
      <SectionSkeleton label="Загружаем изменения" />
    </section>
  );
}
