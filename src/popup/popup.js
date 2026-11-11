/**
 * Popup 逻辑：加载/保存设置，向当前页发送翻译/还原指令。
 */
(function (LP) {
  const $ = function (id) { return document.getElementById(id); };

  const els = {
    sourceLang: $('sourceLang'),
    targetLang: $('targetLang'),
    swapBtn: $('swapBtn'),
    translateBtn: $('translateBtn'),
    restoreBtn: $('restoreBtn'),
    status: $('status'),
    selectionEnabled: $('selectionEnabled'),
    hoverEnabled: $('hoverEnabled'),
    protectTerms: $('protectTerms'),
    skipLinks: $('skipLinks'),
    autoTranslate: $('autoTranslate'),
    autoSites: $('autoSites'),
    engine: $('engine'),
    customEndpoint: $('customEndpoint'),
    deeplKey: $('deeplKey'),
    mmEmail: $('mmEmail'),
    diagBtn: $('diagBtn'),
    diagStatus: $('diagStatus')
  };

  const ENGINE_LABEL = {
    google: 'Google',
    mymemory: 'MyMemory',
    deepl: 'DeepL',
    custom: '自定义接口'
  };

  let settings = null;

  // 填充语言下拉
  function fillLangs() {
    LP.SOURCE_LANGS.forEach(function (l) {
      const opt = document.createElement('option');
      opt.value = l.code;
      opt.textContent = l.flag + ' ' + l.label;
      els.sourceLang.appendChild(opt);
    });
    LP.LANGS.forEach(function (l) {
      const opt = document.createElement('option');
      opt.value = l.code;
      opt.textContent = l.flag + ' ' + l.label;
      els.targetLang.appendChild(opt);
    });
  }

  // 应用设置到界面
  function applySettings(s) {
    settings = s;
    els.sourceLang.value = s.sourceLang;
    els.targetLang.value = s.targetLang;
    els.selectionEnabled.checked = s.selectionEnabled;
    els.hoverEnabled.checked = s.hoverEnabled;
    els.protectTerms.checked = s.protectTerms;
    els.skipLinks.checked = s.skipLinks;
    els.autoTranslate.checked = s.autoTranslate !== false;
    els.autoSites.value = s.autoSites || '';
    els.engine.value = s.engine;
    els.customEndpoint.value = s.customEndpoint || '';
    els.deeplKey.value = s.deeplKey || '';
    els.mmEmail.value = s.mmEmail || '';
    toggleEngineInputs();
  }

  // 按引擎显示对应的输入框
  function toggleEngineInputs() {
    const e = els.engine.value;
    els.customEndpoint.style.display = e === 'custom' ? 'block' : 'none';
    els.deeplKey.style.display = e === 'deepl' ? 'block' : 'none';
  }

  function setStatus(text, isError) {
    els.status.textContent = text;
    els.status.className = 'status' + (isError ? ' error' : '');
  }

  // 保存并同步到当前页
  function save() {
    settings = {
      sourceLang: els.sourceLang.value,
      targetLang: els.targetLang.value,
      selectionEnabled: els.selectionEnabled.checked,
      hoverEnabled: els.hoverEnabled.checked,
      protectTerms: els.protectTerms.checked,
      skipLinks: els.skipLinks.checked,
      autoTranslate: els.autoTranslate.checked,
      autoSites: els.autoSites.value.trim(),
      engine: els.engine.value,
      customEndpoint: els.customEndpoint.value.trim(),
      deeplKey: els.deeplKey.value.trim(),
      mmEmail: els.mmEmail.value.trim()
    };
    LP.storage.set(settings);
    sendToTab({ type: 'LP_UPDATE_SETTINGS', settings: settings });
  }

  function getActiveTab() {
    return new Promise(function (resolve) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        resolve(tabs[0]);
      });
    });
  }

  function sendToTab(msg) {
    getActiveTab().then(function (tab) {
      if (!tab || !tab.id) return;
      chrome.tabs.sendMessage(tab.id, msg, function () {
        if (chrome.runtime.lastError) { /* 页面无内容脚本，忽略 */ }
      });
    });
  }

  // 翻译本页：交给后台下发，这样页面缺脚本时会自动补注入（面板直连做不到）
  function translatePage() {
    setStatus('正在翻译…');
    chrome.runtime.sendMessage({ type: 'LP_CMD', action: 'translate' }, function (resp) {
      if (chrome.runtime.lastError) {
        setStatus('后台未响应，请在扩展页重载一次后重试', true);
        return;
      }
      if (resp && resp.error) {
        setStatus('翻译失败：' + resp.error, true);
        return;
      }
      if (resp && resp.count === 0) {
        setStatus('本页没有需要翻译的文本（可能已是中文）');
        return;
      }
      const eng = resp && resp.engine ? ('，引擎 ' + (ENGINE_LABEL[resp.engine] || resp.engine)) : '';
      setStatus('翻译完成，共 ' + ((resp && resp.count) || 0) + ' 段文本' + eng);
    });
  }

  function restorePage() {
    chrome.runtime.sendMessage({ type: 'LP_CMD', action: 'restore' }, function () {
      if (chrome.runtime.lastError) { /* 忽略 */ }
    });
    setStatus('已还原原文');
    setTimeout(function () { setStatus(''); }, 1500);
  }

  function bind() {
    [els.sourceLang, els.targetLang, els.selectionEnabled, els.hoverEnabled,
     els.protectTerms, els.skipLinks, els.autoTranslate, els.autoSites,
     els.engine].forEach(function (el) {
      el.addEventListener('change', save);
    });
    els.customEndpoint.addEventListener('input', function () {
      settings.customEndpoint = els.customEndpoint.value.trim();
      LP.storage.set({ customEndpoint: settings.customEndpoint });
    });
    els.deeplKey.addEventListener('input', function () {
      settings.deeplKey = els.deeplKey.value.trim();
      LP.storage.set({ deeplKey: settings.deeplKey });
    });
    els.mmEmail.addEventListener('input', function () {
      settings.mmEmail = els.mmEmail.value.trim();
      LP.storage.set({ mmEmail: settings.mmEmail });
    });

    els.swapBtn.addEventListener('click', function () {
      let src = els.sourceLang.value;
      const tgt = els.targetLang.value;
      if (src === 'auto') src = 'zh-CN';
      els.sourceLang.value = tgt;
      els.targetLang.value = src;
      save();
    });

    els.translateBtn.addEventListener('click', translatePage);
    els.restoreBtn.addEventListener('click', restorePage);

    // 引擎切换时显示对应输入框
    els.engine.addEventListener('change', toggleEngineInputs);

    els.diagBtn.addEventListener('click', runDiagnose);
  }

  // 一键检测各引擎是否可用（判断「为什么翻译不了」最直接的办法）
  function runDiagnose() {
    els.diagStatus.className = 'status diag-status';
    els.diagStatus.textContent = '检测中，约需 10 秒…';
    chrome.runtime.sendMessage({
      type: 'LP_DIAGNOSE',
      sl: 'en',
      tl: els.targetLang.value || 'zh-CN',
      customEndpoint: els.customEndpoint.value.trim(),
      deeplKey: els.deeplKey.value.trim(),
      mmEmail: els.mmEmail.value.trim()
    }, function (resp) {
      if (chrome.runtime.lastError || !resp) {
        els.diagStatus.className = 'status diag-status error';
        els.diagStatus.textContent = '检测失败：后台未响应，请重载扩展后重试';
        return;
      }
      if (resp.error) {
        els.diagStatus.className = 'status diag-status error';
        els.diagStatus.textContent = '检测失败：' + resp.error;
        return;
      }
      const results = resp.results || [];
      const lines = results.map(function (r) {
        if (r.ok) return '✅ ' + r.label + '：可用（' + r.ms + 'ms）';
        return '❌ ' + r.label + '：' + r.msg;
      });

      const google = results.find(function (r) { return r.engine === 'google'; });
      const mm = results.find(function (r) { return r.engine === 'mymemory'; });
      if (google && !google.ok && mm && mm.ok) {
        lines.push('— 本机访问不了 Google，将自动改用 MyMemory。');
      }
      els.diagStatus.textContent = lines.join('\n');
    });
  }

  // 兜底提额：面板每次打开都会从磁盘重新加载脚本，即使后台 service worker
  // 还是旧版（用户没点 ↻），旧后台也会读 storage 里的 mmEmail。
  // 在这里补写一次，用户「打开面板 → 点翻译」就能直接生效，不必先重载扩展。
  function ensureMmEmail() {
    LP.storage.getAll().then(function (s) {
      if (!s || s.mmEmail) return;
      let id;
      try { id = crypto.randomUUID().replace(/-/g, '').slice(0, 16); }
      catch (e) { id = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); }
      const auto = 'pagelingo-' + id + '@example.com';
      chrome.storage.sync.set({ mmEmail: auto }, function () {
        if (settings) settings.mmEmail = auto;
        els.mmEmail.value = auto;
        // 通知页面刷新设置缓存，避免内容脚本还拿着旧的空值
        sendToTab({ type: 'LP_UPDATE_SETTINGS', settings: Object.assign({}, settings || {}, { mmEmail: auto }) });
      });
    }).catch(function () { /* 不影响面板其它功能 */ });
  }

  function init() {
    fillLangs();
    bind();
    // 版本号直接读 manifest，避免以后改版本忘了改面板里的硬编码
    try {
      const v = $('appVersion');
      if (v) v.textContent = 'v' + chrome.runtime.getManifest().version;
    } catch (e) { /* 忽略 */ }
    LP.storage.getAll().then(applySettings).then(ensureMmEmail);
  }

  document.addEventListener('DOMContentLoaded', init);
})(window.LinguaPage);
