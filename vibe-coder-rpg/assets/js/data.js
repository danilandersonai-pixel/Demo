/* ============================================================
   Вайб-Кодер — данные игры: палитра, пиксель-арт, карты,
   враги, предметы, навыки. Чистые данные, без логики.
   ============================================================ */
'use strict';

/* ---------- палитра (32-битный пиксельный вайб) ---------- */
window.PAL = {
  '.': null,
  '0': '#101019', // почти чёрный (глаза, контуры)
  '1': '#ffffff',
  '2': '#0f1220',
  'a': '#f6cfa4', // кожа
  'A': '#d9a06c',
  'h': '#5b3a25', // каштановые волосы
  'H': '#3d2617',
  'j': '#f2d54d', // золотой / блонд
  'J': '#c7a52f',
  'r': '#e04f4f', // красный
  'R': '#a83030',
  'g': '#49b866', // зелёный
  'G': '#2f7d45',
  'l': '#a3e14f', // лайм
  'L': '#6fae2b',
  'b': '#4f7de0', // синий
  'B': '#33549f',
  'c': '#54d6d6', // циан
  'C': '#2f9d9d',
  'p': '#a86fe0', // фиолетовый
  'P': '#7647a8',
  'f': '#f272c8', // розовый
  'F': '#c04797',
  'o': '#f0913f', // оранжевый
  'O': '#bf6a22',
  'v': '#e88968', // коралловый (Клод)
  'V': '#c05f3f',
  'y': '#f6e26b', // жёлтый светлый
  'Y': '#cdb13f',
  'w': '#ece7db', // тёплый белый
  'W': '#b9b3a4',
  'k': '#3a3f52', // сланец
  'K': '#232637',
  'm': '#9aa2b5', // металл
  'M': '#66708c',
  'd': '#8a5a34', // дерево
  'D': '#5f3c20',
  'n': '#274060', // тёмно-синий
  'N': '#16263c',
  't': '#7de3a0', // мятный (экраны терминалов)
  's': '#8a92a8', // камень
  'S': '#5a6278',
};

/* ---------- шаблоны человечков (16×16) ----------
   q/Q — волосы, z/Z — одежда, u — штаны, a/A — кожа, 0 — глаза.
   Реальные цвета подставляются при сборке спрайта. */
window.HUMAN_TPL = {
  down: [
    '....qqqqqqqq....',
    '...qqqqqqqqqq...',
    '..qqqqqqqqqqqq..',
    '..qQaaaaaaaaQq..',
    '..qQaaaaaaaaQq..',
    '...aa0aaaa0aa...',
    '...aaaaaaaaaa...',
    '...aaaa00aaaa...',
    '....aaaaaaaa....',
    '...zzzzzzzzzz...',
    '..zZzzzzzzzzZz..',
    '..aZzzzzzzzzZa..',
    '..aZzzzzzzzzZa..',
    '...ZZZZZZZZZZ...',
    '...uu......uu...',
    '...uu......uu...',
  ],
  up: [
    '....qqqqqqqq....',
    '...qqqqqqqqqq...',
    '..qqqqqqqqqqqq..',
    '..qqqqqqqqqqqq..',
    '..qQqqqqqqqqQq..',
    '...qqqqqqqqqq...',
    '...QqqqqqqqQq...',
    '...aaQqqqqQaa...',
    '....aaaaaaaa....',
    '...zzzzzzzzzz...',
    '..zZzzzzzzzzZz..',
    '..aZzzzzzzzzZa..',
    '..aZzzzzzzzzZa..',
    '...ZZZZZZZZZZ...',
    '...uu......uu...',
    '...uu......uu...',
  ],
  side: [
    '....qqqqqqqq....',
    '...qqqqqqqqqq...',
    '..qqqqqqqqqqqq..',
    '..qqqqaaaaaaQq..',
    '..qQqqaaaaaaQq..',
    '...qqaa0aa0aa...',
    '...qqaaaaaaaa...',
    '...qqaaa00aaa...',
    '....aaaaaaaa....',
    '...zzzzzzzzzz...',
    '...zzzzzzzzZz...',
    '...azzzzzzzza...',
    '...azzzzzzzza...',
    '...ZZZZZZZZZZ...',
    '....uu...uu.....',
    '....uu...uu.....',
  ],
};

/* ---------- варианты ног для анимации ходьбы ----------
   индекс 0 — стоя, 1/2 — шаги (заменяют две нижние строки шаблона) */
window.LEG_FRAMES = {
  down: [
    ['...uu......uu...', '...uu......uu...'],
    ['...uu......uu...', '...uu...........'],
    ['...uu......uu...', '...........uu...'],
  ],
  up: [
    ['...uu......uu...', '...uu......uu...'],
    ['...uu......uu...', '...........uu...'],
    ['...uu......uu...', '...uu...........'],
  ],
  side: [
    ['....uu...uu.....', '....uu...uu.....'],
    ['...uu.....uu....', '...uu.....uu....'],
    ['......uuuu......', '......uuuu......'],
  ],
};

/* ---------- аксессуары персонажей (оверлеи на голову/торс) ----------
   Рисуются поверх собранного спрайта. down/side — 16×16, '.' прозрачно. */
window.ACCESSORIES = {
  glasses: { // круглые очки
    rows: {
      down: [[5, '....10011001....']],
      side: [[5, '.....1001001....']],
    },
  },
  helmet: { // шлем стража
    rows: {
      down: [[0, '....mmmmmmmm....'], [1, '...mmmmmmmmmm...'], [2, '..mMmmmmmmmmMm..'], [3, '..mM........Mm..']],
      up:   [[0, '....mmmmmmmm....'], [1, '...mmmmmmmmmm...'], [2, '..mMmmmmmmmmMm..'], [3, '..mM........Mm..']],
      side: [[0, '....mmmmmmmm....'], [1, '...mmmmmmmmmm...'], [2, '..mMmmmmmmmmMm..'], [3, '..mM........Mm..']],
    },
  },
  beard: { // белая борода
    rows: {
      down: [[6, '...w........w...'], [7, '...ww......ww...'], [8, '....wwwwwwww....'], [9, '.....wwwwww.....']],
      side: [[7, '...ww...........'], [8, '....wwwww.......'], [9, '.....www........']],
    },
  },
  apron: { // фартук баристы
    rows: {
      down: [[10, '....wwwwwwww....'], [11, '....wwwwwwww....'], [12, '....wwwwwwww....'], [13, '.....wwwwww.....']],
      side: [[10, '.....wwwwww.....'], [11, '.....wwwwww.....'], [12, '.....wwwwww.....']],
    },
  },
  headset: { // гарнитура тимлида
    rows: {
      down: [[3, '..k..........k..'], [4, '..kk........kk..'], [5, '..k..........k..']],
      side: [[3, '..k.............'], [4, '..kk............'], [5, '..kk............']],
    },
  },
  beanie: { // шапка стажёра
    rows: {
      down: [[0, '....llllllll....'], [1, '...llLlLlLlll...'], [2, '..llllllllllll..']],
      up:   [[0, '....llllllll....'], [1, '...llLlLlLlll...'], [2, '..llllllllllll..']],
      side: [[0, '....llllllll....'], [1, '...llLlLlLlll...'], [2, '..llllllllllll..']],
    },
  },
};

/* ---------- спрайты (строчный пиксель-арт) ---------- */
window.SPRITES = {

  cat: [ // рыжий кот
    '................',
    '...o......o.....',
    '...oo....oo.....',
    '...oooooooo.....',
    '..oooooooooo....',
    '..o0oooo0ooo....',
    '..oooooooooo....',
    '..ooo1o1oooo....',
    '...oooooooo.....',
    '...OooooooO.....',
    '..oooooooooo.o..',
    '..oooooooooo.o..',
    '..oOoooooOoo..o.',
    '..oo.oo..oo...o.',
    '..OO.OO..OO..oo.',
    '................',
  ],

  robot: [ // робот-уборщик техдолга
    '................',
    '................',
    '.......1........',
    '.......m........',
    '....mmmmmmm.....',
    '...mmmmmmmmm....',
    '...mm0cc0mmm....',
    '...mmmmmmmmm....',
    '..mmMMMMMMMmm...',
    '..mKmmmmmmmKm...',
    '..mmmmmmmmmmm...',
    '..mMmmMmmMmmm...',
    '...mmmmmmmmm....',
    '...KK.....KK....',
    '................',
    '................',
  ],


  claude: [ // дух ИИ, коралловый
    '................',
    '.....vvvvvv.....',
    '...vvvvvvvvvv...',
    '..vvvvvvvvvvvv..',
    '..vvwwwwwwwwvv..',
    '..vvw0wwww0wvv..',
    '..vvwwwwwwwwvv..',
    '..vvww0000wwvv..',
    '..vvvwwwwwwvvv..',
    '..vvvvvvvvvvvv..',
    '...vVvvvvvvVv...',
    '....vvVVVVvv....',
    '.....v.vv.v.....',
    '......v..v......',
    '................',
    '................',
  ],

  bug: [ // Жук-Тайпо
    '................',
    '....0......0....',
    '.....0....0.....',
    '....rrrrrrrr....',
    '...rrRrrrrRrr...',
    '..rrrrrrrrrrrr..',
    '..rRrrrrrrrrRr..',
    '..rrrr0rr0rrrr..',
    '..rrrrrrrrrrrr..',
    '...rrrr11rrrr...',
    '....rrrrrrrr....',
    '..0..rrrrrr..0..',
    '.0....0..0....0.',
    '................',
    '................',
    '................',
  ],

  glitch: [ // CSS-Глюк
    '................',
    '................',
    '....cccccc......',
    '...cccccccc.f...',
    '..ccccccccccff..',
    '.f.ccc0cc0ccc...',
    '.ffcccccccccc...',
    '..cccc0000cccf..',
    '.ccccccccccccff.',
    '.cccffcccccccc..',
    'cccccccccccccc..',
    'cCcccccCcccccCc.',
    '.CCcccCCcccCCC..',
    '..CCCCCCCCCCC...',
    '................',
    '................',
  ],

  ghost: [ // Нулл-Поинтер
    '................',
    '.....pppppp.....',
    '....pppppppp....',
    '...pppppppppp...',
    '...pp1pppp1pp...',
    '...pp0pppp0pp...',
    '...pppppppppp...',
    '...ppp0000ppp...',
    '...pppppppppp...',
    '...pppppppppp...',
    '...pPppPppPpp...',
    '...pp.pp.pp.p...',
    '....p..p..p.....',
    '................',
    '................',
    '................',
  ],

  crab: [ // Мерж-Краб
    '................',
    '..00........00..',
    '.0oo0......0oo0.',
    '.0ooo0....0ooo0.',
    '..0oo0....0oo0..',
    '...00......00...',
    '....oooooooo....',
    '...oooooooooo...',
    '..oo0oooooo0oo..',
    '..oooooooooooo..',
    '..ooo000000ooo..',
    '...oOoooooooO...',
    '....O.O..O.O....',
    '................',
    '................',
    '................',
  ],

  sloth: [ // Прокрастинация
    '................',
    '................',
    '.....kkkkkk.....',
    '...kkkkkkkkkk...',
    '..kkkkkkkkkkkk..',
    '.kkk00kkkk00kkk.',
    '.kkkkkkkkkkkkkk.',
    '.kkkkkk00kkkk1k.',
    '.kkkkkkkkkkkk1k.',
    '.kkkkkkkkkkkkkk.',
    '.kKkkkkKkkkkKkk.',
    '..kkkkkkkkkkkk..',
    '...KKKKKKKKKK...',
    '................',
    '................',
    '................',
  ],

  spaghetti: [ // Спагетти-Монстр (24×24)
    '........................',
    '.......yyyyyyyyy........',
    '.....yyYyyYyyYyyyy......',
    '....yYyyyyyyyyyYyyy.....',
    '...yyyyrryyyyrryyyyy....',
    '..yyyyr00ryyr00ryyyyy...',
    '..yYyyr00ryyr00ryyYyy...',
    '..yyyyyrryyyyrryyyyyy...',
    '.yyYyyyyyyyyyyyyyyYyyy..',
    '.yyyyyYyyy0000yyyyyyyy..',
    '.yYyyyyyy0yyyy0yyyYyyy..',
    '.yyyyYyyyyyyyyyyyyyyyy..',
    '..yyyyyYyyyyYyyyyYyyy...',
    '..yYyyyyyyyyyyyyyyyyy...',
    '...yyyYyyyyYyyyyYyyy....',
    '...yyyyyyyyyyyyyyyyy....',
    '....yYyy.yyYyy.yyYy.....',
    '....yyy...yyy...yyy.....',
    '...Yyy....Yyy...Yyy.....',
    '...yy......yy....yy.....',
    '..Yy.......Yy.....Yy....',
    '..y........y.......y....',
    '........................',
    '........................',
  ],

  conflict: [ // Мерж-Конфликт, двухголовый голем (24×24)
    '........................',
    '...ssss........ssss.....',
    '..ssssss......ssssss....',
    '..s0ss0s......s0ss0s....',
    '..ssrrss......ssrrss....',
    '...ssss..pppp..ssss.....',
    '...sSssppppppssssS......',
    '..sssssspppppssssss.....',
    '.sssssssspppssssssss....',
    '.sSssssssspssssssSss....',
    '.ssssssssspssssssssss...',
    '.sssSssssspsssssSssss...',
    '.sssssssspppssssssss....',
    '..sSsssspppppsssSss.....',
    '..sssssspppppssssss.....',
    '...ssssspppppsssss......',
    '...sssssspppssssss......',
    '....ssss.....ssss.......',
    '....ssss.....ssss.......',
    '...sSsss.....sSsss......',
    '...SSSS.......SSSS......',
    '........................',
    '........................',
    '........................',
  ],

  dragon: [ // Дедлайн-Дракон (32×32)
    '................................',
    '......kk................kk......',
    '.....krrk..............krrk.....',
    '.....rrrr..............rrrr.....',
    '......rrrrrrrrrrrrrrrrrrrr......',
    '.....rrrrrrrrrrrrrrrrrrrrrr.....',
    '....rrRrrrrrrrrrrrrrrrrrRrrr....',
    '....rr100rrrrrrrrrrrr100rrr.....',
    '....rrrrrrrrrrrrrrrrrrrrrrr.....',
    '.....rrrryyyyyyyyyyyyrrrr.......',
    '.....rrry0y0y0y0y0y0yrrrr.......',
    '......rryyyyyyyyyyyyrr..........',
    '....rrrrrrrrrrrrrrrrrrrr........',
    '..rrrrrrRRrrrrrrrrRRrrrrrr......',
    '.rrrrrrrrrrryyyyrrrrrrrrrrr.....',
    '.rrkrrrrrrryyyyyyrrrrrrrkrr.....',
    '.rkkrrrrrryyyYYyyyrrrrrrkkr.....',
    '.rkrrrrrrryyyYYyyyrrrrrrrkr.....',
    '..rrrrrrrryyyyyyyyrrrrrrrr......',
    '..rrrrrrrrryyyyyyrrrrrrrr.......',
    '...rrrrrrrrryyyyrrrrrrrr........',
    '...RrrrrrrrrrrrrrrrrrrR.........',
    '....rrrr..rrrrrrr..rrrr.........',
    '....rrr....rrrrr....rrr.........',
    '...krrk....rrrrr...krrk.........',
    '...kkkk....RRRRR...kkkk.........',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
  ],

  chest: [
    '................',
    '................',
    '................',
    '...dddddddddd...',
    '..dDDDDDDDDDDd..',
    '..dDddddddddDd..',
    '..dddddyyddddd..',
    '..DDDDDyyDDDDD..',
    '..dddddyyddddd..',
    '..dDddddddddDd..',
    '..dDddddddddDd..',
    '..dDDDDDDDDDDd..',
    '...dddddddddd...',
    '................',
    '................',
    '................',
  ],

  chestOpen: [
    '................',
    '...dddddddddd...',
    '..d2222222222d..',
    '..d2222222222d..',
    '..dddddddddddd..',
    '................',
    '..dddddyyddddd..',
    '..DDDDDyyDDDDD..',
    '..dddddyyddddd..',
    '..dDddddddddDd..',
    '..dDddddddddDd..',
    '..dDDDDDDDDDDd..',
    '...dddddddddd...',
    '................',
    '................',
    '................',
  ],

  bean: [ // кофе-зерно
    '................',
    '................',
    '................',
    '................',
    '......dddd......',
    '.....dddddd.....',
    '....ddDDDddd....',
    '....dDdddDdd....',
    '....dDdddDdd....',
    '....ddDDDddd....',
    '.....dddddd.....',
    '......dddd......',
    '................',
    '................',
    '................',
    '................',
  ],

  crystal: [ // Коммит-Кристалл
    '................',
    '................',
    '.......cc.......',
    '......cccc......',
    '.....cc1ccc.....',
    '.....c11cccc....',
    '....cc11ccccc...',
    '....c1ccccccc...',
    '....ccccccccc...',
    '.....ccccccC....',
    '.....cccccC.....',
    '......cccC......',
    '.......cC.......',
    '................',
    '................',
    '................',
  ],

  token: [ // Токен Доступа
    '................',
    '................',
    '................',
    '...yyyyyyyyyy...',
    '..yyYYYYYYYYyy..',
    '..yy0000000yyy..',
    '..yy0ttttt0yyy..',
    '..yy0ttttt0yyy..',
    '..yy0000000yyy..',
    '..yyYyYyYyYyyy..',
    '..yyyyyyyyyyyy..',
    '...yyyyyyyyyy...',
    '................',
    '................',
    '................',
    '................',
  ],

  sign: [
    '................',
    '................',
    '...dddddddddd...',
    '..dwwwwwwwwwwd..',
    '..dwKwKwKwKwwd..',
    '..dwwwwwwwwwwd..',
    '..dwKwKwKKwwwd..',
    '..dwwwwwwwwwwd..',
    '...dddddddddd...',
    '.......dd.......',
    '.......dd.......',
    '.......dd.......',
    '................',
    '................',
    '................',
    '................',
  ],

  terminal: [
    '................',
    '..kkkkkkkkkkkk..',
    '.kkKKKKKKKKKKkk.',
    '.kkKttKtttKKKkk.',
    '.kkKKKKKKKKKKkk.',
    '.kkKtttKttKKKkk.',
    '.kkKKKKKKKKKKkk.',
    '.kkKttttKtKKKkk.',
    '.kkKKKKKKKKKKkk.',
    '..kkkkkkkkkkkk..',
    '...kkkkkkkkkk...',
    '..kkkkkkkkkkkk..',
    '..mmmmmmmmmmmm..',
    '................',
    '................',
    '................',
  ],
};

/* ---------- тайлы ----------
   Символы карты:
   . трава   , высокая трава (энкаунтеры)  F цветы   t дерево
   w вода    = мост    p тропа    # скала
   b стена   r крыша   d дверь (декор)     T древний терминал
   C стена пещеры      c пол пещеры        ; щебень (энкаунтеры)
   P плитка города     S серверная башня   ~ поток данных
   f паркет (интерьер) x пустота
   Декор: W стена с окном  e забор  g камешки  m гриб  L фонарь
          K кристалл  u сталагмит  q ковёр  B стена со знаменем */
window.SOLID_TILES = new Set(['t','w','#','b','r','d','T','C','S','~','x','W','e','L','K','u','B']);
window.ENCOUNTER_TILES = new Set([',', ';']);

/* ---------- карты ---------- */
window.MAPS = {

  village: {
    name: 'Деревня Локалхост',
    pad: 't',
    theme: { sky: '#2c4a6e', ground: '#3e8e50' },
    music: 'calm',
    encounters: [],
    ambient: 'petals',
    rows: [
      'tttttttttttttttttttttttttttt',
      't....g......tt.......F..g..t',
      't..rrrr...rrrr......TT.....t',
      't..rrrr...rrrr......TT.....t',
      't..WdbW...WbdW......pp.....t',
      't...p.......p.......p......t',
      't...p.......p.......p......t',
      't...p.......p.......p......t',
      'tppppppppppppppppppppppppppp',
      't...p........g.........g...t',
      't...p...rrrr......FF.......t',
      't...p...rrrr......FF.......t',
      't...p...WbdW...............t',
      't...p.....p.....www........t',
      't...p.....p....wwwww.......t',
      't...ppppppp.....www........t',
      't..e.......F..F.......e....t',
      'tttttttttttttttttttttttttttt',
    ],
    portals: [
      { x: 27, y: 8, to: 'fields', tx: 1, ty: 8 },
    ],
  },

  fields: {
    name: 'Поля Фронтенда',
    pad: 't',
    theme: { sky: '#3e6ea0', ground: '#4aa25c' },
    encounters: ['typo', 'glitch'],
    ambient: 'petals',
    rows: [
      'tttttttttttttttttttttttttttttt',
      't.....,,,,........FF.........t',
      't...,,,,,,,.......FF....,,...t',
      't...,,,,,,,..............,,..t',
      't.....,,,........F...........t',
      't........g................g..t',
      't..FF.....ppp.........,,,....t',
      't.........p.p.........,,,....t',
      'pppppppppppppppppppppppppppppp',
      't.........................,,.t',
      't....www........,,,,.....,,,.t',
      't...wwwww.......,,,,.........t',
      't....www........,,,,.....FF..t',
      't.....F........,,,,,,........t',
      't..............,,,,,,........t',
      't.....g..............g.......t',
      't...F...F.............F......t',
      'tttttttttttttttttttttttttttttt',
    ],
    portals: [
      { x: 0, y: 8, to: 'village', tx: 26, ty: 8 },
      { x: 29, y: 8, to: 'forest', tx: 1, ty: 10 },
    ],
  },

  forest: {
    name: 'Лес Легаси',
    pad: 't',
    theme: { sky: '#1d3326', ground: '#2f6e3e' },
    encounters: ['typo', 'nullp', 'glitch'],
    ambient: 'leaves',
    rows: [
      'ttttttttttttttt.tttttttttttttt',
      'ttttttttttttttt.tttttttttttttt',
      'tttttttttttttt...ttttttttttttt',
      'tttttt...ttttt...ttttt.....ttt',
      'tttttt.,,.ttttt.tttt..,,,...tt',
      'ttttt.,,,,.tttt.tttt..,,,,..tt',
      'ttttt.,,,,....,,,....,,,,,..tt',
      'tttttt.,,,....,,,,...,,,...ttt',
      'ttt....m......,,,......g..tttt',
      't............,,,,...........tt',
      'pppppppppppppp,,,,pppppp..tttt',
      't.........,,,,,,,....rrrr...tt',
      't...,,.....,,,,,.....rrrr...tt',
      't...,,,..............WbdW...tt',
      't....,,....m...........g....tt',
      't..........,,,,,,...........tt',
      'tt.........,,,,,,..........ttt',
      'ttt........,,,,............ttt',
      'tttt...m..............g...tttt',
      'tttttttttttttttttttttttttttttt',
    ],
    portals: [
      { x: 0, y: 10, to: 'fields', tx: 28, ty: 8 },
      { x: 15, y: 0, to: 'cave', tx: 13, ty: 14 },
    ],
  },

  cave: {
    name: 'Пещера Мерж-Конфликтов',
    pad: 'C',
    theme: { sky: '#191326', ground: '#2c2440' },
    encounters: ['crab', 'nullp', 'sloth'],
    dark: true,
    ambient: 'dust',
    rows: [
      'CCCCCCCCCCCCCCCCCCCCCCCCCC',
      'CCCccKccCCCCCCccccKccccCCC',
      'CCcccc;;cccCCCccc;;;ccCCCC',
      'CCccc;;;;ccCCCcc;;;ccccccc',
      'CCcccc;;;cccCCcc;;;;ccccCC',
      'CCCcKcccccccccc;;;ccKccCCC',
      'CCCCCcccCCCCccccccccCCCCCC',
      'CCCCCcccCCCCcc;;;;ccCCCCCC',
      'CCCcc;;;ccCCCcccccccccCCCC',
      'CCcc;;;;;cccccccc;;;;ccCCC',
      'CCcc;;;;;;cccCCCcc;;;cccCC',
      'CCCcc;;;cccCCCCCcccccccCCC',
      'CCCCccccccCCCCCCCcccccCCCC',
      'CCCCCcccccCCCCCCCcccCCCCCC',
      'CCCCCCcccuccccccccccCCCCCC',
      'CCCCCCCCCCCCCcCCCCCCCCCCCC',
    ],
    portals: [
      { x: 13, y: 15, to: 'forest', tx: 15, ty: 1 },
      { x: 25, y: 3, to: 'city', tx: 1, ty: 9 },
    ],
  },

  city: {
    name: 'Город Продакшен',
    pad: 'S',
    theme: { sky: '#131a30', ground: '#3a4258' },
    encounters: [],
    night: true,
    ambient: 'data',
    rows: [
      'SSSSSSSSSSSSSSSSSSSSSSSSSSSS',
      'S~~~.......bbbbbb......~~~~S',
      'S~~~.......bbddbb......~~~~S',
      'S......L....PP....L........S',
      'SPPPPPPPPPPPPPPPPPPPPPPPPPPS',
      'S....PP......PP.......PP...S',
      'SSS..PP..SSS.PP.SSS...PP.SSS',
      'SSS..PP..SSS.PP.SSS...PP.SSS',
      'S....PP......PP.......PP...S',
      'PPPPPPPPPPPPPPPPPPPPPPPPPPPP',
      'S....PP..L......PP....L....S',
      'S~~..PP....S....PP....~~~..S',
      'S~~..PPPPPPPPPPPPP....~~~..S',
      'S....L.......P........L....S',
      'S..........................S',
      'SSSSSSSSSSSSSSSSSSSSSSSSSSSS',
    ],
    portals: [
      { x: 0, y: 9, to: 'cave', tx: 24, ty: 3 },
      { x: 13, y: 2, to: 'tower', tx: 7, ty: 11, needs: 'token',
        deniedMsg: 'Дверь Башни Деплоя запечатана CI-магией. Нужен Токен Доступа.' },
      { x: 14, y: 2, to: 'tower', tx: 8, ty: 11, needs: 'token',
        deniedMsg: 'Дверь Башни Деплоя запечатана CI-магией. Нужен Токен Доступа.' },
    ],
  },

  tower: {
    name: 'Башня Деплоя',
    pad: 'b',
    theme: { sky: '#33122a', ground: '#4a2440' },
    encounters: [],
    ambient: 'embers',
    rows: [
      'bbbbbbbbbbbbbbbb',
      'bbbBbbbbbbbbBbbb',
      'bffffffqqffffffb',
      'bffffffqqffffffb',
      'bffffffqqffffffb',
      'bffffffqqffffffb',
      'bffffffqqffffffb',
      'bffffffqqffffffb',
      'bffffffqqffffffb',
      'bffffffqqffffffb',
      'bffffffqqffffffb',
      'bffffffqqffffffb',
      'bbbbbbbqqbbbbbbb',
      'bbbbbbbqqbbbbbbb',
    ],
    portals: [
      { x: 7, y: 13, to: 'city', tx: 13, ty: 3 },
      { x: 8, y: 13, to: 'city', tx: 14, ty: 3 },
    ],
  },
};

/* ---------- враги ---------- */
window.ENEMIES = {
  typo: {
    name: 'Жук-Тайпо', spr: 'bug', hp: 22, atk: 6, def: 1, xp: 12, coins: 6,
    lines: ['Жук-Тайпо меняет местами буквы в твоих мыслях!', 'Жук-Тайпо стрекочет: «teh, retrun, funciton!»'],
  },
  glitch: {
    name: 'CSS-Глюк', spr: 'glitch', hp: 28, atk: 7, def: 2, xp: 16, coins: 9,
    lines: ['CSS-Глюк сдвигает всё на 1 пиксель влево!', 'CSS-Глюк шепчет: «!important…»'],
  },
  nullp: {
    name: 'Нулл-Поинтер', spr: 'ghost', hp: 36, atk: 9, def: 2, xp: 22, coins: 12,
    lines: ['Нулл-Поинтер указывает в пустоту. Пустота смотрит в ответ.', 'Нулл-Поинтер воет: «undefined is not a function!»'],
  },
  crab: {
    name: 'Мерж-Краб', spr: 'crab', hp: 42, atk: 10, def: 4, xp: 28, coins: 15,
    lines: ['Мерж-Краб щёлкает клешнями: <<<<<<< HEAD', 'Мерж-Краб пятится вбок, унося твои изменения.'],
  },
  sloth: {
    name: 'Прокрастинация', spr: 'sloth', hp: 50, atk: 9, def: 3, xp: 30, coins: 16,
    lines: ['Прокрастинация мурлычет: «сделаешь завтра…»', 'Прокрастинация показывает тебе смешное видео про котов.'],
  },
  spaghetti: {
    name: 'Спагетти-Монстр', spr: 'spaghetti', hp: 95, atk: 11, def: 3, xp: 70, coins: 50, boss: true,
    lines: ['Спагетти-Монстр опутывает тебя вложенными колбэками!', 'Спагетти-Монстр рычит: «Я — функция на 2000 строк!»'],
  },
  conflict: {
    name: 'Мерж-Конфликт', spr: 'conflict', hp: 140, atk: 13, def: 5, xp: 120, coins: 90, boss: true,
    lines: ['Обе головы Мерж-Конфликта кричат разные версии правды!', 'Мерж-Конфликт ревёт: «ПРИМИ ОБЕ ВЕТКИ, СМЕРТНЫЙ!»'],
  },
  dragon: {
    name: 'Дедлайн-Дракон', spr: 'dragon', hp: 230, atk: 16, def: 6, xp: 300, coins: 250, boss: true, final: true,
    lines: ['Дедлайн-Дракон дышит горящими сроками!', 'Дедлайн-Дракон ревёт: «ЭТО НУЖНО БЫЛО ВЧЕРА!»', 'Часы на шее дракона тикают всё громче.'],
  },
};

/* ---------- предметы ---------- */
window.ITEMS = {
  coffee:   { name: 'Кофе',              desc: '+35 HP. Горячий, как хотфикс.', usable: true, hp: 35 },
  energy:   { name: 'Энергетик',         desc: '+20 EN. Вкус дедлайна и цитруса.', usable: true, en: 20 },
  bean:     { name: 'Кофе-зерно',        desc: 'Квестовое. Пахнет продуктивностью.' },
  palette:  { name: 'Палитра Пикселя',   desc: 'Квестовое. 32 бита чистого вдохновения.' },
  crystal:  { name: 'Коммит-Кристалл',   desc: 'Квестовое. Внутри застыл идеальный коммит.' },
  token:    { name: 'Токен Доступа',     desc: 'Квестовое. Открывает Башню Деплоя.' },
  keyboard: { name: 'Меха-клавиатура',   desc: 'АТК +3. Кликает так, что враги нервничают.', passive: { atk: 3 } },
  hoodie:   { name: 'Худи «grep»',       desc: 'ЗАЩ +2. Уютная броня настоящего кодера.', passive: { def: 2 } },
  duck:     { name: 'Резиновая Уточка',  desc: 'Шанс оглушения «Дебагом» вырастает до 60%.', passive: { duck: true } },
};

/* ---------- навыки ---------- */
window.SKILLS = [
  { id: 'prompt',   name: 'Промпт',       en: 0,  mult: 1.0, desc: 'Точная просьба. Бесплатно.' },
  { id: 'debug',    name: 'Дебаг',        en: 4,  mult: 1.3, stun: 0.35, desc: 'Может оглушить (35%)' },
  { id: 'refactor', name: 'Рефакторинг',  en: 8,  mult: 2.0, desc: 'Мощный чистый удар' },
  { id: 'vibe',     name: 'Вайб-запрос',  en: 12, mult: 2.8, needsClaude: true, desc: 'Клод генерит решение' },
];

/* ---------- подсказки по сюжету ---------- */
window.QUEST_HINTS = [
  'Поговори с наставницей — Сеньорой Октавией. Она стоит на площади Деревни Локалхост.',
  'Найди Древний Терминал в северо-восточном углу деревни и поговори с духом, который в нём живёт.',
  'Отправляйся на восток, в Поля Фронтенда. Дизайнеру Пиксель нужна помощь — её Палитру утащили в сундук на юго-востоке полей.',
  'Пробейся через Лес Легаси на восток от полей. Тропа к пещере на севере леса — но её сторожит Спагетти-Монстр.',
  'Покажи Коммит-Кристалл Гит-Стражу у входа в пещеру. Внутри найди выход в Продакшен — его охраняет Мерж-Конфликт.',
  'Ты в Городе Продакшен! Поговори с Тимлидом Грейс у Башни Деплоя и войди в башню с Токеном Доступа.',
  'Дедлайн-Дракон повержен! Подойди к Деплой-Терминалу в башне и запусти Великий Релиз.',
  'Игра пройдена! Мир Кодоземья вайбует. Можешь гулять, добивать сайд-квесты и просто ловить вайб.',
];
