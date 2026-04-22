import json
import os
import re
import ssl
import time
import traceback
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import imaplib
from imaplib import IMAP4_SSL
from email import message_from_bytes
from email.header import decode_header, make_header


HOST = "127.0.0.1"
PORT = 17374
IMAP_HOST = "imap.163.com"
IMAP_PORT = 993
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_DIR = os.path.join(BASE_DIR, "data")
LOG_PATH = os.path.join(DATA_DIR, "mail163-helper.log")

if "ID" not in imaplib.Commands:
  imaplib.Commands["ID"] = ("NONAUTH", "AUTH", "SELECTED")


def _append_log(level: str, message: str):
  os.makedirs(DATA_DIR, exist_ok=True)
  timestamp = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S%z")
  with open(LOG_PATH, "a", encoding="utf-8") as handle:
    handle.write(f"[{timestamp}] [{level}] {message}\n")


def _log_info(message: str):
  print(f"[Mail163Helper] {message}", flush=True)
  _append_log("INFO", message)


def _log_error(message: str):
  print(f"[Mail163Helper] {message}", flush=True)
  _append_log("ERROR", message)


def _mask_email(email_addr: str) -> str:
  email_addr = str(email_addr or "").strip()
  if not email_addr or "@" not in email_addr:
    return email_addr

  local, domain = email_addr.split("@", 1)
  if len(local) <= 3:
    local_masked = local[0] + "***" if local else "***"
  else:
    local_masked = local[:3] + "***"
  return f"{local_masked}@{domain}"


def _decode_imap_atoms(values) -> str:
  if not values:
    return ""
  normalized = []
  for item in values:
    if isinstance(item, bytes):
      normalized.append(item.decode("utf-8", errors="replace"))
    else:
      normalized.append(str(item))
  return " | ".join(part.strip() for part in normalized if str(part).strip())


def _list_mailboxes(imap) -> list[str]:
  try:
    typ, data = imap.list()
    if typ != "OK":
      return []
    results = []
    for item in data or []:
      text = item.decode("utf-8", errors="replace") if isinstance(item, bytes) else str(item)
      results.append(text.strip())
    return results
  except Exception:
    return []


def _parse_mailbox_targets(imap) -> list[dict]:
  targets = [{"label": "INBOX", "name": "INBOX"}]
  seen = {"INBOX"}
  for item in _list_mailboxes(imap):
    normalized = str(item or "").strip()
    if not normalized:
      continue

    parts = re.findall(r'"([^"]*)"', normalized)
    mailbox_name = parts[-1] if parts else ""
    mailbox_flags = normalized.split(" ", 1)[0]
    if not mailbox_name or mailbox_name in seen:
      continue

    if "\\Junk" in mailbox_flags or mailbox_name.lower() in {"junk", "junk email", "junk e-mail"}:
      targets.append({
        "label": "Junk",
        "name": mailbox_name,
      })
      seen.add(mailbox_name)

  return targets


def _send_client_id(imap):
  payload = (
    '("name" "MultiPage Mail163 Helper" '
    '"version" "1.0.0" '
    '"vendor" "OpenAI" '
    '"contact" "local-helper")'
  )
  try:
    typ, data = imap._simple_command("ID", payload)
    _log_info(
      f"imap id sent status={typ} state={getattr(imap, 'state', '')} "
      f"response={_decode_imap_atoms(data)}"
    )
    return typ, data
  except Exception as exc:
    raise RuntimeError(f"IMAP ID command failed: {exc}") from exc


def _select_mailbox(imap, mailbox: str = "INBOX"):
  candidates = []
  requested = str(mailbox or "").strip()
  if requested:
    candidates.append(requested)
  if requested.upper() != "INBOX":
    candidates.append("INBOX")
  candidates.append(None)

  last_failure = None
  for candidate in candidates:
    try:
      typ, data = imap.select(candidate) if candidate else imap.select()
    except Exception as exc:
      last_failure = f"select({candidate or '<default>'}) raised: {exc}"
      continue

    if typ == "OK" and getattr(imap, "state", "") == "SELECTED":
      return candidate or "INBOX"

    response_text = _decode_imap_atoms(data)
    last_failure = (
      f"select({candidate or '<default>'}) status={typ} "
      f"state={getattr(imap, 'state', '')} response={response_text}"
    )

  mailbox_list = _list_mailboxes(imap)
  mailbox_text = "; ".join(mailbox_list[:20]) if mailbox_list else "unavailable"
  raise RuntimeError(
    f"IMAP select mailbox failed: {last_failure}; availableMailboxes={mailbox_text}"
  )


def _message_matches_filters(from_header: str, subject_header: str, body_text: str, sender_filters, subject_filters):
  sender_match = _matches_any(from_header, sender_filters)
  subject_match = _matches_any(subject_header, subject_filters) or _matches_any(body_text, subject_filters)

  if sender_filters and subject_filters:
    return sender_match or subject_match, sender_match, subject_match
  if sender_filters:
    return sender_match, sender_match, subject_match
  if subject_filters:
    return subject_match, sender_match, subject_match
  return True, sender_match, subject_match


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict):
  body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
  try:
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.end_headers()
    handler.wfile.write(body)
  except (BrokenPipeError, ConnectionResetError):
    _log_error("client disconnected before helper response could be written")


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
_TIME_FALLBACK_MAX_AGE_MS = 20 * 60 * 1000


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
  selected_mailbox = "INBOX"
  mailbox_targets = [{"label": "INBOX", "name": "INBOX"}]
  debug_candidates = []
  time_fallback_match = None

  # One poll request may take a while; keep a single IMAP connection and NOOP between rounds.
  context = ssl.create_default_context()
  imap = IMAP4_SSL(IMAP_HOST, IMAP_PORT, ssl_context=context)
  try:
    _log_info(
      f"poll start email={_mask_email(email_addr)} "
      f"filterAfter={int(filter_after_timestamp_ms or 0)} "
      f"maxAttempts={max_attempts} intervalMs={interval_ms}"
    )
    _send_client_id(imap)
    imap.login(email_addr, auth_code)
    selected_mailbox = _select_mailbox(imap, "INBOX")
    mailbox_targets = _parse_mailbox_targets(imap)
    _log_info(
      f"imap login/select ok email={_mask_email(email_addr)} mailbox={selected_mailbox} "
      f"scanTargets={[item['label'] + ':' + item['name'] for item in mailbox_targets]}"
    )

    for attempt in range(max_attempts):
      try:
        debug_candidates = []
        for mailbox_target in mailbox_targets:
          selected_mailbox = _select_mailbox(imap, mailbox_target["name"])
          typ, data = imap.search(None, "ALL")
          if typ != "OK" or not data or not data[0]:
            raise RuntimeError(
              f"IMAP search failed: status={typ} state={getattr(imap, 'state', '')} "
              f"response={_decode_imap_atoms(data)} mailbox={selected_mailbox}"
            )

          ids = data[0].split()
          ids = ids[-max_messages:][::-1]
          _log_info(
            f"poll attempt={attempt + 1}/{max_attempts} email={_mask_email(email_addr)} "
            f"mailbox={mailbox_target['label']} matchedCandidates={len(ids)}"
          )

          for msg_id in ids:
            typ, fetched = imap.fetch(msg_id, "(INTERNALDATE RFC822)")
            if typ != "OK" or not fetched:
              continue

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

            if internal_date:
              ts_ms = int(time.mktime(internal_date) * 1000)
            else:
              ts_ms = int(time.time() * 1000)

            msg = message_from_bytes(raw)
            from_header = _decode_mime_header(msg.get("From", ""))
            subject_header = _decode_mime_header(msg.get("Subject", ""))
            body_text = _extract_text(msg)
            combined = f"{subject_header}\n{body_text}"

            code = ""
            for m in _CODE_RE.finditer(combined):
              next_code = m.group(1)
              if next_code in exclude_set:
                continue
              code = next_code
              break

            passed_filter_after = not filter_after_timestamp_ms or ts_ms > filter_after_timestamp_ms
            matches_filters, sender_match, subject_match = _message_matches_filters(
              from_header,
              subject_header,
              body_text,
              sender_filters,
              subject_filters,
            )

            if len(debug_candidates) < 12:
              debug_candidates.append({
                "mailbox": mailbox_target["label"],
                "timestamp": ts_ms,
                "from": from_header[:120],
                "subject": subject_header[:120],
                "code": code,
                "senderMatch": sender_match,
                "subjectMatch": subject_match,
                "passedFilterAfter": passed_filter_after,
              })

            if matches_filters and code:
              if (
                time_fallback_match is None
                or ts_ms > int(time_fallback_match.get("emailTimestamp") or 0)
              ):
                time_fallback_match = {
                  "code": code,
                  "emailTimestamp": ts_ms,
                  "mailId": str(
                    msg_id.decode("ascii", errors="ignore")
                    if isinstance(msg_id, (bytes, bytearray))
                    else msg_id
                  ),
                  "mailbox": mailbox_target["label"],
                }

            if not passed_filter_after:
              continue
            if not matches_filters:
              continue
            if not code:
              continue

            _log_info(
              f"poll success email={_mask_email(email_addr)} mailbox={mailbox_target['label']} "
              f"mailId={msg_id.decode('ascii', errors='ignore') if isinstance(msg_id, (bytes, bytearray)) else msg_id} "
              f"code={code}"
            )
            return {
              "code": code,
              "emailTimestamp": ts_ms,
              "mailId": str(msg_id.decode("ascii", errors="ignore") if isinstance(msg_id, (bytes, bytearray)) else msg_id),
              "usedTimeFallback": False,
              "selectionSource": "strict",
            }

        if attempt < max_attempts - 1:
          try:
            imap.noop()
          except Exception:
            # reconnect on next attempt
            imap.logout()
            imap = IMAP4_SSL(IMAP_HOST, IMAP_PORT, ssl_context=context)
            _send_client_id(imap)
            imap.login(email_addr, auth_code)
            selected_mailbox = _select_mailbox(imap, "INBOX")
            mailbox_targets = _parse_mailbox_targets(imap)
            _log_info(
              f"imap reconnect/select ok email={_mask_email(email_addr)} mailbox={selected_mailbox} "
              f"scanTargets={[item['label'] + ':' + item['name'] for item in mailbox_targets]}"
            )
          time.sleep(max(0.5, interval_ms / 1000.0))
      except Exception as e:
        last_error = e
        _log_error(
          f"poll attempt failed email={_mask_email(email_addr)} "
          f"attempt={attempt + 1}/{max_attempts} detail={e}"
        )
        if debug_candidates:
          _log_info(
            "poll debug candidates: "
            + " || ".join(
              (
                f"mailbox={item['mailbox']} "
                f"ts={item['timestamp']} "
                f"senderMatch={item['senderMatch']} "
                f"subjectMatch={item['subjectMatch']} "
                f"passedFilterAfter={item['passedFilterAfter']} "
                f"code={item['code'] or '-'} "
                f"from={item['from']} "
                f"subject={item['subject']}"
              )
              for item in debug_candidates
            )
          )
        if attempt < max_attempts - 1:
          time.sleep(max(0.5, interval_ms / 1000.0))
          continue
        raise

  finally:
    try:
      imap.logout()
    except Exception:
      pass

  if debug_candidates:
    _log_info(
      "poll final candidates: "
      + " || ".join(
        (
          f"mailbox={item['mailbox']} "
          f"ts={item['timestamp']} "
          f"senderMatch={item['senderMatch']} "
          f"subjectMatch={item['subjectMatch']} "
          f"passedFilterAfter={item['passedFilterAfter']} "
          f"code={item['code'] or '-'} "
          f"from={item['from']} "
          f"subject={item['subject']}"
        )
        for item in debug_candidates
      )
    )

  if time_fallback_match and filter_after_timestamp_ms:
    fallback_age_ms = max(0, int(time.time() * 1000) - int(time_fallback_match["emailTimestamp"]))
    if fallback_age_ms <= _TIME_FALLBACK_MAX_AGE_MS:
      _log_info(
        f"poll time fallback email={_mask_email(email_addr)} mailbox={time_fallback_match['mailbox']} "
        f"mailId={time_fallback_match['mailId']} code={time_fallback_match['code']} "
        f"ageMs={fallback_age_ms} filterAfter={int(filter_after_timestamp_ms or 0)}"
      )
      return {
        "code": time_fallback_match["code"],
        "emailTimestamp": int(time_fallback_match["emailTimestamp"]),
        "mailId": str(time_fallback_match["mailId"]),
        "usedTimeFallback": True,
        "selectionSource": "time_fallback",
      }

    _log_info(
      f"poll time fallback skipped email={_mask_email(email_addr)} mailbox={time_fallback_match['mailbox']} "
      f"mailId={time_fallback_match['mailId']} ageMs={fallback_age_ms} "
      f"maxAgeMs={_TIME_FALLBACK_MAX_AGE_MS}"
    )

  raise RuntimeError(str(last_error) if last_error else "no code found")


class Handler(BaseHTTPRequestHandler):
  def do_OPTIONS(self):
    _json_response(self, 200, {"ok": True})

  def do_GET(self):
    if self.path == "/health":
      return _json_response(self, 200, {"ok": True, "logPath": LOG_PATH})
    return _json_response(self, 404, {"ok": False, "error": "not found"})

  def do_POST(self):
    if self.path == "/accounts/test":
      payload = _read_json(self)
      email_addr = str(payload.get("email") or "").strip().lower()
      auth_code = str(payload.get("authCode") or "").strip()
      if not email_addr or not auth_code:
        return _json_response(self, 400, {"ok": False, "error": "email/authCode required"})

      try:
        _log_info(f"test start email={_mask_email(email_addr)}")
        context = ssl.create_default_context()
        imap = IMAP4_SSL(IMAP_HOST, IMAP_PORT, ssl_context=context)
        try:
          _send_client_id(imap)
          imap.login(email_addr, auth_code)
          selected_mailbox = _select_mailbox(imap, "INBOX")
          _log_info(f"test success email={_mask_email(email_addr)} mailbox={selected_mailbox}")
          _json_response(self, 200, {"ok": True, "logPath": LOG_PATH, "mailbox": selected_mailbox})
        finally:
          try:
            imap.logout()
          except Exception:
            pass
      except Exception as e:
        _log_error(f"test failed email={_mask_email(email_addr)} detail={e}")
        return _json_response(self, 200, {"ok": False, "error": str(e), "logPath": LOG_PATH})
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
        _log_info(
          f"poll endpoint start email={_mask_email(email_addr)} "
          f"senderFilters={sender_filters} subjectFilters={subject_filters}"
        )
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
        return _json_response(self, 200, {"ok": True, "logPath": LOG_PATH, **result})
      except Exception as e:
        _log_error(f"poll endpoint failed email={_mask_email(email_addr)} detail={e}")
        _log_error(traceback.format_exc().strip())
        return _json_response(self, 200, {"ok": False, "error": str(e), "logPath": LOG_PATH})

    return _json_response(self, 404, {"ok": False, "error": "not found"})

  def log_message(self, _format, *_args):
    # Keep helper logs quiet; do not log credentials.
    return


def main():
  httpd = ThreadingHTTPServer((HOST, PORT), Handler)
  _log_info(f"mail163 helper listening on http://{HOST}:{PORT}")
  _log_info(f"mail163 helper log path: {LOG_PATH}")
  httpd.serve_forever()


if __name__ == "__main__":
  main()
