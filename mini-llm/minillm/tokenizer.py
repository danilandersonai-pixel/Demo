# -*- coding: utf-8 -*-
"""Токенизаторы для mini-LLM.

Два варианта, оба без зависимостей:

* ``CharTokenizer`` — посимвольный. Словарь = все символы корпуса.
  Учится мгновенно, словарь маленький, зато последовательности длинные.
* ``BPETokenizer`` — байтовый BPE (тот же принцип, что у GPT-2, но в
  минимальном виде). Сливает самые частые пары токенов, пока словарь
  не дорастёт до нужного размера. Текст становится в 3-4 раза короче,
  значит при том же ``block_size`` модель видит больше контекста.
"""

import json
import re
from collections import Counter


class CharTokenizer(object):
    """Посимвольный токенизатор: один символ — один токен."""

    kind = "char"

    def __init__(self, chars):
        self.itos = list(chars)
        self.stoi = dict((ch, i) for i, ch in enumerate(self.itos))

    @classmethod
    def train(cls, text):
        return cls(sorted(set(text)))

    @property
    def vocab_size(self):
        return len(self.itos)

    def encode(self, text):
        stoi = self.stoi
        # неизвестные символы просто выбрасываем — так безопаснее, чем падать
        return [stoi[ch] for ch in text if ch in stoi]

    def decode(self, ids):
        itos = self.itos
        return "".join(itos[i] for i in ids if 0 <= i < len(itos))

    def state(self):
        return {"kind": self.kind, "itos": self.itos}

    @classmethod
    def from_state(cls, state):
        return cls(state["itos"])


# Разбиение на «слова» перед BPE: пробелы приклеиваются к следующему слову.
# Слияния никогда не пересекают границу чанка — так же устроен GPT-2, и это
# на порядки ускоряет и обучение, и кодирование (чанки повторяются).
_CHUNK_RE = re.compile(r"\s*\S+|\s+")


class BPETokenizer(object):
    """Минимальный byte-level BPE.

    Работает поверх UTF-8 байтов, поэтому не боится ни эмодзи, ни редких
    символов: базовый словарь — это всегда 256 байтов, дальше идут слияния.
    """

    kind = "bpe"

    def __init__(self, merges):
        # merges: список пар [(a, b), ...] в порядке обучения.
        # Токен 256 + i получается склейкой i-й пары.
        self.merges = [tuple(pair) for pair in merges]
        self.ranks = dict((pair, i) for i, pair in enumerate(self.merges))
        self._cache = {}
        self._build_vocab()

    def _build_vocab(self):
        vocab = dict((i, bytes([i])) for i in range(256))
        for i, (a, b) in enumerate(self.merges):
            vocab[256 + i] = vocab[a] + vocab[b]
        self.vocab = vocab

    @classmethod
    def train(cls, text, vocab_size=512, verbose=False):
        if vocab_size < 256:
            raise ValueError("vocab_size должен быть не меньше 256")
        # считаем статистику по уникальным чанкам с их частотами, а не по
        # всему потоку байтов: результат тот же, работы в сотни раз меньше
        freqs = Counter(_CHUNK_RE.findall(text))
        words = dict((tuple(chunk.encode("utf-8")), n) for chunk, n in freqs.items())
        merges = []
        num_merges = vocab_size - 256
        for i in range(num_merges):
            stats = Counter()
            for ids, n in words.items():
                for pair in zip(ids, ids[1:]):
                    stats[pair] += n
            if not stats:
                break
            pair, count = stats.most_common(1)[0]
            if count < 2:
                break  # сливать больше нечего
            new_id = 256 + i
            words = dict((tuple(_merge(list(ids), pair, new_id)), n)
                         for ids, n in words.items())
            merges.append(pair)
            if verbose and (i + 1) % 100 == 0:
                print("  слияние %d/%d, частота лучшей пары %d"
                      % (i + 1, num_merges, count))
        return cls(merges)

    @property
    def vocab_size(self):
        return 256 + len(self.merges)

    def encode(self, text):
        out = []
        for chunk in _CHUNK_RE.findall(text):
            cached = self._cache.get(chunk)
            if cached is None:
                cached = self._encode_chunk(chunk)
                self._cache[chunk] = cached
            out.extend(cached)
        return out

    def _encode_chunk(self, chunk):
        ids = list(chunk.encode("utf-8"))
        while len(ids) >= 2:
            # применяем слияния в том же порядке, в каком они выучены
            best = None
            best_rank = None
            for pair in zip(ids, ids[1:]):
                rank = self.ranks.get(pair)
                if rank is not None and (best_rank is None or rank < best_rank):
                    best, best_rank = pair, rank
            if best is None:
                break
            ids = _merge(ids, best, 256 + best_rank)
        return ids

    def decode(self, ids):
        vocab = self.vocab
        raw = b"".join(vocab[i] for i in ids if i in vocab)
        return raw.decode("utf-8", errors="replace")

    def state(self):
        return {"kind": self.kind, "merges": [list(p) for p in self.merges]}

    @classmethod
    def from_state(cls, state):
        return cls(state["merges"])


def _merge(ids, pair, new_id):
    """Заменяет все вхождения пары на новый токен."""
    out = []
    i = 0
    n = len(ids)
    a, b = pair
    while i < n:
        if i < n - 1 and ids[i] == a and ids[i + 1] == b:
            out.append(new_id)
            i += 2
        else:
            out.append(ids[i])
            i += 1
    return out


def train_tokenizer(text, kind="char", vocab_size=512, verbose=False):
    if kind == "char":
        return CharTokenizer.train(text)
    if kind == "bpe":
        return BPETokenizer.train(text, vocab_size=vocab_size, verbose=verbose)
    raise ValueError("неизвестный тип токенизатора: %r" % (kind,))


def save_tokenizer(tok, path):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(tok.state(), fh, ensure_ascii=False)


def load_tokenizer(path):
    with open(path, "r", encoding="utf-8") as fh:
        state = json.load(fh)
    if state["kind"] == "char":
        return CharTokenizer.from_state(state)
    if state["kind"] == "bpe":
        return BPETokenizer.from_state(state)
    raise ValueError("неизвестный токенизатор в файле: %r" % (state.get("kind"),))
