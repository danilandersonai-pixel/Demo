#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Собирает корпус прозы Чехова с русского Викитеки (ru.wikisource.org).

Тексты Чехова — общественное достояние. Скрипт качает вики-разметку
страниц через ``action=raw``, вычищает шаблоны, ссылки и теги и склеивает
всё в один UTF-8 файл. Между запросами пауза: у Викимедиа строгие лимиты.

Запуск:  python3 data/fetch_chekhov.py --out data/chekhov.txt
"""

import argparse
import html
import re
import sys
import time
import urllib.parse
import urllib.request

BASE = "https://ru.wikisource.org/w/index.php"
USER_AGENT = "mini-llm-corpus-builder/1.0 (educational project; python urllib)"

# Названия страниц в Викитеке имеют вид «Название (Чехов)». Повести и
# крупные рассказы дают основную массу текста, пьесы — диалоги.
TITLES = [
    "Степь (Чехов)", "Дуэль (Чехов)", "Палата № 6 (Чехов)", "Скучная история (Чехов)",
    "Моя жизнь (Чехов)", "Три года (Чехов)", "Драма на охоте (Чехов)",
    "Рассказ неизвестного человека (Чехов)", "Огни (Чехов)", "Именины (Чехов)",
    "Жена (Чехов)", "Бабье царство (Чехов)", "Мужики (Чехов)", "В овраге (Чехов)",
    "Чёрный монах (Чехов)", "Дама с собачкой (Чехов)", "Человек в футляре (Чехов)",
    "Крыжовник (Чехов)", "О любви (Чехов)", "Ионыч (Чехов)", "Невеста (Чехов)",
    "Архиерей (Чехов)", "Студент (Чехов)", "Попрыгунья (Чехов)",
    "Учитель словесности (Чехов)", "Дом с мезонином (Чехов)", "Ариадна (Чехов)",
    "Убийство (Чехов)", "Анна на шее (Чехов)", "Припадок (Чехов)", "Гусев (Чехов)",
    "Скрипка Ротшильда (Чехов)", "Володя большой и Володя маленький (Чехов)",
    "Бабы (Чехов)", "Страх (Чехов)", "Соседи (Чехов)", "В ссылке (Чехов)",
    "Рассказ старшего садовника (Чехов)", "Супруга (Чехов)", "Белолобый (Чехов)",
    "Печенег (Чехов)", "В родном углу (Чехов)", "На подводе (Чехов)",
    "Случай из практики (Чехов)", "По делам службы (Чехов)", "Душечка (Чехов)",
    "Новая дача (Чехов)", "На святках (Чехов)", "У знакомых (Чехов)",
    "Смерть чиновника (Чехов)", "Толстый и тонкий (Чехов)", "Хамелеон (Чехов)",
    "Лошадиная фамилия (Чехов)", "Ванька (Чехов)", "Тоска (Чехов)", "Каштанка (Чехов)",
    "Спать хочется (Чехов)", "Враги (Чехов)", "Верочка (Чехов)", "Счастье (Чехов)",
    "Поцелуй (Чехов)", "Володя (Чехов)", "Дома (Чехов)", "Мальчики (Чехов)",
    "Пари (Чехов)", "Хорошие люди (Чехов)", "Злоумышленник (Чехов)",
    "Унтер Пришибеев (Чехов)", "Горе (Чехов)", "Агафья (Чехов)", "Ведьма (Чехов)",
    "Святою ночью (Чехов)", "Тиф (Чехов)", "Почта (Чехов)", "Мечты (Чехов)",
    "Нищий (Чехов)", "Шуточка (Чехов)", "Егерь (Чехов)", "Злой мальчик (Чехов)",
    "Беглец (Чехов)", "Свирель (Чехов)", "Холодная кровь (Чехов)",
    "Без заглавия (Чехов)", "Красавицы (Чехов)", "Княгиня (Чехов)", "Воры (Чехов)",
    "После театра (Чехов)", "История одного торгового предприятия (Чехов)",
    "Чайка (Чехов)", "Дядя Ваня (Чехов)", "Три сестры (Чехов)", "Вишнёвый сад (Чехов)",
    "Иванов (Чехов)", "Леший (Чехов)", "Медведь (Чехов)", "Предложение (Чехов)",
    "Свадьба (Чехов)", "Юбилей (Чехов)", "О вреде табака (Чехов)",
]


def fetch_raw(title, retries=4):
    url = BASE + "?" + urllib.parse.urlencode({"title": title, "action": "raw"})
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    delay = 5.0
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 429 and attempt < retries - 1:
                time.sleep(delay)
                delay *= 2
                continue
            raise
        except urllib.error.URLError:
            if attempt < retries - 1:
                time.sleep(delay)
                delay *= 2
                continue
            raise
    return None


def strip_templates(text):
    """Удаляет {{...}} с учётом вложенности."""
    out = []
    depth = 0
    i = 0
    n = len(text)
    while i < n:
        if text.startswith("{{", i):
            depth += 1
            i += 2
        elif text.startswith("}}", i) and depth > 0:
            depth -= 1
            i += 2
        else:
            if depth == 0:
                out.append(text[i])
            i += 1
    return "".join(out)


def clean_wikitext(raw):
    t = raw
    t = re.sub(r"<!--.*?-->", "", t, flags=re.S)
    t = re.sub(r"<ref[^>]*/>", "", t)
    t = re.sub(r"<ref[^>]*>.*?</ref>", "", t, flags=re.S)
    t = re.sub(r"<(noinclude|includeonly)>.*?</\1>", "", t, flags=re.S)
    t = strip_templates(t)
    t = re.sub(r"\[\[Категория:[^\]]*\]\]", "", t)
    t = re.sub(r"\[\[(?:Файл|Изображение|File|Image):[^\]]*\]\]", "", t)
    # [[цель|видимый текст]] -> видимый текст ; [[текст]] -> текст
    t = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\[\[([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\[https?://\S+\s+([^\]]*)\]", r"\1", t)
    t = re.sub(r"\[https?://\S+\]", "", t)
    t = re.sub(r"<br\s*/?>", "\n", t)
    t = re.sub(r"<[^>]+>", "", t)              # остальные теги
    t = html.unescape(t)
    t = re.sub(r"'{2,}", "", t)                 # ''курсив'' и '''жирный'''
    t = re.sub(r"^=+\s*(.*?)\s*=+\s*$", r"\1", t, flags=re.M)   # заголовки
    t = re.sub(r"^[*#:;]+\s*", "", t, flags=re.M)
    t = re.sub(r"^\|.*$", "", t, flags=re.M)    # остатки таблиц
    t = re.sub(r"^\{\|.*$|^\|\}.*$", "", t, flags=re.M)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def looks_like_prose(text):
    """Отсеиваем страницы-оглавления: мало текста или почти нет точек."""
    return len(text) > 3000 and text.count(".") > 30


def main():
    ap = argparse.ArgumentParser(description="Загрузка корпуса Чехова с Викитеки")
    ap.add_argument("--out", default="data/chekhov.txt")
    ap.add_argument("--pause", type=float, default=2.0, help="пауза между запросами, с")
    ap.add_argument("--limit", type=int, default=0, help="взять только первые N названий")
    args = ap.parse_args()

    titles = TITLES[:args.limit] if args.limit else TITLES
    chunks = []
    total = 0
    skipped = []
    for i, title in enumerate(titles):
        raw = fetch_raw(title)
        if raw is None:
            skipped.append((title, "нет страницы"))
        else:
            text = clean_wikitext(raw)
            if looks_like_prose(text):
                chunks.append(text)
                total += len(text)
                print("[%2d/%d] %-45s %7d симв. | всего %d"
                      % (i + 1, len(titles), title, len(text), total))
            else:
                skipped.append((title, "не похоже на текст (%d симв.)" % len(text)))
        sys.stdout.flush()
        time.sleep(args.pause)

    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("\n\n".join(chunks) + "\n")
    print("\nЗаписано %s: %d произведений, %d символов" % (args.out, len(chunks), total))
    if skipped:
        print("Пропущено %d:" % len(skipped))
        for title, why in skipped:
            print("  - %s — %s" % (title, why))


if __name__ == "__main__":
    main()
