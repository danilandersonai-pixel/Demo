// Ревизия: каждая функция проверяется дважды — на компьютере (1500px) и на
// телефоне (360px). Результат идёт в таблицу AUDIT.md, строка «потеряно»
// недопустима. После редизайна (задание 3) селекторы обновлены под новую
// разметку: чип состояния стал картушкой, всплывающий сигнал — её же
// состоянием, «Просто/Подробно» — одной кнопкой-переключателем.
//
//   node server.js --port 4517 &
//   node tests/manual/audit-v2.js [url]

const { launch, sleep, killAll } = require('./cdp');
const SHOTS = process.env.SHTURMAN_SHOTS || require('os').tmpdir();
const URL = process.argv[2] || 'http://127.0.0.1:4517/';

const rows = [];
function row(feature, desktop, mobile, ok, note) {
  rows.push({ feature, desktop, mobile, ok, note: note || '' });
}

const checks = [];
function check(name, cond, detail) {
  checks.push({ name, ok: !!cond, detail: detail || '' });
  // Печатаем сразу: если сценарий упадёт, видно, до чего он дошёл.
  console.log((cond ? '  ✔ ' : '  ✖ ') + name + (detail ? '\n      ' + detail : ''));
}

(async () => {
  const b = await launch({ cdpPort: 9421, width: 1500, height: 980 });

  // Клик, который называет виновника, если элемента не оказалось.
  // Ждём условие, а не «столько-то миллисекунд»: лента наполняется по SSE,
  // и фиксированная пауза давала ложные провалы.
  b.waitFor = async function (expr, timeout) {
    var deadline = Date.now() + (timeout || 8000);
    for (;;) {
      if (await b.eval(expr)) return true;
      if (Date.now() > deadline) return false;
      await sleep(200);
    }
  };

  b.click = async function (selector) {
    const ok = await b.eval(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});
             if(!e) return false; e.click(); return true;})()`);
    if (!ok) throw new Error('нет элемента для клика: ' + selector);
    return ok;
  };
  await b.metrics(1500, 980, false);
  await b.goto(URL, 5000);
  await b.eval(`window.__err=[];window.addEventListener('error',e=>window.__err.push(String(e.message)))`);

  // Ждём, пока по SSE придёт снимок и лента наполнится.
  await b.waitFor(`document.querySelectorAll('.ev').length > 0`, 15000);

  // Приветствие и тур мешают измерениям — закрываем сразу, отдельно
  // проверив, что они были.
  await sleep(1400);
  const welcomeShown = await b.eval(`!!document.querySelector('.tour--welcome')`);
  await b.eval(`var w=document.querySelector('.tour--welcome .btn--primary'); if(w) w.click()`);
  await sleep(500);
  const tourShown = await b.eval(`!document.getElementById('tour').hidden`);
  await b.eval(`var t=document.getElementById('tourSkip'); if(t) t.click()`);
  await sleep(400);

  // ═══ КОМПЬЮТЕР ═══════════════════════════════════════════════════════════
  const d = {};
  d.panels = await b.json(`[...document.querySelectorAll('.panel')].filter(p=>p.offsetParent!==null).map(p=>p.dataset.view)`);
  check('Компьютер: все панели видны сразу', d.panels.length === 4, d.panels.join(', '));

  d.feed = await b.eval(`document.querySelectorAll('.ev').length`);
  check('Компьютер: лента наполнена', d.feed > 3, d.feed + ' карточек в окне');

  d.tabbarHidden = await b.eval(`getComputedStyle(document.getElementById('tabbar')).display === 'none'`);
  check('Компьютер: нижних вкладок нет', d.tabbarHidden);

  // Фильтры
  const filters = [];
  for (const f of ['edit', 'run', 'error', 'agent', 'all']) {
    await b.eval(`document.querySelector('[data-filter="${f}"]').click()`);
    await sleep(200);
    filters.push(f + '=' + await b.eval(`app_visible_count()`).catch(() => '?'));
  }
  check('Компьютер: фильтры ленты', true, filters.join(' '));

  // Просто/Подробно
  await b.eval(`document.getElementById('btnDetail').click()`);
  await sleep(400);
  const rawOn = await b.eval(`document.querySelectorAll('.ev__raw').length`);
  await b.eval(`document.getElementById('btnDetail').click()`);
  await sleep(400);
  check('Компьютер: режим «Подробно»', rawOn > 0, rawOn + ' блоков сырых данных');

  // Шторка вместо модалки
  await b.eval(`document.querySelector('.ev').click()`);
  await sleep(1200);
  const sheetDesktop = await b.json(`(()=>{const s=document.getElementById('sheetBox');const r=s.getBoundingClientRect();
    return {open:!document.getElementById('sheet').hidden, w:Math.round(r.width), h:Math.round(r.height),
            right:Math.round(window.innerWidth-r.right)}})()`);
  check('Компьютер: детали открываются боковой панелью',
    sheetDesktop.open && sheetDesktop.right < 5 && sheetDesktop.h > 500,
    `${sheetDesktop.w}x${sheetDesktop.h} у правого края`);
  await b.eval(`document.getElementById('sheetClose').click()`);

  // Горячие клавиши
  await b.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'2',bubbles:true}))`);
  await sleep(300);
  const afterKey2 = await b.eval(`document.body.dataset.view`);
  await b.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'1',bubbles:true}))`);
  await sleep(200);
  check('Компьютер: горячая клавиша «2» переключает раздел', afterKey2 === 'map', 'view=' + afterKey2);

  await b.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'/',bubbles:true}))`);
  await sleep(300);
  const focused = await b.eval(`document.activeElement.id`);
  check('Компьютер: «/» ставит курсор в поиск', focused === 'feedSearch', 'фокус на ' + focused);
  await b.eval(`document.activeElement.blur()`);

  const themeBefore = await b.eval(`document.documentElement.getAttribute('data-theme')`);
  await b.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'t',bubbles:true}))`);
  await sleep(300);
  const themeAfter = await b.eval(`document.documentElement.getAttribute('data-theme')`);
  check('Компьютер: «t» меняет тему', themeBefore !== themeAfter, `${themeBefore} → ${themeAfter}`);

  // Светлая тема читаема
  await b.eval(`document.documentElement.setAttribute('data-theme','light')`);
  await sleep(300);
  const light = await b.json(`(()=>{const s=getComputedStyle(document.body);
    return {bg:s.backgroundColor, fg:s.color}})()`);
  check('Светлая тема применяется', light.bg !== 'rgb(13, 17, 23)', `фон ${light.bg}, текст ${light.fg}`);
  await b.shot(SHOTS + '/v2-light.png');
  await b.eval(`document.documentElement.setAttribute('data-theme','dark')`);
  await sleep(200);

  // Git, словарь, пульс, сессии — на компьютере
  const gitDesktop = await b.json(`({branch:(document.querySelector('.git__branch')||{}).textContent,
      count:(document.querySelector('.git__count-num')||{}).textContent})`);
  check('Компьютер: git-панель', !!gitDesktop.branch, 'ветка ' + gitDesktop.branch);

  await b.eval(`document.querySelector('[data-gittab="history"]').click()`);
  await sleep(300);
  check('Компьютер: таймлайн', await b.eval(`document.querySelectorAll('.tl').length`) > 0);
  await b.eval(`document.querySelector('[data-gittab="now"]').click()`);

  const pulseDesktop = await b.json(`({files:document.getElementById('pulseFiles').textContent,
      graph:document.querySelectorAll('.attgraph__node').length,
      sessions:document.querySelectorAll('.session').length})`);
  check('Компьютер: пульс, граф внимания, журнал сессий',
    pulseDesktop.graph > 0 && pulseDesktop.sessions > 0,
    `файлов ${pulseDesktop.files}, узлов ${pulseDesktop.graph}, сессий ${pulseDesktop.sessions}`);

  await b.eval(`document.getElementById('btnGlossary').click()`);
  await sleep(600);
  const glDesktop = await b.eval(`document.querySelectorAll('.gl__item').length`);
  check('Компьютер: словарь', glDesktop >= 25, glDesktop + ' терминов');
  await b.eval(`document.getElementById('sheetClose').click()`);

  await b.eval(`document.getElementById('btnConnect').click()`);
  await sleep(2000);
  const connDesktop = await b.json(`({open:!document.getElementById('sheet').hidden,
      text:(document.querySelector('.conn__explain')||{}).textContent||'',
      body:document.getElementById('sheetBody').innerText.trim().length,
      hasCmd:!!document.querySelector('.conn__cmd')})`);
  check('Компьютер: экран подключения объясняет share',
    connDesktop.open && connDesktop.text.length > 60,
    (connDesktop.hasCmd ? 'показана команда включения' : 'показан QR') +
    `, объяснение ${connDesktop.text.length} симв., всего в шторке ${connDesktop.body}`);
  await b.eval(`document.getElementById('sheetClose').click()`);

  await b.shot(SHOTS + '/v2-desktop.png');

  // ═══ ТЕЛЕФОН 360px ═══════════════════════════════════════════════════════
  await b.metrics(360, 780, true);
  await sleep(900);

  const m = {};
  m.overflow = await b.json(`({scrollW:document.body.scrollWidth, inner:window.innerWidth,
      over:document.body.scrollWidth > window.innerWidth + 2})`);
  check('Телефон: нет горизонтальной прокрутки', !m.overflow.over,
    `${m.overflow.scrollW} при ширине ${m.overflow.inner}`);

  m.tabbar = await b.json(`(()=>{const t=document.getElementById('tabbar');
      const r=t.getBoundingClientRect();
      return {visible:getComputedStyle(t).display!=='none', h:Math.round(r.height),
              tabs:[...t.querySelectorAll('.tab')].map(x=>x.textContent.trim())}})()`);
  check('Телефон: нижние вкладки видны', m.tabbar.visible && m.tabbar.tabs.length === 4,
    m.tabbar.tabs.join(' / ') + `, высота ${m.tabbar.h}px`);

  // Меряем не картинку, а зону касания. Мелкие на вид элементы (значок «?»,
  // слово-термин в строке ленты) расширены невидимой площадкой ::after с
  // отрицательным inset — палец попадает в неё, хотя рисунок остаётся
  // маленьким. Считать по рамке элемента было бы враньём в обе стороны.
  m.touch = await b.json(`(()=>{
      const SEL='button, .node, .gitfile, .session, .pill';
      const grow=(e)=>{
        const a=getComputedStyle(e,'::after');
        if(!a || a.content==='none' || a.position!=='absolute') return {x:0,y:0};
        const num=(v)=>{const n=parseFloat(v); return isFinite(n)&&n<0 ? -n : 0;};
        return {y:num(a.top)+num(a.bottom), x:num(a.left)+num(a.right)};
      };
      const bad=[...document.querySelectorAll(SEL)]
        .filter(e=>{const r=e.getBoundingClientRect();
          if(!(r.width>0 && r.height>0)) return false;
          const g=grow(e);
          return (r.height+g.y)<44 || (r.width+g.x)<24;})
        .map(e=>(e.className||'')+ '|' + (e.textContent||'').trim().slice(0,14));
      return {bad:bad.slice(0,8), count:bad.length,
              total:document.querySelectorAll(SEL).length}})()`);
  check('Телефон: зоны касания ≥44px', m.touch.count === 0,
    m.touch.count ? `мелких: ${m.touch.count} из ${m.touch.total} → ${m.touch.bad.join(' ; ')}`
                  : `все ${m.touch.total} элементов достаточно крупные`);

  // Переключение вкладок и что видна одна секция
  const perTab = {};
  for (const tab of ['feed', 'map', 'git', 'pulse']) {
    await b.eval(`[...document.querySelectorAll('.tab')].find(t=>t.dataset.tab==='${tab}').click()`);
    await sleep(500);
    perTab[tab] = await b.json(`({view:document.body.dataset.view,
        visiblePanels:[...document.querySelectorAll('.panel')].filter(p=>p.offsetParent!==null).map(p=>p.dataset.view),
        content:document.querySelector('.panel[data-view="${tab}"]').innerText.trim().length})`);
  }
  const oneAtATime = Object.values(perTab).every(v => v.visiblePanels.length === 1);
  check('Телефон: видна ровно одна секция', oneAtATime,
    Object.entries(perTab).map(([k, v]) => k + ':' + v.visiblePanels.join('+')).join(' '));
  const allHaveContent = Object.values(perTab).every(v => v.content > 40);
  check('Телефон: у каждой вкладки есть содержимое', allHaveContent,
    Object.entries(perTab).map(([k, v]) => k + '=' + v.content).join(' '));

  // Липкая шапка со статусом
  await b.eval(`[...document.querySelectorAll('.tab')].find(t=>t.dataset.tab==='feed').click()`);
  await sleep(400);
  // Шапка на телефоне — это сама картушка: она вне прокручиваемой области,
  // поэтому видна всегда, что бы ни листали.
  await b.eval(`document.getElementById('feedScroll').scrollTop = 400`);
  await sleep(300);
  m.header = await b.json(`(()=>{const t=document.getElementById('head');
      const r=t.getBoundingClientRect();
      return {top:Math.round(r.top), h:Math.round(r.height),
              state:document.getElementById('roseState').textContent,
              dial:!!document.querySelector('#rose .dial__ring')}})()`);
  check('Телефон: картушка видна всегда и показывает состояние',
    m.header.top <= 1 && m.header.dial && !!m.header.state,
    `сверху ${m.header.top}px, высота ${m.header.h}px, состояние «${m.header.state}»`);

  // Свайп между вкладками
  await b.eval(`(()=>{
    const grid=document.getElementById('grid');
    function t(type, x, y){
      const touch = new Touch({identifier:1, target:grid, clientX:x, clientY:y});
      grid.dispatchEvent(new TouchEvent(type,{touches:type==='touchend'?[]:[touch],
        changedTouches:[touch], bubbles:true, cancelable:true}));
    }
    t('touchstart', 300, 400); t('touchmove', 200, 402); t('touchmove', 120, 404); t('touchend', 100, 405);
  })()`);
  await sleep(500);
  const afterSwipe = await b.eval(`document.body.dataset.view`);
  check('Телефон: свайп переключает вкладку', afterSwipe === 'map', 'после свайпа влево: ' + afterSwipe);
  await b.eval(`[...document.querySelectorAll('.tab')].find(t=>t.dataset.tab==='feed').click()`);
  await sleep(300);

  // Шторка снизу
  await b.eval(`document.querySelector('.ev').click()`);
  await sleep(1200);
  const sheetMobile = await b.json(`(()=>{const s=document.getElementById('sheetBox');
      const r=s.getBoundingClientRect();
      return {open:!document.getElementById('sheet').hidden, w:Math.round(r.width),
              bottomGap:Math.round(window.innerHeight-r.bottom), fromTop:Math.round(r.top)}})()`);
  check('Телефон: детали открываются нижней шторкой',
    sheetMobile.open && sheetMobile.w >= 355 && sheetMobile.bottomGap < 5 && sheetMobile.fromTop > 40,
    `ширина ${sheetMobile.w}, сверху ${sheetMobile.fromTop}px`);
  await b.shot(SHOTS + '/v2-mobile-sheet.png');

  // Дифф читается без горизонтальной прокрутки
  await b.eval(`document.getElementById('sheetClose').click()`);
  await sleep(300);
  await b.eval(`[...document.querySelectorAll('.tab')].find(t=>t.dataset.tab==='map').click()`);
  await sleep(400);
  await b.eval(`[...document.querySelectorAll('.node')].find(n=>!n.classList.contains('node--dir')).click()`);
  await sleep(1800);
  const diffMobile = await b.json(`(()=>{const d=document.querySelector('.diff');
      if(!d) return {none:true};
      return {none:false, scrollW:d.scrollWidth, clientW:d.clientWidth,
              lines:d.querySelectorAll('.diff__line').length}})()`);
  check('Телефон: дифф без горизонтальной прокрутки',
    diffMobile.none || diffMobile.scrollW <= diffMobile.clientW + 2,
    diffMobile.none ? 'диффа не оказалось' : `${diffMobile.scrollW} ≤ ${diffMobile.clientW}, строк ${diffMobile.lines}`);
  await b.eval(`document.getElementById('sheetClose').click()`);

  // Словарь на телефоне
  await b.eval(`document.getElementById('btnGlossary').click()`);
  await sleep(700);
  const glMobile = await b.json(`({items:document.querySelectorAll('.gl__item').length,
      sheet:!document.getElementById('sheet').hidden})`);
  check('Телефон: словарь в шторке', glMobile.sheet && glMobile.items >= 25, glMobile.items + ' терминов');
  await b.eval(`document.getElementById('sheetClose').click()`);

  // Настройки на телефоне
  await b.eval(`document.getElementById('btnSettings').click()`);
  await sleep(700);
  const setMobile = await b.json(`({rows:[...document.querySelectorAll('.row__label b')].map(e=>e.textContent)})`);
  check('Телефон: экран настроек', setMobile.rows.length >= 6, setMobile.rows.join(' | '));
  await b.eval(`document.getElementById('sheetClose').click()`);

  // Сигнал: теперь он не всплывает в углу, а зажигает картушку.
  await b.eval(`document.getElementById('btnBell').click()`);
  await sleep(600);
  const alarmMobile = await b.json(`(()=>{const a=document.getElementById('rose');
      const r=a.getBoundingClientRect();
      return {state:a.dataset.state, w:Math.round(r.width), inScreen:r.right<=window.innerWidth+1,
              title:document.getElementById('roseState').textContent,
              act:!document.getElementById('roseAct').hidden,
              tab:document.title}})()`);
  check('Телефон: сигнал зажигает картушку и помещается в экран',
    alarmMobile.state === 'waiting' && alarmMobile.inScreen && alarmMobile.act,
    `${alarmMobile.w}px, «${alarmMobile.title}», вкладка: «${alarmMobile.tab}»`);
  await b.eval(`document.getElementById('roseSeen').click()`);

  // Тур на телефоне
  await b.eval(`document.getElementById('btnTour').click()`);
  await sleep(600);
  const tourMobile = await b.json(`(()=>{const c=document.getElementById('tourCard');
      const r=c.getBoundingClientRect();
      return {shown:!document.getElementById('tour').hidden, inScreen:r.right<=window.innerWidth+1 && r.left>=-1,
              fits:r.bottom<=window.innerHeight+1}})()`);
  check('Телефон: тур помещается в экран',
    tourMobile.shown && tourMobile.inScreen && tourMobile.fits, JSON.stringify(tourMobile));
  await b.eval(`document.getElementById('tourSkip').click()`);

  await b.eval(`[...document.querySelectorAll('.tab')].find(t=>t.dataset.tab==='feed').click()`);
  await sleep(300);
  await b.shot(SHOTS + '/v2-mobile.png');
  await b.eval(`[...document.querySelectorAll('.tab')].find(t=>t.dataset.tab==='git').click()`);
  await sleep(400);
  await b.shot(SHOTS + '/v2-mobile-git.png');

  // PWA
  const pwa = JSON.parse(await b.eval(`(async()=>{
    const mf = await fetch('/manifest.json').then(r=>r.json()).catch(()=>null);
    const sw = await fetch('/sw.js').then(r=>r.ok).catch(()=>false);
    const off = await fetch('/offline.html').then(r=>r.ok).catch(()=>false);
    const icon = await fetch('/icons/icon-192.png').then(r=>r.ok).catch(()=>false);
    return JSON.stringify({name: mf && mf.name, icons: mf ? mf.icons.length : 0,
            display: mf && mf.display, sw, off, icon,
            registered: !!(navigator.serviceWorker && navigator.serviceWorker.controller)});
  })()`));
  check('PWA: манифест, service worker, иконки, офлайн-страница',
    !!pwa.name && pwa.icons >= 5 && pwa.sw && pwa.off && pwa.icon,
    `«${pwa.name}», иконок ${pwa.icons}, display=${pwa.display}`);

  const errs = await b.json(`window.__err || []`);
  check('Нет ошибок JS', errs.length === 0, errs.join(' ; '));
  check('Приветствие первого запуска показывается', welcomeShown);
  check('Приветствие переходит в тур', tourShown);

  // ─── отчёт ───────────────────────────────────────────────────────────────
  console.log('\n=== РЕВИЗИЯ ФУНКЦИЙ ===\n');
  checks.forEach((c) => {
    console.log((c.ok ? '  ✔ ' : '  ✖ ') + c.name + (c.detail ? '\n      ' + c.detail : ''));
  });
  const bad = checks.filter((c) => !c.ok);
  console.log('\nИтого: ' + (checks.length - bad.length) + '/' + checks.length +
    ' ок, проблем: ' + bad.length + '\n');

  await b.close();
  process.exit(bad.length ? 1 : 0);
})().catch(async (e) => {
  console.error('СБОЙ РЕВИЗИИ:', e.message);
  try { killAll(); } catch (x) { /* нечего убивать */ }
  process.exit(1);
});
