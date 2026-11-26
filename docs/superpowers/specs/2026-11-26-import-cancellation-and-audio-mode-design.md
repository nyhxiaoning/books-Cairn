# 图书导入取消与音频生成模式设计

## 目标

改善图书导入在解析、模型生成和幻灯片/口播生成阶段长时间无进展的体验，并允许用户选择是否在导入时生成 MP3。

成功标准：

- 导入任务的进度连续 5 分钟没有变化时，界面显示“取消上传”。
- 取消后保留已写入的缓存、路径和已完成 deck；下次从书架恢复时继续未完成部分。
- 设置中可以关闭导入时 MP3 生成，默认行为保持不变。
- 关闭 MP3 后仍生成幻灯片、口播文稿和可驱动幻灯片的估算时间轴；阅读器使用系统语音临时朗读。
- 已有带 MP3 的图书继续优先播放已有音频，不受新设置影响。

## 方案

### 设置与构建快照

在主进程设置模型中新增 `generateAudio: boolean`，默认值为 `true`，并放在现有“口播”设置页。导入开始时读取一次该设置，将其作为本次构建的固定选项；`LibraryEntry` 记录 `audioEnabled`，断点恢复时沿用该值而不是重新读取当前设置。旧书缺少该字段时按 `true` 兼容。

这样设置变化不会让同一本半成品书在恢复时混用两种 deck，也不会改变已有图书的播放行为。

### 无 MP3 的 deck

无论是否生成音频，模型都生成同一份句子和幻灯片。启用 MP3 时沿用现有 narrator，获取真实字幕时间轴并写入音频；关闭时跳过 `Narrator.ensureReady()` 与 `Narrator.speak()`，根据书籍语言的已测语速为每个句子生成确定性的本地估算时间轴，再通过现有 deck assembly 逻辑计算幻灯片时间和总时长。

`NodeDeck.audioPath` 改为可选。安装 deck 时仅在存在音频时复制 MP3；deck JSON 保留 narration 和 duration，播放器可以判断“明确无音频”，直接启用系统语音 fallback。音频模式加入 deck cache key，避免旧的带音频缓存被无音频构建错误复用，或反过来覆盖。

### 取消与断点恢复

主进程为当前导入持有一个 `AbortController`，增加取消导入 RPC。取消信号传入：

- 解析和文件读取的可取消边界；
- map 的批处理；
- classify/reduce 的模型调用；
- deck scheduler、slides/PPT 生成和 TTS 调用。

UI 保留最后一次进度快照和更新时间；收到进度、轮询到不同进度或完成状态时刷新更新时间。若连续 5 分钟没有变化，显示取消按钮。点击后调用取消 RPC，等待主进程收尾，关闭当前进度状态；不删除任何已落盘的缓存或半成品书。若路径已经安装，书架上的未完成条目通过现有 resume 机制继续；若仍在 map/classify/reduce，保留的 map 缓存会在重新选择同一本书时复用。

取消属于正常终止，不显示模型失败；真正的失败仍保留现有错误提示和重试路径。

### 播放器行为

播放器继续使用音频优先策略：有可用 MP3 时由 `<audio>` 驱动时间；无 MP3 时直接启动现有视觉时钟，并让 `window.speechSynthesis` 按 narration cue 朗读。没有系统语音时仍显示静态幻灯片，不阻塞阅读。

## 涉及模块

- `apps/desktop/src/shared/settings.ts`、设置读写与设置页：新增开关和中英文文案。
- `apps/desktop/src/shared/schema.ts`、`bridge.ts`、`main/rpc.ts`：传递构建选项、取消 RPC 和任务生命周期。
- `packages/core/src/books/builder.ts`、`pipeline/build.ts`、`pipeline/scheduler.ts`、`pipeline/tts.ts`：固定音频模式、响应取消、生成估算时间轴。
- `packages/core/src/types.ts`、`store/library.ts`、`store/library-disk.ts`：可选音频路径和兼容旧数据。
- `apps/desktop/src/AddBook.tsx`、播放器相关组件：超时按钮和无音频播放状态。

## 错误处理

- 取消优先映射为 `cancelled`，不计为 deck 失败，不破坏已有成功缓存。
- 取消期间已完成的 map 任务、deck 和音频保持可复用。
- 设置文件缺少新字段时使用默认值 `true`。
- 无系统语音能力时降级为只显示幻灯片并允许手动浏览。
- 音频文件损坏时沿用现有 `audio.onError` fallback。

## 验证

- 核心单元测试：估算时间轴的中英文时长、无音频 deck、cache key 隔离、取消信号传播、取消后的 scheduler resume。
- 设置测试：旧 settings 兼容、开关持久化、构建读取快照。
- 桌面 UI 测试：进度 5 分钟不变后出现取消按钮；进度变化会重置计时；取消后 modal 退出且不显示失败。
- 运行 `bun test`、四项目 typecheck、`cd apps/desktop && bun run build`。
- 使用 `cairn-desktop-verify` 在真实 `bun run start` 窗口验证：关闭音频后导入一本小书，确认没有 MP3、系统语音可播放；模拟/等待停滞后确认取消按钮和书架恢复。

## 非目标

- 不改变已有图书的音频文件或重新合成入口。
- 不把“无音频”设置成每本书可单独编辑的长期产品设置。
- 不引入新的音频引擎或网络服务。
