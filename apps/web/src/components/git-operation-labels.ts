export const branchSyncLabels = {
  idle: "Обновить из Git",
  busy: "Обновляем ветку…",
} as const;

export function gitRetryMessage(attempt: number, maxAttempts: number, queued: boolean) {
  return queued
    ? `Запрос завершился ошибкой. Ожидаем повтор: попытка ${attempt} из ${maxAttempts}.`
    : `Повторяем запрос: попытка ${attempt} из ${maxAttempts}…`;
}

export const branchUpdateLabels = {
  title: "Обновите ветку",
  idle: "Обновить ветку",
  success: "Ветка обновлена.",
  error: "Не удалось обновить ветку. Попробуйте ещё раз.",
  checking: "Нет связи. Проверяем результат обновления…",
  unavailable:
    "Обновление пока недоступно. Обновите страницу или обратитесь к администратору проекта.",
  reader: "Обновить ветку может редактор проекта",
  unavailableBranch: "Обновление этой ветки недоступно. Обратитесь к администратору проекта.",
} as const;

export const branchConflictLabels = {
  noticeTitle: "Есть конфликты",
  title: "Исправьте конфликты",
  action: "Исправить конфликты",
  reader: "Исправить конфликты может редактор проекта",
} as const;

export const pendingBranchChangesLabels = {
  title: "Сохраните текущие правки",
  description: "Сохраните или отмените текущие правки, чтобы продолжить.",
  action: "Открыть правки",
} as const;
