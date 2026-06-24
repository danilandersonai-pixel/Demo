/* ============================================================
   КОНФИГ СВАДЕБНОГО САЙТА — единственный файл, который правят
   под новую свадьбу.

   Меняйте значения ниже — имена, дату, тексты, адреса, фото,
   палитру. Разметка (index.html), стили (styles.css) и логика
   (main.js) трогать не нужно: страница рендерится из этого
   объекта через assets/js/render.js.

   Пример заполнен данными «Егор & Диана» (26.08.2026, СПб).
   ============================================================ */
window.WEDDING = {

  /* --- Пара --- */
  couple: {
    name1: "Егор",
    name2: "Диана",
    monogram1: "Е",
    monogram2: "Д",
    amp: "&",
    hashtag: "#EgDiDa"
  },

  /* --- Событие ---
     dateISO — дата в формате YYYY-MM-DD; startTime/endTime — HH:MM
     (локальное время города); utcOffset — смещение часового пояса
     города от UTC в часах (Москва/СПб = 3). */
  event: {
    dateISO: "2026-08-26",
    startTime: "10:00",
    endTime: "23:00",
    utcOffset: 3,
    city: "Санкт-Петербург"
  },

  /* --- Мета (вкладка браузера, описание, цвет темы) --- */
  meta: {
    title: "Егор & Диана — Приглашение на свадьбу · 26.08.2026",
    description: "Приглашение на свадьбу Егора и Дианы, 26 августа 2026 года, Санкт-Петербург.",
    themeColor: "#4a0008",
    lang: "ru-RU"
  },

  /* --- Hero (первый экран) --- */
  hero: {
    kicker: "Приглашение на свадьбу",
    sub: "Приглашаем разделить наш день",
    ctaText: "Подтвердить присутствие",
    photo1: "assets/img/photo-01.jpg",
    photo2: "assets/img/photo-02.jpg"
  },

  /* --- Обратный отсчёт --- */
  countdown: {
    kicker: "До встречи остаётся"
  },

  /* --- Галерея «Четыре кадра о нас» (раскладка рассчитана на 4 фото) --- */
  gallery: [
    { image: "assets/img/photo-01.jpg", alt: "Кадр первый: начало истории",  roman: "I",   caption: "Начало",   tilt: "-1.6deg", parallax: "0.035" },
    { image: "assets/img/photo-02.jpg", alt: "Кадр второй: вдвоём",          roman: "II",  caption: "Вдвоём",   tilt: "1.4deg",  parallax: "-0.03" },
    { image: "assets/img/photo-03.jpg", alt: "Кадр третий: обещание",        roman: "III", caption: "Обещание", tilt: "-1.2deg", parallax: "0.045" },
    { image: "assets/img/photo-04.jpg", alt: "Кадр четвёртый: навсегда",     roman: "IV",  caption: "Навсегда", tilt: "1.8deg",  parallax: "-0.04" }
  ],

  /* --- Love Story --- */
  story: [
    {
      year: "2021",
      title: "Первая встреча",
      text: "Случайный вечер, общие друзья и&nbsp;разговор, который не&nbsp;хотелось заканчивать. Так начинаются лучшие истории.",
      image: "assets/img/photo-01.jpg",
      alt: "2021 год: первая встреча Егора и Дианы",
      tilt: "-1.8deg",
      parallax: "0.03"
    },
    {
      year: "2022",
      title: "Первое свидание",
      text: "Прогулка по&nbsp;набережным до&nbsp;самого рассвета — и&nbsp;понимание, что Петербург теперь наш город на&nbsp;двоих.",
      image: "assets/img/photo-02.jpg",
      alt: "2022 год: первое свидание",
      tilt: "1.5deg",
      parallax: "-0.028"
    },
    {
      year: "2023",
      title: "Первое путешествие",
      text: "Чемодан на&nbsp;двоих, дорога и&nbsp;сотни фотографий. С&nbsp;тех пор мы&nbsp;путешествуем только вместе.",
      image: "assets/img/photo-03.jpg",
      alt: "2023 год: первое совместное путешествие",
      tilt: "-1.3deg",
      parallax: "0.032"
    },
    {
      year: "2025",
      title: "Предложение",
      text: "Одно колено, одно кольцо и&nbsp;одно самое короткое «да» в&nbsp;нашей жизни. Дальше — 26 августа 2026 года.",
      image: "assets/img/photo-04.jpg",
      alt: "2025 год: предложение руки и сердца",
      tilt: "1.7deg",
      parallax: "-0.03"
    }
  ],

  /* --- Программа дня --- */
  program: [
    {
      time: "10:00",
      datetime: "2026-08-26T10:00",
      title: "Регистрация в&nbsp;ЗАГСе",
      description: "Петроградский район, ул. Большая Монетная, 17-19, Санкт-Петербург"
    },
    {
      time: "17:00",
      datetime: "2026-08-26T17:00",
      title: "Сбор гостей во&nbsp;дворце",
      description: "Дворец Кваренги, Казанская ул., 7а лит. А, Санкт-Петербург"
    },
    {
      time: "17:30",
      datetime: "2026-08-26T17:30",
      title: "Торжественная часть",
      description: "Главные слова, аплодисменты и&nbsp;первый тост вечера."
    },
    {
      time: "23:00",
      datetime: "2026-08-26T23:00",
      title: "Завершение вечера",
      description: "Прощаемся до&nbsp;новых встреч — уже семьёй."
    }
  ],

  /* --- Как добраться ---
     address — ПОЛНЫЙ человекочитаемый адрес (НЕ url-encoded);
     из него render строит карту и кнопки маршрутов. */
  locations: [
    {
      time: "10:00 · Церемония",
      type: "ceremony",
      title: "ЗАГС Петроградского района",
      address: "Санкт-Петербург, Большая Монетная улица, 17-19",
      zoom: 16
    },
    {
      time: "17:00 · Праздничный вечер",
      type: "party",
      title: "Дворец Кваренги",
      address: "Санкт-Петербург, Казанская улица, 7а",
      zoom: 16
    }
  ],

  /* --- Детали --- */
  details: {
    dress: {
      title: "Дресс-код",
      text: "Для дам — пастельные тона, для мужчин — костюмы. Пусть вечер сложится в&nbsp;единую палитру.",
      image: "assets/img/dress-code.jpeg",
      alt: "Палитра дресс-кода",
      swatches: [
        { color: "#e9c8c5", name: "Пудра" },
        { color: "#aebfa8", name: "Шалфей" },
        { color: "#c5bedd", name: "Лаванда" },
        { color: "#f1e6d4", name: "Крем" },
        { color: "#cf9e9c", name: "Пыльная роза" },
        { color: "#aecbe0", name: "Небесно-голубой" }
      ]
    },
    gift: {
      title: "Подарки",
      text: "Вместо традиционных букетов мы&nbsp;будем рады подписке на&nbsp;цветы — так праздник продлится не&nbsp;один вечер, а&nbsp;целые месяцы.",
      linkText: "Подробнее в&nbsp;разделе «Цветы» →",
      linkHref: "#flowers"
    },
    photo: {
      title: "Фото и&nbsp;видео",
      text: "Делитесь кадрами вечера в&nbsp;нашем Telegram-канале — соберём общий альбом дня.",
      btnText: "Telegram-канал",
      telegram: "https://t.me/+EnMLrlHYcA1kZDIy",
      hashtag: "#EgDiDa"
    },
    booth: {
      title: "Фотозона",
      text: "Во&nbsp;дворце будет работать фотозона — оставьте себе кадр на&nbsp;память.",
      images: ["assets/img/booth-01.jpg", "assets/img/booth-02.jpg"]
    }
  },

  /* --- RSVP ---
     endpoint — вставьте свой Formspree endpoint, чтобы включить
     реальную отправку. Пока стоит плейсхолдер — форма работает
     в демо-режиме (ничего не шлёт). */
  rsvp: {
    kicker: "Опрос гостей",
    title: "Подтвердите присутствие",
    lead: "Пожалуйста, ответьте до&nbsp;1&nbsp;августа — нам важно подготовить всё именно для&nbsp;вас.",
    endpoint: "https://formspree.io/f/YOUR_FORM_ID",
    labels: {
      name: "ФИО",
      namePlaceholder: "Иванов Иван Иванович",
      attendanceLegend: "Подтверждение присутствия",
      attendanceYes: "Буду",
      attendanceNo: "К сожалению, не&nbsp;смогу",
      plusOneLegend: "Гость +1",
      plusOneYes: "Приду с&nbsp;парой",
      plusOneNo: "Приду один / одна",
      plusOnePlaceholder: "Имя вашего гостя",
      mealLegend: "Выбор блюда",
      mealFish: "Рыба",
      mealMeat: "Мясо",
      mealPoultry: "Птица",
      alcoholLegend: "Алкоголь",
      alcoholWine: "Вино",
      alcoholChampagne: "Шампанское",
      alcoholStrong: "Крепкое",
      alcoholNone: "Не пью",
      commentLabel: "Комментарий",
      commentPlaceholder: "Аллергии, пожелания, тёплые слова…",
      submit: "Отправить ответ"
    },
    success: {
      title: "Спасибо! Ваш ответ сохранён",
      sub: "Ждём вас 26 августа — будет красиво."
    }
  },

  /* --- Цветы (подписка вместо букетов) --- */
  flowers: {
    kicker: "Вместо букетов",
    title: "Нужно ли&nbsp;дарить цветы?",
    text: "Один вечер — и&nbsp;десятки букетов остаются без&nbsp;ваз. Мы&nbsp;придумали лучше: подарите нам подписку на&nbsp;цветы, и&nbsp;свежие композиции будут приезжать к&nbsp;нам домой ещё долго после свадьбы — как продолжение праздника.",
    hint: "Наведите камеру на&nbsp;QR-код или нажмите кнопку ниже.",
    url: "https://plombirflowers.ru/egordiana",
    cta: "Оформить подписку",
    qr: "assets/img/qr.jpeg",
    caption: "plombirflowers.ru/egordiana",
    tilt: "1.5deg"
  },

  /* --- Футер (имена/дата/хэштег берутся из couple/event) --- */
  footer: {},

  /* --- Палитра (переопределяет CSS-переменные :root через JS) --- */
  colors: {
    wine: "#4a0008",
    wineSoft: "#7d1019",
    wineDeep: "#2a0003",
    cream: "#fbf6ec",
    paper: "#fffaf2",
    gold: "#c9a253",
    goldBright: "#e8cf95",
    ink: "#211c19",
    muted: "#6f665e"
  }
};
