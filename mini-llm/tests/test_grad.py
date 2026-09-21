# -*- coding: utf-8 -*-
"""Проверка аналитических градиентов конечными разностями.

Это главный тест проекта: backprop написан руками, значит его нужно
сверить с численной производной

    df/dw ≈ (f(w + eps) - f(w - eps)) / (2 * eps)

Считаем в float64 (в float32 численная производная утонула бы в шуме)
и при выключенном dropout — иначе функция была бы случайной.
Запуск: python3 tests/test_grad.py
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from minillm.model import GPT  # noqa: E402
from minillm.tokenizer import BPETokenizer, CharTokenizer  # noqa: E402


def check_gradients(eps=1e-5, atol=1e-9, rtol=1e-4, n_samples=12, seed=0):
    rng = np.random.default_rng(seed)
    model = GPT(vocab_size=11, block_size=6, n_layer=2, n_head=2, n_embd=12,
                dropout=0.0, seed=7)
    # переводим всё в float64 ради точности конечных разностей
    for k in model.params:
        model.params[k] = model.params[k].astype(np.float64)
        # ненулевая инициализация смещений и LN, чтобы тест не был тривиальным
        if k.endswith("_b") or k.endswith("_g"):
            model.params[k] = model.params[k] + rng.standard_normal(model.params[k].shape) * 0.1

    idx = rng.integers(0, 11, size=(3, 6))
    inputs, targets = idx[:, :-1], idx[:, 1:]

    def loss_fn():
        _, loss, _ = model.forward(inputs, targets, training=False)
        return loss

    _, grads = model.loss_and_grads(inputs, targets, training=False)

    worst = 0.0
    worst_name = None
    failures = []
    for name in sorted(model.params):
        arr = model.params[name]
        flat = arr.reshape(-1)
        picks = rng.choice(flat.size, size=min(n_samples, flat.size), replace=False)
        gflat = grads[name].reshape(-1)
        for pos in picks:
            orig = flat[pos]
            flat[pos] = orig + eps
            plus = loss_fn()
            flat[pos] = orig - eps
            minus = loss_fn()
            flat[pos] = orig
            numeric = (plus - minus) / (2 * eps)
            analytic = gflat[pos]
            # Критерий в стиле numpy.allclose: конечные разности сами по себе
            # шумят на уровне ~1e-10, поэтому чистая относительная ошибка на
            #微 крошечных градиентах бессмысленна.
            diff = abs(numeric - analytic)
            rel = diff / max(abs(numeric), abs(analytic), 1e-12)
            if abs(analytic) > 1e-7 and rel > worst:
                worst, worst_name = rel, "%s[%d]" % (name, pos)
            if diff > atol + rtol * abs(numeric):
                failures.append((name, int(pos), numeric, analytic, rel))
    return worst, worst_name, failures


def check_tokenizers():
    text = "Егор и Диана приглашают вас на свадьбу 26 августа 2026 года! " * 20
    for tok in (CharTokenizer.train(text), BPETokenizer.train(text, vocab_size=320)):
        probe = "Диана 2026!"
        assert tok.decode(tok.encode(probe)) == probe, tok.kind
        print("  [ok] %-5s round-trip, словарь %d, длина %d токенов"
              % (tok.kind, tok.vocab_size, len(tok.encode(probe))))
    # BPE работает с байтами, поэтому переживает любой символ вне корпуса
    bpe = BPETokenizer.train(text, vocab_size=300)
    assert bpe.decode(bpe.encode("🎉 wedding")) == "🎉 wedding"
    # char-токенизатор незнакомые символы молча выбрасывает
    ch = CharTokenizer.train(text)
    assert ch.decode(ch.encode("Диана🎉")) == "Диана"
    print("  [ok] незнакомые символы: BPE кодирует, char отбрасывает")


def check_causality():
    """Изменение будущего токена не должно менять прошлые логиты."""
    model = GPT(vocab_size=9, block_size=5, n_layer=2, n_head=3, n_embd=9, seed=3)
    a = np.array([[1, 2, 3, 4, 5]])
    b = a.copy()
    b[0, -1] = 8
    la, _, _ = model.forward(a)
    lb, _, _ = model.forward(b)
    diff = np.abs(la[:, :-1] - lb[:, :-1]).max()
    assert diff < 1e-6, "маска протекает: %g" % diff
    print("  [ok] causal-маска держит: расхождение %.2e" % diff)


def check_overfit():
    """Модель обязана выучить одну короткую последовательность наизусть."""
    from minillm.optim import AdamW

    rng = np.random.default_rng(0)
    seq = rng.integers(0, 13, size=(1, 17))
    model = GPT(vocab_size=13, block_size=16, n_layer=2, n_head=2, n_embd=32, seed=5)
    opt = AdamW(model.params, lr=3e-3)
    loss = None
    for _ in range(300):
        loss, grads = model.loss_and_grads(seq[:, :-1], seq[:, 1:])
        opt.step(grads)
    assert loss < 0.02, "не переобучилась на одном примере: loss=%.4f" % loss
    print("  [ok] переобучение на одном примере: loss %.5f" % loss)


if __name__ == "__main__":
    print("1. Численная проверка градиентов (float64, dropout выключен)")
    worst, worst_name, failures = check_gradients()
    for name, pos, num, ana, rel in failures:
        print("  [FAIL] %s[%d]: численный %.8e vs аналитический %.8e (rel %.2e)"
              % (name, pos, num, ana, rel))
    print("  худшая относительная ошибка (на градиентах > 1e-7): %.2e (%s)"
          % (worst, worst_name))
    print("2. Токенизаторы")
    check_tokenizers()
    print("3. Причинно-следственная маска")
    check_causality()
    print("4. Способность выучить последовательность")
    check_overfit()
    if failures:
        print("\nПРОВАЛЕНО: %d градиентов разошлись" % len(failures))
        sys.exit(1)
    print("\nВсе проверки пройдены.")
