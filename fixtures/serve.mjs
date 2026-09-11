import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const dir = path.resolve('fixtures');
http.createServer((req, res) => {
  const f = path.join(dir, req.url.split('?')[0].replace(/^\//, '') || 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(f));
}).listen(8787, '127.0.0.1');
