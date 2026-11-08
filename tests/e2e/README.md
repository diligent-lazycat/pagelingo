# 端到端实测

用**真实 Chrome**（不是 Playwright 自带 Chromium）加载扩展并驱动，验证运行时行为。

## 为什么这么设计

Chrome 137 起移除了 `--load-extension` 命令行参数，自动化不能再靠启动参数注入扩展。
本目录改用 CDP 的 `Extensions.loadUnpacked`（需 `--enable-unsafe-extension-debugging`），
并通过 `chrome-extension://<id>/src/popup/popup.html` 页面作为特权驱动器发消息、读状态，
等价于用户点击 Popup 按钮的真实链路。

## 依赖

- Google Chrome（`/Applications/Google Chrome.app`，可用 `CHROME_BIN` 覆盖）
- Node.js + `playwright`（仅用于 CDP 连接，不需下载浏览器）
- `python3`（本地静态站，仅 run-local 需要）

```bash
npm i -D playwright
```

## 运行

```bash
bash tests/e2e/run-local.sh    # 本地测试页，14 项断言，用真实 MyMemory 接口
bash tests/e2e/run-github.sh   # GitHub 真实页面，8 项断言，用本地 mock 引擎
```

产物：`tests/e2e/output/`（截图 + `report.json` / `report-gh.json`）。

## 两套用例的分工

| 用例 | 引擎 | 验证目标 |
|---|---|---|
| `run-local.sh` | MyMemory（真实） | 翻译质量、术语保护、划词/悬停、动态内容、还原 —— 关注「译得对不对」 |
| `run-github.sh` | 本地 mock | 代码块/行内代码/链接是否被误翻、布局是否被打乱 —— 关注「不该翻的有没有翻」 |

GitHub 用例刻意不用真实接口：一是规模大（单页 300+ 文本节点）会打爆免费额度，
二是该用例只关心「哪些内容进入了翻译器」，mock 返回带标记的译文反而更好判定。

## 可覆盖的环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `CHROME_BIN` | 系统 Chrome | Chrome 可执行文件路径 |
| `NODE_BIN` | `node` | Node 可执行文件 |
| `PYTHON_BIN` | `python3` | Python 可执行文件（run-local） |
| `CDP_PORT` | 9333 / 9335 | Chrome 调试端口 |
| `SITE_PORT` / `SITE_URL` | 8765 | 本地静态站端口 |
| `MOCK_PORT` | 8799 | mock 引擎端口 |
| `OUT_DIR` | `tests/e2e/output` | 产物目录 |
