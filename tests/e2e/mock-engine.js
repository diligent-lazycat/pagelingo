// 本地 mock 翻译接口：按 {text}/{from}/{to} 模板返回带标记的译文
const http = require('http');
const url = require('url');

http.createServer((req, res) => {
  const q = url.parse(req.url, true).query;
  const text = q.text || '';
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ translatedText: '【译】' + text }));
}).listen(Number(process.env.MOCK_PORT || 8799), '127.0.0.1', () => console.log('mock engine on 8799'));
