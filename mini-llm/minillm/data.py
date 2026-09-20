# -*- coding: utf-8 -*-
"""Загрузка корпуса и нарезка батчей."""

import numpy as np


class Dataset(object):
    """Хранит корпус как один длинный массив токенов и режет из него окна.

    Классика языкового моделирования: берём случайную позицию i и
    формируем пару (x, y), где y — это x, сдвинутый на один токен.
    Модель на каждой позиции предсказывает следующий токен.
    """

    def __init__(self, ids, block_size, val_split=0.1, seed=1337):
        ids = np.asarray(ids, dtype=np.int32)
        if len(ids) < block_size + 2:
            raise ValueError("корпус слишком короткий: %d токенов при block_size %d"
                             % (len(ids), block_size))
        n_val = int(len(ids) * val_split)
        if val_split > 0 and n_val < block_size + 1:
            n_val = min(block_size + 1, len(ids) // 2)
        self.train_ids = ids[:len(ids) - n_val] if n_val else ids
        self.val_ids = ids[len(ids) - n_val:] if n_val else None
        self.block_size = block_size
        self.rng = np.random.default_rng(seed)

    def get_batch(self, batch_size, split="train"):
        data = self.train_ids if split == "train" else self.val_ids
        if data is None or len(data) < self.block_size + 1:
            data = self.train_ids
        hi = len(data) - self.block_size - 1
        starts = self.rng.integers(0, hi, size=batch_size)
        x = np.stack([data[s:s + self.block_size] for s in starts])
        y = np.stack([data[s + 1:s + 1 + self.block_size] for s in starts])
        return x.astype(np.int64), y.astype(np.int64)

    def summary(self):
        val = 0 if self.val_ids is None else len(self.val_ids)
        return "train %d токенов, val %d токенов" % (len(self.train_ids), val)


def read_text(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()
