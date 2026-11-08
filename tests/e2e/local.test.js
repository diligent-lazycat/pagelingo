/**
 * PageLingo 实测（真实 Chrome 157 + CDP Extensions.loadUnpacked）
 * 通过 popup 页面作为特权驱动器发送消息，等同于用户点按钮的真实链路。
 */
const { chromium } = require('playwright');
const fs = require('fs');

const EXT = require('path').resolve(__dirname, '../..');
const OUT = process.env.OUT_DIR || require('path').resolve(__dirname, 'output');
const LOCAL = process.env.SITE_URL || 'http://127.0.0.1:8765/';
const PORT = process.env.PORT || '9333';
const CJK = /[\u4e00-\u9fa5]/;

fs.mkdirSync(OUT, { recursive: true });
const report = { browser: '', extId: '', steps: [], errors: [], shots: [] };
const log = (step, ok, detail) => {
  report.steps.push({ step, ok, detail });
  console.log((ok ? '✅' : '❌') + ' ' + step + ' :: ' + JSON.stringify(detail));
};
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 60000, interval = 500) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await fn();
    if (v) return v;
    await wait(interval);
  }
  return null;
}

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const bcdp = await browser.newBrowserCDPSession();
  const ver = await bcdp.send('Browser.getVersion');
  report.browser = ver.product;
  console.log('浏览器：' + ver.product);

  // ---- T1 用浏览器级 CDP 载入解包扩展
  let loadRes = null, loadErr = null;
  try {
    loadRes = await bcdp.send('Extensions.loadUnpacked', { path: EXT });
  } catch (e) { loadErr = e.message.split('\n')[0]; }
  const extId = loadRes && (loadRes.id || loadRes.extensionId);
  report.extId = extId || null;
  log('T1 CDP 载入解包扩展（真实 Chrome）', !!extId, { result: loadRes, error: loadErr });
  if (!extId) throw new Error('扩展载入失败：' + loadErr);

  // ---- T2 popup 页作为特权驱动器，写入测试配置
  const popup = await ctx.newPage();
  const popupErrors = [];
  popup.on('pageerror', e => popupErrors.push('[pageerror] ' + e.message));
  popup.on('console', m => { if (m.type() === 'error') popupErrors.push('[console] ' + m.text()); });
  await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`, { waitUntil: 'domcontentloaded' });
  await wait(800);

  const popupState = await popup.evaluate(() => ({
    srcOptions: document.querySelectorAll('#sourceLang option').length,
    tgtOptions: document.querySelectorAll('#targetLang option').length,
    tgtValue: document.getElementById('targetLang').value,
    engineValue: document.getElementById('engine').value,
    hasTranslateBtn: !!document.getElementById('translateBtn'),
    title: document.title
  }));
  await popup.setViewportSize({ width: 380, height: 600 });
  await popup.screenshot({ path: OUT + '/05-popup.png' });
  report.shots.push('05-popup.png');
  log('T2 Popup 渲染（6 源语言 / 5 目标语言 / 按钮齐全）',
    popupState.srcOptions === 6 && popupState.tgtOptions === 5 && popupState.hasTranslateBtn && !popupErrors.length,
    { popupState, popupErrors });

  const cfg = await popup.evaluate(async () => {
    await chrome.storage.sync.set({
      sourceLang: 'en', targetLang: 'zh-CN', engine: 'mymemory',
      customEndpoint: '', selectionEnabled: true, hoverEnabled: false,
      skipLinks: true, protectTerms: true
    });
    return await chrome.storage.sync.get(null);
  });
  log('T3 配置写入 storage.sync（mymemory 引擎）', cfg.engine === 'mymemory', cfg);

  // ---- T4 打开本地测试页，在「隔离世界」里验证内容脚本注入
  const page = await ctx.newPage();
  page.on('pageerror', e => report.errors.push('[PAGE-PAGEERROR] ' + e.message));
  await page.setViewportSize({ width: 1100, height: 900 });
  const pcdp = await ctx.newCDPSession(page);
  const worlds = [];
  pcdp.on('Runtime.executionContextCreated', e => worlds.push(e.context));
  await pcdp.send('Runtime.enable');
  await page.goto(LOCAL, { waitUntil: 'domcontentloaded' });
  await wait(1800);

  const iso = worlds.find(c => c.auxData && c.auxData.isDefault === false &&
    ((c.origin && c.origin.indexOf('chrome-extension://') === 0) || /PageLingo|网页灵译/.test(c.name || '')));
  let injected = { found: false, worlds: worlds.map(c => ({ id: c.id, name: c.name, def: c.auxData && c.auxData.isDefault })) };
  if (iso) {
    const r = await pcdp.send('Runtime.evaluate', {
      contextId: iso.id,
      returnByValue: true,
      expression: `(function(){var L=window.LinguaPage;return {
        hasLP: !!L,
        hasTranslate: !!(L && L.translateWholePage),
        hasSelection: !!(L && L.initSelection),
        hasHover: !!(L && L.initHover),
        hasTooltip: !!(L && L.tooltip),
        hasProtector: !!(L && L.protector && L.protector.planBatch),
        terms: (L && L.DEFAULT_TERMS) ? L.DEFAULT_TERMS.length : 0,
        codeLike: (L && L.classifier) ? L.classifier.isCodeLike('v1.2.3') : null
      };})()`
    });
    injected = Object.assign({ found: true, worldName: iso.name }, r.result.value);
  }
  log('T4 内容脚本注入（隔离世界，模块齐全）',
    injected.hasTranslate && injected.hasSelection && injected.hasHover && injected.hasProtector && injected.terms > 50,
    injected);

  const before = await page.evaluate(() => ({
    h1: document.querySelector('h1').textContent.trim(),
    p1: document.querySelector('body > p').textContent.trim(),
    pre: document.querySelector('pre code').textContent,
    inlineCode: document.querySelector('p code').textContent,
    link: document.querySelector('p a').textContent,
    li1: document.querySelector('ul li').textContent.trim()
  }));

  // ---- T5 端到端：点 popup「翻译本页」按钮
  await page.bringToFront();
  await wait(400);
  await popup.evaluate(() => document.getElementById('translateBtn').click());
  const status = await until(async () => {
    const s = await popup.evaluate(() => document.getElementById('status').textContent.trim());
    return s && s !== '正在翻译…' ? s : null;
  }, 90000);
  log('T5 popup 按钮触发全页翻译（端到端）', !!status && /共处理|完成/.test(status), { status });

  const gotCJK = await until(async () => {
    const t = await page.evaluate(() => document.querySelector('body > p').textContent);
    return CJK.test(t) ? t : null;
  }, 60000);
  await wait(1200);

  const after = await page.evaluate(() => ({
    h1: document.querySelector('h1').textContent.trim(),
    p1: document.querySelector('body > p').textContent.trim(),
    pre: document.querySelector('pre code').textContent,
    inlineCode: document.querySelector('p code').textContent,
    link: document.querySelector('p a').textContent,
    li1: document.querySelector('ul li').textContent.trim(),
    allText: document.body.innerText
  }));

  log('T6 正文已译为中文', CJK.test(after.p1) && CJK.test(after.h1), { before: before.p1, after: after.p1 });
  log('T7 代码块 / 命令保持原文', before.pre === after.pre,
    { unchanged: before.pre === after.pre, firstLine: after.pre.split('\n')[0] });
  log('T8 行内代码保持原文', before.inlineCode === after.inlineCode && /git clone/.test(after.inlineCode),
    { text: after.inlineCode });
  log('T9 链接文字保持原文', before.link === after.link, { text: after.link, original: before.link });
  const termList = ['GitHub', 'JSON', 'TypeScript', 'LLM', 'AI'];
  const termHit = termList.map(t => t + '=' + after.allText.includes(t));
  log('T10 术语保护（GitHub/JSON/TypeScript/LLM 原样保留）',
    termList.every(t => after.allText.includes(t)) && !/0和1/.test(after.allText),
    { termHit, 段落原文: before.p1.slice(0, 80), 段落译文: after.p1.slice(0, 80) });
  await page.screenshot({ path: OUT + '/01-translated-full.png', fullPage: true });
  report.shots.push('01-translated-full.png');

  // ---- T11 动态内容（MutationObserver）
  await page.bringToFront();
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'late-inject';
    p.textContent = 'This sentence is injected after translation to verify dynamic handling.';
    document.getElementById('dynamic-box').appendChild(p);
  });
  const dyn = await until(async () => {
    const t = await page.evaluate(() => {
      const el = document.getElementById('late-inject');
      return el ? el.textContent : '';
    });
    return CJK.test(t) ? t : null;
  }, 30000);
  log('T11 动态插入内容自动翻译', !!dyn, { text: dyn });
  await page.screenshot({ path: OUT + '/02-dynamic.png', fullPage: true });
  report.shots.push('02-dynamic.png');

  // ---- T12 划词翻译
  const box = await page.locator('#sel-target').boundingBox();
  if (box) {
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + Math.min(box.width - 4, 330), box.y + box.height / 2, { steps: 20 });
    await page.mouse.up();
  }
  const tip = await until(async () => {
    const r = await page.evaluate(() => {
      const t = document.getElementById('lp-tooltip');
      if (!t) return null;
      const st = getComputedStyle(t);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return null;
      const body = t.innerText.replace('译 · PageLingo', '').replace('复制×', '').trim();
      if (!body || /翻译中/.test(body)) return null; // 仍在加载态，继续等
      return { visible: true, text: body.slice(0, 140) };
    });
    return r && CJK.test(r.text) && r.text.length > 15 ? r : null;
  }, 30000);
  log('T12 划词翻译悬浮框（含中文译文，非加载态）', !!tip, tip);
  await page.screenshot({ path: OUT + '/03-selection.png' });
  report.shots.push('03-selection.png');

  // ---- T12b 悬停翻译（开启 hoverEnabled）
  await popup.evaluate(async () => {
    await chrome.storage.sync.set({ hoverEnabled: true });
    const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:8765/*' });
    await new Promise(r => chrome.tabs.sendMessage(tabs[0].id, {
      type: 'LP_UPDATE_SETTINGS',
      settings: { hoverEnabled: true, selectionEnabled: true, skipLinks: true, protectTerms: true, engine: 'mymemory', sourceLang: 'en', targetLang: 'zh-CN' }
    }, r));
  });
  // 先点空白处让上一条悬浮框消失
  await page.mouse.click(5, 5);
  await wait(400);
  const hbox = await page.locator('#sel-target').boundingBox();
  if (hbox) {
    await page.mouse.move(hbox.x + 30, hbox.y + 12);
    await wait(1500);
  }
  const htip = await until(async () => {
    const r = await page.evaluate(() => {
      const t = document.getElementById('lp-tooltip');
      if (!t) return null;
      const st = getComputedStyle(t);
      if (st.display === 'none' || st.visibility === 'hidden') return null;
      const body = t.innerText.replace('译 · PageLingo', '').replace('复制×', '').trim();
      if (!body || /翻译中/.test(body)) return null;
      return { visible: true, text: body.slice(0, 140) };
    });
    return r && CJK.test(r.text) ? r : null;
  }, 30000);
  log('T12b 段落悬停翻译', !!htip, htip);

  // ---- T13 一键还原
  await popup.evaluate(() => document.getElementById('restoreBtn').click());
  await wait(800);
  const restored = await page.evaluate(() => ({
    h1: document.querySelector('h1').textContent.trim(),
    p1: document.querySelector('body > p').textContent.trim()
  }));
  log('T13 一键还原原文', restored.h1 === before.h1 && restored.p1 === before.p1,
    { restoredHead: restored.h1 });
  await page.screenshot({ path: OUT + '/04-restored.png', fullPage: true });
  report.shots.push('04-restored.png');

  // ---- T14 引擎连通性自检（Popup 的「检测引擎连通性」按钮）
  await popup.evaluate(() => document.getElementById('diagBtn').click());
  const diag = await until(async () => {
    const t = await popup.evaluate(() => document.getElementById('diagStatus').textContent.trim());
    return /✅|❌/.test(t) ? t : null;
  }, 30000);
  log('T14 引擎连通性自检', !!diag && /MyMemory/.test(diag), { diag });
  await popup.setViewportSize({ width: 380, height: 1000 });
  await wait(300);
  await popup.screenshot({ path: OUT + '/07-diag.png' });
  report.shots.push('07-diag.png');

  // ---- 汇总
  const passed = report.steps.filter(s => s.ok).length;
  report.summary = { total: report.steps.length, passed, failed: report.steps.length - passed, errors: report.errors };
  fs.writeFileSync(OUT + '/report.json', JSON.stringify(report, null, 2));
  console.log('\n===== 汇总 =====');
  console.log(`通过 ${passed}/${report.steps.length}｜extId=${extId}｜${ver.product}`);
  console.log('页面错误：' + (report.errors.length ? report.errors.join(' | ') : '无'));
  await browser.close();
})().catch(e => {
  console.error('脚本异常：', (e && e.message) || e);
  report.errors.push('SCRIPT: ' + ((e && e.message) || e));
  fs.writeFileSync(OUT + '/report.json', JSON.stringify(report, null, 2));
  process.exit(1);
});
