#!/usr/bin/env bash
# 本地测试页用例：验证扩展加载、Popup、全页/划词/悬停翻译、代码与术语保护、动态内容、还原。
# 引擎用 MyMemory（真实接口，需外网）。
# 依赖：Google Chrome、Node + playwright、python3
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$(cd "$HERE/../.." && pwd)"
CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
NODE_BIN="${NODE_BIN:-node}"
PY_BIN="${PYTHON_BIN:-python3}"
PORT="${CDP_PORT:-9333}"
SITE_PORT="${SITE_PORT:-8765}"
PROFILE="$(mktemp -d)/chrome-profile"

export NO_PROXY=127.0.0.1,localhost
export no_proxy=127.0.0.1,localhost
export EXT_DIR OUT_DIR="$HERE/output" PORT

cleanup() {
  kill "${CHROME_PID:-0}" "${HTTP_PID:-0}" "${MOCK_PID:-0}" 2>/dev/null || true
  rm -rf "$PROFILE"
}
trap cleanup EXIT

mkdir -p "$OUT_DIR"
echo "扩展目录：$EXT_DIR"
echo "浏览器：$CHROME"

# 静态测试站
( cd "$HERE/site" && "$PY_BIN" -m http.server "$SITE_PORT" --bind 127.0.0.1 >/dev/null 2>&1 ) &
HTTP_PID=$!

# 真实 Chrome（无头 + CDP）
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

# 默认用本地 mock 引擎：离线、确定、不受第三方免费额度影响。
# 想用真实 MyMemory 接口：LP_MOCK=0 MM_EMAIL=you@example.com bash tests/e2e/run-local.sh
export LP_MOCK="${LP_MOCK:-1}"
export MOCK_URL="http://127.0.0.1:${MOCK_PORT:-8799}/"
if [ "$LP_MOCK" != "0" ]; then
  MOCK_PORT="${MOCK_PORT:-8799}" "$NODE_BIN" "$HERE/mock-engine.js" >/dev/null 2>&1 &
  MOCK_PID=$!
  sleep 1
  echo "翻译引擎：本地 mock（${MOCK_URL}离线确定）"
else
  echo "翻译引擎：真实 MyMemory（MM_EMAIL=${MM_EMAIL:-未填，额度约 5000 字符/天}）"
fi

"$NODE_BIN" "$HERE/local.test.js"
