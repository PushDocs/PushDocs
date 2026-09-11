export default function LoadingProject() {
  return (
    <section className="page" role="status" aria-live="polite">
      <h1>Открываем проект…</h1>
      <progress aria-label="Загрузка проекта" />
    </section>
  );
}
