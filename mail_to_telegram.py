"""
Gmail → Telegram Document Collector
Скачивает PDF/DOCX вложения из Gmail и отправляет их в Telegram-бот.

Зависимости: pip install requests
Запуск:       python mail_to_telegram.py

=== Пошаговая настройка ===

1. ВКЛЮЧИТЬ IMAP В GMAIL
   Gmail → Настройки (шестерёнка) → Все настройки →
   Вкладка «Пересылка и POP/IMAP» → «Включить IMAP» → Сохранить.

2. СОЗДАТЬ APP PASSWORD (пароль приложения)
   myaccount.google.com → Безопасность → Двухэтапная аутентификация →
   Пароли приложений → Создать → выбрать «Почта» + «Mac» → Скопировать 16-значный пароль.
   Вставить в config.py → GMAIL_APP_PASSWORD (пробелы можно оставить).

3. СОЗДАТЬ TELEGRAM-БОТ
   В Telegram напишите @BotFather → /newbot →
   введите имя и username бота → скопируйте токен в TELEGRAM_TOKEN.

4. УЗНАТЬ СВОЙ TELEGRAM CHAT_ID
   Отправьте боту любое сообщение, затем откройте в браузере:
   https://api.telegram.org/bot<TELEGRAM_TOKEN>/getUpdates
   Найдите "chat":{"id": XXXXXXX} — это и есть ваш TELEGRAM_CHAT_ID.
   Либо напишите боту @userinfobot — он ответит вашим id.

5. ЗАПУСТИТЬ СКРИПТ
   pip install requests
   python mail_to_telegram.py
"""

import imaplib
import email
import email.utils
import os
import sys

import requests

import config


# ---------------------------------------------------------------------------
# Лог отправленных файлов
# ---------------------------------------------------------------------------

def load_sent_log(path: str) -> set:
    if not os.path.exists(path):
        return set()
    with open(path, "r", encoding="utf-8") as f:
        return {line.strip() for line in f if line.strip()}


def save_sent_log(path: str, sent_set: set) -> None:
    with open(path, "w", encoding="utf-8") as f:
        for entry in sorted(sent_set):
            f.write(entry + "\n")


# ---------------------------------------------------------------------------
# IMAP: получение вложений
# ---------------------------------------------------------------------------

def _decode_filename(part) -> str:
    """Возвращает читаемое имя файла из заголовка вложения."""
    raw = part.get_filename("")
    if not raw:
        return ""
    decoded_parts = email.header.decode_header(raw)
    filename = ""
    for fragment, charset in decoded_parts:
        if isinstance(fragment, bytes):
            filename += fragment.decode(charset or "utf-8", errors="replace")
        else:
            filename += fragment
    return filename


def fetch_attachments():
    """
    Генератор: подключается к Gmail, ищет письма от config.SENDER и
    выдаёт (uid, date_str, sender, filename, file_bytes) для каждого
    PDF/DOCX вложения.
    """
    imap = imaplib.IMAP4_SSL("imap.gmail.com", 993)
    try:
        imap.login(config.GMAIL, config.GMAIL_APP_PASSWORD)
    except imaplib.IMAP4.error as exc:
        print(f"Ошибка входа в Gmail: {exc}")
        print("Проверьте GMAIL и GMAIL_APP_PASSWORD в config.py,")
        print("а также убедитесь, что IMAP включён в настройках Gmail.")
        sys.exit(1)

    imap.select("INBOX")

    status, data = imap.search(None, f'(FROM "{config.SENDER}")')
    if status != "OK" or not data[0]:
        imap.logout()
        return

    uids = data[0].split()

    for uid in uids:
        status, msg_data = imap.fetch(uid, "(RFC822)")
        if status != "OK":
            continue

        raw_email = msg_data[0][1]
        msg = email.message_from_bytes(raw_email)

        # Дата письма
        date_tuple = email.utils.parsedate(msg.get("Date", ""))
        if date_tuple:
            import time
            date_str = time.strftime("%d.%m.%Y", date_tuple)
        else:
            date_str = "неизвестно"

        sender = msg.get("From", config.SENDER)

        for part in msg.walk():
            disposition = part.get("Content-Disposition", "")
            if "attachment" not in disposition.lower():
                continue

            filename = _decode_filename(part)
            if not filename:
                continue

            lower_name = filename.lower()
            if not (lower_name.endswith(".pdf") or lower_name.endswith(".docx")):
                continue

            file_bytes = part.get_payload(decode=True)
            if not file_bytes:
                continue

            yield uid.decode(), date_str, sender, filename, file_bytes

    imap.logout()


# ---------------------------------------------------------------------------
# Telegram: отправка файла
# ---------------------------------------------------------------------------

def send_to_telegram(filepath: str, sender: str, date_str: str, filename: str) -> bool:
    caption = (
        f"📎 Новый документ от {sender}\n"
        f"📄 Файл: {filename}\n"
        f"📅 Дата письма: {date_str}"
    )
    url = f"https://api.telegram.org/bot{config.TELEGRAM_TOKEN}/sendDocument"

    with open(filepath, "rb") as f:
        response = requests.post(
            url,
            data={"chat_id": config.TELEGRAM_CHAT_ID, "caption": caption},
            files={"document": (filename, f)},
            timeout=60,
        )

    if not response.ok:
        print(f"  Ошибка Telegram ({response.status_code}): {response.text}")
        return False
    return True


# ---------------------------------------------------------------------------
# Основной поток
# ---------------------------------------------------------------------------

def main():
    os.makedirs(config.TEMP_DIR, exist_ok=True)
    sent_log = load_sent_log(config.SENT_LOG)

    count = 0

    for uid, date_str, sender, filename, file_bytes in fetch_attachments():
        log_key = f"{uid}:{filename}"
        if log_key in sent_log:
            continue  # уже отправляли

        # Безопасное имя файла (убираем слэши)
        safe_name = filename.replace("/", "_").replace("\\", "_")
        filepath = os.path.join(config.TEMP_DIR, safe_name)

        with open(filepath, "wb") as f:
            f.write(file_bytes)

        print(f"  Отправка: {filename} ({date_str}) …", end=" ", flush=True)
        ok = send_to_telegram(filepath, sender, date_str, filename)

        if ok:
            print("OK")
            sent_log.add(log_key)
            save_sent_log(config.SENT_LOG, sent_log)  # сохраняем сразу
            count += 1
        else:
            print("ОШИБКА — файл не удалён из временной папки")

    print(f"Отправлено новых документов: {count}")


if __name__ == "__main__":
    main()
