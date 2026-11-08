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
    engine: $('engine'),
    customEndpoint: $('customEndpoint'),
    deeplKey: $('deeplKey'),
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
    els.engine.value = s.engine;
    els.customEndpoint.value = s.customEndpoint || '';
    els.deeplKey.value = s.deeplKey || '';
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
      engine: els.engine.value,
      customEndpoint: els.customEndpoint.value.trim(),
      deeplKey: els.deeplKey.value.trim()
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

  // 翻译本页
  function translatePage() {
    setStatus('正在翻译…');
    getActiveTab().then(function (tab) {
      if (!tab || !tab.id) { setStatus('未找到当前页面', true); return; }
      chrome.tabs.sendMessage(tab.id, { type: 'LP_TRANSLATE_PAGE' }, function (resp) {
        if (chrome.runtime.lastError) {
          setStatus('此页面不支持翻译（如浏览器内部页）', true);
          return;
        }
        if (resp && resp.error) {
          setStatus('翻译失败：' + resp.error, true);
        } else if (resp && resp.count === 0) {
          setStatus('本页没有需要翻译的文本（可能已是中文）');
        } else {
          const eng = resp && resp.engine ? ('，引擎 ' + (ENGINE_LABEL[resp.engine] || resp.engine)) : '';
          setStatus('翻译完成，共 ' + ((resp && resp.count) || 0) + ' 段文本' + eng);
        }
      });
    });
  }

  function restorePage() {
    sendToTab({ type: 'LP_RESTORE' });
    setStatus('已还原原文');
    setTimeout(function () { setStatus(''); }, 1500);
  }

  function bind() {
    [els.sourceLang, els.targetLang, els.selectionEnabled, els.hoverEnabled,
     els.protectTerms, els.skipLinks, els.engine].forEach(function (el) {
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
      deeplKey: els.deeplKey.value.trim()
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

  function init() {
    fillLangs();
    bind();
    LP.storage.getAll().then(applySettings);
  }

  document.addEventListener('DOMContentLoaded', init);
})(window.LinguaPage);
