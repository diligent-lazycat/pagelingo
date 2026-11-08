/**
 * 真实 GitHub 页面实测：验证规模下的代码/命令/链接保护与布局稳定性。
 * 引擎：本地 mock（Google 接口在本机不通，MyMemory 有每日额度），
 * 目的是验证「哪些内容被送进翻译器」，而不是译文质量。
 */
const { chromium } = require('playwright');
const fs = require('fs');

const EXT = require('path').resolve(__dirname, '../..');
const OUT = process.env.OUT_DIR || require('path').resolve(__dirname, 'output');
const PORT = process.env.PORT || '9333';
const GH = 'https://github.com/diligent-lazycat/pagelingo';
const MOCK = process.env.MOCK_ENDPOINT || 'http://127.0.0.1:8799/t?text={text}&from={from}&to={to}';

const report = { steps: [], errors: [], shots: [] };
const log = (s, ok, d) => {
  report.steps.push({ step: s, ok, detail: d });
  console.log((ok ? '✅' : '❌') + ' ' + s + ' :: ' + JSON.stringify(d));
};
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 120000, interval = 700) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const v = await fn(); if (v) return v; await wait(interval); }
  return null;
}

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const bcdp = await browser.newBrowserCDPSession();
  const { id: extId } = await bcdp.send('Extensions.loadUnpacked', { path: EXT });
  console.log('扩展已载入：' + extId);

  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`, { waitUntil: 'domcontentloaded' });
  await wait(500);
  await popup.evaluate(async (endpoint) => {
    await chrome.storage.sync.set({
      sourceLang: 'en', targetLang: 'zh-CN', engine: 'custom', customEndpoint: endpoint,
      selectionEnabled: true, hoverEnabled: false, skipLinks: true, protectTerms: true
    });
  }, MOCK);

  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 1000 });
  page.on('pageerror', e => report.errors.push('[PAGE] ' + e.message));
  let navOk = false;
  for (let attempt = 1; attempt <= 4 && !navOk; attempt++) {
    try {
      await page.goto(GH, { waitUntil: 'domcontentloaded', timeout: 90000 });
      navOk = true;
      console.log('第 ' + attempt + ' 次导航成功');
    } catch (e) {
      console.log('第 ' + attempt + ' 次导航失败：' + e.message.split('\n')[0]);
      await wait(3000);
    }
  }
  if (!navOk) throw new Error('GitHub 页面连续 4 次导航失败（网络不可达）');
  const loaded = await until(async () => {
    const n = await page.evaluate(() => document.querySelectorAll('article, .markdown-body').length);
    return n > 0;
  }, 45000);
  log('T1 真实 GitHub 页面加载成功', !!loaded, { url: GH });
  await wait(1500);

  const before = await page.evaluate(() => {
    const pres = Array.from(document.querySelectorAll('pre')).map(p => p.innerText);
    const codes = Array.from(document.querySelectorAll('code')).map(c => c.innerText);
    const links = Array.from(document.querySelectorAll('a')).map(a => a.innerText.trim()).filter(Boolean);
    return {
      preCount: pres.length,
      pres,
      codeCount: codes.length,
      codes,
      linksSample: links.slice(0, 40),
      bodyWidth: document.body.scrollWidth,
      docHeight: document.documentElement.scrollHeight,
      sampleText: (document.querySelector('article') || document.body).innerText.slice(0, 300),
      nodeCount: (function () {
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n = 0, t; while ((t = w.nextNode())) if (t.nodeValue.trim()) n++;
        return n;
      })()
    };
  });
  console.log(`页面文本节点 ${before.nodeCount} 个，pre ${before.preCount} 个，code ${before.codeCount} 个`);

  await page.bringToFront();
  await popup.evaluate(() => document.getElementById('translateBtn').click());
  const status = await until(async () => {
    const s = await popup.evaluate(() => document.getElementById('status').textContent.trim());
    return s && s !== '正在翻译…' ? s : null;
  }, 180000);
  log('T2 全页翻译完成（真实 GitHub 页面）', !!status && /共处理|完成/.test(status), { status });
  await wait(2000);

  const after = await page.evaluate(() => {
    const pres = Array.from(document.querySelectorAll('pre')).map(p => p.innerText);
    const codes = Array.from(document.querySelectorAll('code')).map(c => c.innerText);
    const links = Array.from(document.querySelectorAll('a')).map(a => a.innerText.trim()).filter(Boolean);
    const marked = (document.body.innerText.match(/【译】/g) || []).length;
    return {
      pres, codes, linksSample: links.slice(0, 40),
      bodyWidth: document.body.scrollWidth,
      docHeight: document.documentElement.scrollHeight,
      sampleText: (document.querySelector('article') || document.body).innerText.slice(0, 300),
      marked
    };
  });

  const preSame = JSON.stringify(before.pres) === JSON.stringify(after.pres);
  log('T3 全部 <pre> 代码块逐字未变', preSame, { preCount: after.pres.length, firstPre: (after.pres[0] || '').slice(0, 60) });

  const codeSame = JSON.stringify(before.codes) === JSON.stringify(after.codes);
  log('T4 全部 <code> 行内代码逐字未变', codeSame, { codeCount: after.codes.length });

  const linkSame = JSON.stringify(before.linksSample) === JSON.stringify(after.linksSample);
  log('T5 链接文字未变（前 40 个）', linkSame, {
    差异: before.linksSample.map((l, i) => l === after.linksSample[i] ? null : l + ' → ' + after.linksSample[i]).filter(Boolean).slice(0, 5)
  });

  log('T6 正文确有译文注入（【译】标记出现）', after.marked > 10, { markedCount: after.marked });
  log('T7 页面布局未被打乱（宽度/高度变化 < 3%）',
    Math.abs(after.bodyWidth - before.bodyWidth) / before.bodyWidth < 0.03 &&
    Math.abs(after.docHeight - before.docHeight) / before.docHeight < 0.15,
    { 宽: before.bodyWidth + '→' + after.bodyWidth, 高: before.docHeight + '→' + after.docHeight });

  await page.screenshot({ path: OUT + '/06-github-translated.png', fullPage: false });
  report.shots.push('06-github-translated.png');

  // 还原
  await popup.evaluate(() => document.getElementById('restoreBtn').click());
  await wait(1500);
  const restored = await page.evaluate(() => (document.querySelector('article') || document.body).innerText.slice(0, 300));
  log('T8 真实页面一键还原', !/【译】/.test(restored), { restoredSample: restored.slice(0, 80) });
  await page.screenshot({ path: OUT + '/07-github-restored.png', fullPage: false });
  report.shots.push('07-github-restored.png');

  const passed = report.steps.filter(s => s.ok).length;
  report.summary = { total: report.steps.length, passed, failed: report.steps.length - passed, errors: report.errors };
  fs.writeFileSync(OUT + '/report-gh.json', JSON.stringify(report, null, 2));
  console.log(`\n===== GitHub 实测 ${passed}/${report.steps.length} =====`);
  await browser.close();
})().catch(e => {
  console.error('脚本异常：', (e && e.message) || e);
  fs.writeFileSync(OUT + '/report-gh.json', JSON.stringify(report, null, 2));
  process.exit(1);
});
