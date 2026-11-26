# 家庭厨房 H5 + Cloudflare D1 部署说明

本文是当前项目的实际部署文档。H5 页面由 Cloudflare Worker 托管，Worker 通过 D1 保存家庭厨房状态；微信小程序继续使用 `wx` 本地存储，不会被本次接入影响。

## 一、当前架构

```text
H5 页面（dist-web）
        │ 同源请求 /api/kitchen/state
        ▼
Cloudflare Worker
        │ DB binding
        ▼
Cloudflare D1
```

第一版使用一个 `kitchen_state` 快照表保存完整的 `KitchenState`。这样可以直接复用当前前端数据模型，保证菜谱、菜品、待做清单、餐厅、探店菜品和菜单历史一次性同步。后续如果需要多人权限、数据审计或大规模查询，再拆成独立业务表。

访问控制使用一个家庭访问密钥：

- 密钥只保存在 Cloudflare Worker Secret 和用户浏览器 localStorage。
- 不写入 `wrangler.jsonc`、源码或 Git。
- H5 第一次访问接口返回 401 时会提示输入密钥。
- 输入后保存在当前浏览器，后续请求自动带上 `Authorization: Bearer <密钥>`。

## 二、准备环境

需要准备：

- Cloudflare 账号
- Node.js 18+
- npm 或 pnpm
- Wrangler 登录权限

安装依赖并登录：

```bash
npm install
npx wrangler login
npx wrangler whoami
```

如果使用 pnpm：

```bash
pnpm install
pnpm exec wrangler login
```

## 三、创建 D1 数据库

```bash
npx wrangler d1 create family-kitchen-db
```

命令会输出数据库 ID。将输出的 ID 写入 `wrangler.jsonc`：

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "family-kitchen-db",
      "database_id": "替换为实际 D1 ID",
      "migrations_dir": "worker/migrations"
    }
  ]
}
```

不要将真实的家庭访问密钥写进这个文件。

## 四、生成家庭访问密钥

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

设置 Worker Secret：

```bash
npx wrangler secret put FAMILY_ACCESS_TOKEN
```

按提示粘贴刚才生成的密钥。不要使用简单密码。

## 五、应用 D1 migration

先应用到本地 D1：

```bash
npm run db:migrate:local
```

再应用到线上 D1：

```bash
npm run db:migrate:remote
```

确认表已经创建：

```bash
npx wrangler d1 execute family-kitchen-db --remote \
  --command='SELECT name FROM sqlite_master WHERE type = "table"'
```

## 六、本地验证

本地验证必须使用 Worker 开发服务，不要只运行 `wv dev -p h5`，因为单独的 Vite H5 服务没有 `/api` 接口。

H5 构建会将页面资源输出为相对路径，并在产物校验阶段检查 CSS 中不能残留 `rpx`。这样直接部署整个 `dist-web` 目录时，CSS、JS 和图片资源不会因为部署目录变化而丢失，浏览器也不会忽略微信小程序专用的 `rpx` 单位。

```bash
npm run build:web
npm run cf:dev
```

打开 Wrangler 输出的本地地址，通常是 `http://localhost:8787`。

```bash
curl -i http://localhost:8787/api/health
```

预期返回：

```json
{"ok":true,"database":"d1","migration":true}
```

本地 D1 数据查看：

```bash
npx wrangler d1 execute family-kitchen-db --local \
  --command='SELECT id, updated_at, length(state_json) AS bytes FROM kitchen_state'
```

首次打开 H5 时，页面会提示输入 `FAMILY_ACCESS_TOKEN`。新建或修改菜谱后，刷新页面确认数据仍然存在。

## 七、线上部署

确认 `wrangler.jsonc` 中的 `database_id` 已替换，并且已经设置 `FAMILY_ACCESS_TOKEN` 后执行：

```bash
npm run cf:preflight
FAMILY_ACCESS_TOKEN='同一个家庭访问密钥' npm run cf:deploy
```

`npm run cf:deploy` 现在是确定性的完整部署入口，按以下顺序执行：

1. 构建 H5 到 `dist-web/`。
2. 校验 H5 产物和 `wrangler.jsonc`。
3. 检查远程 Worker 是否存在 `FAMILY_ACCESS_TOKEN`。
4. 执行 `wrangler d1 migrations apply family-kitchen-db --remote`。
5. 执行 `wrangler deploy`，同时部署 Worker、`dist-web/` 和 D1 binding。
6. 请求 `/api/health`，确认 `database=d1` 且 `migration=true`。
7. 使用同一个 `FAMILY_ACCESS_TOKEN` 请求 `/api/kitchen/state`，确认鉴权和 D1 状态读取正常。

如果 `database_id` 仍是占位符、没有登录 Wrangler、没有远程 migration、没有设置 Worker Secret，或者没有提供本次验证用的 `FAMILY_ACCESS_TOKEN`，命令会失败，不会产生一个“看起来部署成功但实际只用 localStorage”的发布结果。

底层等价命令（不包含自动校验，不建议作为发布入口）：

```bash
npx wv build -p h5
npx wrangler d1 migrations apply family-kitchen-db --remote
npx wrangler deploy
```

部署成功后，Wrangler 会输出 Worker 地址。浏览器访问该地址，输入家庭访问密钥，然后验收：

1. 新建菜谱，刷新页面后仍然存在。
2. 新建餐厅，刷新页面后仍然存在。
3. 新增、修改、删除菜品后刷新确认结果。
4. 生成今日菜单后，切换到饮食记录确认菜单历史存在。
5. 在另一台浏览器输入同一密钥，确认能够看到相同数据。

## 八、数据同步规则

当前版本的同步策略是“远程优先 + 本地兜底”：

- 页面启动时先读取 localStorage，保证页面立即可用。
- H5 后台请求 D1。
- D1 有数据时，用远程状态替换本地状态。
- D1 没有数据但本地有数据时，把本地状态作为首次数据上传。
- 页面发生新增、修改、删除时，先保存 localStorage，再异步同步 D1。
- 网络失败时保留本地数据，不阻断页面操作。
- 下一次页面启动时会再次尝试同步。

注意：当前 D1 使用 `kitchen_state` 单行快照保存完整 `KitchenState`，不是把菜谱和菜品拆成独立 D1 表。创建菜谱、创建菜品、修改、删除、分类变化都会先更新整个本地状态，再通过 `PUT /api/kitchen/state` 覆盖这一个快照，因此刷新或换浏览器后可以恢复完整数据。

验证线上同步：

```bash
CF_WORKER_URL='https://你的-worker.workers.dev' \
FAMILY_ACCESS_TOKEN='同一个家庭访问密钥' \
npm run cf:verify
```

验证通过代表 Worker、D1 migration、访问密钥和状态读取全部正常；之后在 H5 创建菜谱或菜品，前端会把最新快照写回 D1。

当前是最后写入覆盖策略。建议第一阶段只让一个家庭使用一个访问密钥，避免多人同时编辑同一条数据造成覆盖。

## 九、常用运维命令

```bash
npm run db:info
npx wrangler d1 execute family-kitchen-db --remote \
  --command='SELECT id, updated_at, length(state_json) AS bytes FROM kitchen_state'
npx wrangler tail family-kitchen
npx wrangler secret put FAMILY_ACCESS_TOKEN
npx wrangler secret list
```

修改访问密钥后，浏览器需要清除旧密钥：

```js
localStorage.removeItem('family-kitchen-cloud-token')
```

## 十、安全注意事项

- `wrangler deploy` 不会删除 D1 数据。
- 不要执行 `DROP TABLE kitchen_state`，除非已经完成数据备份。
- 不要把 `FAMILY_ACCESS_TOKEN` 写入源码或提交到 Git。
- 不要在浏览器前端写入 Cloudflare API Token。
- 当前 Worker 使用单个家庭数据空间，不适合公开注册用户场景。
- 如果需要多个家庭或账号，需要增加用户表、登录机制和 `user_id` 数据隔离。

## 十一、故障排查

### 页面一直使用本地数据

确认 H5 是通过 Worker 地址访问，而不是单独的 Vite 地址，并检查：

```bash
curl -i https://你的-worker 地址/api/health
npx wrangler tail family-kitchen
```

### 返回 401

清理浏览器旧密钥后刷新：

```js
localStorage.removeItem('family-kitchen-cloud-token')
```

### 返回 500

查看日志并确认线上 migration 已应用：

```bash
npx wrangler tail family-kitchen
npm run db:migrate:remote
```

### 本地 H5 没有同步

需要运行：

```bash
npm run build:web
npm run cf:dev
```

单独运行 `npm run dev:web` 只适合验证页面 UI，不提供 D1 API。

---

## Cairn 专用附录：Cloudflare 书籍同步 Worker

以上家庭厨房部署说明与 Cairn 无关，Cairn 使用独立的 Worker、D1 数据库和 R2
存储桶。不要复用 `kitchen_state`、`FAMILY_ACCESS_TOKEN` 或其中的 migration
路径。Cairn 的完整部署说明见 [`docs/CLOUDFLARE_SYNC.md`](docs/CLOUDFLARE_SYNC.md)。

### 资源和数据边界

```text
Cairn desktop -> Cloudflare Worker -> D1（管理员、会话、清单、版本、进度）
                                      R2（生成后的 deck、封面和 path.json；不包含 MP3 音频）
```

Cairn **不会上传** `chapters.json`、`.cache`、模型 trace、chat transcript 或
source snapshot。同步后的设备可以阅读和播放生成内容，但不能使用本机原始章节文本
执行依赖原文的功能。

### 首次创建与部署

在仓库根目录执行：

```bash
bun install
bunx wrangler login
bunx wrangler d1 create cairn-sync
bunx wrangler r2 bucket create cairn-book-resources
```

把 D1 返回的 UUID 写入 `apps/sync-worker/wrangler.jsonc` 的 `database_id`；
不要把 API Token 或任何 Secret 写入配置文件。然后分别应用本地和远程 migration：

```bash
bunx wrangler d1 migrations apply cairn-sync --local
bunx wrangler d1 migrations apply cairn-sync --remote
```

创建 Worker Secret：

```bash
openssl rand -hex 32 | bunx wrangler secret put ADMIN_INIT_SECRET \
  --config apps/sync-worker/wrangler.jsonc
```

部署前运行安全检查；它会拒绝占位符、检查 Wrangler 登录状态和远端 Secret 名称，
不会打印 Secret 值：

```bash
bun run sync-worker:preflight
bunx wrangler deploy --config apps/sync-worker/wrangler.jsonc
```

### 管理员初始化和验收

Worker 部署后，用 `POST /api/auth/init` 初始化唯一管理员。使用密码管理器或不回显
密码的交互式 shell；不要把真实密码写入命令历史。初始化成功后，将 Wrangler 输出的
Worker 地址作为桌面端的 `Worker URL`。

验收脚本只需要以下环境变量：

```bash
export CAIRN_SYNC_URL='https://你的-worker.workers.dev'
export CAIRN_SYNC_USERNAME='admin'
read -rsp 'Cairn admin password: ' CAIRN_SYNC_PASSWORD; echo
bun run sync-worker:verify
unset CAIRN_SYNC_PASSWORD
```

脚本会检查 `/api/health`、管理员登录和认证后的 manifest 读取，仅输出状态和图书数量，
不会输出密码、Cookie 或 Token。部署 URL 必须使用 HTTPS；本地 `localhost` 和
`127.0.0.1` 验证允许使用 HTTP。

### 运行规则

- 登录成功后桌面端自动拉取云端最新清单。
- 新生成的图书和完成的 deck 在后台同步到 R2/D1；MP3 音频不会上传或下载。
- 云端版本冲突时优先使用云端版本。
- 网络失败保留本地图书和播放能力，并显示可重试的同步失败状态。
- 桌面端只连接 Worker，不直接连接 D1 或 R2。
