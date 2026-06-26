FROM python:3.11-slim

# Системные зависимости: Tesseract OCR + русский языковой пакет.
RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-rus \
        tesseract-ocr-eng \
        libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY bot ./bot

# Каталог данных (монтируется как volume в docker-compose).
RUN mkdir -p /app/data
ENV DB_PATH=/app/data/finance.db \
    RECEIPTS_DIR=/app/data/receipts

CMD ["python", "-m", "bot"]
