"use client";

import { Select } from "@pushdocs/ui";
import { EditorWordWrap } from "../lib/editor-settings";
import { useEditorWordWrap } from "./editor-preferences";

export function EditorSettings() {
  const [wordWrap, setWordWrap] = useEditorWordWrap();
  return (
    <section className="settings-form" aria-labelledby="editor-view-heading">
      <h2 id="editor-view-heading">Отображение файлов</h2>
      <div className="form-field">
        <label htmlFor="editor-word-wrap">Перенос строк</label>
        <Select
          id="editor-word-wrap"
          label="Перенос строк"
          value={wordWrap}
          onValueChange={(value) =>
            setWordWrap(value === EditorWordWrap.Off ? EditorWordWrap.Off : EditorWordWrap.On)
          }
          options={[
            { value: EditorWordWrap.On, label: "Переносить" },
            { value: EditorWordWrap.Off, label: "Не переносить" },
          ]}
        />
      </div>
      <p>
        Длинные строки переносятся по ширине редактора без горизонтальной прокрутки. Перенос меняет
        только отображение, содержимое файлов остаётся прежним.
      </p>
      <p>
        Настройка применяется сразу к исходникам и сравнению файлов во всех проектах в этом
        браузере.
      </p>
    </section>
  );
}
