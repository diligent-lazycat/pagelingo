/**
 * 翻译引擎抽象层（运行于 background service worker）。
 * 对外统一暴露 translate(texts, sl, tl, engine, customEndpoint, deeplKey)。
 *
 * 四种后端：
 *   - auto     : 自动降级链（Google → MyMemory → DeepL → 自定义），推荐
 *   - google   : 非官方免费接口（无需密钥，国内多数网络不可达）
 *   - mymemory : 官方免费接口（无需密钥，匿名每天约 5000 字符）
 *   - deepl    : 官方 API（需密钥，免费版 50 万字符/月，质量最好）
 *   - custom   : 用户自定义接口模板
 *
 * 关键设计：所有请求带超时。Google 在国内被墙时，若无超时会一直挂着，
 * 表现为「点了翻译没反应」。超时后 auto 链自动换下一个引擎。
 */

/* global sleep */

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

/**
 * MyMemory 官方提额通道：请求里带 de=<邮箱格式标识>，额度从「匿名 5000 字符/天」
 * 提升到「5 万字符/天」。实测：额度耗尽后带上标识立即恢复可用。
 * 该值仅作为额度标识发给 MyMemory，不用于登录；用户不填时由 service-worker
 * 自动生成并持久化一个 pagelingo-<随机>@example.com，避免匿名额度耗尽导致全链失败。
 */
let MYMEMORY_EMAIL = '';
let LAST_CREDS = '';

/**
 * 同步一次「引擎凭据」。凭据变了就作废引擎冷却：
 * 之前「Google 不通、MyMemory 超额」的结论只对旧凭据成立，
 * 若不清空，用户填完邮箱后仍会跳过本已可用的 MyMemory，
 * 症状就是「填了邮箱还是不行」。
 */
function syncEngineCredentials(mmEmail, deeplKey) {
  const email = String(mmEmail || '').trim();
  const key = String(deeplKey || '').trim();
  const sig = email + '\u0000' + key;
  if (sig !== LAST_CREDS) {
    LAST_CREDS = sig;
    MYMEMORY_EMAIL = email;
    resetEngineHealth();
  }
  return MYMEMORY_EMAIL;
}

function setMyMemoryEmail(email) {
  syncEngineCredentials(email, LAST_CREDS.split('\u0000')[1] || '');
}

// 带超时的 fetch，避免墙外接口把整批请求拖死
async function fetchJson(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 8000);
  try {
    const init = Object.assign({ signal: ctrl.signal }, opts || {});
    const res = await fetch(url, init);
    if (!res.ok) {
      // 把响应体一起带走：MyMemory 的 429 正文里写了「额度用完」，
      // 只看 HTTP 429 用户不知道该干什么。
      let body = '';
      try { body = await res.text(); } catch (e2) { /* 正文读不到就只留状态码 */ }
      const err = new Error('HTTP ' + res.status);
      err.status = res.status;
      err.body = body.slice(0, 500);
      throw err;
    }
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时（' + ((timeoutMs || 8000) / 1000) + 's）');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// 语言代码归一：auto -> auto(google) / Autodetect(mymemory)
function normSl(sl, engine) {
  if (sl === 'auto') {
    return engine === 'mymemory' ? 'Autodetect' : 'auto';
  }
  return sl;
}

// 项目内语言代码 -> DeepL 语言代码
const DEEPL_LANG = {
  'zh-CN': 'ZH-HANS',
  'zh-TW': 'ZH-HANT',
  'en': 'EN',
  'ja': 'JA',
  'ko': 'KO',
  'de': 'DE'
};

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

    const data = await fetchJson(url + '?' + params.toString(), null, 6000);
    // data[i] = [[译文, 原文, ...], ...]，逐段拼接
    return texts.map(function (_, i) {
      const seg = data[i];
      if (!Array.isArray(seg)) return '';
      return seg.map(function (x) { return (x && x[0]) ? x[0] : ''; }).join('');
    });
  }
};

/** MyMemory 额度耗尽时的可执行提示（有没有填邮箱，说法不同） */
function myMemoryQuotaError() {
  return new Error(MYMEMORY_EMAIL
    ? 'MyMemory 连提额邮箱的额度也用完了，请明天再试或改用 DeepL 密钥'
    : 'MyMemory 今日免费额度已用完（约 5000 字符/天）。在面板填入 MyMemory 邮箱，可提升到 5 万字符/天');
}

const MyMemoryEngine = {
  // 仅支持单条，且单条不超过 500 字符
  async translateOne(text, sl, tl) {
    const langpair = normSl(sl, 'mymemory') + '|' + tl;
    let url = 'https://api.mymemory.translated.net/get?q=' +
      encodeURIComponent(text) + '&langpair=' + encodeURIComponent(langpair);
    // 带邮箱可把额度从 5000 提升到 50000 字符/天
    if (MYMEMORY_EMAIL) url += '&de=' + encodeURIComponent(MYMEMORY_EMAIL);

    let data;
    try {
      data = await fetchJson(url, null, 12000);
    } catch (e) {
      // 429 就是额度耗尽，直接给可执行建议，不要把裸状态码抛给用户
      if (e.status === 429 || /USED ALL AVAILABLE FREE TRANSLATIONS/.test(e.body || '')) {
        throw myMemoryQuotaError();
      }
      throw e;
    }
    const out = data && data.responseData && data.responseData.translatedText;

    if (typeof out === 'string' && out.indexOf('USED ALL AVAILABLE FREE TRANSLATIONS') >= 0) {
      throw myMemoryQuotaError();
    }
    if (!out || out.indexOf('MYMEMORY WARNING') === 0 || out === 'NO QUERY SPECIFIED') {
      throw new Error('MyMemory 已达免费额度或查询无效');
    }
    return out;
  },

  // 超长文本按句切分，避免单条 >500 字符被接口拒绝（整批会因此失败）
  async translateLong(text, sl, tl) {
    const parts = splitByLimit(text, 450);
    const out = [];
    for (const p of parts) {
      out.push(await this.translateOne(p, sl, tl));
    }
    // 中日韩译文不加空格，其它语言用空格连接
    const joiner = /^(zh|ja|ko)/i.test(tl) ? '' : ' ';
    return out.join(joiner);
  },

  async translate(texts, sl, tl) {
    const results = new Array(texts.length);
    const self = this;
    // 并发 6：GitHub 这类页面有 250+ 文本节点，并发 3 时约两分钟才出中文，
    // 用户会以为「打开网页没翻译」。6 路是实测不触发 MyMemory 限流的上限。
    const CONCURRENCY = 6;
    let cursor = 0;

    async function worker() {
      while (cursor < texts.length) {
        const i = cursor++;
        results[i] = await self.translateLong(texts[i], sl, tl);
        await sleep(40);
      }
    }

    const workers = [];
    for (let k = 0; k < Math.min(CONCURRENCY, texts.length); k++) workers.push(worker());
    await Promise.all(workers);
    return results;
  }
};

// 按标点把长文本切成不超过 limit 字符的片段
function splitByLimit(text, limit) {
  if (text.length <= limit) return [text];
  const parts = [];
  let cur = '';
  const sentences = text.split(/(?<=[.!?。！？；;])\s+/);

  for (const s of sentences) {
    if (!s) continue;
    if (s.length > limit) {
      if (cur) { parts.push(cur); cur = ''; }
      for (let i = 0; i < s.length; i += limit) parts.push(s.slice(i, i + limit));
      continue;
    }
    const next = cur ? cur + ' ' + s : s;
    if (next.length <= limit) {
      cur = next;
    } else {
      parts.push(cur);
      cur = s;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

const DeepLEngine = {
  async translate(texts, sl, tl, key) {
    if (!key) throw new Error('未填写 DeepL 密钥');
    // 免费版密钥以 :fx 结尾，走 api-free；否则走付费域名
    const host = key.trim().endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
    const body = new URLSearchParams();
    texts.forEach(function (t) { body.append('text', t); });
    if (sl !== 'auto' && DEEPL_LANG[sl]) body.set('source_lang', DEEPL_LANG[sl]);
    body.set('target_lang', DEEPL_LANG[tl] || tl.toUpperCase());

    const data = await fetchJson('https://' + host + '/v2/translate', {
      method: 'POST',
      headers: {
        'Authorization': 'DeepL-Auth-Key ' + key.trim(),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    }, 20000);

    const arr = (data && data.translations) || [];
    if (arr.length !== texts.length) throw new Error('DeepL 返回条数不匹配');
    return arr.map(function (x) { return x.text || ''; });
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
      const data = await fetchJson(url, null, 15000);
      // 约定返回 { translatedText: "..." } 或纯字符串
      results.push(typeof data === 'string' ? data : (data.translatedText || data.text || ''));
      await sleep(200);
    }
    return results;
  }
};

/**
 * 引擎健康状态：某个引擎连续失败后，在有效期内跳过它，
 * 避免每次翻译都白白等一个超时。
 */
const health = { dead: {} };
const DEAD_TTL = 10 * 60 * 1000;

function markDead(name) { health.dead[name] = Date.now() + DEAD_TTL; }

// 用户改了设置（填邮箱/换密钥）后，之前的「引擎已失败」结论不再成立，
// 必须清空冷却，否则会跳过本已可用的引擎，表现为「填了邮箱还是不行」。
function resetEngineHealth() {
  health.dead = {};
}
function markAlive(name) { delete health.dead[name]; }
function isDead(name) {
  const t = health.dead[name];
  if (!t) return false;
  if (Date.now() > t) { delete health.dead[name]; return false; }
  return true;
}

async function runSingle(engine, texts, sl, tl, customEndpoint, deeplKey) {
  if (engine === 'google') return GoogleEngine.translate(texts, sl, tl);
  if (engine === 'mymemory') return MyMemoryEngine.translate(texts, sl, tl);
  if (engine === 'deepl') return DeepLEngine.translate(texts, sl, tl, deeplKey);
  if (engine === 'custom') return CustomEngine.translate(texts, sl, tl, customEndpoint);
  throw new Error('未知引擎：' + engine);
}

/**
 * 自动降级链：按顺序尝试，第一个成功的引擎即采用；
 * 失败者进入冷却期，后续请求直接跳过。
 */
async function runAuto(texts, sl, tl, customEndpoint, deeplKey) {
  const chain = ['google', 'mymemory'];
  if (deeplKey) chain.push('deepl');
  if (customEndpoint) chain.push('custom');

  let lastErr = null;
  for (const engine of chain) {
    if (isDead(engine)) continue;
    try {
      const out = await runSingle(engine, texts, sl, tl, customEndpoint, deeplKey);
      markAlive(engine);
      return { translations: out, engine: engine };
    } catch (e) {
      lastErr = e;
      markDead(engine);
      console.warn('[PageLingo] 引擎 ' + engine + ' 失败，尝试下一个：' + (e.message || e));
    }
  }
  // 全部引擎都在冷却期时 lastErr 为空，别抛「所有引擎均不可用」这种无用信息
  throw lastErr || new Error(
    '翻译服务刚刚全部失败过，已临时跳过。请检查网络/代理，或在面板改用 DeepL 密钥');
}

/**
 * 统一入口：按引擎路由，并对超大文本分批。
 * auto 模式下返回带实际引擎信息的对象；其它模式返回数组（向后兼容）。
 */
async function translate(texts, sl, tl, engine, customEndpoint, deeplKey) {
  const CHUNK = 30; // 单次批量上限

  if (engine === 'auto') {
    const flat = [];
    let used = '';
    for (let i = 0; i < texts.length; i += CHUNK) {
      const chunk = texts.slice(i, i + CHUNK);
      const r = await runAuto(chunk, sl, tl, customEndpoint, deeplKey);
      used = r.engine;
      flat.push.apply(flat, r.translations);
    }
    return { translations: flat, engine: used };
  }

  if (engine === 'mymemory') {
    return MyMemoryEngine.translate(texts, sl, tl);
  }
  if (engine === 'deepl') {
    return DeepLEngine.translate(texts, sl, tl, deeplKey);
  }
  if (engine === 'custom') {
    return CustomEngine.translate(texts, sl, tl, customEndpoint);
  }

  // 明确指定 google 时，仍然分批
  const flat = [];
  for (let i = 0; i < texts.length; i += CHUNK) {
    const chunk = texts.slice(i, i + CHUNK);
    flat.push.apply(flat, await GoogleEngine.translate(chunk, sl, tl));
    if (i + CHUNK < texts.length) await sleep(200);
  }
  return flat;
}

/**
 * 连通性自检：用一句话测每个引擎，给 Popup 的「检测引擎」按钮用。
 * 只测一次，不影响冷却状态。
 */
async function diagnose(sl, tl, customEndpoint, deeplKey) {
  const sample = ['Hello world.'];
  const targets = [
    { engine: 'google', label: 'Google 免费接口' },
    { engine: 'mymemory', label: 'MyMemory 免费接口' },
    { engine: 'deepl', label: 'DeepL 官方 API' },
    { engine: 'custom', label: '自定义接口' }
  ];

  const result = [];
  for (const t of targets) {
    if (t.engine === 'deepl' && !deeplKey) {
      result.push({ engine: t.engine, label: t.label, ok: false, msg: '未填写密钥' });
      continue;
    }
    if (t.engine === 'custom' && !customEndpoint) {
      result.push({ engine: t.engine, label: t.label, ok: false, msg: '未填写接口地址' });
      continue;
    }
    const start = Date.now();
    try {
      const out = await runSingle(t.engine, sample, sl === 'auto' ? 'en' : sl, tl, customEndpoint, deeplKey);
      const first = (out && out[0]) || '';
      result.push({
        engine: t.engine, label: t.label, ok: !!first,
        msg: first.slice(0, 30), ms: Date.now() - start
      });
    } catch (e) {
      result.push({
        engine: t.engine, label: t.label, ok: false,
        msg: e.message || String(e), ms: Date.now() - start
      });
    }
  }
  return result;
}
