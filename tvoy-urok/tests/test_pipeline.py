"""Тесты детерминированной половины пайплайна (без ключей и сети).

Проверяем то, что обещано архитектурой:
  • дек собирается и переоткрывается как валидный PPTX;
  • текст остаётся ЖИВЫМ (извлекается из файла), а не растром;
  • замер текста реально снижает кегль на переполнении;
  • валидаторы ловят дефекты оригинальных деков (нет заголовка,
    перебор объёма, «служивые», Title Case, дубли).

Запуск:  python -m tests.test_pipeline
"""

from __future__ import annotations

import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from generator import textfit  # noqa: E402
from generator.render import render_deck  # noqa: E402
from generator.schema import (  # noqa: E402
    Deck,
    Layout,
    Meta,
    Paragraph,
    Role,
    Slide,
)
from generator.themes import font_path  # noqa: E402
from generator.validators import validate_deck, validate_slide  # noqa: E402

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


# --- 1. Схема и фикстура --------------------------------------------------

def test_fixture_valid() -> Deck:
    print("\n[1] Фикстура проходит схему и валидаторы")
    deck = load_fixture()
    check("дек парсится", len(deck.slides) > 0)
    check("холст-независимая мета", deck.meta.grade == 6)
    issues = validate_deck(deck)
    errors = [i for i in issues if i.level == "error"]
    warns = [i for i in issues if i.level == "warn"]
    check("нет ошибок валидации", not errors, str(errors))
    check("нет предупреждений", not warns, str(warns))
    check("заголовок есть на каждом слайде", all(s.title.strip() for s in deck.slides))
    check("ровно один титул", [s.role for s in deck.slides].count(Role.TITLE) == 1)
    check("есть проверка понимания", any(s.role == Role.QUIZ for s in deck.slides))
    return deck


# --- 2. Рендер ------------------------------------------------------------

def test_render(deck: Deck) -> None:
    print("\n[2] Рендер PPTX")
    from pptx import Presentation

    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "deck.pptx")
        render_deck(deck, out)
        check("файл создан", os.path.exists(out))

        prs = Presentation(out)
        check("слайдов столько же", len(prs.slides) == len(deck.slides))
        # Холст всегда 16:9
        ratio = prs.slide_width / prs.slide_height
        check("холст 16:9", abs(ratio - 16 / 9) < 0.01, f"ratio={ratio:.3f}")
        # Метаданные чистые
        check("title в метаданных", prs.core_properties.title == deck.meta.topic)
        check("author в метаданных", prs.core_properties.author == deck.meta.author)

        # Текст живой: собираем весь текст из фигур
        found = []
        for slide in prs.slides:
            for shape in slide.shapes:
                if shape.has_text_frame:
                    found.append(shape.text_frame.text)
        blob = "\n".join(found)
        check("текст извлекается из PPTX", "Василия III" in blob or "Василий III" in blob)
        check("заголовок слайда на месте", "Итоги правления" in blob)

        # Настоящий bold, а не имитация
        bold_runs = []
        for slide in prs.slides:
            for shape in slide.shapes:
                if not shape.has_text_frame:
                    continue
                for para in shape.text_frame.paragraphs:
                    for run in para.runs:
                        if run.font.bold:
                            bold_runs.append(run.text)
        check("есть настоящие bold-раны", len(bold_runs) > 5, f"{len(bold_runs)}")
        check("bold на термине", any("Василий III" in t for t in bold_runs))


# --- 3. Защита от переполнения -------------------------------------------

def test_overflow_guard() -> None:
    print("\n[3] Замер текста и снижение кегля")
    font = font_path("PT Sans")
    check("шрифт найден", font is not None, "PT Sans отсутствует")

    short = ["Короткий тезис на одну строку."]
    long_texts = [
        "Очень длинный тезис, который заведомо не помещается в узкий слот "
        "и должен заставить подборщик кегля опуститься ниже стартового размера."
    ] * 6

    size_short, over_short = textfit.fit_size(short, font, 400, 200, 17, 13)
    size_long, over_long = textfit.fit_size(long_texts, font, 240, 120, 17, 13)

    check("короткий текст — стартовый кегль", size_short == 17, f"{size_short}")
    check("короткий текст не переполняет", not over_short)
    check("длинный текст — кегль снижен", size_long < 17, f"{size_long}")
    check("переполнение отмечено флагом", over_long)

    # Перенос строк реально работает
    lines = textfit.wrap_text("одно два три четыре пять шесть семь восемь", font, 14, 60)
    check("перенос по словам", len(lines) > 1, f"{lines}")

    # Ширина растёт с кеглем (санитарная проверка замера)
    w1 = textfit.text_width_pt("Проверка", font, 12)
    w2 = textfit.text_width_pt("Проверка", font, 24)
    check("ширина пропорциональна кеглю", abs(w2 / w1 - 2.0) < 0.05, f"{w1:.1f}/{w2:.1f}")


# --- 4. Валидаторы ловят дефекты оригинала --------------------------------

def test_validators_catch_defects() -> None:
    print("\n[4] Валидаторы ловят реальные дефекты")

    # Слайд без заголовка — главный дефект оригинала (9 из 12 слайдов)
    no_title = Slide(role=Role.CONTENT, layout=Layout.CARD_LEFT_IMAGE_RIGHT, title="   ")
    codes = {i.code for i in validate_slide(no_title, 0)}
    check("ловит отсутствие заголовка", "no-title" in codes, str(codes))

    # Перебор объёма — ретрай слайда
    fat = Slide(
        role=Role.CONTENT,
        layout=Layout.CARD_LEFT_IMAGE_RIGHT,
        title="Слишком много текста",
        paragraphs=[Paragraph(text=" ".join(["слово"] * 15)) for _ in range(6)],
    )
    codes = {i.code for i in validate_slide(fat, 0)}
    check("ловит перебор объёма", "slide-too-long" in codes, str(codes))

    # Типографика: двойной пробел, дефис вместо тире, пропуск «ё»
    typo = Slide(
        role=Role.CONTENT,
        layout=Layout.CARD_LEFT_IMAGE_RIGHT,
        title="Проверка типографики",
        paragraphs=[
            Paragraph(text="Здесь  двойной пробел и слово еще без буквы ё точно."),
            Paragraph(text="Термин - определение через дефис вместо тире в тексте."),
        ],
    )
    codes = {i.code for i in validate_slide(typo, 0)}
    check("ловит двойной пробел", "double-space" in codes, str(codes))
    check("ловит дефис вместо тире", "hyphen-as-dash" in codes, str(codes))
    check("ловит пропуск «ё»", "missing-yo" in codes, str(codes))

    # bold_terms должен реально быть в тексте
    bad_bold = Slide(
        role=Role.CONTENT,
        layout=Layout.CARD_LEFT_IMAGE_RIGHT,
        title="Проверка выделений",
        paragraphs=[Paragraph(text="Обычный тезис на восемь слов без выделения тут.",
                              bold_terms=["отсутствующий термин"])],
    )
    codes = {i.code for i in validate_slide(bad_bold, 0)}
    check("ловит несуществующий bold-термин", "bold-missing" in codes, str(codes))

    # Дедупликация фактов между слайдами
    dup_text = "Псков окончательно вошёл в состав единого Российского государства навсегда."
    dup_deck = Deck(
        meta=Meta(topic="Тест", subject="История", grade=6),
        slides=[
            Slide(role=Role.TITLE, layout=Layout.TITLE_HERO, title="Тест"),
            Slide(role=Role.CONTENT, layout=Layout.CARD_LEFT_IMAGE_RIGHT,
                  title="Первый", paragraphs=[Paragraph(text=dup_text)]),
            Slide(role=Role.CONTENT, layout=Layout.CARD_LEFT_IMAGE_RIGHT,
                  title="Второй", paragraphs=[Paragraph(text=dup_text)]),
            Slide(role=Role.SUMMARY, layout=Layout.BULLETS_SUMMARY, title="Итоги",
                  bullets=["Вывод один."]),
        ],
    )
    codes = {i.code for i in validate_deck(dup_deck)}
    check("ловит дубль текста между слайдами", "duplicate-text" in codes, str(codes))

    # Промпт картинки не должен просить текст внутри изображения
    from generator.schema import Image

    img_slide = Slide(
        role=Role.CONTENT, layout=Layout.CARD_LEFT_IMAGE_RIGHT, title="Картинка",
        image=Image(prompt="схема с подписями и надписью сверху", alt="Схема"),
    )
    codes = {i.code for i in validate_slide(img_slide, 0)}
    check("ловит текст в промпте картинки", "image-text" in codes, str(codes))


# --- 5. Тема и bold-раны --------------------------------------------------

def test_bold_split() -> None:
    print("\n[5] Разбивка на bold-раны")
    from generator.render import _bold_runs

    segs = _bold_runs("Годы правления с 1505 по 1533 год.", ["1505", "1533"])
    bold = [t for t, b in segs if b]
    check("оба термина выделены", bold == ["1505", "1533"], str(segs))
    check("текст собирается обратно",
          "".join(t for t, _ in segs) == "Годы правления с 1505 по 1533 год.")

    # Термин, которого нет — не ломает текст
    segs = _bold_runs("Простой текст.", ["нет такого"])
    check("отсутствующий термин игнорируется", segs == [("Простой текст.", False)], str(segs))


def test_render_report(deck: Deck) -> None:
    """Сигналы рендера доходят до вызывающего, а не теряются по дороге."""
    print("\n[6] Отчёт рендера: переполнение, шрифты, заметки")
    from pptx import Presentation

    from generator.schema import Layout, Meta, Role, Slide
    from generator.themes import check_theme_fonts, get_theme, resolve_font

    with tempfile.TemporaryDirectory() as tmp:
        rep = render_deck(deck, os.path.join(tmp, "ok.pptx"))
        check("отчёт возвращается", hasattr(rep, "overflowed"))
        check("в строковом контексте — путь", str(rep).endswith("ok.pptx"))
        check("эталонный дек без переполнений", not rep.overflowed, str(rep.overflowed))
        check("шрифты темы на месте", not rep.missing_fonts, str(rep.missing_fonts))
        check("дек признан чистым", rep.ok)
        check("замечаний нет", rep.issues() == [])

        # Переполнение по ШИРИНЕ: слово, которое не переносится.
        #
        # Почему проверяем именно этот случай, а не высоту: лимиты схемы
        # (140 символов на тезис, ≤6 тезисов) не дают тексту перебрать по
        # высоте ни в одном лейауте — первый эшелон защиты работает. А вот
        # длинное неразрывное слово схема пропускает: оно укладывается в 140
        # символов, но шире колонки. Высотный путь использует тот же флаг и
        # проверен на уровне замерщика (тесты 3 и 7).
        wide = "Сверхдлинноесловоизстачетырёхбуквкотороеточнонепоместитсяниводнуколонкунашегослайдаивылезетзакрай"
        wide_deck = Deck(
            meta=Meta(topic="Тест", subject="История", grade=6),
            slides=[
                Slide(role=Role.TITLE, layout=Layout.TITLE_HERO, title="Тест"),
                Slide(role=Role.CONTENT, layout=Layout.CARD_LEFT_IMAGE_RIGHT,
                      title="Длинное слово", paragraphs=[Paragraph(text=wide)]),
            ],
        )
        rep3 = render_deck(wide_deck, os.path.join(tmp, "wide.pptx"))
        check("переполнение поймано", bool(rep3.overflowed), str(rep3.overflowed))
        check("в замечании назван слайд",
              any("слайд 2" in i for i in rep3.issues()), str(rep3.issues()))
        check("дек признан проблемным", not rep3.ok)

        # Заметки докладчика попадают в файл
        out = os.path.join(tmp, "notes.pptx")
        render_deck(deck, out)
        prs = Presentation(out)
        with_notes = [
            s for s in prs.slides
            if s.has_notes_slide and s.notes_slide.notes_text_frame.text.strip()
        ]
        expected = sum(1 for s in deck.slides if s.notes)
        check("заметки записаны в файл", len(with_notes) == expected,
              f"{len(with_notes)} из {expected}")
        check("в фикстуре заметки есть", expected > 0)
        blob = "\n".join(s.notes_slide.notes_text_frame.text for s in with_notes)
        check("заметка не на слайде, а в заметках", "Спросить" in blob)

    # Подмена шрифта видна, а не молчалива
    _, exact_ok = resolve_font("PT Sans")
    _, exact_bad = resolve_font("Такого Шрифта Нет")
    check("существующий шрифт — точное совпадение", exact_ok)
    check("несуществующий помечен как подмена", not exact_bad)
    check("проверка темы находит все начертания",
          check_theme_fonts(get_theme("manuscript")) == [])


def test_width_measurement() -> None:
    print("\n[7] Замер ширины (текст, вылезающий вбок)")
    from generator.themes import font_path

    font = font_path("PT Sans")
    check("длинное слово шире слота — поймано",
          textfit.too_wide(["Гидрометеорологическийсупертермин"], font, 17, 60))
    check("обычный текст — нет", not textfit.too_wide(["Короткий тезис."], font, 17, 400))
    # fit_size учитывает обе беды сразу
    _, over_w = textfit.fit_size(["Гидрометеорологическийсупертермин"], font, 60, 400, 17, 13)
    _, over_h = textfit.fit_size(["слово " * 60] * 6, font, 300, 100, 17, 13)
    _, fine = textfit.fit_size(["Обычный тезис."], font, 400, 200, 17, 13)
    check("fit_size ловит перебор по ширине", over_w)
    check("fit_size ловит перебор по высоте", over_h)
    check("нормальный текст не помечен", not fine)


def main() -> int:
    deck = test_fixture_valid()
    test_render(deck)
    test_overflow_guard()
    test_validators_catch_defects()
    test_bold_split()
    test_render_report(deck)
    test_width_measurement()
    print(f"\n{'=' * 46}\nПройдено: {_passed}, провалено: {_failed}")
    return 1 if _failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
