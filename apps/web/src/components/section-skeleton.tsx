export function SectionSkeleton({ label = "Загрузка раздела" }: { label?: string }) {
  return (
    <div className="section-skeleton" role="status" aria-label={label} aria-busy="true">
      <div aria-hidden="true">
        <div className="skeleton-block skeleton-title" />
        <div className="skeleton-toolbar">
          <div className="skeleton-block" />
          <div className="skeleton-block" />
        </div>
        <div className="skeleton-columns">
          <div className="skeleton-list">
            {["a", "b", "c", "d", "e", "f", "g"].map((row) => (
              <div className="skeleton-block" key={row} />
            ))}
          </div>
          <div className="skeleton-content">
            {["a", "b", "c", "d", "e", "f"].map((row) => (
              <div className="skeleton-block" key={row} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
