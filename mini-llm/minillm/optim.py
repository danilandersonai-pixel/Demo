# -*- coding: utf-8 -*-
"""AdamW, обрезка градиентов и расписание learning rate."""

import numpy as np


class AdamW(object):
    """Adam с корректной (несвязанной) регуляризацией весов.

    Weight decay применяется только к матрицам (ndim >= 2): смещения и
    параметры LayerNorm штрафовать смысла нет — это общепринятая практика.
    """

    def __init__(self, params, lr=1e-3, betas=(0.9, 0.95), eps=1e-8,
                 weight_decay=0.1):
        self.params = params
        self.lr = lr
        self.beta1, self.beta2 = betas
        self.eps = eps
        self.weight_decay = weight_decay
        self.t = 0
        self.m = dict((k, np.zeros_like(v)) for k, v in params.items())
        self.v = dict((k, np.zeros_like(v)) for k, v in params.items())

    def step(self, grads, lr=None):
        if lr is not None:
            self.lr = lr
        self.t += 1
        b1, b2 = self.beta1, self.beta2
        bias1 = 1.0 - b1 ** self.t
        bias2 = 1.0 - b2 ** self.t
        for k, p in self.params.items():
            g = grads[k]
            m = self.m[k]
            v = self.v[k]
            m *= b1
            m += (1.0 - b1) * g
            v *= b2
            v += (1.0 - b2) * (g * g)
            mhat = m / bias1
            vhat = v / bias2
            update = mhat / (np.sqrt(vhat) + self.eps)
            if self.weight_decay and p.ndim >= 2:
                update = update + self.weight_decay * p
            p -= self.lr * update


def clip_grad_norm(grads, max_norm):
    """Глобальная обрезка по L2-норме. Возвращает норму ДО обрезки."""
    total = 0.0
    for g in grads.values():
        total += float((g.astype(np.float64) ** 2).sum())
    total = np.sqrt(total)
    if max_norm and total > max_norm:
        scale = max_norm / (total + 1e-6)
        for g in grads.values():
            g *= scale
    return total


def lr_schedule(step, total_steps, base_lr, warmup=100, min_ratio=0.1):
    """Линейный прогрев, затем косинусное затухание до min_ratio * base_lr."""
    if warmup > 0 and step < warmup:
        return base_lr * (step + 1) / float(warmup)
    progress = (step - warmup) / max(1.0, float(total_steps - warmup))
    progress = min(1.0, max(0.0, progress))
    coeff = 0.5 * (1.0 + np.cos(np.pi * progress))
    return base_lr * (min_ratio + (1.0 - min_ratio) * coeff)
