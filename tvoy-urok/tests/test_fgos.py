"""Тесты модуля ФГОС-соответствия (без ключей и сети).

Главное, что проверяем: соответствие ФГОС у нас ПРОВЕРЯЕМОЕ, а не
декларируемое — реестр детерминированный, находки воспроизводимые.

Запуск:  python -m tests.test_fgos
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fgos.check import brief, check_deck  # noqa: E402
from fgos.registry import (  # noqa: E402
    grade_for_topic,
    load_subject,
    match_sections,
    prompt_layer,
)
from generator.schema import (  # noqa: E402
    Deck,
    Image,
    Layout,
    Meta,
    Paragraph,
    QuizItem,
    Role,
    Slide,
)

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "fixtures", "vasiliy-iii.json")

_passed = 0
_failed = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global _passed, _failed
    if condition:
        _passed += 1
        print(f"  ok   {name}")
    else:
        _failed += 1
        print(f"  FAIL {name} {detail}")


def load_fixture() -> Deck:
    with open(FIXTURE, encoding="utf-8") as f:
        return Deck.model_validate(json.load(f))


def test_registry() -> None:
    print("\n[1] Реестр ФРП")
    spec = load_subject("История России")
    check("предмет найден", spec is not None)
    check("есть 6 и 7 класс", {6, 7} <= set(spec.grades.keys()))
    check("источник указан", "edsoo.ru" in spec.source.get("url", ""))
    check("есть напоминание о редакции", bool(spec.source.get("edition_note")))

    # Регистр и «ё» не должны мешать поиску
    check("предмет ищется без регистра", load_subject("история") is not None)
    check("непокрытый предмет — None", load_subject("Астрономия") is None)

    # Ключевая проверка: ФРП относит Василия III к 7 классу
    check("Василий III → 7 класс", grade_for_topic(spec, "Правление Василия III") == 7,
          str(grade_for_topic(spec, "Правление Василия III")))
    check("Иван III → 6 класс", grade_for_topic(spec, "Иван III и присоединение Новгорода") == 6,
          str(grade_for_topic(spec, "Иван III и присоединение Новгорода")))
    check("неизвестная тема не матчится",
          grade_for_topic(spec, "Квантовая механика") is None)

    matches = match_sections(spec, "Правление Василия III")
    check("раздел найден", matches and "Василия III" in matches[0][0].title, str(matches))


def test_prompt_layer() -> None:
    print("\n[2] Слой ФГОС для промпта")
    spec = load_subject("История России")
    layer = prompt_layer(spec, 7, "Правление Василия III")
    check("слой не пуст", len(layer) > 500)
    check("есть заголовок слоя", "[СЛОЙ 4" in layer)
    check("есть дидактические единицы", "Отмирание удельной системы" in layer)
    check("есть обязательные даты", "1510" in layer)
    check("есть защита от анахронизма", "Титул царя принят Иваном IV" in layer)
    check("есть запрет терминов", "царская семья" in layer)
    check("есть УУД", "Познавательные УУД" in layer)
    check("есть планируемые результаты", "Работа с исторической картой" in layer)
    # Слой стабилен для пары {предмет, класс} — важно для кэша промпта
    check("слой детерминирован",
          prompt_layer(spec, 7, "Правление Василия III") == layer)


def test_grade_mismatch() -> None:
    print("\n[3] Несоответствие темы классу — главная формальная проверка")
    deck = load_fixture()
    check("фикстура заявлена как 6 класс", deck.meta.grade == 6)
    report = check_deck(deck)
    check("отчёт построен", report is not None)
    codes = {f.code for f in report.findings}
    check("ловит несоответствие класса", "grade-mismatch" in codes, str(codes))
    check("это ошибка, а не предупреждение",
          any(f.code == "grade-mismatch" and f.level == "error" for f in report.findings))
    check("в тексте указан правильный класс",
          any("7 класс" in f.message for f in report.findings if f.code == "grade-mismatch"))

    # Тот же дек как 7 класс — несоответствия быть не должно
    deck7 = load_fixture()
    deck7.meta.grade = 7
    report7 = check_deck(deck7)
    check("для 7 класса несоответствия нет",
          "grade-mismatch" not in {f.code for f in report7.findings})


def test_coverage() -> None:
    print("\n[4] Охват дидактических единиц и понятий")
    deck = load_fixture()
    report = check_deck(deck)
    check("охват посчитан", 0 < report.coverage_pct <= 100, f"{report.coverage_pct}%")
    check("Псков засчитан", any("Псков" in u for u in report.covered_units))
    check("удельная система засчитана",
          any("удельной системы" in u for u in report.covered_units))
    check("пробел найден: ханства",
          any("ханствами" in u for u in report.missing_units), str(report.missing_units))
    check("обязательные понятия проверены",
          "Псков" in report.covered_terms and "Смоленск" in report.covered_terms)
    check("отчёт печатается", "ОТЧЁТ О СООТВЕТСТВИИ ФГОС" in report.to_text())
    check("в отчёте есть основание",
          "Федеральная рабочая программа" in report.to_text())


def test_anachronism_and_bloom() -> None:
    print("\n[5] Анахронизмы и уровни вопросов")

    base_slides = [
        Slide(role=Role.TITLE, layout=Layout.TITLE_HERO, title="Правление Василия III"),
        Slide(role=Role.CONTENT, layout=Layout.CARD_LEFT_IMAGE_RIGHT,
              title="Двор государя",
              paragraphs=[Paragraph(
                  text="В царской семье Василия III долго не появлялись наследники.")]),
        Slide(role=Role.SUMMARY, layout=Layout.BULLETS_SUMMARY, title="Итоги",
              bullets=["Псков и Смоленск вошли в состав государства."]),
    ]
    bad = Deck(
        meta=Meta(topic="Правление Василия III", subject="История России", grade=7),
        slides=base_slides,
    )
    report = check_deck(bad)
    codes = {f.code for f in report.findings}
    check("ловит анахронизм «царская семья»", "anachronism" in codes, str(codes))
    check("анахронизм — это ошибка",
          any(f.code == "anachronism" and f.level == "error" for f in report.findings))
    check("ловит отсутствие проверки понимания", "no-quiz" in codes, str(codes))

    # Вопросы только на воспроизведение
    recall_only = Deck(
        meta=Meta(topic="Правление Василия III", subject="История России", grade=7),
        slides=base_slides[:1] + [
            Slide(role=Role.QUIZ, layout=Layout.QUIZ_LIST, title="Проверь себя",
                  quiz=[QuizItem(q="В каком году присоединили Псков?"),
                        QuizItem(q="Кто был отцом Василия III?")]),
        ],
    )
    codes = {f.code for f in check_deck(recall_only).findings}
    check("ловит вопросы только на память", "bloom-recall-only" in codes, str(codes))

    # У фикстуры есть вопрос «почему» — предупреждения быть не должно
    deck = load_fixture()
    codes = {f.code for f in check_deck(deck).findings}
    check("фикстура проходит по уровням вопросов", "bloom-recall-only" not in codes)


def test_brief_for_inspector() -> None:
    print("\n[6] Задание для ФГОС-инспектора (отдельной модели)")
    deck = load_fixture()
    report = check_deck(deck)
    b = brief(deck, report)

    check("есть нормативное основание", bool(b["normative_source"]))
    check("передан чек-лист единиц", bool(b["checklist"]["sections"]))
    check("переданы механические находки", bool(b["mechanical_findings"]))
    check("есть вопросы к модели", len(b["questions_for_model"]) >= 5)
    check("есть вопрос про изображения",
          any("изображени" in q for q in b["questions_for_model"]))
    check("изображения перечислены для осмотра", len(b["images_to_inspect"]) > 5,
          str(len(b["images_to_inspect"])))
    check("у изображения есть промпт и alt",
          all("prompt" in i and "alt" in i for i in b["images_to_inspect"]))
    check("передана верхняя граница периода",
          b["period_bounds"]["period_end_year"] == 1533,
          str(b["period_bounds"]))
    check("brief сериализуется в JSON", bool(json.dumps(b, ensure_ascii=False)))

    # Чувствительные картинки помечены — для маршрутизации мимо OpenAI
    sensitive = [i for i in b["images_to_inspect"] if i["sensitive"]]
    check("чувствительные изображения помечены", len(sensitive) >= 1, str(sensitive))


def test_uncovered_subject() -> None:
    print("\n[7] Непокрытый предмет не ломает пайплайн")
    deck = Deck(
        meta=Meta(topic="Тема", subject="Астрономия", grade=10),
        slides=[Slide(role=Role.TITLE, layout=Layout.TITLE_HERO, title="Тема")],
    )
    check("возвращает None без исключения", check_deck(deck) is None)


def main() -> int:
    test_registry()
    test_prompt_layer()
    test_grade_mismatch()
    test_coverage()
    test_anachronism_and_bloom()
    test_brief_for_inspector()
    test_uncovered_subject()
    print(f"\n{'=' * 46}\nПройдено: {_passed}, провалено: {_failed}")
    return 1 if _failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
