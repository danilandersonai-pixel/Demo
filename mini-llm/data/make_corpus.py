# -*- coding: utf-8 -*-
"""Генератор учебного корпуса на русском.

Корпус синтетический и намеренно шаблонный: у мини-модели на 100k
параметров нет шансов выучить «весь русский язык», зато структуру таких
фраз она осваивает за несколько минут — и это отлично видно в генерации.

Запуск:  python3 data/make_corpus.py --out data/corpus.txt --size 400000
"""

import argparse
import random

NAMES = ["Егор", "Диана", "Анна", "Михаил", "Ольга", "Пётр", "Мария", "Артём",
         "Софья", "Никита", "Вера", "Илья", "Ксения", "Роман", "Алиса"]
PLACES = ["Санкт-Петербург", "загородный клуб", "усадьба у залива",
          "набережная Невы", "старый парк", "терраса с видом на воду"]
MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля",
          "августа", "сентября", "октября", "ноября", "декабря"]
FLOWERS = ["пионы", "розы", "эвкалипт", "гортензии", "лаванда", "ранункулюсы"]
DISHES = ["паста с трюфелем", "судак с овощами", "тыквенный крем-суп",
          "сырная тарелка", "медовик", "тарт с грушей"]
MOODS = ["тёплый", "тихий", "светлый", "праздничный", "нежный", "долгожданный"]
ACTIONS = ["сбор гостей", "выездная церемония", "фуршет", "первый танец",
           "поздравления", "торт", "фейерверк", "танцы до утра"]

TEMPLATES = [
    "{a} и {b} приглашают вас на свадьбу {day} {month} {year} года.",
    "Дорогой гость, мы будем рады видеть вас {day} {month} в {place}.",
    "Сбор гостей в {hh}:{mm}, церемония начинается в {hh2}:{mm}.",
    "Программа дня: {act1}, затем {act2}, вечером {act3}.",
    "Дресс-код вечера: {mood} образ в оттенках бордо и кремового.",
    "На столах будут {flower} — любимые цветы невесты.",
    "В меню: {dish1}, {dish2} и {dish3}.",
    "Пожалуйста, подтвердите присутствие до {day} {month}.",
    "{a}, спасибо, что будете рядом в этот {mood} день.",
    "Мы встречаемся в {place}, добраться удобнее всего на такси.",
    "Вопрос: приедете ли вы с парой? Ответ: {yesno}.",
    "Если вы задумались о подарке — лучший подарок это ваше присутствие.",
    "{a} и {b} ждут вас ровно в {hh}:{mm}, не опаздывайте.",
    "После церемонии гостей ждёт {act1} и бокал игристого.",
    "Свадьба состоится {day} {month} {year} года в городе {place}.",
    "Наш день будет {mood}, и мы хотим разделить его с вами.",
]


def sentence(rng):
    t = rng.choice(TEMPLATES)
    return t.format(
        a=rng.choice(NAMES), b=rng.choice(NAMES),
        day=rng.randint(1, 28), month=rng.choice(MONTHS),
        year=rng.choice([2025, 2026, 2027]),
        place=rng.choice(PLACES), flower=rng.choice(FLOWERS),
        dish1=rng.choice(DISHES), dish2=rng.choice(DISHES),
        dish3=rng.choice(DISHES), mood=rng.choice(MOODS),
        act1=rng.choice(ACTIONS), act2=rng.choice(ACTIONS),
        act3=rng.choice(ACTIONS),
        hh="%02d" % rng.randint(9, 17), hh2="%02d" % rng.randint(9, 18),
        mm=rng.choice(["00", "15", "30", "45"]),
        yesno=rng.choice(["да, вдвоём", "да, буду один", "нет, к сожалению"]),
    )


def build(size, seed=7):
    rng = random.Random(seed)
    out = []
    total = 0
    while total < size:
        # абзац из 2-4 предложений — так модель учится ещё и переносам строк
        para = " ".join(sentence(rng) for _ in range(rng.randint(2, 4)))
        out.append(para)
        total += len(para) + 1
    return "\n".join(out) + "\n"


def main():
    ap = argparse.ArgumentParser(description="Генератор учебного корпуса")
    ap.add_argument("--out", default="data/corpus.txt")
    ap.add_argument("--size", type=int, default=400000, help="примерный размер в символах")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    text = build(args.size, args.seed)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("Записано %s: %d символов, %d строк, %d уникальных символов"
          % (args.out, len(text), text.count("\n"), len(set(text))))


if __name__ == "__main__":
    main()
