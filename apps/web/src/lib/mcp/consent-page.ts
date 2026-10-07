import { randomBytes } from "node:crypto";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
const icon = (path: string, className = "") =>
  `<svg class="${className}" aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const documentIcon =
  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>';
const mark = icon('<path d="M3 12h5m8 0h5"/><circle cx="12" cy="12" r="4"/>');
const styles = `
:root{color-scheme:light;--ink:#252631;--muted:#707280;--violet:#7354d8;--line:#e8e8ee;--canvas:#f8f8fb}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:15px/1.55 "Avenir Next",Avenir,"Segoe UI",sans-serif}button,input,a{font:inherit}a{color:var(--violet);text-decoration:none}a:hover{text-decoration:underline}button{cursor:pointer}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #baabea;outline-offset:4px}h1,h2,p{margin:0}h1{font-size:32px;font-weight:650;letter-spacing:-1.2px;line-height:1.2;overflow-wrap:anywhere}h2,legend{font-size:15px;font-weight:650}svg{flex-shrink:0}
.shell{max-width:1020px;margin:auto;min-height:100dvh;padding:56px 28px;display:flex;flex-direction:column;justify-content:center}.brand{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:650;letter-spacing:-.7px;margin-bottom:26px}.mark{display:grid;place-items:center;width:34px;height:34px;border-radius:9px 9px 9px 2px;background:var(--violet);color:white}.card{display:grid;grid-template-columns:340px minmax(0,1fr);border:1px solid var(--line);border-radius:22px;background:white;overflow:hidden;box-shadow:0 24px 80px #2921380a}.intro{background:#f1eef9;padding:38px 32px;display:flex;flex-direction:column}.eyebrow{font-size:11px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;color:#6d589e;margin-bottom:22px}.connection{display:flex;align-items:center;gap:15px;margin:6px 0 30px}.connection-tile{width:60px;height:60px;background:white;border:1px solid #e2daef;border-radius:16px;display:grid;place-items:center;color:var(--violet);box-shadow:0 4px 12px #4c32670a}.connection-tile svg{width:30px;height:30px}.client-initial{font-size:25px;font-weight:650;color:#534c65}.connection-arrow{color:#9b8ab9}.description{color:#797185;margin-top:18px;font-size:14px;line-height:1.7}.identity{margin-top:30px;display:flex;align-items:center;gap:10px;font-size:13px;color:#6f657f;overflow-wrap:anywhere}.identity svg{width:18px;height:18px}.access-note{margin-top:auto;padding-top:56px;font-size:13px;line-height:1.7;color:#797185}.access-note strong{display:block;color:#51495e;font-weight:600;margin-bottom:5px}.content{padding:36px}.scope-list{list-style:none;margin:16px 0 28px;padding:0;display:grid;gap:16px}.scope{display:flex;align-items:flex-start;gap:12px}.scope-icon{color:var(--violet);background:#f6f3fc;border-radius:8px;display:grid;place-items:center;width:34px;height:34px;flex-shrink:0}.scope-icon svg{width:18px;height:18px}.scope strong{font-size:14px;font-weight:600;display:block}.scope p{font-size:12px;color:var(--muted);margin-top:2px;line-height:1.5}fieldset{border:0;border-top:1px solid var(--line);margin:0;padding:24px 0 0;min-width:0}legend{float:left;width:100%;padding:0;margin-bottom:3px}.hint{clear:both;color:var(--muted);font-size:12px;margin-bottom:16px}.projects{display:grid;gap:8px;max-height:270px;overflow:auto;padding:3px}.project{display:flex;align-items:center;gap:12px;border:1px solid var(--line);border-radius:11px;padding:14px;cursor:pointer;transition:background .15s,border-color .15s}.project:hover{background:#faf9fd;border-color:#cfc4e8}.project:has(input:checked){border-color:#b7a3e7;background:#f6f3fd}.project input{width:18px;height:18px;accent-color:var(--violet);flex-shrink:0;margin:0}.project-icon{color:#a69ab9;display:flex}.project-icon svg{width:20px;height:20px}.project-name{font-size:14px;font-weight:550;overflow-wrap:anywhere;min-width:0}.role{font-size:11px;color:#7d748c;display:block;margin-top:2px}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:28px}.actions .button{min-width:128px}.button{display:inline-flex;justify-content:center;align-items:center;min-height:44px;padding:11px 20px;border:1px solid var(--line);background:white;border-radius:10px;color:var(--ink);font-size:14px;font-weight:600}.button:hover{background:#f5f3fa;text-decoration:none}.primary{background:var(--violet);border-color:var(--violet);color:white}.primary:hover{background:#5d3fc0}.button:disabled{opacity:.45;cursor:not-allowed}.footer{font-size:12px;color:#92909d;margin-top:20px;display:flex;gap:8px;align-items:center;justify-content:center}.footer svg{width:14px;height:14px}.error{font-size:13px;line-height:1.65;padding:12px 14px;border:1px solid #f0cbd0;border-radius:10px;color:#a63346;background:#fff6f7;margin-bottom:20px}.empty{padding:18px;background:#f8f8fb;border-radius:10px;color:var(--muted);font-size:13px}.failure{max-width:520px;display:block;margin:auto}.failure .content{padding:40px}.failure h1{font-size:28px;margin-bottom:18px}.failure p{color:var(--muted);margin-bottom:24px}.failure .button{width:100%}@media(max-width:760px){.shell{padding:24px 16px;justify-content:flex-start}.brand{margin-bottom:18px}.card{grid-template-columns:1fr;border-radius:18px}.intro{padding:26px}.eyebrow{margin-bottom:16px}.connection{margin:0 0 22px}.connection-tile{height:46px;width:46px;border-radius:12px}.connection-tile svg{width:24px;height:24px}h1{font-size:28px}.description{margin-top:12px;font-size:13px;line-height:1.6}.identity{margin-top:18px}.access-note{padding-top:16px;margin-top:0;font-size:12px;line-height:1.6}.content{padding:26px}.actions .button{flex:1;min-width:0;padding-inline:12px}.scope-list{gap:14px}.footer{align-items:flex-start;text-align:center;font-size:11px}.footer svg{margin-top:2px}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}
`;
function htmlResponse(body: string, status: number, callbackOrigin?: string) {
  const nonce = randomBytes(18).toString("base64");
  return new Response(
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Подключение приложения · PushDocs</title><style nonce="${nonce}">${styles}</style></head><body><div class="shell"><div class="brand"><span class="mark">${mark}</span>PushDocs</div>${body}<p class="footer">${icon('<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>')}Доступ можно отозвать в любое время в Настройках → MCP</p></div></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "same-origin",
        // Chromium also checks the destination of a form's 303 redirect.
        "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'${callbackOrigin ? ` ${callbackOrigin}` : ""}; frame-ancestors 'none'; base-uri 'none'`,
      },
    },
  );
}
const scopeCopy: Record<string, [string, string, string]> = {
  "pushdocs:read": [
    "Читать документацию",
    "Документы, сохранённые черновики, поиск и история изменений.",
    documentIcon,
  ],
  "pushdocs:write": [
    "Редактировать документы",
    "Создание веток, правки текстов, навигации и изображений.",
    '<path d="m16 3 5 5-12 12-6 1 1-6zM14 5l5 5"/>',
  ],
  "pushdocs:preview": [
    "Запускать предпросмотр",
    "Просмотр сайта с сохранёнными изменениями.",
    '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/>',
  ],
  "pushdocs:submit": [
    "Отправлять изменения в Git",
    "Создание коммитов и запросов на слияние по вашей команде.",
    '<path d="M6 3v12a4 4 0 0 0 4 4h8M18 3v7a4 4 0 0 1-4 4H6"/><circle cx="6" cy="3" r="2"/><circle cx="18" cy="3" r="2"/><circle cx="18" cy="19" r="2"/>',
  ],
};
export function consentPage(input: {
  clientName: string;
  userName: string;
  nonce: string;
  scopes: string[];
  redirectUri: string;
  projects: Array<{ id: string; name: string; role: string }>;
  error?: string;
  selectedProjects?: string[];
}) {
  const roles: Record<string, string> = {
    admin: "Администратор",
    editor: "Редактор",
    reader: "Читатель",
  };
  const scopes = input.scopes
    .map((scope) => {
      const [title, description, path] = scopeCopy[scope] ?? [scope, "", documentIcon];
      return `<li class="scope"><span class="scope-icon">${icon(path)}</span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p></div></li>`;
    })
    .join("");
  const projects = input.projects
    .map(
      (project) =>
        `<label class="project"><input type="checkbox" name="projects" value="${escapeHtml(project.id)}"${input.selectedProjects?.includes(project.id) ? " checked" : ""}><span class="project-icon">${icon(documentIcon)}</span><span class="project-name">${escapeHtml(project.name)}<span class="role">${escapeHtml(roles[project.role] ?? project.role)}</span></span></label>`,
    )
    .join("");
  return htmlResponse(
    `<main class="card"><aside class="intro"><p class="eyebrow">Подключение приложения</p><div class="connection"><span class="connection-tile">${mark}</span>${icon('<path d="M4 12h16m-5-5 5 5-5 5"/>', "connection-arrow")}<span class="connection-tile client-initial">${escapeHtml(Array.from(input.clientName)[0]?.toLocaleUpperCase() ?? "A")}</span></div><h1>Подключить ${escapeHtml(input.clientName)}</h1><p class="description">Выберите, к какой документации приложение получит доступ от вашего имени.</p><p class="identity">${icon('<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>')}${escapeHtml(input.userName)}</p><div class="access-note"><strong>Вы управляете доступом</strong>Приложение получит только перечисленные разрешения и сохранит ограничения вашей роли в каждом проекте.</div></aside><section class="content" aria-label="Настройки доступа"><h2>Приложение запрашивает</h2><ul class="scope-list">${scopes}</ul><form method="post" action="/oauth/authorize"><input type="hidden" name="nonce" value="${escapeHtml(input.nonce)}">${input.error ? `<p class="error" role="alert">${escapeHtml(input.error)}</p>` : ""}<fieldset><legend>Доступ к проектам</legend><p class="hint">Выберите хотя бы один проект. Сохранённые черновики тоже будут доступны.</p><div class="projects">${projects || '<p class="empty">У вас пока нет доступных проектов. Попросите администратора проекта добавить вас, затем начните подключение заново.</p>'}</div></fieldset><div class="actions"><button class="button" name="decision" value="deny">Отказать</button><button class="button primary" name="decision" value="allow"${input.projects.length ? "" : " disabled"}>Разрешить</button></div></form></section></main>`,
    input.error ? 400 : 200,
    new URL(input.redirectUri).origin,
  );
}
export function consentFailure(message: string, status = 400) {
  return htmlResponse(
    `<main class="card failure"><section class="content"><p class="eyebrow">Подключение приложения</p><h1>Подключение не завершено</h1><p role="alert">${escapeHtml(message)}</p><a class="button" href="/settings/mcp">Перейти к настройкам MCP</a></section></main>`,
    status,
  );
}
