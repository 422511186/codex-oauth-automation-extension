#!/bin/sh
set -e

cd "$(dirname "$0")"

if command -v python3 >/dev/null 2>&1; then
  python3 scripts/mail163_helper.py
  exit 0
fi

if command -v python >/dev/null 2>&1; then
  python scripts/mail163_helper.py
  exit 0
fi

echo "Python 3 not found. Please install Python 3.10+ and try again."
exit 1

