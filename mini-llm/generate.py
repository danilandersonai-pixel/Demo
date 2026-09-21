#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Генерация текста обученной мини-LLM.

Пример:
    python3 generate.py --run runs/default --prompt "Егор и Диана" --temperature 0.7
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from minillm.model import GPT
from minillm.sample import generate
from minillm.tokenizer import load_tokenizer


def main():
    ap = argparse.ArgumentParser(description="Генерация текста мини-LLM")
    ap.add_argument("--run", default="runs/default", help="каталог с model.npz и tokenizer.json")
    ap.add_argument("--prompt", default="", help="затравка")
    ap.add_argument("--max-new-tokens", type=int, default=250)
    ap.add_argument("--temperature", type=float, default=0.8,
                    help="0 = жадный выбор, >1 = больше хаоса")
    ap.add_argument("--top-k", type=int, default=0, help="оставить k лучших токенов")
    ap.add_argument("--top-p", type=float, default=0.0, help="nucleus-сэмплирование")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--n", type=int, default=1, help="сколько вариантов сгенерировать")
    args = ap.parse_args()

    model_path = os.path.join(args.run, "model.npz")
    tok_path = os.path.join(args.run, "tokenizer.json")
    for path in (model_path, tok_path):
        if not os.path.exists(path):
            raise SystemExit("не найден %s — сначала запусти train.py" % path)

    model = GPT.load(model_path)
    tokenizer = load_tokenizer(tok_path)

    for i in range(args.n):
        seed = None if args.seed is None else args.seed + i
        text = generate(model, tokenizer, prompt=args.prompt,
                        max_new_tokens=args.max_new_tokens,
                        temperature=args.temperature, top_k=args.top_k,
                        top_p=args.top_p, seed=seed)
        if args.n > 1:
            print("--- вариант %d ---" % (i + 1))
        print(text)


if __name__ == "__main__":
    main()
