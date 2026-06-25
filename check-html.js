/* ============================================================================
   HTML 内嵌脚本语法校验  ·  Validate the inline <script> in the game file
   ----------------------------------------------------------------------------
   抽取 epidemic-commander.html 中的 <script> 内容，用 new Function() 解析，
   捕获语法错误（不执行）。同时做一些基本的健全性检查。
   用法：  node check-html.js   （CI 中作为 npm run check:html）
   退出码 0 = 通过，1 = 失败。
   ============================================================================ */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, 'epidemic-commander.html');
const html = fs.readFileSync(FILE, 'utf8');

let failed = false;
const fail = msg => { console.error('  ✗ ' + msg); failed = true; };
const ok   = msg => console.log('  ✓ ' + msg);

// 1) 必须能取出内嵌脚本
const m = html.match(/<script>([\s\S]*)<\/script>/);
if(!m){ fail('未找到内嵌 <script> 块'); process.exit(1); }
const code = m[1];
ok(`找到内嵌脚本（${code.length} 字符）`);

// 2) 脚本必须能被解析（语法正确）
try{ new Function(code); ok('内嵌脚本语法正确'); }
catch(e){ fail('语法错误：' + e.message); }

// 3) 关键结构存在性（防止误删层）
const layers = [
  ['Domain 领域层', /const\s+Domain\s*=\s*\(function/],
  ['createGameService 应用层', /function\s+createGameService\s*\(/],
  ['createView 表现层', /function\s+createView\s*\(/],
  ['createCharts 基础设施', /function\s+createCharts\s*\(/],
  ['组合根 DOMContentLoaded', /addEventListener\(\s*['"]DOMContentLoaded['"]/],
];
for(const [name, re] of layers){
  if(re.test(code)) ok(`包含 ${name}`);
  else fail(`缺少 ${name}`);
}

// 4) Chart.js CDN 仍被引入
if(/cdn\.jsdelivr\.net\/npm\/chart\.js/.test(html)) ok('已引入 Chart.js CDN');
else fail('未引入 Chart.js CDN');

console.log(failed ? '\nHTML 校验失败 ✗' : '\nHTML 校验通过 ✓');
process.exit(failed ? 1 : 0);
