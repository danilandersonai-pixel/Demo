#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Обучение мини-LLM.

Пример:
    python3 train.py --data data/corpus.txt --steps 2000 --tokenizer char

Всё, что нужно для инференса, складывается в каталог --out:
model.npz (веса), tokenizer.json (словарь), train_log.jsonl (история).
"""

import argparse
import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from minillm.data import Dataset, read_text
from minillm.model import GPT
from minillm.optim import AdamW, clip_grad_norm, lr_schedule
from minillm.sample import generate
from minillm.tokenizer import load_tokenizer, save_tokenizer, train_tokenizer


def parse_args():
    ap = argparse.ArgumentParser(description="Обучение мини-LLM на NumPy")
    g = ap.add_argument_group("данные")
    g.add_argument("--data", default="data/corpus.txt", help="текстовый корпус UTF-8")
    g.add_argument("--tokenizer", choices=["char", "bpe"], default="char")
    g.add_argument("--vocab-size", type=int, default=512, help="размер словаря для BPE")
    g.add_argument("--val-split", type=float, default=0.1)

    g = ap.add_argument_group("модель")
    g.add_argument("--block-size", type=int, default=64, help="длина контекста в токенах")
    g.add_argument("--n-layer", type=int, default=4)
    g.add_argument("--n-head", type=int, default=4)
    g.add_argument("--n-embd", type=int, default=128)
    g.add_argument("--dropout", type=float, default=0.0)

    g = ap.add_argument_group("обучение")
    g.add_argument("--steps", type=int, default=2000)
    g.add_argument("--batch-size", type=int, default=32)
    g.add_argument("--lr", type=float, default=3e-3)
    g.add_argument("--warmup", type=int, default=100)
    g.add_argument("--weight-decay", type=float, default=0.1)
    g.add_argument("--grad-clip", type=float, default=1.0)
    g.add_argument("--seed", type=int, default=1337)

    g = ap.add_argument_group("логи и вывод")
    g.add_argument("--out", default="runs/default")
    g.add_argument("--log-interval", type=int, default=25)
    g.add_argument("--eval-interval", type=int, default=200)
    g.add_argument("--eval-batches", type=int, default=10)
    g.add_argument("--sample-interval", type=int, default=500)
    g.add_argument("--sample-prompt", default="")
    g.add_argument("--resume", action="store_true", help="продолжить обучение из --out")
    return ap.parse_args()


def estimate_loss(model, dataset, batch_size, n_batches, split):
    total = 0.0
    for _ in range(n_batches):
        x, y = dataset.get_batch(batch_size, split=split)
        _, loss, _ = model.forward(x, y, training=False)
        total += loss
    return total / n_batches


def main():
    args = parse_args()
    os.makedirs(args.out, exist_ok=True)
    model_path = os.path.join(args.out, "model.npz")
    tok_path = os.path.join(args.out, "tokenizer.json")
    log_path = os.path.join(args.out, "train_log.jsonl")

    text = read_text(args.data)
    print("Корпус: %s — %d символов" % (args.data, len(text)))

    if args.resume and os.path.exists(tok_path):
        tokenizer = load_tokenizer(tok_path)
        print("Токенизатор загружен из %s (%s, словарь %d)"
              % (tok_path, tokenizer.kind, tokenizer.vocab_size))
    else:
        t0 = time.time()
        tokenizer = train_tokenizer(text, kind=args.tokenizer,
                                    vocab_size=args.vocab_size, verbose=True)
        save_tokenizer(tokenizer, tok_path)
        print("Токенизатор %s обучен за %.1f с, словарь %d"
              % (tokenizer.kind, time.time() - t0, tokenizer.vocab_size))

    t0 = time.time()
    ids = tokenizer.encode(text)
    print("Корпус закодирован за %.1f с: %d токенов (сжатие x%.2f)"
          % (time.time() - t0, len(ids), len(text) / max(1, len(ids))))

    dataset = Dataset(ids, args.block_size, val_split=args.val_split, seed=args.seed)
    print("Разбиение: %s" % dataset.summary())

    if args.resume and os.path.exists(model_path):
        model = GPT.load(model_path)
        print("Модель загружена из %s" % model_path)
    else:
        model = GPT(vocab_size=tokenizer.vocab_size, block_size=args.block_size,
                    n_layer=args.n_layer, n_head=args.n_head, n_embd=args.n_embd,
                    dropout=args.dropout, seed=args.seed)
    print("Модель: %d слоёв, %d голов, d_model=%d, контекст %d -> %s параметров"
          % (model.n_layer, model.n_head, model.n_embd, model.block_size,
             format(model.num_params(), ",d").replace(",", " ")))

    opt = AdamW(model.params, lr=args.lr, weight_decay=args.weight_decay)
    log_file = open(log_path, "a", encoding="utf-8")

    best_val = float("inf")
    tokens_per_step = args.batch_size * args.block_size
    start = time.time()
    running = None

    for step in range(args.steps):
        lr = lr_schedule(step, args.steps, args.lr, warmup=args.warmup)
        x, y = dataset.get_batch(args.batch_size, split="train")
        loss, grads = model.loss_and_grads(x, y, training=True)
        gnorm = clip_grad_norm(grads, args.grad_clip)
        opt.step(grads, lr=lr)

        running = loss if running is None else 0.9 * running + 0.1 * loss

        if step % args.log_interval == 0 or step == args.steps - 1:
            elapsed = time.time() - start
            speed = tokens_per_step * (step + 1) / max(elapsed, 1e-9)
            eta = (args.steps - step - 1) * elapsed / max(step + 1, 1)
            print("шаг %5d/%d | loss %.4f (сглаж. %.4f) | lr %.2e | |g| %.2f "
                  "| %.0f ток/с | осталось ~%.0f с"
                  % (step, args.steps, loss, running, lr, gnorm, speed, eta))
            log_file.write(json.dumps({"step": step, "loss": loss, "smooth": running,
                                       "lr": lr, "grad_norm": gnorm}) + "\n")
            log_file.flush()

        if args.eval_interval and (step + 1) % args.eval_interval == 0:
            val = estimate_loss(model, dataset, args.batch_size,
                                args.eval_batches, "val")
            ppl = float(np.exp(min(val, 20)))
            flag = ""
            if val < best_val:
                best_val = val
                model.save(model_path)
                flag = " (сохранено)"
            print("  -> val loss %.4f | перплексия %.2f%s" % (val, ppl, flag))
            log_file.write(json.dumps({"step": step, "val_loss": val, "ppl": ppl}) + "\n")
            log_file.flush()

        if args.sample_interval and (step + 1) % args.sample_interval == 0:
            sample = generate(model, tokenizer, prompt=args.sample_prompt,
                              max_new_tokens=160, temperature=0.8, top_k=20,
                              seed=step)
            print("  -- образец (шаг %d) --\n%s\n  -------------" % (step, sample.strip()))

    if best_val == float("inf"):
        # валидации не было (--eval-interval 0) — сохраняем финальные веса
        model.save(model_path)
    log_file.close()
    total = time.time() - start
    print("\nГотово за %.1f с. Веса: %s, токенизатор: %s"
          % (total, model_path, tok_path))
    print("Генерация:  python3 generate.py --run %s --prompt \"Егор и Диана\"" % args.out)


if __name__ == "__main__":
    main()
