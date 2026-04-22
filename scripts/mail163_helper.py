import json
import re
import ssl
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
import imaplib
from imaplib import IMAP4_SSL
from email import message_from_bytes
from email.header import decode_header, make_header


HOST = "127.0.0.1"
PORT = 17374
IMAP_HOST = "imap.163.com"
IMAP_PORT = 993


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict):
  body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
  handler.send_response(status)
  handler.send_header("Content-Type", "application/json; charset=utf-8")
  handler.send_header("Content-Length", str(len(body)))
  handler.send_header("Access-Control-Allow-Origin", "*")
  handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  handler.send_header("Access-Control-Allow-Headers", "Content-Type")
  handler.end_headers()
  handler.wfile.write(body)


def _read_json(handler: BaseHTTPRequestHandler) -> dict:
  length = int(handler.headers.get("Content-Length") or "0")
  raw = handler.rfile.read(length) if length > 0 else b"{}"
  try:
    data = json.loads(raw.decode("utf-8"))
    return data if isinstance(data, dict) else {}
  except Exception:
    return {}


def _decode_mime_header(value: str) -> str:
  if not value:
    return ""
  try:
    return str(make_header(decode_header(value)))
  except Exception:
    return value


def _extract_text(msg) -> str:
  # Prefer text/plain; fallback to any text/*.
  if msg.is_multipart():
    parts = msg.walk()
    candidates = []
    for part in parts:
      ctype = (part.get_content_type() or "").lower()
      disp = (part.get("Content-Disposition") or "").lower()
      if "attachment" in disp:
        continue
      if not ctype.startswith("text/"):
        continue
      try:
        payload = part.get_payload(decode=True) or b""
        charset = part.get_content_charset() or "utf-8"
        text = payload.decode(charset, errors="replace")
        candidates.append((ctype, text))
      except Exception:
        continue

    for ctype, text in candidates:
      if ctype == "text/plain" and text:
        return text
    for _ctype, text in candidates:
      if text:
        return text
    return ""

  try:
    payload = msg.get_payload(decode=True) or b""
    charset = msg.get_content_charset() or "utf-8"
    return payload.decode(charset, errors="replace")
  except Exception:
    return ""


_CODE_RE = re.compile(r"\b(\d{6})\b")


def _matches_any(haystack: str, filters) -> bool:
  if not filters:
    return True
  lower = (haystack or "").lower()
  for item in filters:
    token = str(item or "").strip().lower()
    if token and token in lower:
      return True
  return False


def _poll_code_via_imap(
  email_addr: str,
  auth_code: str,
  filter_after_timestamp_ms: int,
  sender_filters,
  subject_filters,
  exclude_codes,
  max_attempts: int,
  interval_ms: int,
  max_messages: int = 30,
):
  exclude_set = {str(c).strip() for c in (exclude_codes or []) if str(c).strip()}
  last_error = None

  # One poll request may take a while; keep a single IMAP connection and NOOP between rounds.
  context = ssl.create_default_context()
  imap = IMAP4_SSL(IMAP_HOST, IMAP_PORT, ssl_context=context)
  try:
    imap.login(email_addr, auth_code)
    imap.select("INBOX")

    for attempt in range(max_attempts):
      try:
        typ, data = imap.search(None, "ALL")
        if typ != "OK" or not data or not data[0]:
          raise RuntimeError("IMAP search failed")

        ids = data[0].split()
        # newest first
        ids = ids[-max_messages:][::-1]

        for msg_id in ids:
          typ, fetched = imap.fetch(msg_id, "(INTERNALDATE RFC822)")
          if typ != "OK" or not fetched:
            continue

          # fetched: [(b'123 (INTERNALDATE "..." RFC822 {..}', b'...raw...', b')'), ...]
          raw = None
          internal_date = None
          for item in fetched:
            if isinstance(item, tuple) and len(item) >= 2:
              raw = item[1]
            if isinstance(item, tuple) and len(item) >= 1 and isinstance(item[0], (bytes, bytearray)):
              try:
                internal_date = imaplib.Internaldate2tuple(item[0])
              except Exception:
                internal_date = None

          if not raw:
            continue

          # internal_date: time tuple in UTC; convert to ms.
          if internal_date:
            ts_ms = int(time.mktime(internal_date) * 1000)
            if filter_after_timestamp_ms and ts_ms <= filter_after_timestamp_ms:
              continue
          else:
            ts_ms = int(time.time() * 1000)
            if filter_after_timestamp_ms and ts_ms <= filter_after_timestamp_ms:
              continue

          msg = message_from_bytes(raw)
          from_header = _decode_mime_header(msg.get("From", ""))
          subject_header = _decode_mime_header(msg.get("Subject", ""))
          if not _matches_any(from_header, sender_filters):
            continue
          if not _matches_any(subject_header, subject_filters):
            continue

          body_text = _extract_text(msg)
          # Search in subject and body
          combined = f"{subject_header}\n{body_text}"
          for m in _CODE_RE.finditer(combined):
            code = m.group(1)
            if code in exclude_set:
              continue
            return {
              "code": code,
              "emailTimestamp": ts_ms,
              "mailId": str(msg_id.decode("ascii", errors="ignore") if isinstance(msg_id, (bytes, bytearray)) else msg_id),
            }

        if attempt < max_attempts - 1:
          try:
            imap.noop()
          except Exception:
            # reconnect on next attempt
            imap.logout()
            imap = IMAP4_SSL(IMAP_HOST, IMAP_PORT, ssl_context=context)
            imap.login(email_addr, auth_code)
            imap.select("INBOX")
          time.sleep(max(0.5, interval_ms / 1000.0))
      except Exception as e:
        last_error = e
        if attempt < max_attempts - 1:
          time.sleep(max(0.5, interval_ms / 1000.0))
          continue
        raise

  finally:
    try:
      imap.logout()
    except Exception:
      pass

  raise RuntimeError(str(last_error) if last_error else "no code found")


class Handler(BaseHTTPRequestHandler):
  def do_OPTIONS(self):
    _json_response(self, 200, {"ok": True})

  def do_GET(self):
    if self.path == "/health":
      return _json_response(self, 200, {"ok": True})
    return _json_response(self, 404, {"ok": False, "error": "not found"})

  def do_POST(self):
    if self.path == "/accounts/test":
      payload = _read_json(self)
      email_addr = str(payload.get("email") or "").strip().lower()
      auth_code = str(payload.get("authCode") or "").strip()
      if not email_addr or not auth_code:
        return _json_response(self, 400, {"ok": False, "error": "email/authCode required"})

      try:
        context = ssl.create_default_context()
        imap = IMAP4_SSL(IMAP_HOST, IMAP_PORT, ssl_context=context)
        try:
          imap.login(email_addr, auth_code)
          imap.select("INBOX")
          _json_response(self, 200, {"ok": True})
        finally:
          try:
            imap.logout()
          except Exception:
            pass
      except Exception as e:
        return _json_response(self, 200, {"ok": False, "error": str(e)})
      return

    if self.path == "/accounts/poll-code":
      payload = _read_json(self)
      email_addr = str(payload.get("email") or "").strip().lower()
      auth_code = str(payload.get("authCode") or "").strip()
      if not email_addr or not auth_code:
        return _json_response(self, 400, {"ok": False, "error": "email/authCode required"})

      filter_after = int(payload.get("filterAfterTimestamp") or 0)
      sender_filters = payload.get("senderFilters") if isinstance(payload.get("senderFilters"), list) else []
      subject_filters = payload.get("subjectFilters") if isinstance(payload.get("subjectFilters"), list) else []
      exclude_codes = payload.get("excludeCodes") if isinstance(payload.get("excludeCodes"), list) else []
      max_attempts = int(payload.get("maxAttempts") or 5)
      interval_ms = int(payload.get("intervalMs") or 3000)
      max_attempts = max(1, min(60, max_attempts))
      interval_ms = max(500, min(30000, interval_ms))

      try:
        result = _poll_code_via_imap(
          email_addr=email_addr,
          auth_code=auth_code,
          filter_after_timestamp_ms=filter_after,
          sender_filters=sender_filters,
          subject_filters=subject_filters,
          exclude_codes=exclude_codes,
          max_attempts=max_attempts,
          interval_ms=interval_ms,
        )
        return _json_response(self, 200, {"ok": True, **result})
      except Exception as e:
        return _json_response(self, 200, {"ok": False, "error": str(e)})

    return _json_response(self, 404, {"ok": False, "error": "not found"})

  def log_message(self, _format, *_args):
    # Keep helper logs quiet; do not log credentials.
    return


def main():
  httpd = HTTPServer((HOST, PORT), Handler)
  print(f"mail163 helper listening on http://{HOST}:{PORT}")
  httpd.serve_forever()


if __name__ == "__main__":
  main()
