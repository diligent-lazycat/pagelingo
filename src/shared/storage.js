/**
 * 设置存取封装：统一默认值与 chrome.storage.sync 读写。
 * 内容脚本与 popup 共用。
 */
window.LinguaPage = window.LinguaPage || {};

(function (LP) {
  const DEFAULTS = {
    sourceLang: 'auto',      // 源语言，默认自动检测
    targetLang: 'zh-CN',     // 目标语言，默认中文
    engine: 'auto',          // 翻译引擎：auto | google | mymemory | deepl | custom
    customEndpoint: '',      // 自定义接口 URL 模板，占位符 {text} {from} {to}
    deeplKey: '',            // DeepL 官方 API 密钥（免费版以 :fx 结尾）
    mmEmail: '',             // MyMemory 提额邮箱（填了额度从 5000 → 5 万字符/天）
    selectionEnabled: true,  // 划词翻译
    hoverEnabled: false,     // 段落悬停翻译
    skipLinks: true,         // 链接文字保持原文
    protectTerms: true       // 专业术语占位保护
  };

  LP.storage = {
    // 读取全部设置（合并默认值）
    getAll: function () {
      return new Promise(function (resolve) {
        chrome.storage.sync.get(DEFAULTS, function (items) {
          resolve(items);
        });
      });
    },

    // 读取单个键
    get: function (key) {
      return new Promise(function (resolve) {
        chrome.storage.sync.get(key, function (items) {
          resolve(items[key]);
        });
      });
    },

    // 写入若干键值
    set: function (obj) {
      return new Promise(function (resolve) {
        chrome.storage.sync.set(obj, resolve);
      });
    }
  };
})(window.LinguaPage);
