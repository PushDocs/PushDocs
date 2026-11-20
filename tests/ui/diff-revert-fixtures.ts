const prefix = Array.from({ length: 8 }, (_, index) => `Вводная строка ${index + 1}\n`).join("");
const heading = "# Как настроить регулярный экспорт по шаблону\n";
const paragraph =
  "Регулярный экспорт позволяет выгружать контакты и другие данные по расписанию и автоматически отправлять готовые файлы в указанное место.";
const following = "\n[Подробнее о настройке экспорта](./export.mdx)\n\nСледующий раздел\n";

export const wrappedDeletionDiff = {
  before: `${prefix}${heading}\n${paragraph}\n${following}`,
  after: `${prefix}${heading}${following}`,
};

const longPrefix = Array.from({ length: 32 }, (_, index) => `Строка ${index + 1}\n`).join("");
export const logicalLineDiff = {
  before: `${longPrefix}Откройте раздел **Система → Действия по расписанию**. В выпадающем списке выберите команду «Создать».\n\nКонец\n`,
  after: `${longPrefix}данные\nававаы\n\nКонец\n`,
};
