/* ============================================================================
   Domain 单元测试  ·  Unit tests for the Domain layer
   ----------------------------------------------------------------------------
   直接对纯领域逻辑 Domain.* 断言，不依赖任何 DOM / 浏览器。
   运行：  node --test domain.test.js          （需要 Node 18+，使用内置 node:test）
   或：    node domain.test.js
   ----------------------------------------------------------------------------
   做法：读取 epidemic-commander.html，抽取 <script> 内容并在最小桩环境中求值，
   仅把内层的 Domain 暴露出来。因为 Domain 不碰 DOM/存储/音频/i18n，
   它可以脱离浏览器被完整测试——这正是整洁架构的收益。
   ============================================================================ */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

// ---- 加载 Domain（最小桩，仅满足脚本顶层求值） ----
function loadDomain(){
  global.window = { addEventListener(){} };               // 组合根注册用，永不触发
  global.localStorage = { getItem:()=>null, setItem(){}, removeItem(){} };
  global.document = { getElementById:()=>({}), addEventListener(){}, documentElement:{} };
  const html = fs.readFileSync(path.join(__dirname, 'epidemic-commander.html'), 'utf8');
  const code = html.match(/<script>([\s\S]*)<\/script>/)[1] + '\n;globalThis.__EC_DOMAIN__ = Domain;';
  eval(code);                                              // 直接 eval：Domain 块作用域内，下一行把它带出
  return globalThis.__EC_DOMAIN__;
}
const Domain = loadDomain();

// ---- 测试用确定性随机源 deterministic RNG ----
function mulberry32(seed){
  let a = seed >>> 0;
  const rng = {
    next(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; },
    int(n){ return Math.floor(rng.next() * n); },
  };
  return rng;
}
// 固定 RNG：int 永远 0 → 城市固定为 CITIES[0]（tourist），便于断言确定值
const FIXED = { next:()=>0, int:()=>0 };

const N = Domain.N;                       // 100000
const newState = (over={}) => Domain.createState(Object.assign(
  { mode:'campaign', diff:Domain.DIFF.normal, scenario:'standard', dynBeta:0, rng:FIXED }, over));

/* ========================================================================== */
test('createState — 初始仓室与按模式的预算', () => {
  const s = newState();
  assert.equal(s.S, N - Domain.I0);
  assert.equal(s.I, Domain.I0);
  assert.equal(s.R, 0);
  assert.equal(s.D, 0);
  assert.equal(s.budget, Domain.DIFF.normal.budget);
  assert.equal(s.startBudget, s.budget);
  assert.equal(s.city.id, 'tourist');            // FIXED.int=0 → CITIES[0]
  assert.equal(s.history.length, 1);
  assert.equal(s.over, false);

  const sandbox = newState({ mode:'sandbox' });
  assert.equal(sandbox.budget, 9.9e9);           // 无限预算
  assert.equal(sandbox.city.id, 'tech');         // 沙盒固定中性城市 CITIES[3]
});

test('createState — baseBeta = 难度 × 情景 × 城市 + 动态难度', () => {
  // normal.beta 0.30 × standard 1.0 × tourist 1.15 = 0.345
  const s = newState();
  assert.ok(Math.abs(s.baseBeta - 0.345) < 1e-9, `baseBeta=${s.baseBeta}`);
  // 叠加动态难度 +0.05
  const dyn = newState({ dynBeta:0.05 });
  assert.ok(Math.abs(dyn.baseBeta - 0.395) < 1e-9, `baseBeta=${dyn.baseBeta}`);
  // delta 情景 βMul 1.5
  const delta = newState({ scenario:'delta' });
  assert.ok(Math.abs(delta.baseBeta - 0.30*1.5*1.15) < 1e-9);
});

test('createState — 情景修正 CFR 与疫苗免疫比例', () => {
  // aging CFR ×2.2： normal.cfr 0.008 × 2.2 × tourist 1.00
  const aging = newState({ scenario:'aging' });
  assert.ok(Math.abs(aging.baseCfr - 0.008*2.2*1.00) < 1e-12);
  // hesitancy 疫苗只免疫 10%
  assert.equal(newState({ scenario:'hesitancy' }).vaxFrac, 0.10);
  assert.equal(newState({ scenario:'standard' }).vaxFrac, 0.20);
});

test('createState — 新增情景：winter / metropolis / immune_escape', () => {
  const city = 1.15;   // FIXED → tourist betaMul，cfrMul 1.00
  // winter β×1.3, CFR×1.15
  const w = newState({ scenario:'winter' });
  assert.ok(Math.abs(w.baseBeta - 0.30*1.3*city) < 1e-9);
  assert.ok(Math.abs(w.baseCfr - 0.008*1.15*1.00) < 1e-12);
  // metropolis β×1.45
  const m = newState({ scenario:'metropolis' });
  assert.ok(Math.abs(m.baseBeta - 0.30*1.45*city) < 1e-9);
  // immune_escape β×1.1 且疫苗只免疫 10%
  const ie = newState({ scenario:'immune_escape' });
  assert.ok(Math.abs(ie.baseBeta - 0.30*1.1*city) < 1e-9);
  assert.equal(ie.vaxFrac, 0.10);
});

test('currentParams — 措施乘法叠加 + 民众抵制惩罚 + 临时事件', () => {
  const s = newState();
  // 无干预 → 基础值
  let p = Domain.currentParams(s);
  assert.ok(Math.abs(p.beta - s.baseBeta) < 1e-12);
  assert.equal(p.gamma, Domain.GAMMA);
  assert.ok(Math.abs(p.cfr - s.baseCfr) < 1e-12);

  // 单一口罩令 ×0.80
  Domain.applyIntervention(s, 'mask');
  assert.ok(Math.abs(Domain.currentParams(s).beta - s.baseBeta*0.80) < 1e-12);

  // 叠加到 3 项持续措施 → 触发依从性下降 ×1.15
  Domain.applyIntervention(s, 'distancing');     // ×0.70
  Domain.applyIntervention(s, 'school_close');   // ×0.84
  const expected = s.baseBeta * 0.80 * 0.70 * 0.84 * 1.15;
  assert.ok(Math.abs(Domain.currentParams(s).beta - expected) < 1e-9);

  // 临时随机事件：betaAdd / cfrMul 叠加
  const s2 = newState();
  s2.events.push({ kind:'variant', until:999, betaAdd:0.08 });
  s2.events.push({ kind:'overload', until:999, cfrMul:1.5 });
  const p2 = Domain.currentParams(s2);
  assert.ok(Math.abs(p2.beta - (s2.baseBeta + 0.08)) < 1e-12);
  assert.ok(Math.abs(p2.cfr - s2.baseCfr*1.5) < 1e-12);
});

test('currentParams — tracing 提升康复率 γ', () => {
  const s = newState();
  Domain.applyIntervention(s, 'tracing');        // γ ×1.25, β ×0.85
  const p = Domain.currentParams(s);
  assert.ok(Math.abs(p.gamma - Domain.GAMMA*1.25) < 1e-12);
  assert.ok(Math.abs(p.beta - s.baseBeta*0.85) < 1e-12);
});

test('reff = β/γ × (S/N)', () => {
  const s = newState();
  const { beta, gamma } = Domain.currentParams(s);
  assert.ok(Math.abs(Domain.reff(s) - (beta/gamma)*(s.S/N)) < 1e-12);
});

test('applyIntervention — 持续型开/关与退款', () => {
  const s = newState();
  const b0 = s.budget;
  const on = Domain.applyIntervention(s, 'mask');
  assert.equal(on.kind, 'on');
  assert.equal(s.active.mask, true);
  assert.equal(s.budget, b0 - 80000);
  const off = Domain.applyIntervention(s, 'mask');   // 再点 → 关闭并退款
  assert.equal(off.kind, 'off');
  assert.equal(s.active.mask, false);
  assert.equal(s.budget, b0);
});

test('applyIntervention — 预算不足时拒绝且不改变状态', () => {
  const s = newState();
  s.budget = 1000;
  const res = Domain.applyIntervention(s, 'quarantine'); // 需 280k
  assert.equal(res.kind, 'nofunds');
  assert.equal(s.budget, 1000);
  assert.equal(s.active.quarantine, undefined);
});

test('applyIntervention — 疫苗把 20% 易感者移入康复', () => {
  const s = newState();
  const S0 = s.S;
  const res = Domain.applyIntervention(s, 'vaccine');
  assert.equal(res.kind, 'once');
  assert.equal(res.eff.type, 'vaccine');
  assert.ok(Math.abs(res.eff.immun - S0*0.20) < 1e-9);
  assert.ok(Math.abs(s.S - S0*0.80) < 1e-9);
  assert.ok(Math.abs(s.R - S0*0.20) < 1e-9);
  // 历史最后一帧被同步更新
  const last = s.history[s.history.length-1];
  assert.ok(Math.abs(last.S - s.S) < 1e-9);
});

test('applyIntervention — research 解锁 precision；过后可激活', () => {
  const s = newState();
  // 解锁前：precision 被锁，点击无效
  assert.equal(Domain.applyIntervention(s, 'precision').kind, 'blocked');
  Domain.applyIntervention(s, 'research');
  assert.equal(s.unlocked.precision, true);
  assert.equal(Domain.applyIntervention(s, 'precision').kind, 'on');
});

test('applyIntervention — 零干预模式与已结束局一律拦截', () => {
  const zero = newState({ mode:'zero' });
  assert.equal(Domain.applyIntervention(zero, 'mask').kind, 'blocked');
  const done = newState();
  done.over = true;
  assert.equal(Domain.applyIntervention(done, 'mask').kind, 'blocked');
});

test('step — 推进天数、追加历史、守恒 S+I+R+D=N', () => {
  const s = newState();
  const rng = mulberry32(42);
  for(let i=0;i<30;i++){
    const d0 = s.day, h0 = s.history.length;
    Domain.step(s, rng);
    assert.equal(s.day, d0+1);
    assert.equal(s.history.length, h0+1);
  }
  const sum = s.S + s.I + s.R + s.D;       // 离散 SIR 守恒：四仓室之和恒等于总人口
  assert.ok(Math.abs(sum - N) < 1e-6, `sum=${sum}`);
});

test('step — 一定会结束（≤365 天）并发出 gameover 事件', () => {
  const s = newState();
  const rng = mulberry32(7);
  let gameover = false, guard = 0;
  while(!gameover && guard < 400){
    gameover = Domain.step(s, rng).some(e => e.type === 'gameover');
    guard++;
  }
  assert.ok(gameover, '应当触发 gameover');
  assert.ok(s.day <= Domain.MAX_DAYS);
  assert.ok(s.I < 1 || s.day >= Domain.MAX_DAYS);
});

test('step — 拐点事件只发一次，并置 everBelow1', () => {
  const s = newState();
  ['mask','distancing','quarantine','tracing'].forEach(id => Domain.applyIntervention(s, id));
  const rng = mulberry32(3);
  let turning = 0;
  for(let i=0;i<60 && !s.over;i++){
    for(const e of Domain.step(s, rng)) if(e.type === 'turningpoint') turning++;
  }
  assert.equal(s.everBelow1, true);
  assert.ok(turning <= 1, `turningpoint 次数=${turning}`);
});

test('反事实推演 — 早隔离的死亡 ≤ 无干预；baseline 确定可复现', () => {
  const s = newState();
  const base1 = Domain.baselineRun(s);
  const base2 = Domain.baselineRun(s);
  assert.equal(base1.D, base2.D);                          // 纯函数：可复现
  const early = Domain.earlyIsolationRun(s);
  assert.ok(early.D <= base1.D, `early=${early.D} base=${base1.D}`);
});

test('score / rating — 沙盒不计分、阈值、上限 100', () => {
  // 沙盒：total=0，评级为 mode_sandbox
  const sandbox = newState({ mode:'sandbox' });
  const scS = Domain.score(sandbox, { D:1000, R:0 });
  assert.equal(scS.total, 0);
  assert.equal(scS.sandbox, true);
  assert.equal(Domain.rating(0, true).key, 'mode_sandbox');

  // 评级阈值
  assert.equal(Domain.rating(95, false).key, 'rate_expert');
  assert.equal(Domain.rating(80, false).key, 'rate_great');
  assert.equal(Domain.rating(60, false).key, 'rate_ok');
  assert.equal(Domain.rating(40, false).key, 'rate_poor');
  assert.equal(Domain.rating(10, false).key, 'rate_crisis');

  // 满分情形：死亡 0 + 预算满 + 速度满 → 上限 100
  const perfect = newState();
  perfect.D = 0; perfect.day = 5; perfect.budget = perfect.startBudget;
  const sc = Domain.score(perfect, { D:1000, R:0 });
  assert.ok(sc.total <= 100);
  assert.equal(sc.total, 100);
});

test('evaluateAchievements — 规则求值（below1 / killer / speedrun / 永不 sandbox）', () => {
  const s = newState();
  s.everBelow1 = true;                       // → below1
  let ids = Domain.evaluateAchievements({ state:s, score:50, base:{ D:1000, R:0 } });
  assert.ok(ids.includes('below1'));
  assert.ok(!ids.includes('sandbox'));       // sandbox 成就 cond 永远 false（只能手动解锁）

  const zero = newState({ mode:'zero' });
  zero.day = Domain.MAX_DAYS;
  assert.ok(Domain.evaluateAchievements({ state:zero, score:0, base:{ D:1, R:0 } }).includes('killer'));

  const speed = newState();
  speed.I = 0.5; speed.day = 100;            // I<1 且 day<120
  assert.ok(Domain.evaluateAchievements({ state:speed, score:80, base:{ D:1, R:0 } }).includes('speedrun'));
});

test('evaluateAchievements — 新成就：combo / novax / 新情景', () => {
  // combo：同时激活 4 项持续型措施
  const s = newState();
  ['mask','distancing','school_close','quarantine'].forEach(id => Domain.applyIntervention(s, id));
  assert.ok(Domain.evaluateAchievements({ state:s, score:50, base:{ D:1000, R:0 } }).includes('combo'));
  // novax：得分≥80 且从未用疫苗
  const nv = newState();
  assert.ok(Domain.evaluateAchievements({ state:nv, score:85, base:{ D:1000, R:0 } }).includes('novax'));
  Domain.applyIntervention(nv, 'vaccine');
  assert.ok(!Domain.evaluateAchievements({ state:nv, score:85, base:{ D:1000, R:0 } }).includes('novax'));
  // 新情景成就
  const w = newState({ scenario:'winter' });
  assert.ok(Domain.evaluateAchievements({ state:w, score:72, base:{ D:1, R:0 } }).includes('winter'));
  const ie = newState({ scenario:'immune_escape' });
  assert.ok(Domain.evaluateAchievements({ state:ie, score:75, base:{ D:1, R:0 } }).includes('escape'));
});

test('threatLevel — 起始 R₀ 分档（难度曲线）', () => {
  const mk = beta => { const s = newState(); s.baseBeta = beta; return Domain.threatLevel(s); };
  // R₀ = baseBeta / 0.10
  assert.equal(mk(0.15).tier, 'low');       // R₀ 1.5
  assert.equal(mk(0.25).tier, 'mid');       // R₀ 2.5
  assert.equal(mk(0.35).tier, 'high');      // R₀ 3.5
  assert.equal(mk(0.50).tier, 'extreme');   // R₀ 5.0
  assert.ok(Math.abs(mk(0.30).r0 - 3.0) < 1e-9);
});

test('newsKey — 按疫情态势选择语义键', () => {
  const early = newState(); early.day = 10;
  assert.equal(Domain.newsKey(early), 'news_early');

  const surge = newState(); surge.day = 30; surge.I = 1000; surge.S = 99000; surge.baseBeta = 0.5;
  assert.equal(Domain.newsKey(surge), 'news_surge');   // reff ≈ 4.95 > 2

  const calm = newState(); calm.day = 30; calm.I = 500; calm.S = 99000; calm.baseBeta = 0.05;
  assert.equal(Domain.newsKey(calm), 'news_calm');     // reff < 1，历史短无下降趋势
});

test('pickStoryIdx — 返回合法索引并标记已读', () => {
  const s = newState();
  const rng = mulberry32(99);
  const idx = Domain.pickStoryIdx(s, rng);
  assert.ok(idx >= 0 && idx < Domain.STORY_COUNT);
  assert.equal(s.seenIds['story'+idx], true);
  // 连续抽取倾向于不重复（在条目耗尽前）
  const seen = new Set([idx]);
  for(let i=0;i<6;i++) seen.add(Domain.pickStoryIdx(s, rng));
  assert.ok(seen.size >= 5, `distinct=${seen.size}`);
});
