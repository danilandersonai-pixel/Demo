"""CLI: JSON-дек → PPTX (+ PDF через LibreOffice, если он установлен).

    python -m generator.cli fixtures/vasiliy-iii.json -o out/deck.pptx --pdf

Ключи API здесь не нужны: это детерминированная половина пайплайна.
LLM-слой подключается позже и отдаёт ровно этот же JSON.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from typing import Optional

from .render import render_deck
from .schema import Deck
from .validators import summarize, validate_deck


def load_deck(path: str) -> Deck:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return Deck.model_validate(data)


def to_pdf(pptx_path: str, out_dir: Optional[str] = None) -> Optional[str]:
    """PPTX → PDF через LibreOffice headless.

    В продакшене эту роль берёт Gotenberg (stateful-инстанс LibreOffice):
    без холодного старта на каждый запрос и с очередью. Здесь — прямой вызов,
    чтобы не тянуть докер в дев-цикл.
    """
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return None
    out_dir = out_dir or os.path.dirname(os.path.abspath(pptx_path))
    profile = os.path.join(out_dir, ".lo-profile")
    cmd = [
        soffice,
        "--headless",
        f"-env:UserInstallation=file://{profile}",
        "--convert-to",
        "pdf",
        "--outdir",
        out_dir,
        pptx_path,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=180)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        print(f"PDF: конвертация не удалась ({e})", file=sys.stderr)
        return None
    pdf = os.path.splitext(pptx_path)[0] + ".pdf"
    return pdf if os.path.exists(pdf) else None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Сборка презентации из JSON-дека")
    ap.add_argument("deck", help="путь к JSON-деку")
    ap.add_argument("-o", "--out", default="out/deck.pptx", help="куда сохранить PPTX")
    ap.add_argument("--pdf", action="store_true", help="дополнительно собрать PDF")
    ap.add_argument("--strict", action="store_true", help="падать при ошибках валидации")
    ap.add_argument("--schema", action="store_true", help="напечатать JSON Schema и выйти")
    ap.add_argument("--fgos", action="store_true", help="отчёт о соответствии ФГОС")
    ap.add_argument("--fgos-brief", action="store_true",
                    help="задание для ФГОС-инспектора (JSON) и выход")
    ap.add_argument("--prompt-layer", action="store_true",
                    help="напечатать слой ФГОС для промпта генерации и выйти")
    args = ap.parse_args(argv)

    if args.schema:
        from .schema import json_schema

        print(json.dumps(json_schema(), ensure_ascii=False, indent=2))
        return 0

    deck = load_deck(args.deck)

    if args.prompt_layer:
        from fgos.registry import load_subject, prompt_layer

        spec = load_subject(deck.meta.subject)
        if not spec:
            print(f"Предмет «{deck.meta.subject}» пока не покрыт реестром ФГОС",
                  file=sys.stderr)
            return 2
        print(prompt_layer(spec, deck.meta.grade, deck.meta.topic))
        return 0

    if args.fgos or args.fgos_brief:
        from fgos.check import brief, check_deck

        report = check_deck(deck)
        if report is None:
            print(f"Предмет «{deck.meta.subject}» пока не покрыт реестром ФГОС",
                  file=sys.stderr)
            return 2
        if args.fgos_brief:
            print(json.dumps(brief(deck, report), ensure_ascii=False, indent=2))
            return 0
        print(report.to_text())
        print()
        if report.errors and args.strict:
            print("Остановлено: несоответствие ФГОС (--strict)", file=sys.stderr)
            return 3

    issues = validate_deck(deck)
    print(summarize(issues))
    errors = [i for i in issues if i.level == "error"]
    if errors and args.strict:
        print("\nОстановлено: есть ошибки валидации (--strict)", file=sys.stderr)
        return 2

    pptx = render_deck(deck, args.out)
    print(f"\nPPTX: {pptx} ({os.path.getsize(pptx) // 1024} КБ, {len(deck.slides)} слайдов)")

    if args.pdf:
        pdf = to_pdf(pptx)
        if pdf:
            print(f"PDF:  {pdf} ({os.path.getsize(pdf) // 1024} КБ)")
        else:
            print("PDF:  пропущен (нет LibreOffice или ошибка конвертации)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
