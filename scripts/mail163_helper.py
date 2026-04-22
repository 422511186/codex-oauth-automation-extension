import json
import os
import re
import ssl
import time
import traceback
import html
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
      f"已发送 IMAP ID：status={typ} state={getattr(imap, 'state', '')} "
      f"response={_decode_imap_atoms(data)}"
    )
    return typ, data
  except Exception as exc:
    raise RuntimeError(f"IMAP ID 命令失败：{exc}") from exc


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
      last_failure = f"select({candidate or '<default>'}) 抛错：{exc}"
      continue

    if typ == "OK" and getattr(imap, "state", "") == "SELECTED":
      return candidate or "INBOX"

    response_text = _decode_imap_atoms(data)
    last_failure = (
      f"select({candidate or '<default>'}) status={typ} "
      f"state={getattr(imap, 'state', '')} response={response_text}"
    )

  mailbox_list = _list_mailboxes(imap)
  mailbox_text = "; ".join(mailbox_list[:20]) if mailbox_list else "不可用"
  raise RuntimeError(
    f"IMAP 选择邮箱失败：{last_failure}；availableMailboxes={mailbox_text}"
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
  except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
    _log_error("客户端已断开，helper 响应未能写回")


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


def _normalize_text(value: str) -> str:
  text = html.unescape(str(value or ""))
  text = text.replace("\r", " ").replace("\n", " ").replace("\xa0", " ").replace("\u200b", " ")
  return re.sub(r"\s+", " ", text).strip()


def _html_to_text(value: str) -> str:
  text = html.unescape(str(value or ""))
  if not text:
    return ""
  text = re.sub(r"(?is)<!--.*?-->", " ", text)
  text = re.sub(r"(?is)<(script|style)\b.*?>.*?</\1>", " ", text)
  text = re.sub(r"(?i)<br\s*/?>", "\n", text)
  text = re.sub(r"(?i)</p\s*>", "\n", text)
  text = re.sub(r"(?i)</div\s*>", "\n", text)
  text = re.sub(r"(?s)<[^>]+>", " ", text)
  return _normalize_text(text)


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
        if ctype == "text/html":
          text = _html_to_text(text)
        else:
          text = _normalize_text(text)
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
    text = payload.decode(charset, errors="replace")
    if (msg.get_content_type() or "").lower() == "text/html":
      return _html_to_text(text)
    return _normalize_text(text)
  except Exception:
    return ""


_CN_CODE_HINT = (
  r"(?:输入此临时验证码以继续|请输入(?:此)?临时验证码(?:以继续)?|"
  r"临时验证码|临时登录验证码|临时登录代码|登录验证码|登录代码|验证码|代码为)"
)
_EN_CODE_HINT = (
  r"(?:input this temporary code to continue|enter this temporary code to continue|enter this code|"
  r"log[-\s]*in code|"
  r"your temporary code|temporary verification code|temporary login code|"
  r"verification code|login code|temporary code|one[-\s]*time code|"
  r"security code|auth(?:entication)? code|code(?:\s+is)?)"
)
_VERIFICATION_CODE_PATTERNS = [
  ("cn_forward", re.compile(rf"{_CN_CODE_HINT}[^0-9]{{0,24}}(\d{{6}})", re.IGNORECASE)),
  ("en_forward", re.compile(rf"{_EN_CODE_HINT}[^0-9]{{0,24}}(\d{{6}})", re.IGNORECASE)),
  ("cn_reverse", re.compile(rf"\b(\d{{6}})\b[^0-9]{{0,24}}{_CN_CODE_HINT}", re.IGNORECASE)),
  ("en_reverse", re.compile(rf"\b(\d{{6}})\b[^0-9]{{0,24}}{_EN_CODE_HINT}", re.IGNORECASE)),
]
_TIME_FALLBACK_MAX_GAP_MS = 2 * 60 * 1000


def _matches_any(haystack: str, filters) -> bool:
  if not filters:
    return True
  lower = (haystack or "").lower()
  for item in filters:
    token = str(item or "").strip().lower()
    if token and token in lower:
      return True
  return False


def _extract_search_ids(data) -> list[bytes]:
  if not data:
    return []

  raw_ids = data[0]
  if raw_ids is None:
    return []

  if isinstance(raw_ids, bytes):
    return raw_ids.split()

  normalized = str(raw_ids or "").strip()
  if not normalized:
    return []

  return normalized.encode("utf-8", errors="ignore").split()


def _extract_verification_code(text: str):
  normalized = _normalize_text(text)
  if not normalized:
    return None

  for source, pattern in _VERIFICATION_CODE_PATTERNS:
    match = pattern.search(normalized)
    if not match:
      continue
    code = str(match.group(1) or "").strip()
    if not code:
      continue
    snippet_start = max(0, match.start() - 36)
    snippet_end = min(len(normalized), match.end() + 36)
    return {
      "code": code,
      "source": source,
      "snippet": normalized[snippet_start:snippet_end],
    }

  return None


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
      f"开始轮询验证码 email={_mask_email(email_addr)} "
      f"filterAfter={int(filter_after_timestamp_ms or 0)} "
      f"maxAttempts={max_attempts} intervalMs={interval_ms}"
    )
    _send_client_id(imap)
    imap.login(email_addr, auth_code)
    selected_mailbox = _select_mailbox(imap, "INBOX")
    mailbox_targets = _parse_mailbox_targets(imap)
    _log_info(
      f"IMAP 登录与选箱成功 email={_mask_email(email_addr)} mailbox={selected_mailbox} "
      f"scanTargets={[item['label'] + ':' + item['name'] for item in mailbox_targets]}"
    )

    for attempt in range(max_attempts):
      try:
        debug_candidates = []
        for mailbox_target in mailbox_targets:
          selected_mailbox = _select_mailbox(imap, mailbox_target["name"])
          typ, data = imap.search(None, "ALL")
          if typ != "OK":
            raise RuntimeError(
              f"IMAP 搜索失败：status={typ} state={getattr(imap, 'state', '')} "
              f"response={_decode_imap_atoms(data)} mailbox={selected_mailbox}"
            )

          ids = _extract_search_ids(data)
          ids = ids[-max_messages:][::-1]
          _log_info(
            f"轮询第 {attempt + 1}/{max_attempts} 次 email={_mask_email(email_addr)} "
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
            extraction = _extract_verification_code(combined)
            code = ""
            extraction_source = ""
            extraction_snippet = ""
            if extraction:
              next_code = str(extraction.get("code") or "").strip()
              if next_code and next_code not in exclude_set:
                code = next_code
                extraction_source = str(extraction.get("source") or "").strip()
                extraction_snippet = str(extraction.get("snippet") or "").strip()

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
                "codeSource": extraction_source,
                "codeSnippet": extraction_snippet[:120],
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
                  "source": extraction_source,
                }

            if not passed_filter_after:
              continue
            if not matches_filters:
              continue
            if not code:
              continue

            _log_info(
              f"轮询成功 email={_mask_email(email_addr)} mailbox={mailbox_target['label']} "
              f"mailId={msg_id.decode('ascii', errors='ignore') if isinstance(msg_id, (bytes, bytearray)) else msg_id} "
              f"code={code} source={extraction_source or '-'}"
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
              f"IMAP 重连并选箱成功 email={_mask_email(email_addr)} mailbox={selected_mailbox} "
              f"scanTargets={[item['label'] + ':' + item['name'] for item in mailbox_targets]}"
            )
          time.sleep(max(0.5, interval_ms / 1000.0))
      except Exception as e:
        last_error = e
        _log_error(
          f"轮询第 {attempt + 1}/{max_attempts} 次失败 email={_mask_email(email_addr)} "
          f"detail={e}"
        )
        if debug_candidates:
          _log_info(
            "轮询调试候选："
            + " || ".join(
              (
                f"mailbox={item['mailbox']} "
                f"ts={item['timestamp']} "
                f"senderMatch={item['senderMatch']} "
                f"subjectMatch={item['subjectMatch']} "
                f"passedFilterAfter={item['passedFilterAfter']} "
                f"code={item['code'] or '-'} "
                f"codeSource={item.get('codeSource') or '-'} "
                f"codeSnippet={item.get('codeSnippet') or '-'} "
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
      "轮询结束候选："
      + " || ".join(
        (
          f"mailbox={item['mailbox']} "
          f"ts={item['timestamp']} "
          f"senderMatch={item['senderMatch']} "
          f"subjectMatch={item['subjectMatch']} "
          f"passedFilterAfter={item['passedFilterAfter']} "
          f"code={item['code'] or '-'} "
          f"codeSource={item.get('codeSource') or '-'} "
          f"codeSnippet={item.get('codeSnippet') or '-'} "
          f"from={item['from']} "
          f"subject={item['subject']}"
        )
        for item in debug_candidates
      )
    )

  if time_fallback_match and filter_after_timestamp_ms:
    fallback_gap_ms = max(0, int(filter_after_timestamp_ms) - int(time_fallback_match["emailTimestamp"]))
    if fallback_gap_ms <= _TIME_FALLBACK_MAX_GAP_MS:
      _log_info(
        f"启用时间兜底 email={_mask_email(email_addr)} mailbox={time_fallback_match['mailbox']} "
        f"mailId={time_fallback_match['mailId']} code={time_fallback_match['code']} "
        f"gapMs={fallback_gap_ms} filterAfter={int(filter_after_timestamp_ms or 0)} "
        f"source={time_fallback_match.get('source') or '-'}"
      )
      return {
        "code": time_fallback_match["code"],
        "emailTimestamp": int(time_fallback_match["emailTimestamp"]),
        "mailId": str(time_fallback_match["mailId"]),
        "usedTimeFallback": True,
        "selectionSource": "time_fallback",
      }

    _log_info(
      f"跳过时间兜底 email={_mask_email(email_addr)} mailbox={time_fallback_match['mailbox']} "
      f"mailId={time_fallback_match['mailId']} gapMs={fallback_gap_ms} "
      f"maxGapMs={_TIME_FALLBACK_MAX_GAP_MS}"
    )

  raise RuntimeError(str(last_error) if last_error else "未找到验证码")


class Handler(BaseHTTPRequestHandler):
  def do_OPTIONS(self):
    _json_response(self, 200, {"ok": True})

  def do_GET(self):
    if self.path == "/health":
      return _json_response(self, 200, {"ok": True, "logPath": LOG_PATH})
    return _json_response(self, 404, {"ok": False, "error": "未找到接口"})

  def do_POST(self):
    if self.path == "/accounts/test":
      payload = _read_json(self)
      email_addr = str(payload.get("email") or "").strip().lower()
      auth_code = str(payload.get("authCode") or "").strip()
      if not email_addr or not auth_code:
        return _json_response(self, 400, {"ok": False, "error": "缺少 email 或 authCode"})

      try:
        _log_info(f"开始测试账号 email={_mask_email(email_addr)}")
        context = ssl.create_default_context()
        imap = IMAP4_SSL(IMAP_HOST, IMAP_PORT, ssl_context=context)
        try:
          _send_client_id(imap)
          imap.login(email_addr, auth_code)
          selected_mailbox = _select_mailbox(imap, "INBOX")
          _log_info(f"账号测试成功 email={_mask_email(email_addr)} mailbox={selected_mailbox}")
          _json_response(self, 200, {"ok": True, "logPath": LOG_PATH, "mailbox": selected_mailbox})
        finally:
          try:
            imap.logout()
          except Exception:
            pass
      except Exception as e:
        _log_error(f"账号测试失败 email={_mask_email(email_addr)} detail={e}")
        return _json_response(self, 200, {"ok": False, "error": str(e), "logPath": LOG_PATH})
      return

    if self.path == "/accounts/poll-code":
      payload = _read_json(self)
      email_addr = str(payload.get("email") or "").strip().lower()
      auth_code = str(payload.get("authCode") or "").strip()
      if not email_addr or not auth_code:
        return _json_response(self, 400, {"ok": False, "error": "缺少 email 或 authCode"})

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
          f"收到轮询请求 email={_mask_email(email_addr)} "
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
        _log_error(f"轮询接口失败 email={_mask_email(email_addr)} detail={e}")
        _log_error(f"异常堆栈：\n{traceback.format_exc().strip()}")
        return _json_response(self, 200, {"ok": False, "error": str(e), "logPath": LOG_PATH})

    return _json_response(self, 404, {"ok": False, "error": "未找到接口"})

  def log_message(self, _format, *_args):
    # Keep helper logs quiet; do not log credentials.
    return


def main():
  httpd = ThreadingHTTPServer((HOST, PORT), Handler)
  _log_info(f"mail163 helper 已监听：http://{HOST}:{PORT}")
  _log_info(f"mail163 helper 日志路径：{LOG_PATH}")
  httpd.serve_forever()


if __name__ == "__main__":
  main()
