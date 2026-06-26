"""Генерация диаграмм (matplotlib, без GUI) в виде PNG-байтов."""

from __future__ import annotations

import io
import re

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

# Бордово-кремовая палитра под общий стиль.
_COLORS = [
    "#7b2d3b", "#a4404f", "#c75c6a", "#d98a94", "#e3b0b6",
    "#b8860b", "#d4a843", "#e6c97a", "#8a6d3b", "#5c4033",
    "#9c7c6c", "#c2a499", "#6b4226",
]


def _clean_label(label: str) -> str:
    """Убирает ведущие эмодзи/символы, оставляя текст категории."""
    return re.sub(r"^[^\w]+", "", label, flags=re.UNICODE).strip() or label


def category_pie(
    pairs: list[tuple[str, float]], title: str, currency: str
) -> bytes | None:
    """Круговая диаграмма распределения по категориям."""
    pairs = [(c, v) for c, v in pairs if v > 0]
    if not pairs:
        return None

    # Мелкие доли (<3%) сворачиваем в «Прочее», чтобы не засорять легенду.
    total = sum(v for _, v in pairs)
    big, small = [], 0.0
    for cat, val in pairs:
        if val / total < 0.03 and len(pairs) > 6:
            small += val
        else:
            big.append((cat, val))
    if small > 0:
        big.append(("Прочее (мелкое)", small))

    # Эмодзи отсутствуют в стандартном шрифте matplotlib — убираем их из подписей.
    labels = [_clean_label(c) for c, _ in big]
    values = [v for _, v in big]

    fig, ax = plt.subplots(figsize=(7, 5), dpi=130)
    wedges, _texts, autotexts = ax.pie(
        values,
        autopct=lambda p: f"{p:.0f}%",
        startangle=140,
        colors=_COLORS[: len(values)],
        wedgeprops={"edgecolor": "white", "linewidth": 1.5},
        pctdistance=0.78,
    )
    for at in autotexts:
        at.set_color("white")
        at.set_fontsize(9)
        at.set_fontweight("bold")

    legend_labels = [
        f"{lab} — {val:,.0f} {currency}".replace(",", " ")
        for lab, val in zip(labels, values)
    ]
    ax.legend(
        wedges,
        legend_labels,
        loc="center left",
        bbox_to_anchor=(1.0, 0.5),
        fontsize=9,
        frameon=False,
    )
    ax.set_title(title, fontsize=13, fontweight="bold", color="#7b2d3b")
    ax.axis("equal")
    fig.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()
