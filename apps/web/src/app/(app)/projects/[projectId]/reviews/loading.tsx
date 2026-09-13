import { SectionSkeleton } from "@/components/section-skeleton";

export default function LoadingReviews() {
  return (
    <section className="page">
      <SectionSkeleton label="Загружаем MR и PR" />
    </section>
  );
}
