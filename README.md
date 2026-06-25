# 🦠 流行病指挥官 · Epidemic Commander

[![test](https://github.com/Xinyao-Lyra-Xu/Epidemic-Commander-web-game/actions/workflows/test.yml/badge.svg)](https://github.com/Xinyao-Lyra-Xu/Epidemic-Commander-web-game/actions/workflows/test.yml)
[![deploy-pages](https://github.com/Xinyao-Lyra-Xu/Epidemic-Commander-web-game/actions/workflows/deploy.yml/badge.svg)](https://github.com/Xinyao-Lyra-Xu/Epidemic-Commander-web-game/actions/workflows/deploy.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

一款**单文件、纯前端**的 SIR 流行病学策略游戏。你扮演城市公共卫生负责人，在有限预算和 365 天内，用一系列干预措施控制疫情、减少死亡。游戏兼顾趣味与科普，全程**中英双语**可一键切换。

> A single-file, dependency-free browser game built on the SIR epidemic model. Bilingual (中文 / English), runs by simply opening one HTML file.

---

## ▶️ 运行 / Run

**最简单**：直接双击 [`epidemic-commander.html`](epidemic-commander.html) 用浏览器打开即可（无需安装任何东西）。

**用本地服务器预览**（更贴近真实部署环境）：

```bash
npm start                  # → http://localhost:8080/
npm start -- --port 3000   # 自定义端口
```

服务器是零依赖的 [`serve.js`](serve.js)，只用 Node 内置模块。游戏运行时仅通过 CDN 引入 Chart.js。

**在线托管（GitHub Pages）**：仓库已带 [`deploy.yml`](.github/workflows/deploy.yml)。首次需在 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**；之后每次 push 到 `main`/`master`，工作流会先跑校验与测试，通过后把游戏（复制为 `index.html`）发布到 Pages，部署地址显示在该次运行的 `deploy` 任务里。

---

## 🎮 玩法概览 / Gameplay

- **目标**：365 天内把活跃感染降到接近 0，同时尽量减少死亡与预算花费。
- **SIR 模型**：人群分为易感 S / 感染 I / 康复 R 三仓室，外加死亡 D，按离散差分方程逐日演化。`R_eff` 实时显示，< 1 疫情收敛。
- **8 种干预措施**：持续型（口罩令、社交距离、重点隔离、密接追踪、学校关闭，可开关退款）+ 一次性（疫苗、改善救治、病原研究）。效果**乘法叠加**，同时启用 ≥3 项会触发"民众抵制"依从性下降。
- **三种模式**：战役 / 沙盒（无限预算、不计分）/ 零干预挑战。
- **情景**：标准 / 德尔塔变异株 / 老龄化城市 / 疫苗犹豫。
- **随机城市背景**、**随机事件**（超级传播、变异株、医疗挤兑、国际援助、媒体恐慌）、**动态难度**（可在设置关闭）、**渐进式解锁**、**12 个成就**、**结算反事实推演 + 分享卡片**。

设计上融合了自我决定理论、心流、前景理论、MDA、叙事传输、具身认知、Bartle 玩家类型等多套框架。

---

## 🧅 架构 / Architecture（Clean / Onion）

整个 `<script>` 按整洁（洋葱）架构分层，**依赖只向内**：

```
Presentation  →  Infrastructure  →  Application  →  Domain
  表现层            基础设施层          应用层          领域层（最内，纯逻辑）
```

| 层 | 职责 | 关键符号 |
|----|------|---------|
| **Domain** 领域层 | 纯 SIR 数学、计分、成就规则、随机事件规则。**不碰 DOM/存储/音频/i18n**；随机性经注入的 `rng` 端口获得；向外发出语义化 `DomainEvent`（无文案）。 | `Domain.createState / step / reff / score / …` |
| **Application** 应用层 | 持有可变 `GameState`，编排用例，把领域事件分发给端口。 | `createGameService(ports)` |
| **Infrastructure** 基础设施层 | 实现端口、对接浏览器。 | `Repo`(localStorage) · `Audio`(WebAudio) · `createCharts`(Chart.js) · `I18n` · `Rng` · `Clock` |
| **Presentation** 表现层 | DOM 渲染、叙事、弹窗、事件绑定（Presenter 实现）。 | `createView(deps)` |
| **Composition Root** 组合根 | 唯一"知道所有层"的地方：装配 → 注入 → 绑定 → 启动。 | 文件末尾的 `DOMContentLoaded` |

文件顶部的 **PORTS & TYPES** 区块用 JSDoc `@typedef` 写出了 `GameState`、`DomainEvent` 以及六个端口（`Rng / Clock / AudioPort / RepoPort / ChartsPort / Presenter`）的接口契约。

这套分层的收益就是：**领域逻辑可脱离浏览器测试**，应用层的"事件 → 端口调用"编排可用假实现独立验证。

---

## 🧪 测试 / Tests

零依赖，仅用 Node 内置 `node:test` + `node:assert`（**需 Node 18+**），无需 `npm install`。

```bash
npm test            # 全部 35 个测试（领域层 19 + 应用层 16）
npm run test:domain # 仅领域层：直接对 Domain.* 断言，不依赖 DOM
npm run test:service# 仅应用层：用 fake 端口断言"领域事件 → 端口调用"的编排
npm run check:html  # 校验 HTML 内嵌脚本语法与各层结构是否完整
```

- [`domain.test.js`](domain.test.js)：`createState` / `currentParams` / `reff` / `applyIntervention` / `step`（含 S+I+R+D 守恒）/ 反事实 / `score` / 成就规则 / `newsKey` 等。
- [`service.test.js`](service.test.js)：注入 spy 端口，断言如 *turningpoint → `audio.sfx('turningpoint')` + 解锁成就*、*gameover → 存档 + 结算面板*、预算不足 / 零干预拦截、自动模式定时器等编排。

每次 push / PR 到 `main`/`master`，[GitHub Actions](.github/workflows/test.yml) 会在 Node 18 / 20 / 22 上自动跑 `check:html` 与 `npm test`。

---

## 📁 项目结构 / Layout

```
epidemic-commander.html   游戏本体（单文件：HTML + CSS + 分层脚本 + JSDoc 端口契约）
serve.js                  零依赖本地静态服务器
check-html.js             HTML 内嵌脚本语法 / 结构校验
domain.test.js            领域层单元测试（19）
service.test.js           应用层编排测试（16）
package.json              start / preview / test / check:html 脚本
.github/workflows/test.yml  CI：push 自动跑校验与测试
```

---

## 📚 科普声明 / Disclaimer

各干预措施的效果数值参考了 COVID-19 与流感的公共卫生研究文献（相对风险降低），但模型做了大量简化，**仅供教育与娱乐**，不可用于真实决策。延伸阅读：[WHO](https://www.who.int/) · [CDC](https://www.cdc.gov/) · [SIR 模型（维基）](https://en.wikipedia.org/wiki/Compartmental_models_in_epidemiology)。

## License

[MIT](LICENSE)
