# Cairn 项目分析总结

> 基于当前 `feature/dev` 分支（commit `8af0f5f`）的只读阅读，未修改任何代码。
> 主要来源：`AGENTS.md`、`CONTEXT.md`、`docs/ARCHITECTURE.md`、`docs/PRD.md`、`README.md`、`package.json`、CI 配置。

---

## 1. 项目是做什么的

**Cairn** 把读者已经拥有的电子书，变成一条可以走到终点的"路径"（path）。

- **输入**：EPUB / PDF / MOBI·AZW3 / DOCX / TXT / Markdown（以及读者自己的 Markdown 笔记）。
- **输出**：一条由**站点**（station）组成的路径，站点分组为**阶段**（stage），结尾有一个 recap station。每个 station 是一个短的**幻灯片 deck**（slides）+ **配音音频** + **字幕**，用时间线、对比、流程图、矩阵等十多种图表布局渲染。
- **四档预算**（budget）：skim / gist / read / walk it all，决定站点数量——预算是约束，站点数是结果。
- **伴读 agent**（companion）：放在播放器旁边，回答关于当前书的问题，并把每条论断溯源到原文段落或网页。
- **形态**：本地桌面应用（Electrobun），Mac 首发、Windows 实验性支持；没有后端服务器，没有指标统计。

关键设计原则（来自 CONTEXT.md 的词汇表与 AGENTS.md 的 Invariants）：
- 结构来自书的真实目录与正文，不来自模型的预训练记忆。
- 全文只读一次（map 阶段生成 chapter note，下游只读 note）。
- 每个 station 携带 `sourceChapters`，可溯源。
- 幻灯片是数据不是视频；不生成图片；不生成 mp4。
- 缓存 key 来自内容指纹而非位置；声音在加书时锁定且跟随书的生命周期。

---

## 2. 技术栈

| 层 | 选择 | 说明 |
| --- | --- | --- |
| 语言/运行时 | **TypeScript strict** + **Bun** | 一个工具链覆盖 app、脚本、测试；`noUncheckedIndexedAccess` 开启，禁用 `any` |
| 桌面壳 | **Electrobun** | 小型原生壳；参考项目 llm-space 用它同时发 macOS / Windows |
| Webview 构建 | **Vite** | 小体积、快速 dev |
| UI | **React 19** | 幻灯片布局就是组件 |
| 模型生成 | **pi-ai**（`@earendil-works/pi-ai`） | 通过 `LlmProvider` 接口；结构化输出走 JSON Schema；约 100 次调用/书 |
| 伴读 agent | **pi-agent-core** | 流式 tool loop、取消、选模型路由 |
| 配音 | **edge-tts**（WebSocket 直连） | 免费无 key；`runtime/edge-tts-ws.ts` 直连 Microsoft Edge 读服务，字边界事件折叠成字幕 cue |
| EPUB | JSZip + 自研提取 | 只要文字，不用 epub.js |
| PDF | **unpdf**（pdf.js 服务端构建） | 纯 JS 无 worker；书签给章节，标题是兜底 |
| MOBI/AZW3 | 自研 PalmDB 读取（移植自 foliate-js 字节层） | `mobi-decode.ts` |
| DOCX | **mammoth** + EPUB 标题拆分 | 表格/列表/修订痕迹；标题来自样式名 |
| 搜索 | Firecrawl（默认 keyless）/ Brave / Tavily | 键在主进程，不在 webview |
| WeChat Reading | 自研 `weread/` | 可选 key，只发标题作者，不发正文 |
| 测试 | **bun test** | 79 个测试文件 |
| 类型检查 | 4 个独立 tsc 项目 | core / ui / desktop(webview) / desktop(main) |
| CI | GitHub Actions，`macos-15` | `bun test` + `bun run typecheck` + `bun run build` |
| 依赖修补 | `patches/edge-tts-universal@1.4.0.patch` | 有一个依赖被 patch 过 |

环境变量（见 AGENTS.md）：`CAIRN_DATA_DIR`、`CAIRN_TRACE`、`BRAVE_SEARCH_API_KEY`、`FIRECRAWL_API_KEY`、`TAVILY_API_KEY`、`WEREAD_API_KEY`。

---

## 3. 目录结构如何组织

```
books-Cairn/
├── packages/
│   ├── core/                    域名 + pipeline；无框架导入
│   │   ├── parse/              epub pdf mobi mobi-decode docx txt markdown notes chunk text
│   │   │                       format(可被 webview 用的接受类型) language html-blocks pdf-layout
│   │   ├── llm/                LlmProvider 接口 + trace 包装；无实现
│   │   ├── pipeline/           map classify reduce recap slides tts build budget caption
│   │   │                       fingerprint job(批量状态机) scheduler(交互式) material
│   │   │                       diagram-slides slide-fields voice
│   │   ├── books/              builder.ts(加书/恢复/删除) progress.ts
│   │   ├── companion/          citations compact context types web-search xml
│   │   ├── store/              asks file-store library(布局) library-disk(Library) reading
│   │   ├── runtime/            codex-cli codex-credentials edge-tts-ws trace-dir
│   │   └── eval/               judge metrics prompts run summary   ← 只有 `bun run eval` 用，app 不 import
│   └── ui/                     React 组件、设计 token、幻灯片布局渲染器
│       ├── panes/              StagePane DeckPane CompanionPane Splitter PanelToggle BookMenu
│       │                       markdown resume split useAutoHide useSplit useResume useTransport
│       ├── slides/             Chrome SlideView Gauntlet faults glyphs Icon reveal magnitude
│       │   layouts/            Aside Causes Compare Cycle Flow Matrix NumberSlide Overlap Points
│       │                       Pyramid Quadrant Quote Relation Timeline Title
│       ├── settings/           ModelsPage pages rows SettingsPanel SettingsProvider prefs shell
│       └── i18n/               messages/en messages/zh locale errorText
├── apps/desktop/               Electrobun 壳：主进程 + webview
│   ├── src/main/               index.ts(组合根) rpc inspect library-server provider companion/
│   │                           menu settings store weread route reading pi-provider
│   ├── src/shared/             schema(RPC 契约) types providers settings errors companion-events
│   └── src/                    App.tsx(路由根) main.tsx AddBook.tsx Home.tsx bridge.ts
│                               QuoteCycle.tsx shortcut.ts silence.ts useBundle.ts useShellSettings.ts
├── scripts/                    add-book replay typecheck eval
├── docs/                       PRD ARCHITECTURE DESIGN EVAL + agents/
└── .agents/skills .claude/skills   agent skills（仅 cairn-desktop-verify 入库）
```

**依赖箭头单向**：`pipeline/`、`llm/` 只依赖接口（`LlmProvider`、`Narrator`、`JobStore`、`TraceSink`）；`runtime/` 实现它们。`core` 不 import pi-ai，只有 `main/pi-provider.ts` import。

**第二条更严的规则**：webview 也 import 的模块不能 import `node:*`（Vite 会 externalise，bundle 阶段才失败）。`pipeline/voice.ts` 和 `parse/format.ts` 正是为此而存在。`apps/desktop/tests/webview/imports.test.ts` 会从 `main.tsx` 出发走真实 import 图，抓出这两类违规。

**进程作用域对象集中在一处**：`main/index.ts` 是组合根，构造 narrator、builder、RPC handler 并传入。 companion 的工具仍直接 import `store.ts`——AGENTS.md 明确说"那是下一个要搬的，不是要复制的模式"。

---

## 4. 启动、构建、测试命令

```bash
bun install
cd apps/desktop && bunx electrobun prepare   # 每次 checkout 跑一次，把 SDK 投影到 .hutch/（gitignored）

bun test                # 全部 79 个测试文件
bun test <path>         # 单文件
bun run typecheck       # 四个项目 tsc --noEmit；缺 .hutch/ 会明确跳过并说明
bun run add-book <file> # 终端加书
bun run replay <bookId> [file]   # 列出/重放 recorded model call
bun run eval --judge deepseek-v4-pro   # 评估 pipeline 变更

cd apps/desktop
bun run dev      # 只起 Vite：三栏，无模型、无壳
bun run build    # 打 webview bundle（会抓 node:* 泄漏）
bun run start    # 真实桌面 app（需要模型 key / codex login + 网络）
bun run package  # 可分发 .app
```

CI（`.github/workflows/ci.yml`）在 `macos-15` 跑 `bun install --frozen-lockfile` → `electrobun prepare` → `bun test` → `bun run typecheck` → `bun run build`。

---

## 5. 新增一个页面应该从哪里开始

"页面"有两种含义，入口不同：

### A. 新增一个**设置页**（settings page / tab）

1. **组件**：在 `packages/ui/src/settings/pages.tsx` 新建一个 `XxxPage` 组件（shell 可选参数，无主进程时显示 `Offline`）。
2. **注册 tab**：在 `SettingsPanel.tsx` 的 `SETTINGS_TABS` 数组加键、`PAGES` 数组加 `{ tab, group, Icon }`、`GROUPS` 已有三个分组（app/reading/generation）可复用或加新分组。
3. **图标**：在 `packages/ui/src/settings/icons.tsx` 加一个 Mark 组件，并在 `SettingsPanel.tsx` import。
4. **文案（i18n）**：在 `packages/ui/src/i18n/messages/en.ts` 与 `zh.ts` 加 `settings.pages.xxx`、`settings.groups.*`、`settings.xxx.*` 两套——`en` 是类型源，漏一个 zh 会 typecheck 失败。
5. **如需主进程数据**：在 `apps/desktop/src/shared/schema.ts` 的 `BunSchema.requests` 加 RPC 请求类型 → 在 `apps/desktop/src/main/rpc.ts` 实现 handler → 在 `apps/desktop/src/bridge.ts` 暴露给 webview。
6. **导出**：需要被外部引用的组件/类型，加到 `packages/ui/src/index.ts`（或 core 的 `exports`）。

### B. 新增一个**应用视图页**（Home / AddBook / 阅读器这一层）

- 路由根是 `apps/desktop/src/App.tsx`：没有 `bookId` 渲染 `<Home>`（书架），有 `bookId` 渲染三栏阅读器（StagePane / DeckPane / CompanionPane）。
- 新增视图组件放在 `apps/desktop/src/`，通过 `bridge.ts` 调 RPC。
- 如果是 modal 层（如 AddBook、SettingsPanel），在 `App.tsx` 的 `modal` 片段里挂载。
- 用到的 UI 组件应来自 `@cairn/ui`（`packages/ui/src/index.ts`）。

### 必须过的检查

- `bun run typecheck` 四个项目全绿。
- `bun test` 全绿，包括 `apps/desktop/tests/webview/imports.test.ts`（新页面若引入 `node:*` 或主进程依赖会被它抓出）。
- `cd apps/desktop && bun run build`（bundle 才暴露 Vite externalise 问题）。
- 视觉变化需对照 `docs/DESIGN.md` 的对比度表；文案需 en/zh 双语。

---

## 6. 当前项目有哪些明显维护风险

1. **edge-tts 是非官方端点**。它搭 Microsoft Edge 的读服务，免费无 key，但可能被限速或关闭。切换到付费云 TTS 成本不高（约 ¥7.5/书），但外部依赖不可控。`runtime/edge-tts-ws.ts` 直连 WebSocket，绕过了官方 CLI。

2. **Windows 支持是"实验性且未真正测过"**。CI 只在 `macos-15` 跑；Windows 安装包未签名（SmartScreen 要手动放行），README 自己写 `expect rough edges`。Cairn 的平台特定部分集中在 `runtime/` 和 Electrobun 打包，但实际兼容性无人验证。

3. **一个依赖被 patch 过**：`patches/edge-tts-universal@1.4.0.patch`。patchedDependencies 会在升级该包时自动重新应用，但 patch 维护成本是隐性负债。

4. **伴读工具仍直接 import `store.ts`**（AGENTS.md 原话："The companion's tools still reach `store.ts` at import. That is the next step, not a pattern."）。这违反"进程作用域对象在组合根构造"的规则，store.ts 的 module-level `let` 绑定是已知技术债。

5. **pipeline prompts 只部分 XML 结构化**。`docs/ARCHITECTURE.md` 把"所有面向模型的 prompt 都 XML 化"列为迁移目标，目前伴读、compaction、部分 pipeline 阶段还是半标签的。动态内容（书名、正文、网页、用户输入）有 XSS 式注入风险，需要按字符数据转义。

6. **i18n 只有 en/zh 两套**。`pipeline/prompts/` 也只有 `en.ts` 与 `zh.ts`，AGENTS.md 明确"en 是类型源，加 prompt 必须同时补 zh"。任何新页面/新阶段都得双语同步，漏一套即 typecheck 失败。

7. **模型目录绑定 pi-ai 0.87.1 的生成 catalog**。设置面板只提供"能强制结构化输出"的模型，且 `OFFERED_PROVIDERS` 在 build time 从 catalog 决定。pi-ai 升级可能改变哪些 vendor 被提供（如 moonshotai 0/4、minimax 0/3、xai 0/4 目前不入列表）。这是隐性耦合。

8. **`codex exec` 仍有约 18k token harness 开销**，目前只被 `bun run replay` 使用；map 阶段靠 `DEFAULT_BATCH_SIZE` 批次摊薄。任何回归到 CLI 路由的改动都会重燃这个成本。

9. **生成缓存与书籍数据包含完整章节文本与音频**，靠 `.gitignore` 排除出仓库。规划中的 iCloud 同步会与 Security 一节"生成内容永不出机器"的声明直接冲突——AGENTS.md 写明"决定之前不要建同步"。

10. **没有 notarization**。DMG 安装后需要 `xattr -dr com.apple.quarantine`；Homebrew cask 由brew 处理签名。

11. **测试覆盖的结构性缺口**：pipeline 核心逻辑有单元测试（纯逻辑可测），但**幻灯片溢出无法单元测试**，只能靠 `?gauntlet` 人工目视；`runtime/` 因为要 fork 进程/连服务，没有测试。伴读侧测试较全（11 个 companion 测试），主进程侧也有覆盖。

12. **类型检查的 4 项目模型对新 checkout 不友好**：两个 desktop 项目依赖 `electrobun prepare` 投影到 gitignored 的 `.hutch/`，全新 checkout 必须先跑一次 prepare，否则 `bun run typecheck` 会明确跳过两个——跳过是"响亮"的，但仍是流程上的摩擦。

13. **eval 基线需要持续维护**。`bun run eval` 盲测对比接受的基线，需要定期 `--accept`；judge 模型要比生成模型强；"信任结论不信任记录"——未改动的 pipeline 曾 2–5 输给自己。这部分是人工负担。

14. **分支状态**：当前在 `feature/dev`，`main` 已有 PR #1 合并记录；最近提交多为 release chore 与小修复，暂无明显未完成的 refactor 标记。

---

## 7. 关键文件速查

| 用途 | 文件 |
| --- | --- |
| 项目约定总纲 | `AGENTS.md` |
| 产品词汇表 | `CONTEXT.md` |
| 产品定义 | `docs/PRD.md` |
| 架构/边界/决策记录 | `docs/ARCHITECTURE.md` |
| 视觉设计 token | `docs/DESIGN.md`、`packages/ui/src/tokens.css` |
| 评估方法 | `docs/EVAL.md` |
| 组合根（主进程） | `apps/desktop/src/main/index.ts` |
| 路由根（webview） | `apps/desktop/src/App.tsx` |
| RPC 契约 | `apps/desktop/src/shared/schema.ts` |
| 设置面板入口 | `packages/ui/src/settings/SettingsPanel.tsx` |
| 设置页组件 | `packages/ui/src/settings/pages.tsx` |
| 核心导出 | `packages/core/src/types.ts`、各 `index.ts` |
| UI 导出 | `packages/ui/src/index.ts` |