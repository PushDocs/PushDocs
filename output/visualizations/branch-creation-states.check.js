
    (() => {
      const root = document.getElementById("branch-creation-states");
      const board = root.querySelector(".pd-board");
      const transition = root.querySelector(".pd-transition");
      const defaultName = "docs/new";
      const stageLabels = ["Проверка", "Ветка в Git", "Файлы"];
      const automaticHint = "После загрузки файлов откроем новую ветку автоматически.";
      const checkOnlyHint = "Проверка не запускает создание ветки заново.";
      const restoredHint = "Вы продолжаете ту же операцию. Создавать ветку повторно не нужно.";
      const action = (label, target, disabled = false) => ({ label, target, disabled });
      const groups = [
        {
          title: "Обычное создание",
          label: "Пока идёт подготовка, закрытие недоступно. Переход — после загрузки файлов.",
          states: [
            {
              id: "entry", label: "Ввод имени", editable: true, close: true,
              heading: "Новая ветка для ваших изменений",
              message: "Сохраним текущие правки и создадим ветку от main.",
              actions: [action("Создать и перейти", "saving"), action("Отмена", "close")],
            },
            {
              id: "saving", label: "Сохранение текущих правок", tone: "working",
              heading: "Сохраняем текущие правки…",
              message: "Подготавливаем документы перед созданием ветки.",
              actions: [action("Сохраняем…", null, true)],
            },
            {
              id: "queued", label: "Ожидание обработчика", tone: "working", stage: 0,
              heading: "Ожидаем свободный обработчик…",
              message: "Задача принята. Скоро начнём подготовку ветки.",
              hint: automaticHint,
              actions: [action("Ожидаем…", null, true)],
            },
            {
              id: "checking", label: "Проверка исходной ветки", tone: "working", stage: 0,
              heading: "Проверяем исходную ветку…",
              message: "Проверяем доступ к репозиторию и актуальность main.",
              hint: automaticHint,
              actions: [action("Проверяем…", null, true)],
            },
            {
              id: "creating", label: "Создание в Git", tone: "working", stage: 1,
              heading: "Создаём ветку в Git…",
              message: "Отправили запрос на создание docs/new.",
              hint: automaticHint,
              actions: [action("Создаём ветку…", null, true)],
            },
            {
              id: "created", label: "Создана, Git ещё обновляется", tone: "working", stage: 2,
              heading: "Ветка создана. Получаем файлы…",
              message: "Git подтвердил создание. Подготавливаем загрузку документов.",
              hint: automaticHint,
              actions: [action("Получаем файлы…", null, true)],
            },
            {
              id: "importing", label: "Загрузка документов", tone: "working", stage: 2,
              heading: "Ветка создана. Загружаем файлы…",
              counts: { completed: 12, total: 25 },
              hint: automaticHint,
              actions: [action("Загружаем файлы…", null, true)],
            },
            {
              id: "opening", label: "Готово, автоматический переход", tone: "success", stage: 3,
              heading: "Ветка готова",
              message: "Открываем docs/new. Дерево файлов переключится вместе с веткой.",
              actions: [action("Переходим в ветку…", null, true)],
            },
          ],
        },
        {
          title: "Ожидание и восстановление",
          label: "Потеря связи не означает ошибку создания. При возвращении продолжается прежняя операция.",
          states: [
            {
              id: "source-refresh", label: "Исходная ветка обновилась", tone: "working", stage: 0,
              heading: "Исходная ветка обновилась",
              message: "Получаем изменения main. Затем продолжим создание от свежей версии.",
              hint: "Пока проверяем и обновляем исходную ветку, новую не создаём.",
              actions: [action("Обновляем main…", null, true)],
            },
            {
              id: "creation-checking", label: "Проверка потерянного ответа Git", tone: "working", stage: 1,
              heading: "Проверяем результат создания…",
              message: "Git не подтвердил результат запроса. Ветка уже могла появиться — проверяем её наличие.",
              hint: checkOnlyHint,
              actions: [action("Проверяем ветку…", null, true)],
            },
            {
              id: "network-temporary", label: "Временный обрыв связи", tone: "warning", stage: 2,
              heading: "Связь с сервером прервана",
              message: "Ветка уже создана. Автоматически проверим, как идёт загрузка файлов.",
              hint: "Последние данные: загружено 12 из 25 файлов.",
              actions: [action("Восстанавливаем связь…", null, true)],
            },
            {
              id: "network-lost", label: "Длительный обрыв связи", tone: "warning", close: true, stage: 2, issue: true,
              heading: "Не удаётся проверить загрузку",
              message: "Ветка создана. Загрузка файлов могла продолжиться на сервере, но сейчас мы не получаем её статус.",
              hint: "Можно закрыть окно. При возвращении покажем эту же операцию.",
              actions: [action("Проверить снова", "network-temporary"), action("Закрыть", "close-pending")],
            },
            {
              id: "creation-unknown", label: "Результат создания не установлен", tone: "warning", close: true, stage: 1, issue: true,
              heading: "Пока не удалось подтвердить создание",
              message: "Ветка могла быть создана, но Git ещё не позволяет это проверить.",
              hint: checkOnlyHint,
              actions: [action("Проверить снова", "creation-checking"), action("Закрыть", "close-pending")],
            },
            {
              id: "restored-running", label: "Возврат к незавершённой операции", tone: "working", stage: 2,
              heading: "Продолжаем подготовку ветки",
              message: "Ветка docs/new создана. Загрузка файлов ещё выполняется.",
              counts: { completed: 19, total: 25 },
              hint: restoredHint,
              actions: [action("Загружаем файлы…", null, true)],
            },
            {
              id: "restored-ready", label: "Готова после возврата / сбоя перехода", tone: "success", close: true, stage: 3,
              heading: "Ветка docs/new готова",
              message: "Все файлы загружены. Можно перейти в новую ветку.",
              hint: "До нажатия кнопки текущая ветка и её дерево остаются открытыми.",
              actions: [action("Перейти в ветку", "destination"), action("Закрыть", "close")],
            },
          ],
        },
        {
          title: "Ошибки и действия пользователя",
          label: "Сообщение и повторное действие зависят от того, подтверждено ли создание ветки.",
          states: [
            {
              id: "name-invalid", label: "Ошибка в имени", editable: true, close: true,
              value: "docs/new..", fieldError: "В имени ветки нельзя использовать две точки подряд.",
              heading: "Укажите другое имя",
              message: "Исправьте имя, чтобы продолжить создание ветки.",
              actions: [action("Создать и перейти", "saving", true), action("Отмена", "close")],
            },
            {
              id: "save-error", label: "Текущие правки не сохранились", editable: true, close: true, tone: "error",
              heading: "Не удалось сохранить текущие правки",
              message: "Создание ветки ещё не запускали. Проверьте соединение и повторите попытку.",
              actions: [action("Повторить сохранение", "saving"), action("Закрыть", "close")],
            },
            {
              id: "creation-error", label: "Git отклонил создание", editable: true, close: true, tone: "error", stage: 1, issue: true,
              heading: "Не удалось создать ветку",
              message: "Git отклонил запрос: у подключения нет права создавать ветки.",
              hint: "Проверьте права подключения и повторите попытку.",
              detail: "Запрос отклонён до создания ветки. Для этой операции подтверждён отказ Git.",
              actions: [action("Повторить создание", "checking"), action("Закрыть", "close")],
            },
            {
              id: "import-error", label: "Ветка создана, загрузка не удалась", close: true, tone: "error", stage: 2, issue: true,
              heading: "Ветка создана, файлы не загружены",
              message: "Не удалось подготовить документы docs/new. Повторите загрузку файлов.",
              hint: "Повторная загрузка продолжит подготовку этой ветки.",
              detail: "Не удалось получить файлы из Git. Повтор будет выполнен для сохранённой ветки и её версии, без нового запроса создания.",
              actions: [action("Повторить загрузку", "importing"), action("Закрыть", "close-pending")],
            },
            {
              id: "access-lost", label: "Доступ к проекту потерян", close: true, tone: "error",
              heading: "Нет доступа к проекту",
              message: "Проверка операции остановлена. Уточните доступ у администратора проекта.",
              hint: "По этой ошибке нельзя определить, завершилось ли создание ветки.",
              actions: [action("Закрыть", "close")],
            },
            {
              id: "operation-missing", label: "Операция не найдена", close: true, tone: "warning",
              heading: "Не удалось найти операцию",
              message: "Сейчас нельзя подтвердить результат создания. Ветка могла быть создана.",
              hint: "Перед новым созданием проверьте список веток проекта.",
              actions: [action("Закрыть", "close")],
            },
            {
              id: "branch-conflict", label: "Найдена ветка с другой версией", close: true, tone: "warning", stage: 1, issue: true,
              heading: "Ветка с таким именем уже существует",
              message: "У docs/new другая версия файлов. Продолжить эту операцию автоматически нельзя.",
              hint: "Проверьте существующую ветку. Её содержимое не будет перезаписано.",
              detail: "Ожидали исходную версию main, но Git вернул другую версию docs/new. Нужна проверка существующей ветки перед новым действием.",
              actions: [action("Закрыть", "close")],
            },
          ],
        },
      ];

      const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      })[char]);
      const states = groups.flatMap((group) => group.states);
      let number = 0;
      const stagesMarkup = (state) => {
        if (state.stage === undefined) return "";
        return `<ol class="pd-stages" aria-label="Этапы подготовки ветки">${stageLabels.map((label, index) => {
          const step = index < state.stage ? "done" : index === state.stage ? (state.issue ? "issue" : "active") : "waiting";
          const marker = step === "done" ? "✓" : step === "issue" ? "!" : index + 1;
          return `<li class="pd-stage" data-step="${step}"><span class="pd-stage-mark" aria-hidden="true">${marker}</span><span>${label}<span class="sr-only">: ${{ done: "готово", issue: "требует внимания", active: "выполняется", waiting: "ожидает" }[step]}</span></span></li>`;
        }).join("")}</ol>`;
      };
      board.innerHTML = groups.map((group, groupIndex) => `
        <section class="pd-group" aria-labelledby="pd-group-${groupIndex}">
          <header class="pd-group-title">
            <h2 id="pd-group-${groupIndex}">${escapeHtml(group.title)}</h2>
            <p class="pd-board-label">${escapeHtml(group.label)}</p>
          </header>
          <div class="pd-grid viz-dotted-background">${group.states.map((state) => {
            number += 1;
            const fieldId = `pd-name-${state.id}`;
            const titleId = `pd-title-${state.id}`;
            const counts = state.counts;
            const progress = counts ? Math.round(counts.completed / counts.total * 100) : 0;
            return `<article class="pd-plate" id="pd-state-${state.id}" data-state="${state.id}">
              <header class="pd-caption"><span class="pd-number">${String(number).padStart(2, "0")}</span><strong>${escapeHtml(state.label)}</strong></header>
              <section class="pd-modal" aria-labelledby="${titleId}">
                <header class="pd-modal-header">
                  <h3 id="${titleId}">Создание ветки</h3>
                  <button class="pd-close" type="button" aria-label="Закрыть диалог: ${escapeHtml(state.label)}" data-origin="${state.id}" data-target="${state.id === "entry" || state.editable ? "close" : "close-pending"}" ${state.close ? "" : "disabled"}><span aria-hidden="true">×</span></button>
                </header>
                <label class="pd-field" for="${fieldId}">Имя ветки
                  <input id="${fieldId}" value="${escapeHtml(state.value || defaultName)}" ${state.editable ? "" : "readonly"} ${state.fieldError ? `aria-invalid="true" aria-describedby="${fieldId}-error"` : ""} spellcheck="false" autocapitalize="off" autocomplete="off">
                  ${state.fieldError ? `<span class="pd-field-error" id="${fieldId}-error">${escapeHtml(state.fieldError)}</span>` : ""}
                  <span class="pd-source">Исходная ветка: <code>main</code></span>
                </label>
                <div class="pd-message" ${state.tone ? `data-tone="${state.tone}"` : ""}>
                  <strong>${escapeHtml(state.heading)}</strong>
                  ${state.message ? `<p>${escapeHtml(state.message)}</p>` : ""}
                  ${counts ? `<span class="pd-counts">${counts.completed} из ${counts.total} файлов загружено</span><div class="pd-meter" role="progressbar" aria-label="Загрузка файлов" aria-valuenow="${counts.completed}" aria-valuemin="0" aria-valuemax="${counts.total}"><span class="pd-meter-fill" style="width:${progress}%"></span></div>` : ""}
                </div>
                ${stagesMarkup(state)}
                ${state.detail ? `<details class="pd-detail"><summary>Подробнее</summary><p>${escapeHtml(state.detail)}</p></details>` : ""}
                <footer class="pd-footer">
                  ${state.hint ? `<p class="pd-hint">${escapeHtml(state.hint)}</p>` : ""}
                  <div class="pd-actions">${state.actions.map((button, index) => `<button class="pd-button" data-emphasis="${index === 0 && button.label !== "Закрыть" ? "primary" : "secondary"}" type="button" data-origin="${state.id}" data-target="${button.target || ""}" ${button.disabled ? "disabled" : ""}>${escapeHtml(button.label)}</button>`).join("")}</div>
                </footer>
              </section>
            </article>`;
          }).join("")}</div>
        </section>`).join("");

      root.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-target]");
        if (!button || !root.contains(button) || button.disabled) return;
        const target = button.dataset.target;
        const source = states.find((state) => state.id === button.dataset.origin);
        if (target === "close" || target === "close-pending") {
          transition.textContent = target === "close-pending"
            ? "Закрыть → текущая ветка остаётся открытой. Операция сохраняется для возврата."
            : "Закрыть → текущая ветка и её дерево остаются открытыми.";
        } else if (target === "destination") {
          transition.textContent = "Перейти в ветку → открываются docs/new и её дерево файлов.";
        } else {
          const destination = states.find((state) => state.id === target);
          const plate = document.getElementById(`pd-state-${target}`);
          if (!destination || !plate) return;
          for (const selected of root.querySelectorAll("[data-selected]")) selected.removeAttribute("data-selected");
          plate.dataset.selected = "true";
          transition.textContent = `${source.label} → ${destination.label}`;
          plate.scrollIntoView({ behavior: "instant", block: "center" });
        }
        if (window.openai && typeof window.openai.setWidgetState === "function") {
          const saved = window.openai.setWidgetState({ modelContent: { source: source.id, target }, privateContent: null });
          if (saved && typeof saved.catch === "function") saved.catch(() => {});
        }
      });
      const restoreSelection = (snapshot) => {
        const selected = snapshot && snapshot.modelContent && snapshot.modelContent.target;
        if (!selected) return;
        const plate = document.getElementById(`pd-state-${selected}`);
        if (plate && root.contains(plate)) plate.dataset.selected = "true";
      };
      restoreSelection(window.openai && window.openai.widgetState);
      window.addEventListener("openai:set_globals", (event) => {
        restoreSelection(event.detail && event.detail.globals && event.detail.globals.widgetState);
      });
    })();
  