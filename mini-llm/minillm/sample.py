# -*- coding: utf-8 -*-
"""Генерация текста: temperature, top-k и nucleus (top-p) сэмплирование."""

import numpy as np

from .model import softmax


def _filter_logits(logits, top_k=0, top_p=0.0):
    """Обнуляет вероятность «хвоста» распределения.

    top_k: оставить k самых вероятных токенов.
    top_p: оставить минимальный набор токенов с суммарной вероятностью >= p.
    """
    logits = logits.copy()
    if top_k and top_k < logits.size:
        threshold = np.partition(logits, -top_k)[-top_k]
        logits[logits < threshold] = -np.inf
    if top_p and 0.0 < top_p < 1.0:
        order = np.argsort(logits)[::-1]
        probs = softmax(logits[order])
        cumulative = np.cumsum(probs)
        # оставляем токены до порога включительно (первый всегда остаётся)
        keep = cumulative <= top_p
        keep[0] = True
        logits[order[~keep]] = -np.inf
    return logits


def generate(model, tokenizer, prompt="", max_new_tokens=200, temperature=0.8,
             top_k=0, top_p=0.0, seed=None, stop=None):
    """Авторегрессионно достраивает текст после prompt.

    Контекст обрезается до block_size: модель видит только последнее окно.
    KV-кэша нет намеренно — код остаётся читаемым, а для мини-модели
    пересчёт окна стоит доли миллисекунды.
    """
    rng = np.random.default_rng(seed)
    ids = tokenizer.encode(prompt) if prompt else []
    if not ids:
        # без затравки стартуем со случайного токена из словаря
        ids = [int(rng.integers(0, model.vocab_size))]
    generated = []
    for _ in range(max_new_tokens):
        window = ids[-model.block_size:]
        logits, _, _ = model.forward(np.array([window]), training=False)
        next_logits = logits[0, -1].astype(np.float64)
        if temperature <= 0:
            next_id = int(np.argmax(next_logits))
        else:
            next_logits = next_logits / temperature
            next_logits = _filter_logits(next_logits, top_k=top_k, top_p=top_p)
            probs = softmax(next_logits)
            next_id = int(rng.choice(len(probs), p=probs))
        ids.append(next_id)
        generated.append(next_id)
        if stop and tokenizer.decode(generated).endswith(stop):
            break
    return prompt + tokenizer.decode(generated)
