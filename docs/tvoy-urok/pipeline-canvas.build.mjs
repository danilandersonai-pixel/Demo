/**
 * Сборщик статической схемы конвейера.
 *
 * Артефакт должен открываться в любом просмотрщике, включая те, что не
 * выполняют скрипты (мобильное приложение показывает файл именно так).
 * Поэтому вся разметка — ноды, связи, счётчики, панели — печатается здесь,
 * а интерактив в готовой странице держится на radio + CSS, без единой
 * строчки JS.
 *
 *   node docs/tvoy-urok/pipeline-canvas.build.mjs
 *   → docs/tvoy-urok/pipeline-canvas.html
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "pipeline-canvas.html");

/* ── Иконки: штриховые, inline, без внешних зависимостей ─────────── */
const ICON = {
  bolt:  '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  doc:   '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  book:  '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h7M8 11h5"/>',
  stack: '<path d="M12 3 3 8l9 5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  list:  '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  pen:   '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  check: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5L5 20"/>',
  eye:   '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  slide: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  pdf:   '<path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v5h5"/><path d="M8 15h2a1.5 1.5 0 0 0 0-3H8v5"/>',
  box:   '<path d="M21 8v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/><path d="M2 4h20v4H2z"/><path d="M10 12h4"/>',
  tick:  '<path d="M4 12l5 5L20 6"/>'
};

/* ── Ноды: реальные стадии конвейера ─────────────────────────────── */
const NODES = [
  { id:"in", x:60, y:296, icon:"bolt", trigger:true,
    name:"Заявка учителя", sub:"POST /api/generate",
    who:"HTTP-триггер · вход конвейера",
    text:"Точка входа. Учитель называет предмет, класс и тему, при желании прикладывает учебник и пишет пожелания. Здесь же выбирается режим ФГОС: полный, справочный или без привязки к программе.",
    chips:[["принято","1 заявка"],["время","0,04 с"]],
    json:{ type:"presentation", subject:"История России", grade:6,
           topic:"Правление Василия III", fgos_mode:"full",
           wishes:"акцент на присоединении Пскова", source_doc_id:"doc_8f21" } },

  { id:"src", x:268, y:168, icon:"doc",
    name:"Разбор источника", sub:"pdf → чанки → e5-large",
    who:"локальная модель · multilingual-e5-large",
    text:"Учебник превращается в куски текста, и к каждому считается «отпечаток смысла». Дальше автор получит не всю книгу, а те два-три абзаца, что относятся к теме. Именно поэтому слайды пишутся по источнику, а не по памяти модели.",
    chips:[["чанков","34"],["время","2,10 с"],["стоимость","0 ₽"]],
    json:{ doc_id:"doc_8f21", pages:412, chunks:34,
           embedder:"intfloat/multilingual-e5-large",
           top_k:[{ id:"c_118", score:0.87,
                    text:"Великий князь запретил своим братьям чеканить монету…" },
                  { id:"c_121", score:0.81,
                    text:"13 января 1510 года псковский вечевой колокол…" }] } },

  { id:"fgos", x:268, y:424, icon:"book",
    name:"Требования ФГОС", sub:"реестр, редакция 2025",
    who:"детерминированный справочник · без модели",
    text:"По предмету, классу и теме из справочника достаётся список того, что урок обязан раскрыть. Справочник жёсткий, без ИИ: текст стандарта нормативный, и «вспоминать» его моделью нельзя — она выдаст правдоподобную выдумку.",
    chips:[["раздел","ru6.vasiliy3"],["единиц","7"],["время","0,01 с"]],
    json:{ subject:"История", grade_matched:6, section:"ru6.vasiliy3",
           units:["Вхождение Псковской, Смоленской, Рязанской земель",
                  "Отмирание удельной системы",
                  "Укрепление великокняжеской власти"],
           required_terms:["удельная система","великокняжеская власть","Псков"],
           required_dates:["1510","1514"],
           anachronism_guard:{ period_end_year:1533,
                               forbidden_terms:["царская семья","император"] } } },

  { id:"prompt", x:476, y:296, icon:"stack",
    name:"Сборка промпта", sub:"навык + схема + ФГОС",
    who:"skills/loader.py",
    text:"Блоки складываются по убыванию стабильности: сначала навык роли и схема, потом требования и возрастной профиль, и только в конце — тема с источником. Порядок здесь не косметика: кэш работает побайтово, и всё, что выше первой правки, стоит в десять раз дешевле.",
    chips:[["кэшируется","98 %"],["префикс","6 529 ток."],["хвост","75 ток."]],
    json:{ role:"author",
           blocks:[{ type:"text", chars:15069, cache_control:{ type:"ephemeral" } },
                   { type:"text", chars:174 }],
           cached_ratio:0.98, model:"claude-opus-4-8" } },

  { id:"outline", x:684, y:296, icon:"list",
    name:"План дека", sub:"Opus 4.8 · роли и лейауты",
    who:"навык author · первый вызов",
    text:"Модель раскладывает урок по слайдам: какая роль у каждого, какая раскладка, о чём заголовок. Пока без текста — дёшево и быстро, зато структуру можно проверить до того, как за неё заплачено содержанием.",
    chips:[["слайдов","13"],["время","8,60 с"],["токенов","1 240 вых."]],
    json:{ slides:[{ role:"title", layout:"title_hero", title:"Правление Василия III" },
                   { role:"definition", layout:"definition_top", title:"Удельная система" },
                   { role:"timeline", layout:"timeline_rows", title:"Присоединение Пскова" },
                   { role:"compare", layout:"compare_two_cols", title:"Два брака государя" },
                   { role:"quiz", layout:"quiz_list", title:"Проверь себя" }] } },

  { id:"content", x:892, y:296, icon:"pen",
    name:"Контент слайдов", sub:"Opus 4.8 · тезисы и заметки",
    who:"навык author · второй вызов",
    text:"По плану пишутся тезисы, определения, вопросы и заметки для учителя. К каждому содержательному тезису прикладывается цитата из учебника, на которую он опирается — так потом видно, откуда взялся факт.",
    chips:[["слайдов","13"],["время","31,40 с"],["токенов","6 480 вых."]],
    json:{ meta:{ topic:"Правление Василия III", grade:6, theme:"manuscript" },
           slides:[{ role:"content", layout:"card_left_image_right",
                     title:"Начало правления",
                     paragraphs:[{ text:"После смерти Ивана III престол занял его сын Василий III.",
                                   bold_terms:["Василий III"],
                                   source_quote:"После смерти Ивана III престол занял…" }],
                     notes:"Обратить внимание на даты: 28 лет — целое поколение.",
                     image:{ kind:"illustration", alt:"Портрет великого князя",
                             prompt:"портрет русского князя начала XVI века, книжная миниатюра",
                             sensitive:false } }] } },

  { id:"lint", x:1100, y:150, icon:"check",
    name:"Проверки текста", sub:"без модели · бесплатно",
    who:"generator/validators.py",
    text:"Счётчики и правила ловят то, за что глупо платить модели: слайд без заголовка, перебор по словам, двойные пробелы, дефис вместо тире, пропущенную «ё», повтор факта. Здесь же ошибка, если слот заполнен, а раскладка его не отрисует — иначе данные пропали бы молча.",
    chips:[["проверок","57"],["ошибок","0"],["замечаний","2"],["время","0,08 с"]],
    json:{ errors:0, warnings:2,
           issues:[{ level:"warn", code:"sentence-len", slide:8,
                     message:"тезис 7 слов (коридор 8–16)" },
                   { level:"warn", code:"missing-terms", slide:null,
                     message:"не раскрыто понятие «великокняжеская власть»" }] } },

  { id:"art", x:1100, y:442, icon:"image",
    name:"Иллюстрации", sub:"YandexART · без текста в кадре",
    who:"навык illustrator · 1,8 ₽ за картинку",
    text:"По описаниям сцен рисуются картинки — параллельно с проверкой текста, чтобы не ждать дважды. Внутри изображения не должно быть ни одной надписи: впечатанный текст не исправить, не найти поиском и не прочитать незрячим.",
    chips:[["сгенерировано","11"],["из кэша","2"],["время","24,80 с"],["стоимость","19,80 ₽"]],
    json:{ generated:11, from_cache:2, provider:"yandex-art",
           style_prompt:"плоская векторная иллюстрация в духе книжной миниатюры, без текста",
           images:[{ slide:2, path:"img/s02_udel.png", bytes:184320, sensitive:false },
                   { slide:7, path:"img/s07_smolensk.png", bytes:201113, sensitive:true }],
           refused:0 } },

  { id:"insp", x:1308, y:150, icon:"eye",
    name:"ФГОС-инспектор", sub:"Sonnet 5 · со зрением",
    who:"навык fgos-inspector",
    text:"Судит то, что не берётся счётчиком: раскрыта ли тема по существу, а не по совпадению слов, выстроен ли урок методически, нет ли анахронизмов на картинках. Корона не той эпохи или храм, построенный веком позже, ловятся только глазами.",
    chips:[["охват","83 %"],["время","6,20 с"],["вердикт","правки"]],
    json:{ verdict:"fix", coverage_pct:83,
           units_confirmed:["Отмирание удельной системы","Укрепление великокняжеской власти"],
           units_missing:["Отношения с Крымским и Казанским ханствами"],
           image_findings:[{ slide:3, issue:"корона напоминает регалии XVIII в.",
                             action:"regenerate" }],
           notes:"Слайда с исторической картой нет — работа с картой не покрыта." } },

  { id:"render", x:1516, y:296, icon:"slide",
    name:"Сборка PPTX", sub:"python-pptx · холст 16:9",
    who:"generator/render.py",
    text:"Описание слайдов превращается в настоящий файл PowerPoint: живой текст в блоках, настоящий жирный, картинки в готовых слотах, заметки в панели докладчика. Сборщик отчитывается, если текст где-то не поместился или на машине не хватило шрифта.",
    chips:[["слайдов","13"],["переполнений","0"],["размер","1,9 МБ"],["время","0,42 с"]],
    json:{ path:"out/vasiliy-iii.pptx", slides:13, bytes:1994752,
           overflowed:[], missing_fonts:[], notes_written:13,
           theme:"manuscript", canvas:"13.33x7.5in" } },

  { id:"pdf", x:1724, y:296, icon:"pdf",
    name:"Экспорт PDF", sub:"LibreOffice headless",
    who:"в продакшене — Gotenberg",
    text:"Тот же дек конвертируется в PDF — его удобно раздать детям или открыть с любого устройства. Шрифты обязаны стоять в образе конвертации, иначе вёрстка поедет незаметно для всех, кроме учителя у доски.",
    chips:[["страниц","13"],["размер","0,9 МБ"],["время","3,10 с"]],
    json:{ path:"out/vasiliy-iii.pdf", pages:13, bytes:947104,
           converter:"libreoffice-impress", fonts_embedded:true,
           text_layer:true } },

  { id:"out", x:1932, y:296, icon:"box",
    name:"Выдача учителю", sub:"файлы + отчёт ФГОС",
    who:"ответ на поллинг job_id",
    text:"Учитель забирает презентацию, PDF и отчёт о соответствии программе — что раскрыто, чего нет, на какие планируемые результаты работает урок. Такой отчёт можно приложить к уроку или показать на аттестации.",
    chips:[["файлов","2"],["кредитов","2"],["итого","74,2 с"],["себестоимость","46,30 ₽"]],
    json:{ job_id:"job_7c02", status:"done",
           files:[{ kind:"pptx", url:"/d/job_7c02.pptx", bytes:1994752 },
                  { kind:"pdf",  url:"/d/job_7c02.pdf",  bytes:947104 }],
           fgos_report:{ mode:"full", coverage_pct:83, blocking_errors:0 },
           credits_spent:2, elapsed_sec:74.2 } }
];

/* Связи: где конвейер ветвится и сливается — ветвление настоящее */
const EDGES = [
  ["in","src",       "1"],
  ["in","fgos",      "1"],
  ["src","prompt",  "34"],
  ["fgos","prompt",  "7"],
  ["prompt","outline","1"],
  ["outline","content","13"],
  ["content","lint", "13"],
  ["content","art",  "11"],
  ["lint","insp",    "13"],
  ["insp","render",  "13"],
  ["art","render",   "13"],
  ["render","pdf",   "13"],
  ["pdf","out",       "2"]
];

const LANES = [
  { x:1088, y:104, t:"Проверка" },
  { x:1088, y:404, t:"Графика" }
];

const S = 96;            // сторона ноды
const W = 2160, H = 680; // холст

/* ── Вспомогательное ─────────────────────────────────────────────── */
const byId = Object.fromEntries(NODES.map(n => [n.id, n]));
const esc = s => String(s).replace(/[&<>]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;" }[c]));

function paintJson(obj) {
  return esc(JSON.stringify(obj, null, 2))
    .replace(/"([^"\\]*(?:\\.[^"\\]*)*)"(\s*:)/g, '<span class="j-key">"$1"</span>$2')
    .replace(/:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g, ': <span class="j-str">"$1"</span>')
    .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="j-num">$1</span>')
    .replace(/:\s*(true|false|null)/g, ': <span class="j-bool">$1</span>');
}

/* ── Связи считаются здесь, в разметку попадают готовые кривые ───── */
const wires = [];
const counts = [];
for (const [a, b, n] of EDGES) {
  const A = byId[a], B = byId[b];
  const x1 = A.x + S, y1 = A.y + S / 2;
  const x2 = B.x,     y2 = B.y + S / 2;
  const dx = Math.max(58, (x2 - x1) * 0.55);
  wires.push(
    `<path class="wire w-${a} w-${b}" ` +
    `d="M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}"/>`);

  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, w = 15 + n.length * 6;
  counts.push(
    `<rect class="count-bg" x="${mx - w / 2}" y="${my - 9}" width="${w}" height="18" rx="9"/>` +
    `<text class="count" x="${mx}" y="${my + 3.6}" text-anchor="middle">${n}</text>`);
}

/* ── Правила, зависящие от выбранной ноды ────────────────────────── */
const pickRules = NODES.map(n => `
  #p-${n.id}:checked ~ .sheet .pane-${n.id} { display: flex; }
  #p-${n.id}:checked ~ .viewport label[for="p-${n.id}"] .box {
    border-color: var(--accent);
    box-shadow: var(--shadow-lift), 0 0 0 3px var(--accent-soft);
  }
  #p-${n.id}:checked ~ .viewport label[for="p-${n.id}"] .box svg { stroke: var(--accent); }
  #p-${n.id}:checked ~ .viewport .w-${n.id} {
    stroke: var(--accent); stroke-width: 2.25; stroke-opacity: 1;
  }
  #p-${n.id}:focus-visible ~ .viewport label[for="p-${n.id}"] .box {
    outline: 2px solid var(--accent); outline-offset: 3px;
  }`).join("");

const openSheet = NODES.map(n => `#p-${n.id}:checked ~ .sheet`).join(",\n  ");

/* ── Разметка ────────────────────────────────────────────────────── */
const radios =
  '<input class="sr" type="radio" name="mode" id="m-edit" checked>\n' +
  '<input class="sr" type="radio" name="mode" id="m-run">\n' +
  '<input class="sr" type="radio" name="pick" id="p-none" checked>\n' +
  NODES.map(n => `<input class="sr" type="radio" name="pick" id="p-${n.id}">`).join("\n");

const nodeMarkup = NODES.map(n => `
    <label class="node${n.trigger ? " trigger" : ""}" for="p-${n.id}"
           style="left:${n.x}px; top:${n.y}px">
      <span class="box">
        <svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n.icon]}</svg>
        <span class="tick"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON.tick}</svg></span>
      </span>
      <span class="caption">
        <span class="t">${esc(n.name)}</span>
        <span class="s">${esc(n.sub)}</span>
      </span>
    </label>`).join("");

const laneMarkup = LANES.map(l =>
  `\n    <span class="lane" style="left:${l.x}px; top:${l.y}px">${esc(l.t)}</span>`).join("");

const paneMarkup = NODES.map(n => `
  <section class="pane pane-${n.id}">
    <div class="sheet-head">
      <span class="sheet-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n.icon]}</svg></span>
      <span class="sheet-title">
        <h2>${esc(n.name)}</h2>
        <span class="who">${esc(n.who)}</span>
      </span>
      <label class="sheet-close" for="p-none" title="Закрыть панель">×</label>
    </div>
    <div class="sheet-body">
      <p>${esc(n.text)}</p>
      <div class="chips">${n.chips.map(([k, v]) =>
        `<span class="chip"><span class="k">${esc(k)}</span><b>${esc(v)}</b></span>`).join("")}</div>
      <div class="out-label">Выход ноды</div>
      <pre>${paintJson(n.json)}</pre>
    </div>
  </section>`).join("");

/* ── Страница ────────────────────────────────────────────────────── */
const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Конвейер «Твой урок»</title>
<!-- Собрано из pipeline-canvas.build.mjs. Правки — в сборщике, не здесь. -->
<style>
  /* ── Токены. Светлая палитра — на голом :root, чтобы страница жила
       и в «системной» теме, где на корне не стоит ни одной метки. ── */
  :root {
    --canvas:      #EEF0F4;
    --dot:         #C9CFDA;
    --surface:     #FFFFFF;
    --surface-2:   #F7F8FB;
    --border:      #DDE2EA;
    --border-firm: #C3CAD8;
    --ink:         #1B2130;
    --ink-muted:   #67718A;
    --ink-faint:   #96A0B4;
    --accent:      #8A2434;
    --accent-soft: #F3E4E7;
    --edge:        #B7BECD;
    --ok:          #1F8A5B;
    --ok-soft:     #E3F3EB;
    --shadow:      0 1px 2px rgba(27,33,48,.06), 0 4px 12px rgba(27,33,48,.07);
    --shadow-lift: 0 2px 4px rgba(27,33,48,.08), 0 12px 32px rgba(27,33,48,.14);

    --sans: ui-sans-serif, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --mono: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace;

    --z: 1;          /* масштаб холста — задаётся медиазапросами ниже */
    --sheet-h: 62vh; /* высота панели, когда она раскрыта */
  }

  /* Тёмная тема через системную настройку — но явный выбор «светлая» её бьёт */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --canvas:      #141821;
      --dot:         #2B3242;
      --surface:     #1E242F;
      --surface-2:   #262D3A;
      --border:      #333B4B;
      --border-firm: #465063;
      --ink:         #E8EBF2;
      --ink-muted:   #9AA5BC;
      --ink-faint:   #6E7893;
      --accent:      #E08A97;
      --accent-soft: #3A2229;
      --edge:        #4A5568;
      --ok:          #4BC98D;
      --ok-soft:     #16302A;
      --shadow:      0 1px 2px rgba(0,0,0,.4), 0 4px 12px rgba(0,0,0,.35);
      --shadow-lift: 0 2px 6px rgba(0,0,0,.5), 0 14px 36px rgba(0,0,0,.5);
    }
  }
  /* И явный выбор «тёмная» бьёт светлую систему */
  :root[data-theme="dark"] {
    --canvas:      #141821;
    --dot:         #2B3242;
    --surface:     #1E242F;
    --surface-2:   #262D3A;
    --border:      #333B4B;
    --border-firm: #465063;
    --ink:         #E8EBF2;
    --ink-muted:   #9AA5BC;
    --ink-faint:   #6E7893;
    --accent:      #E08A97;
    --accent-soft: #3A2229;
    --edge:        #4A5568;
    --ok:          #4BC98D;
    --ok-soft:     #16302A;
    --shadow:      0 1px 2px rgba(0,0,0,.4), 0 4px 12px rgba(0,0,0,.35);
    --shadow-lift: 0 2px 6px rgba(0,0,0,.5), 0 14px 36px rgba(0,0,0,.5);
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    /* Явный фон обязателен: прозрачное тело подхватит чужую тему */
    background: var(--canvas);
    color: var(--ink);
    font-family: var(--sans);
    -webkit-font-smoothing: antialiased;
    height: 100vh;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Переключатели живут первыми в body: от них идут сестринские
     селекторы ко всему остальному. С экрана убраны, с клавиатуры — нет. */
  .sr {
    position: absolute;
    width: 1px; height: 1px;
    margin: -1px; padding: 0;
    overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%);
    white-space: nowrap;
  }

  /* ── Верхняя полоса ─────────────────────────────────────────── */
  header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 20px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    z-index: 30;
  }
  .brand { display: flex; align-items: baseline; gap: 10px; min-width: 0; flex: 0 1 auto; }
  .brand h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
    letter-spacing: -.01em;
    white-space: nowrap;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .brand .sub {
    font-size: 12px;
    color: var(--ink-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .spacer { flex: 1; }

  .toggle {
    display: flex;
    flex: none;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 2px;
    gap: 2px;
  }
  .toggle label {
    color: var(--ink-muted);
    font-size: 12.5px;
    font-weight: 550;
    padding: 5px 12px;
    border-radius: 6px;
    cursor: pointer;
    user-select: none;
    transition: background .15s, color .15s;
  }

  .runline {
    display: none;
    align-items: center;
    gap: 7px;
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--ok);
    white-space: nowrap;
  }
  .pulse {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--ok);
    box-shadow: 0 0 0 3px var(--ok-soft);
  }

  /* ── Холст ──────────────────────────────────────────────────── */
  .viewport {
    flex: 1;
    min-height: 0;
    overflow: auto;
    position: relative;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    /* Точки живут на скролл-контейнере: так они не мельчают вместе
       с холстом и покрывают всё поле целиком. */
    background-image: radial-gradient(var(--dot) 1.2px, transparent 1.2px);
    background-size: 18px 18px;
    background-position: -1px -1px;
    background-attachment: local;
  }
  /* Обёртка держит габариты за масштабированный холст — иначе скролл
     не знает, сколько места занимает содержимое после scale(). */
  .stage {
    position: relative;
    width:  calc(${W}px * var(--z));
    height: calc(${H}px  * var(--z));
  }
  .canvas {
    position: relative;
    width: ${W}px;
    height: ${H}px;
    transform: scale(var(--z));
    transform-origin: 0 0;
  }
  .wires { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .wire {
    fill: none;
    stroke: var(--edge);
    stroke-width: 1.75;
    transition: stroke .2s;
  }

  .count {
    font-family: var(--mono);
    font-size: 10.5px;
    font-weight: 600;
    fill: var(--ok);
  }
  .count-bg { fill: var(--surface); stroke: var(--ok); stroke-width: 1; }
  .counts { opacity: 0; transition: opacity .25s; }

  /* ── Нода ───────────────────────────────────────────────────── */
  .node {
    position: absolute;
    width: 96px;
    display: block;
    cursor: pointer;
    text-align: center;
  }
  .box {
    position: relative;
    display: grid;
    place-items: center;
    width: 96px; height: 96px;
    background: var(--surface);
    border: 1px solid var(--border-firm);
    border-radius: 14px;
    box-shadow: var(--shadow);
    transition: transform .16s, box-shadow .16s, border-color .16s;
  }
  /* Триггер: левый край скруглён сильно — как в n8n */
  .node.trigger .box { border-radius: 48px 14px 14px 48px; }
  .node:hover .box { transform: translateY(-2px); box-shadow: var(--shadow-lift); }

  .box > svg { width: 30px; height: 30px; stroke: var(--ink-muted); fill: none;
               stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

  .tick {
    position: absolute;
    right: -7px; top: -7px;
    width: 20px; height: 20px;
    border-radius: 50%;
    background: var(--ok);
    display: grid; place-items: center;
    opacity: 0;
    transform: scale(.6);
    transition: opacity .2s, transform .2s;
  }
  .tick svg { width: 12px; height: 12px; stroke: var(--surface); fill: none;
              stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }

  .caption { display: block; margin-top: 9px; width: 156px; margin-left: -30px; }
  .caption .t {
    display: block;
    font-size: 12.5px;
    font-weight: 600;
    line-height: 1.25;
    letter-spacing: -.005em;
  }
  .caption .s {
    display: block;
    margin-top: 3px;
    font-family: var(--mono);
    font-size: 10px;
    line-height: 1.35;
    color: var(--ink-faint);
  }

  .lane {
    position: absolute;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--ink-faint);
    pointer-events: none;
  }

  .hint {
    position: absolute;
    left: 60px; top: 22px;
    font-size: 12px;
    color: var(--ink-faint);
    pointer-events: none;
  }

  /* ── Панель деталей ─────────────────────────────────────────────
     Не оверлей: панель — такой же элемент колонки, и холст сам
     ужимается, когда она раскрыта. Так выбранная нода не оказывается
     под панелью — а подкрутить холст без скрипта было бы нечем. */
  .sheet {
    flex: none;
    height: 0;
    overflow: hidden;
    background: var(--surface);
    border-top: 1px solid var(--border);
    box-shadow: 0 -8px 32px rgba(27,33,48,.16);
    transition: height .28s cubic-bezier(.32,.72,.28,1);
    z-index: 40;
  }
  .pane { display: none; flex-direction: column; height: 100%; }

  .sheet-head {
    flex: none;
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--border);
  }
  .sheet-icon {
    flex: none;
    width: 40px; height: 40px;
    border-radius: 10px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    display: grid; place-items: center;
  }
  .sheet-icon svg { width: 21px; height: 21px; stroke: var(--accent); fill: none;
                    stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .sheet-title { flex: 1; min-width: 0; }
  .sheet-title h2 { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -.01em; }
  .sheet-title .who {
    display: block;
    margin-top: 3px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-faint);
  }
  .sheet-close {
    flex: none;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--ink-muted);
    width: 30px; height: 30px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    display: grid; place-items: center;
    user-select: none;
  }
  .sheet-close:hover { color: var(--ink); }

  .sheet-body { flex: 1; min-height: 0; padding: 16px 20px 22px; overflow-y: auto; }
  .sheet-body p {
    margin: 0 0 14px;
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--ink-muted);
    max-width: 68ch;
  }

  .chips { display: none; flex-wrap: wrap; gap: 7px; margin-bottom: 14px; }
  .chip {
    display: inline-flex; align-items: baseline; gap: 6px;
    padding: 4px 9px;
    border-radius: 6px;
    background: var(--ok-soft);
    border: 1px solid var(--ok);
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ok);
    font-variant-numeric: tabular-nums;
  }
  .chip b { font-weight: 600; }
  .chip .k { color: var(--ink-faint); font-weight: 400; }

  .out-label {
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--ink-faint);
    margin-bottom: 7px;
  }
  pre {
    margin: 0;
    padding: 13px 15px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 9px;
    overflow-x: auto;
    font-family: var(--mono);
    font-size: 11.5px;
    line-height: 1.65;
    color: var(--ink);
    tab-size: 2;
  }
  .j-key { color: var(--accent); }
  .j-str { color: var(--ok); }
  .j-num { color: var(--ink); font-weight: 600; }
  .j-bool { color: var(--ink-muted); font-style: italic; }

  /* ── Состояния: всё, что ниже, переключают radio ────────────── */

  /* Активная половина тумблера */
  #m-edit:checked ~ header label[for="m-edit"],
  #m-run:checked  ~ header label[for="m-run"] {
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow);
  }
  #m-edit:focus-visible ~ header label[for="m-edit"],
  #m-run:focus-visible  ~ header label[for="m-run"] {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Режим прогона */
  #m-run:checked ~ header .runline { display: flex; }
  #m-run:checked ~ .viewport .box { border-color: var(--ok); }
  #m-run:checked ~ .viewport .box > svg { stroke: var(--ink); }
  #m-run:checked ~ .viewport .tick { opacity: 1; transform: scale(1); }
  #m-run:checked ~ .viewport .wire { stroke: var(--ok); stroke-opacity: .55; }
  #m-run:checked ~ .viewport .counts { opacity: 1; }
  #m-run:checked ~ .sheet .chips { display: flex; }

  /* Раскрытая панель */
  ${openSheet} { height: var(--sheet-h); }

  /* Выбранная нода: подсветка ноды, её связей и своей вкладки панели */
${pickRules}

  /* ── Экраны ─────────────────────────────────────────────────── */
  @media (max-width: 1000px) { :root { --z: .8; } }
  @media (max-width: 700px) {
    :root { --z: .62; --sheet-h: 56vh; }
    header { padding: 10px 14px; gap: 10px; }
    .brand .sub { display: none; }
    .brand h1 { font-size: 14px; }
    .toggle label { padding: 5px 10px; font-size: 12px; }
    /* Времени прогона в шапке нет места — оно и так есть в чипсах панели */
    #m-run:checked ~ header .runline { display: none; }
    .hint { left: 26px; top: 16px; font-size: 11px; max-width: 300px; }
    .sheet-head { padding: 14px 16px 10px; }
    .sheet-body { padding: 14px 16px calc(20px + env(safe-area-inset-bottom)); }
    pre { font-size: 11px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .sheet, .box, .tick, .counts, .wire, .toggle label { transition: none; }
  }
</style>
</head>
<body>

${radios}

<header>
  <div class="brand">
    <h1>Конвейер «Твой урок»</h1>
    <span class="sub">заявка учителя → презентация с проверкой по ФГОС</span>
  </div>
  <div class="spacer"></div>
  <div class="runline"><span class="pulse"></span><span>выполнено за 74,2 с</span></div>
  <div class="toggle">
    <label for="m-edit">Редактор</label>
    <label for="m-run">Прогон</label>
  </div>
</header>

<div class="viewport">
  <div class="stage">
    <div class="canvas">
      <span class="hint">Нажмите на ноду — покажу, что она делает и что отдаёт дальше</span>
      <svg class="wires" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        ${wires.join("\n        ")}
        <g class="counts">
        ${counts.join("\n        ")}
        </g>
      </svg>${nodeMarkup}${laneMarkup}
    </div>
  </div>
</div>

<aside class="sheet">${paneMarkup}
</aside>

</body>
</html>
`;

writeFileSync(OUT, html, "utf8");
console.log(`${OUT} — ${NODES.length} нод, ${EDGES.length} связей, ${html.length} байт`);
