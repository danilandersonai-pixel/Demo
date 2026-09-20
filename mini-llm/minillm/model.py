# -*- coding: utf-8 -*-
"""GPT-подобный трансформер на чистом NumPy.

Ни PyTorch, ни автодиффа: каждый градиент посчитан руками. Архитектура —
уменьшенная копия GPT-2: pre-LayerNorm блоки, causal self-attention,
MLP с GELU и привязка весов (weight tying) выходного слоя к эмбеддингам.

Поток данных одного блока::

    x ──┬──► LN ──► attention ──► dropout ──┐
        └───────────────────────────────────(+)──┬──► LN ──► MLP ──► dropout ──┐
                                                 └────────────────────────────(+)──► x

Все параметры лежат в одном словаре ``self.params`` (имя -> ndarray),
градиенты — в словаре такой же формы. Это делает оптимизатор тривиальным
и позволяет численно проверить каждый градиент (см. tests/test_grad.py).
"""

import numpy as np

SQRT_2_OVER_PI = np.sqrt(2.0 / np.pi)


def gelu(x):
    """GELU в tanh-приближении — ровно то же, что в GPT-2."""
    inner = SQRT_2_OVER_PI * (x + 0.044715 * x ** 3)
    return 0.5 * x * (1.0 + np.tanh(inner))


def gelu_backward(x, dout):
    inner = SQRT_2_OVER_PI * (x + 0.044715 * x ** 3)
    t = np.tanh(inner)
    dinner = SQRT_2_OVER_PI * (1.0 + 3 * 0.044715 * x ** 2)
    dx = 0.5 * (1.0 + t) + 0.5 * x * (1.0 - t ** 2) * dinner
    return dout * dx


def layernorm_forward(x, g, b, eps=1e-5):
    mu = x.mean(axis=-1, keepdims=True)
    xc = x - mu
    var = (xc ** 2).mean(axis=-1, keepdims=True)
    std = np.sqrt(var + eps)
    xhat = xc / std
    out = xhat * g + b
    return out, (xhat, std, g)


def layernorm_backward(dout, cache):
    xhat, std, g = cache
    dg = (dout * xhat).sum(axis=tuple(range(dout.ndim - 1)))
    db = dout.sum(axis=tuple(range(dout.ndim - 1)))
    dxhat = dout * g
    n = xhat.shape[-1]
    # классическая свёрнутая формула: вычитаем среднее и проекцию на xhat
    dx = (dxhat - dxhat.mean(axis=-1, keepdims=True)
          - xhat * (dxhat * xhat).mean(axis=-1, keepdims=True)) / std
    return dx, dg, db


def softmax(x, axis=-1):
    x = x - x.max(axis=axis, keepdims=True)
    e = np.exp(x)
    return e / e.sum(axis=axis, keepdims=True)


class GPT(object):
    """Маленькая авторегрессионная языковая модель."""

    def __init__(self, vocab_size, block_size=64, n_layer=2, n_head=2,
                 n_embd=64, dropout=0.0, seed=1337):
        if n_embd % n_head != 0:
            raise ValueError("n_embd (%d) должен делиться на n_head (%d)"
                             % (n_embd, n_head))
        self.config = {
            "vocab_size": int(vocab_size),
            "block_size": int(block_size),
            "n_layer": int(n_layer),
            "n_head": int(n_head),
            "n_embd": int(n_embd),
            "dropout": float(dropout),
        }
        self.vocab_size = int(vocab_size)
        self.block_size = int(block_size)
        self.n_layer = int(n_layer)
        self.n_head = int(n_head)
        self.n_embd = int(n_embd)
        self.dropout = float(dropout)
        self.rng = np.random.default_rng(seed)
        self.params = {}
        self._init_params()
        # причинно-следственная маска: токен видит только прошлое и себя
        mask = np.tril(np.ones((self.block_size, self.block_size), dtype=bool))
        self.causal_mask = mask

    # ------------------------------------------------------------------ init
    def _normal(self, *shape, **kw):
        std = kw.get("std", 0.02)
        return (self.rng.standard_normal(shape) * std).astype(np.float32)

    def _init_params(self):
        d, l = self.n_embd, self.n_layer
        p = self.params
        p["wte"] = self._normal(self.vocab_size, d)
        p["wpe"] = self._normal(self.block_size, d)
        # масштаб для проекций внутри residual-ветки — как в GPT-2
        res_std = 0.02 / np.sqrt(2 * l)
        for i in range(l):
            pre = "h%d." % i
            p[pre + "ln1_g"] = np.ones(d, dtype=np.float32)
            p[pre + "ln1_b"] = np.zeros(d, dtype=np.float32)
            p[pre + "attn_w"] = self._normal(d, 3 * d)
            p[pre + "attn_b"] = np.zeros(3 * d, dtype=np.float32)
            p[pre + "proj_w"] = self._normal(d, d, std=res_std)
            p[pre + "proj_b"] = np.zeros(d, dtype=np.float32)
            p[pre + "ln2_g"] = np.ones(d, dtype=np.float32)
            p[pre + "ln2_b"] = np.zeros(d, dtype=np.float32)
            p[pre + "fc_w"] = self._normal(d, 4 * d)
            p[pre + "fc_b"] = np.zeros(4 * d, dtype=np.float32)
            p[pre + "fcproj_w"] = self._normal(4 * d, d, std=res_std)
            p[pre + "fcproj_b"] = np.zeros(d, dtype=np.float32)
        p["lnf_g"] = np.ones(d, dtype=np.float32)
        p["lnf_b"] = np.zeros(d, dtype=np.float32)
        # выходной слой отдельных весов не имеет: logits = x @ wte.T

    def num_params(self):
        return int(sum(v.size for v in self.params.values()))

    # --------------------------------------------------------------- dropout
    def _dropout(self, x, training):
        """Inverted dropout: на train глушим часть активаций и масштабируем."""
        if not training or self.dropout <= 0.0:
            return x, None
        keep = 1.0 - self.dropout
        mask = (self.rng.random(x.shape) < keep).astype(np.float32) / keep
        return x * mask, mask

    # --------------------------------------------------------------- forward
    def forward(self, idx, targets=None, training=False):
        """idx: (B, T) целые токены. Возвращает (logits, loss, cache)."""
        idx = np.asarray(idx)
        B, T = idx.shape
        if T > self.block_size:
            raise ValueError("длина последовательности %d больше block_size %d"
                             % (T, self.block_size))
        p = self.params
        d, nh = self.n_embd, self.n_head
        hd = d // nh
        cache = {"idx": idx, "B": B, "T": T, "blocks": []}

        x = p["wte"][idx] + p["wpe"][:T]           # (B, T, D)
        mask = self.causal_mask[:T, :T]

        for i in range(self.n_layer):
            pre = "h%d." % i
            bc = {}
            a, bc["ln1"] = layernorm_forward(x, p[pre + "ln1_g"], p[pre + "ln1_b"])
            bc["a"] = a
            qkv = a.reshape(B * T, d) @ p[pre + "attn_w"] + p[pre + "attn_b"]
            qkv = qkv.reshape(B, T, 3 * d)
            q, k, v = np.split(qkv, 3, axis=-1)
            # (B, T, D) -> (B, nh, T, hd)
            q = q.reshape(B, T, nh, hd).transpose(0, 2, 1, 3)
            k = k.reshape(B, T, nh, hd).transpose(0, 2, 1, 3)
            v = v.reshape(B, T, nh, hd).transpose(0, 2, 1, 3)
            scale = 1.0 / np.sqrt(hd)
            att = (q @ k.transpose(0, 1, 3, 2)) * scale        # (B, nh, T, T)
            att = np.where(mask, att, -1e9)
            prob = softmax(att, axis=-1)
            prob_d, bc["att_drop"] = self._dropout(prob, training)
            y = prob_d @ v                                      # (B, nh, T, hd)
            y = y.transpose(0, 2, 1, 3).reshape(B, T, d)
            bc.update(q=q, k=k, v=v, prob=prob, prob_d=prob_d, y=y, scale=scale)
            attn_out = y.reshape(B * T, d) @ p[pre + "proj_w"] + p[pre + "proj_b"]
            attn_out = attn_out.reshape(B, T, d)
            attn_out, bc["res1_drop"] = self._dropout(attn_out, training)
            x = x + attn_out
            bc["x_mid"] = x

            h, bc["ln2"] = layernorm_forward(x, p[pre + "ln2_g"], p[pre + "ln2_b"])
            bc["h"] = h
            f = h.reshape(B * T, d) @ p[pre + "fc_w"] + p[pre + "fc_b"]
            g = gelu(f)
            bc["f"], bc["g"] = f, g
            o = g @ p[pre + "fcproj_w"] + p[pre + "fcproj_b"]
            o = o.reshape(B, T, d)
            o, bc["res2_drop"] = self._dropout(o, training)
            x = x + o
            cache["blocks"].append(bc)

        xf, cache["lnf"] = layernorm_forward(x, p["lnf_g"], p["lnf_b"])
        cache["xf"] = xf
        logits = xf.reshape(B * T, d) @ p["wte"].T              # (B*T, V)

        loss = None
        if targets is not None:
            targets = np.asarray(targets).reshape(-1)
            shifted = logits - logits.max(axis=-1, keepdims=True)
            logsumexp = np.log(np.exp(shifted).sum(axis=-1)) + logits.max(axis=-1)
            loss = float(np.mean(logsumexp - logits[np.arange(logits.shape[0]), targets]))
            cache["targets"] = targets
            cache["logits"] = logits
        return logits.reshape(B, T, self.vocab_size), loss, cache

    # -------------------------------------------------------------- backward
    def backward(self, cache):
        """Возвращает словарь градиентов той же структуры, что params."""
        p = self.params
        B, T = cache["B"], cache["T"]
        d, nh = self.n_embd, self.n_head
        hd = d // nh
        N = B * T
        grads = dict((k, np.zeros_like(v)) for k, v in p.items())

        # --- кросс-энтропия -> логиты
        logits = cache["logits"]
        targets = cache["targets"]
        prob = softmax(logits, axis=-1)
        dlogits = prob
        dlogits[np.arange(N), targets] -= 1.0
        dlogits /= N

        # --- выходной слой (веса привязаны к wte)
        xf2 = cache["xf"].reshape(N, d)
        grads["wte"] += dlogits.T @ xf2
        dxf = (dlogits @ p["wte"]).reshape(B, T, d)

        dx, grads["lnf_g"][...], grads["lnf_b"][...] = layernorm_backward(dxf, cache["lnf"])

        mask = self.causal_mask[:T, :T]
        for i in reversed(range(self.n_layer)):
            pre = "h%d." % i
            bc = cache["blocks"][i]

            # ---- MLP-ветка (residual: dx идёт и в обход, и внутрь)
            do = dx
            if bc["res2_drop"] is not None:
                do = do * bc["res2_drop"]
            do2 = do.reshape(N, d)
            grads[pre + "fcproj_w"] += bc["g"].T @ do2
            grads[pre + "fcproj_b"] += do2.sum(axis=0)
            dg = do2 @ p[pre + "fcproj_w"].T
            df = gelu_backward(bc["f"], dg)
            grads[pre + "fc_w"] += bc["h"].reshape(N, d).T @ df
            grads[pre + "fc_b"] += df.sum(axis=0)
            dh = (df @ p[pre + "fc_w"].T).reshape(B, T, d)
            dx_ln2, grads[pre + "ln2_g"][...], grads[pre + "ln2_b"][...] = \
                layernorm_backward(dh, bc["ln2"])
            dx = dx + dx_ln2

            # ---- attention-ветка
            dattn = dx
            if bc["res1_drop"] is not None:
                dattn = dattn * bc["res1_drop"]
            dattn2 = dattn.reshape(N, d)
            grads[pre + "proj_w"] += bc["y"].reshape(N, d).T @ dattn2
            grads[pre + "proj_b"] += dattn2.sum(axis=0)
            dy = (dattn2 @ p[pre + "proj_w"].T).reshape(B, T, d)
            dy = dy.reshape(B, T, nh, hd).transpose(0, 2, 1, 3)   # (B, nh, T, hd)

            dprob_d = dy @ bc["v"].transpose(0, 1, 3, 2)
            dv = bc["prob_d"].transpose(0, 1, 3, 2) @ dy
            dprob = dprob_d
            if bc["att_drop"] is not None:
                dprob = dprob * bc["att_drop"]
            # softmax по последней оси
            pr = bc["prob"]
            datt = pr * (dprob - (dprob * pr).sum(axis=-1, keepdims=True))
            datt = np.where(mask, datt, 0.0)
            datt = datt * bc["scale"]
            dq = datt @ bc["k"]
            dk = datt.transpose(0, 1, 3, 2) @ bc["q"]

            def merge(t):
                return t.transpose(0, 2, 1, 3).reshape(N, d)

            dqkv = np.concatenate([merge(dq), merge(dk), merge(dv)], axis=-1)
            grads[pre + "attn_w"] += bc["a"].reshape(N, d).T @ dqkv
            grads[pre + "attn_b"] += dqkv.sum(axis=0)
            da = (dqkv @ p[pre + "attn_w"].T).reshape(B, T, d)
            dx_ln1, grads[pre + "ln1_g"][...], grads[pre + "ln1_b"][...] = \
                layernorm_backward(da, bc["ln1"])
            dx = dx + dx_ln1

        # ---- эмбеддинги
        grads["wpe"][:T] += dx.sum(axis=0)
        idx = cache["idx"]
        np.add.at(grads["wte"], idx.reshape(-1), dx.reshape(N, d))
        return grads

    def loss_and_grads(self, idx, targets, training=True):
        _, loss, cache = self.forward(idx, targets, training=training)
        return loss, self.backward(cache)

    # ------------------------------------------------------- сохранение
    def save(self, path):
        payload = dict(self.params)
        payload["__config__"] = np.array(
            [self.vocab_size, self.block_size, self.n_layer,
             self.n_head, self.n_embd], dtype=np.int64)
        payload["__dropout__"] = np.array([self.dropout], dtype=np.float32)
        np.savez_compressed(path, **payload)

    @classmethod
    def load(cls, path):
        z = np.load(path)
        cfg = z["__config__"]
        model = cls(vocab_size=int(cfg[0]), block_size=int(cfg[1]),
                    n_layer=int(cfg[2]), n_head=int(cfg[3]), n_embd=int(cfg[4]),
                    dropout=float(z["__dropout__"][0]))
        for k in model.params:
            model.params[k] = z[k].astype(np.float32)
        return model
