/**
 * 翻译引擎抽象层（运行于 background service worker）。
 * 对外统一暴露 translate(texts, sl, tl, engine, customEndpoint)。
 *
 * 三种后端：
 *   - google   : 非官方免费接口（无需密钥，可能限流）
 *   - mymemory : 官方免费接口（无需密钥，匿名每天约 5000 字符）
 *   - custom   : 用户自定义接口模板
 *
 * 说明：免费接口的稳定性不如付费 API。若要长期稳定运行，
 * 可自行替换为 DeepL / Google Cloud / OpenAI 等带密钥的服务，
 * 只需新增一个 engine 分支即可，无需改动其它模块。
 */

/* global sleep */

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// 语言代码归一：auto -> auto(google) / Autodetect(mymemory)
function normSl(sl, engine) {
  if (sl === 'auto') {
    return engine === 'mymemory' ? 'Autodetect' : 'auto';
  }
  return sl;
}

const GoogleEngine = {
  // 支持批量：一次请求携带多个 q 参数，返回与输入等长的数组
  async translate(texts, sl, tl) {
    const url = 'https://translate.googleapis.com/translate_a/single';
    const params = new URLSearchParams();
    params.set('client', 'gtx');
    params.set('sl', normSl(sl, 'google'));
    params.set('tl', tl);
    params.set('dt', 't');
    texts.forEach(function (t) { params.append('q', t); });

    const res = await fetch(url + '?' + params.toString());
    if (!res.ok) throw new Error('Google 接口错误：HTTP ' + res.status);

    const data = await res.json();
    // data[i] = [[译文, 原文, ...], ...]，逐段拼接
    return texts.map(function (_, i) {
      const seg = data[i];
      if (!Array.isArray(seg)) return '';
      return seg.map(function (x) { return (x && x[0]) ? x[0] : ''; }).join('');
    });
  }
};

const MyMemoryEngine = {
  // 仅支持单条，且单条不超过 500 字符
  async translateOne(text, sl, tl) {
    const langpair = normSl(sl, 'mymemory') + '|' + tl;
    const url = 'https://api.mymemory.translated.net/get?q=' +
      encodeURIComponent(text) + '&langpair=' + encodeURIComponent(langpair);

    const res = await fetch(url);
    if (!res.ok) throw new Error('MyMemory 接口错误：HTTP ' + res.status);

    const data = await res.json();
    const out = data && data.responseData && data.responseData.translatedText;
    if (!out || out.indexOf('MYMEMORY WARNING') === 0 || out === 'NO QUERY SPECIFIED') {
      throw new Error('MyMemory 已达免费额度或查询无效');
    }
    return out;
  },

  async translate(texts, sl, tl) {
    const results = [];
    for (let i = 0; i < texts.length; i++) {
      results.push(await this.translateOne(texts[i], sl, tl));
      if (i < texts.length - 1) await sleep(300); // 限流保护
    }
    return results;
  }
};

const CustomEngine = {
  async translate(texts, sl, tl, endpoint) {
    if (!endpoint) throw new Error('请先在设置中填写自定义接口地址');
    const results = [];
    for (const text of texts) {
      const url = endpoint
        .replace('{text}', encodeURIComponent(text))
        .replace('{from}', encodeURIComponent(sl))
        .replace('{to}', encodeURIComponent(tl));
      const res = await fetch(url);
      if (!res.ok) throw new Error('自定义接口错误：HTTP ' + res.status);
      const data = await res.json();
      // 约定返回 { translatedText: "..." } 或纯字符串
      results.push(typeof data === 'string' ? data : (data.translatedText || data.text || ''));
      await sleep(200);
    }
    return results;
  }
};

/**
 * 统一入口：按引擎路由，并对超大文本分批。
 */
async function translate(texts, sl, tl, engine, customEndpoint) {
  const CHUNK = 30; // 单次批量上限

  if (engine === 'mymemory') {
    return MyMemoryEngine.translate(texts, sl, tl);
  }
  if (engine === 'custom') {
    return CustomEngine.translate(texts, sl, tl, customEndpoint);
  }

  // 默认 google，分批
  const flat = [];
  for (let i = 0; i < texts.length; i += CHUNK) {
    const chunk = texts.slice(i, i + CHUNK);
    flat.push.apply(flat, await GoogleEngine.translate(chunk, sl, tl));
    if (i + CHUNK < texts.length) await sleep(200);
  }
  return flat;
}
