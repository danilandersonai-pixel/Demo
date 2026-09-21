#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Экспорт обученной модели для браузерного визуализатора (web/).

Складывает в один JSON: конфиг модели, слияния BPE, веса в float16
(base64) и историю обучения из train_log.jsonl. Float16 вдвое уменьшает
файл, а на качество генерации такой мини-модели не влияет.

Запуск:  python3 export_web.py --run runs/bpe-demo --out web/model.js

Файл .js кладёт данные в window.MINI_LLM_MODEL: так страница работает и
открытая с диска (fetch с file:// запрещён), и опубликованная.
"""

import argparse
import base64
import json
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from minillm.model import GPT
from minillm.tokenizer import load_tokenizer


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="runs/bpe-demo")
    ap.add_argument("--out", default="web/model.js")
    ap.add_argument("--log", default=None, help="stdout-лог обучения с образцами текста")
    args = ap.parse_args()

    model = GPT.load(os.path.join(args.run, "model.npz"))
    tok = load_tokenizer(os.path.join(args.run, "tokenizer.json"))

    params = {}
    for name, arr in model.params.items():
        params[name] = {
            "shape": list(arr.shape),
            "data": base64.b64encode(arr.astype(np.float16).tobytes()).decode("ascii"),
        }

    history = []
    log_path = os.path.join(args.run, "train_log.jsonl")
    if os.path.exists(log_path):
        with open(log_path, encoding="utf-8") as fh:
            history = [json.loads(line) for line in fh if line.strip()]

    samples = []
    if args.log and os.path.exists(args.log):
        lines = open(args.log, encoding="utf-8").read().split("\n")
        last_step = 0
        i = 0
        while i < len(lines):
            m = re.match(r"шаг\s+(\d+)/", lines[i])
            if m:
                last_step = int(m.group(1))
            m = re.match(r"\s*-- образец(?: \(шаг (\d+)\))? --", lines[i])
            if m:
                step = int(m.group(1)) if m.group(1) else last_step
                body = []
                i += 1
                while i < len(lines) and not re.match(r"\s*-{5,}", lines[i]):
                    body.append(lines[i])
                    i += 1
                samples.append({"step": step, "text": "\n".join(body).strip()})
            i += 1

    payload = {
        "config": model.config,
        "tokenizer": tok.state(),
        "params": params,
        "history": history,
        "samples": samples,
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    with open(args.out, "w", encoding="utf-8") as fh:
        if args.out.endswith(".js"):
            fh.write("window.MINI_LLM_MODEL=" + body + ";\n")
        else:
            fh.write(body)
    size = os.path.getsize(args.out)
    print("Экспортировано %s: %.2f МБ, %d параметров, %d точек истории, %d образцов"
          % (args.out, size / 1e6, model.num_params(), len(history), len(samples)))


if __name__ == "__main__":
    main()
