#!/usr/bin/env bash
# GitHub 真实页面用例：验证规模下代码块/行内代码/链接不被翻译、布局不被打乱、可一键还原。
# 引擎用本地 mock（仅验证「哪些内容被送进翻译器」，不评估译文质量），避免依赖外网翻译接口。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$(cd "$HERE/../.." && pwd)"
CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
NODE_BIN="${NODE_BIN:-node}"
PORT="${CDP_PORT:-9335}"
MOCK_PORT="${MOCK_PORT:-8799}"
PROFILE="$(mktemp -d)/chrome-profile"

export NO_PROXY=127.0.0.1,localhost
export no_proxy=127.0.0.1,localhost
export EXT_DIR OUT_DIR="$HERE/output" PORT
export MOCK_ENDPOINT="http://127.0.0.1:$MOCK_PORT/t?text={text}&from={from}&to={to}"

cleanup() {
  kill "${CHROME_PID:-0}" "${MOCK_PID:-0}" 2>/dev/null || true
  rm -rf "$PROFILE"
}
trap cleanup EXIT

mkdir -p "$OUT_DIR"

# 本地 mock 翻译引擎
"$NODE_BIN" "$HERE/mock-engine.js" >/dev/null 2>&1 &
MOCK_PID=$!

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  ${HTTP_PROXY:+--proxy-server="$HTTP_PROXY"} \
  --proxy-bypass-list="127.0.0.1;localhost" \
  --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" \
  --enable-unsafe-extension-debugging --no-first-run --no-default-browser-check \
  --disable-features=Translate,OptimizationHints >/dev/null 2>&1 &
CHROME_PID=$!

for _ in $(seq 1 40); do
  curl -s --noproxy '*' --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && break
  sleep 0.5
done

"$NODE_BIN" "$HERE/github.test.js"
