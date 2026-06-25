/* ============================================================================
   极简本地静态服务器  ·  Minimal local static server (zero dependencies)
   ----------------------------------------------------------------------------
   方便在浏览器里预览游戏（虽然单文件也能直接双击打开，但用 http 协议更贴近真实环境）。
   用法：
     npm start                 # 默认 http://localhost:8080/ → 打开游戏
     npm start -- --port 3000  # 自定义端口
     PORT=3000 npm start       # 或用环境变量
   只用 Node 内置模块，无需 npm install。
   ============================================================================ */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const ENTRY = 'epidemic-commander.html';   // 根路径默认打开的文件

// 解析端口：--port N > $PORT > 8080
function resolvePort(){
  const i = process.argv.indexOf('--port');
  if(i !== -1 && process.argv[i+1]) return Number(process.argv[i+1]);
  if(process.env.PORT) return Number(process.env.PORT);
  return 8080;
}
const PORT = resolvePort();

const MIME = {
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.gif':'image/gif', '.svg':'image/svg+xml', '.ico':'image/x-icon',
  '.woff':'font/woff', '.woff2':'font/woff2', '.map':'application/json',
};

const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if(pathname === '/' || pathname === '') pathname = '/' + ENTRY;

  // 防目录穿越：解析后必须仍在 ROOT 之内
  const filePath = path.join(ROOT, path.normalize(pathname));
  if(!filePath.startsWith(ROOT)){
    res.writeHead(403); res.end('403 Forbidden'); return;
  }

  fs.stat(filePath, (err, stat) => {
    if(err || !stat.isFile()){
      res.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + pathname);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n  🦠 Epidemic Commander`);
  console.log(`  ▶  http://localhost:${PORT}/   (serving ${ENTRY})`);
  console.log(`  press Ctrl-C to stop\n`);
});
