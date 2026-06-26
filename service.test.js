/* ============================================================================
   GameService 单元测试  ·  Application-layer orchestration tests
   ----------------------------------------------------------------------------
   用 fake / spy 端口注入 createGameService，断言"领域事件 → 端口调用"的编排是否正确，
   例如：turningpoint 事件是否触发 audio.sfx('turningpoint') + 解锁成就。
   不依赖真实 DOM / 存储 / 音频 / 图表。
   运行：  node --test service.test.js
   ============================================================================ */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

// 单例 Repo（unlockLevel 用）所读取的 localStorage 存储——测试可写入以控制解锁层级
const store = {};
function loadModule(){
  global.window = { addEventListener(){} };
  global.localStorage = { getItem:k=>(k in store? store[k]:null), setItem:(k,v)=>store[k]=String(v), removeItem:k=>delete store[k] };
  global.document = { getElementById:()=>({}), addEventListener(){}, documentElement:{} };
  const html = fs.readFileSync(path.join(__dirname, 'epidemic-commander.html'), 'utf8');
  const code = html.match(/<script>([\s\S]*)<\/script>/)[1] + '\n;globalThis.__EC__ = { Domain, createGameService };';
  eval(code);
  return globalThis.__EC__;
}
const { Domain, createGameService } = loadModule();

// 确定性 RNG
function mulberry32(seed){
  let a = seed >>> 0;
  const r = { next(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }, int(n){ return Math.floor(r.next()*n); } };
  return r;
}

// ---- 可记录调用的 fake 端口 spy ports ----
function makeRig(opts={}){
  const calls = [];
  const rec = name => (...args) => { calls.push([name, ...args]); };
  let ach = Object.assign({}, opts.ach);
  const view = {
    readSettings: ()=> opts.settings || { mode:'campaign', difficultyKey:'normal', scenarioId:'standard' },
    startGame: rec('view.startGame'),
    render: rec('view.render'),
    log: rec('view.log'),
    logRaw: rec('view.logRaw'),
    logDayStatus: rec('view.logDayStatus'),
    showNews: rec('view.showNews'),
    initialNews: rec('view.initialNews'),
    logStory: rec('view.logStory'),
    logMilestone: rec('view.logMilestone'),
    announceEvent: rec('view.announceEvent'),
    announceIntervention: rec('view.announceIntervention'),
    flashBudget: rec('view.flashBudget'),
    flashChart: rec('view.flashChart'),
    showAchievement: rec('view.showAchievement'),
    showEasterEgg: rec('view.showEasterEgg'),
    toastText: rec('view.toastText'),
    setAuto: rec('view.setAuto'),
    showResult: rec('view.showResult'),
    showCityCard: rec('view.showCityCard'),
    updateScenarioBanner: rec('view.updateScenarioBanner'),
    applyUIGating: rec('view.applyUIGating'),
    renderAchModal: rec('view.renderAchModal'),
    shareResult: rec('view.shareResult'),
    applyLang: rec('view.applyLang'),
    t: k=>k,
  };
  const audio = {
    beep: rec('audio.beep'),
    sfx: rec('audio.sfx'),
    deathToll: rec('audio.deathToll'),
    setEnabled: rec('audio.setEnabled'),
    enabled: true,
    toggle(){ calls.push(['audio.toggle']); return false; },
  };
  const repo = {
    loadMeta: ()=> opts.meta || {},
    saveMeta: rec('repo.saveMeta'),
    loadAch: ()=> ach,
    saveAch: a=>{ ach = a; calls.push(['repo.saveAch', a]); },
    dynDiffOn: ()=> opts.dynDiffOn !== undefined ? opts.dynDiffOn : true,
    setDynDiff: rec('repo.setDynDiff'),
    theme: ()=> null, setTheme: rec('repo.setTheme'),
    saveScore: rec('repo.saveScore'),
    updateMetaAfterGame: rec('repo.updateMetaAfterGame'),
    eggDone: ()=> opts.eggDone || false,
    markEgg: rec('repo.markEgg'),
  };
  const charts = { reset: rec('charts.reset'), update: rec('charts.update'), retheme: rec('charts.retheme'), relabel: rec('charts.relabel') };
  let timerFn = null;
  const clock = { interval:(fn,ms)=>{ timerFn=fn; calls.push(['clock.interval', ms]); return 'HANDLE'; }, clear:h=>calls.push(['clock.clear', h]) };
  const rng = mulberry32(opts.seed || 1);
  const service = createGameService({ repo, view, audio, charts, rng, clock });
  return { service, calls, getAch:()=>ach, getTimer:()=>timerFn };
}

// 默认让 unlockLevel()=2（完整功能，情景不被强制为 standard）
store['ec_meta'] = JSON.stringify({ completions: 5 });

// ---- 调用断言小工具 ----
const has = (calls, name, ...args) =>
  calls.some(c => c[0] === name && args.every((a, i) => JSON.stringify(c[i+1]) === JSON.stringify(a)));
const count = (calls, name) => calls.filter(c => c[0] === name).length;
// 取得 newGame 之后的"增量"调用
function freshGame(opts){
  const rig = makeRig(opts);
  rig.service.newGame();
  const base = rig.calls.length;
  rig.tail = () => rig.calls.slice(base);
  return rig;
}

/* ========================================================================== */
test('newGame — 重置图表并交给视图开场', () => {
  const rig = makeRig();
  rig.service.newGame();
  assert.ok(has(rig.calls, 'charts.reset'), '应重置图表');
  assert.ok(has(rig.calls, 'view.startGame'), '应调用 view.startGame');
  assert.ok(rig.service.getState(), '应创建状态');
});

test('newGame — 沙盒模式直接解锁 sandbox 成就', () => {
  const rig = makeRig({ settings:{ mode:'sandbox', difficultyKey:'normal', scenarioId:'standard' } });
  rig.service.newGame();
  assert.ok(has(rig.calls, 'view.showAchievement', 'sandbox'), '应弹出 sandbox 成就');
  assert.ok(has(rig.calls, 'repo.saveAch'), '应持久化成就');
  assert.ok(has(rig.calls, 'audio.beep', 990, 120), '解锁音效');
});

test('simulateDays — 推进后刷新 UI（tick 音效 + render + 图表 + 状态行）', () => {
  const rig = freshGame();
  rig.service.simulateDays(3);
  const tail = rig.tail();
  assert.ok(has(tail, 'audio.sfx', 'tick'));
  assert.ok(has(tail, 'view.render'));
  assert.ok(has(tail, 'charts.update'));
  assert.ok(has(tail, 'view.logDayStatus'));
});

test('编排：turningpoint 事件 → audio.sfx + 解锁 below1 成就', () => {
  const rig = freshGame();
  const s = rig.service.getState();
  s.baseBeta = 0.001;                 // 让下一步 R_eff 立刻 < 1，制造拐点
  s.everBelow1 = false;
  rig.service.simulateDays(1);
  const tail = rig.tail();
  assert.ok(has(tail, 'audio.sfx', 'turningpoint'), '拐点应播放专属音效');
  assert.ok(has(tail, 'view.showAchievement', 'below1'), '应弹出 below1 成就');
  assert.ok(has(tail, 'repo.saveAch'), '成就应被持久化');
  assert.ok(has(tail, 'audio.beep', 990, 120), '解锁音效');
  assert.equal(s.everBelow1, true);
});

test('成就彩蛋：集齐 ≥80% 时触发一次 showEasterEgg + markEgg', () => {
  // 预置 13 个成就（不含 below1），再解锁第 14 个 → 达到 ceil(17*0.8)=14
  const preset = {};
  ['flatten','lowdeath','frugal','expert','delta','aging','persuade',
   'speedrun','comeback','sandbox','killer','winter','metropolis'].forEach(id => preset[id]=1);
  const rig = freshGame({ ach: preset });
  const s = rig.service.getState();
  s.baseBeta = 0.001; s.everBelow1 = false;   // 制造拐点 → 解锁 below1（第 14 个）
  rig.service.simulateDays(1);
  const tail = rig.tail();
  assert.ok(has(tail, 'view.showAchievement', 'below1'));
  assert.ok(has(tail, 'view.showEasterEgg'), '达到 80% 应触发彩蛋');
  assert.ok(has(tail, 'repo.markEgg'), '彩蛋应被持久化（只触发一次）');
});

test('成就彩蛋：已触发过则不再重复', () => {
  const preset = {};
  ['flatten','lowdeath','frugal','expert','delta','aging','persuade',
   'speedrun','comeback','sandbox','killer','winter','metropolis'].forEach(id => preset[id]=1);
  const rig = freshGame({ ach: preset, eggDone: true });   // 已触发
  const s = rig.service.getState();
  s.baseBeta = 0.001; s.everBelow1 = false;
  rig.service.simulateDays(1);
  assert.ok(!has(rig.tail(), 'view.showEasterEgg'), '已触发过不应再弹彩蛋');
});

test('编排：死亡里程碑事件 → view.logMilestone + audio.sfx(milestone)', () => {
  const rig = freshGame();
  const s = rig.service.getState();
  s.I = 5000; s.D = 150; s.deathMilestone = 0;   // 跨越 100 里程碑（reff>1，避免拐点干扰）
  rig.service.simulateDays(1);
  const tail = rig.tail();
  assert.ok(has(tail, 'view.logMilestone'), '应记录里程碑叙事');
  assert.ok(has(tail, 'audio.sfx', 'milestone'), '应播放哀悼音');
});

test('编排：随机事件（医疗挤兑）→ announceEvent + alarm + 额外 milestone 音', () => {
  const rig = freshGame();
  const s = rig.service.getState();
  s.day = 10; s.I = 2000; s.S = 90000; s.D = 0;
  s.daily = [100, 3500];              // 上一日新增 > 3000 → 必触发 overload
  s.events = []; s.aidGiven = 99; s.panicTriggered = true;  // 排除 aid / panic 干扰
  rig.service.simulateDays(1);
  const tail = rig.tail();
  assert.ok(has(tail, 'view.announceEvent', 'overload', 'bad'), '应播报医疗挤兑');
  assert.ok(has(tail, 'audio.sfx', 'alarm'), 'bad 事件应报警');
  assert.ok(has(tail, 'audio.sfx', 'milestone'), 'overload 额外触发沉闷音');
});

test('toggleIntervention — 成功路径：announce + confirm + flash + render', () => {
  const rig = freshGame();
  rig.service.toggleIntervention('mask');
  const tail = rig.tail();
  assert.ok(has(tail, 'view.announceIntervention'));
  assert.ok(has(tail, 'audio.sfx', 'confirm'));
  assert.ok(has(tail, 'view.flashChart'));
  assert.ok(has(tail, 'view.render'));
  assert.equal(rig.service.getState().active.mask, true);
});

test('toggleIntervention — 预算不足：flashBudget + beep，且不激活/不确认', () => {
  const rig = freshGame();
  rig.service.getState().budget = 1000;
  rig.service.toggleIntervention('quarantine');   // 需 280k
  const tail = rig.tail();
  assert.ok(has(tail, 'view.flashBudget'));
  assert.ok(has(tail, 'audio.beep', 200, 120));
  assert.ok(!has(tail, 'view.announceIntervention'), '不应记录激活');
  assert.ok(!has(tail, 'audio.sfx', 'confirm'));
});

test('toggleIntervention — 零干预模式被拦截（无任何端口副作用）', () => {
  const rig = freshGame({ settings:{ mode:'zero', difficultyKey:'normal', scenarioId:'standard' } });
  rig.service.toggleIntervention('mask');
  const tail = rig.tail();
  assert.ok(!has(tail, 'view.announceIntervention'));
  assert.ok(!has(tail, 'audio.sfx', 'confirm'));
  assert.ok(!has(tail, 'view.flashChart'));
});

test('toggleIntervention — 疫苗额外刷新图表', () => {
  const rig = freshGame();
  rig.service.toggleIntervention('vaccine');
  assert.ok(has(rig.tail(), 'charts.update'), '疫苗改变仓室，应即时更新图表');
});

test('编排：gameover 事件 → endGame（存档 + 元数据 + 结算面板）', () => {
  const rig = freshGame();
  const s = rig.service.getState();
  s.I = 0.5; s.day = 50;              // 下一步 I<1 → gameover
  rig.service.simulateDays(1);
  const tail = rig.tail();
  assert.ok(has(tail, 'repo.saveScore'), '应保存分数');
  assert.ok(has(tail, 'repo.updateMetaAfterGame'), '应更新元进度');
  assert.ok(has(tail, 'view.showResult'), '应弹出结算面板');
  assert.equal(s.over, true);
});

test('endGame — 零干预通关解锁 killer 成就', () => {
  const rig = freshGame({ settings:{ mode:'zero', difficultyKey:'normal', scenarioId:'standard' } });
  const s = rig.service.getState();
  s.I = 0.5; s.day = 80;
  rig.service.simulateDays(1);
  assert.ok(has(rig.tail(), 'view.showAchievement', 'killer'), '零干预结局应解锁 killer');
});

test('toggleAuto — 启停计时器并切换按钮态', () => {
  const rig = freshGame();
  rig.service.toggleAuto();
  let tail = rig.tail();
  assert.ok(has(tail, 'clock.interval', 500), '应以 500ms 启动自动推进');
  assert.ok(has(tail, 'view.setAuto', true));
  assert.equal(rig.service.getState().auto, true);

  const base2 = rig.calls.length;
  rig.service.toggleAuto();
  const tail2 = rig.calls.slice(base2);
  assert.ok(has(tail2, 'clock.clear', 'HANDLE'), '再次切换应清除计时器');
  assert.ok(has(tail2, 'view.setAuto', false));
  assert.equal(rig.service.getState().auto, false);
});

test('自动推进的定时回调：每跳推进一天并刷新', () => {
  const rig = freshGame();
  rig.service.toggleAuto();
  const day0 = rig.service.getState().day;
  const base = rig.calls.length;
  rig.getTimer()();                  // 手动触发一次定时回调
  const tail = rig.calls.slice(base);
  assert.equal(rig.service.getState().day, day0 + 1);
  assert.ok(has(tail, 'view.render'));
  assert.ok(has(tail, 'charts.update'));
});

test('skipToPeak — 推进到峰值后记录日志并刷新', () => {
  const rig = freshGame();
  rig.service.skipToPeak();
  const tail = rig.tail();
  assert.ok(has(tail, 'view.log', 'log_peak'));
  assert.ok(has(tail, 'view.render'));
  assert.ok(has(tail, 'charts.update'));
  assert.ok(rig.service.getState().day > 0);
});

test('unlockLevel — 由完成局数 / below1 决定（读取单例存储）', () => {
  const rig = makeRig();
  store['ec_meta'] = JSON.stringify({ completions: 2 }); store['ec_ach'] = '{}';
  assert.equal(rig.service.unlockLevel(), 2);
  store['ec_meta'] = JSON.stringify({ completions: 1 });
  assert.equal(rig.service.unlockLevel(), 1);
  store['ec_meta'] = JSON.stringify({ completions: 0 }); store['ec_ach'] = JSON.stringify({ below1: 1 });
  assert.equal(rig.service.unlockLevel(), 1);
  store['ec_meta'] = '{}'; store['ec_ach'] = '{}';
  assert.equal(rig.service.unlockLevel(), 0);
  store['ec_meta'] = JSON.stringify({ completions: 5 });  // 还原默认
});
