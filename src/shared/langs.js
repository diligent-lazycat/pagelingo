/**
 * 语言配置：覆盖 5 个 AI 使用较多的国家/地区语言，支持两两互译。
 * 语言代码遵循 Google / MyMemory 通用的 ISO 规范。
 */
window.LinguaPage = window.LinguaPage || {};

(function (LP) {
  // 目标语言列表（源语言在此基础上多一个「自动检测」）
  LP.LANGS = [
    { code: 'zh-CN', label: '中文', flag: '🇨🇳' },
    { code: 'en',    label: 'English', flag: '🇺🇸' },
    { code: 'ja',    label: '日本語', flag: '🇯🇵' },
    { code: 'ko',    label: '한국어', flag: '🇰🇷' },
    { code: 'de',    label: 'Deutsch', flag: '🇩🇪' }
  ];

  LP.AUTO_LANG = { code: 'auto', label: '自动检测', flag: '🔍' };

  // 源语言选项 = 自动检测 + 5 种语言
  LP.SOURCE_LANGS = [LP.AUTO_LANG].concat(LP.LANGS);

  // 默认不翻译的专业术语（占位保护，翻译后原样还原）
  LP.DEFAULT_TERMS = [
    'Git', 'GitHub', 'GitLab', 'Repository', 'Commit', 'Branch', 'Merge',
    'Pull Request', 'Push', 'Clone', 'Fork', 'Issue', 'Token', 'Release',
    'API', 'REST', 'GraphQL', 'JSON', 'YAML', 'XML', 'HTML', 'CSS', 'Sass',
    'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'Rust', 'Go',
    'Node.js', 'npm', 'Docker', 'Kubernetes', 'CI', 'CD', 'DevOps',
    'SQL', 'NoSQL', 'Redis', 'MySQL', 'PostgreSQL', 'MongoDB',
    'HTTP', 'HTTPS', 'URL', 'URI', 'DNS', 'IP', 'TCP', 'UDP',
    'AI', 'ML', 'LLM', 'GPT', 'ChatGPT', 'OpenAI', 'Anthropic', 'Claude',
    'Gemini', 'Copilot', 'Transformer', 'Prompt', 'Fine-tuning', 'Embedding',
    'GPU', 'CPU', 'RAM', 'SSD', 'SDK', 'CLI', 'UI', 'UX', 'IDE', 'Regex',
    'Linux', 'macOS', 'Windows', 'Android', 'iOS', 'React', 'Vue', 'Angular'
  ];

  // 根据 code 查语言对象
  LP.langByCode = function (code) {
    return LP.LANGS.find(function (l) { return l.code === code; }) || LP.AUTO_LANG;
  };
})(window.LinguaPage);
