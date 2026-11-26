# Cloudflare Worker + D1 + R2 通用接入设计

本文将当前 Cairn 的云端同步实现抽象成一套可以复用到其他项目的
Cloudflare 接入方案，适用于需要登录鉴权、结构化数据保存以及文件上传和下载的应用。

## 一、总体架构

```text
Web / 桌面端 / 移动端
          |
          | HTTPS API
          v
Cloudflare Worker
       |       |
       | D1    | R2
       v       v
   业务元数据  文件对象
```

三者职责必须分开：

- Worker：路由、鉴权、权限、参数校验、版本控制、上传编排和错误返回。
- D1：用户、租户、业务记录、文件元数据、版本号、状态和索引。
- R2：图片、文档、导出文件、媒体等大文件或二进制对象。
- 客户端：本地缓存、上传进度、失败重试和冲突确认。

客户端不能直接访问 D1，也不能持有 R2 的长期访问密钥。

## 二、适用场景

适合以下类型的项目：

- 需要保存 JSON 业务数据；
- 需要保存图片、文档、音频或其他文件；
- 有 Web、桌面端或移动端客户端；
- 需要用户数据隔离；
- 需要断点重试、幂等上传或冲突处理；
- 希望通过边缘 Worker 提供 API，而不维护传统服务器。

如果项目依赖复杂分析、大规模跨区域事务、长时间后台进程或复杂跨表查询，
则应额外考虑外部数据库、队列或异步处理服务。

## 三、必须先确定的系统约束

1. 所有请求在读取或修改私有数据前必须完成鉴权。
2. 所有记录和文件对象必须按用户或租户隔离。
3. D1 元数据是文件所有权和文件状态的事实来源。
4. R2 Object Key 必须由服务端根据经过校验的 ID 生成。
5. 文件未上传并校验成功前，D1 不能把它标记为 `ready`。
6. 所有修改请求都应该携带版本号或幂等键。
7. 云端失败不能破坏客户端已有的本地数据。
8. 密钥不能写入源码、日志、URL、Wrangler 配置或返回 JSON。
9. 解析 JSON 或读取上传体之前必须限制最大字节数。
10. 每种错误都要有稳定的错误代码和安全的提示信息。

## 四、D1 和 R2 的数据边界

### 4.1 D1 保存元数据

通用项目可以从以下表开始：

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE records (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE objects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  object_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id),
  FOREIGN KEY (record_id) REFERENCES records(id)
);

CREATE INDEX records_owner_updated ON records(owner_id, updated_at DESC);
CREATE INDEX objects_record_path ON objects(record_id, object_key);
CREATE INDEX objects_owner_status ON objects(owner_id, status);
```

如果项目存在组织、团队或共享空间，应给所有私有表增加 `tenant_id`，并将
租户 ID 加入唯一约束和索引。只使用用户 ID 不能完整表达组织级隔离。

### 4.2 R2 保存文件

推荐使用服务端生成的固定格式 Object Key：

```text
tenants/{tenantId}/records/{recordId}/objects/{safeRelativePath}
```

客户端传入的路径不能直接拼接到 R2 Key。必须拒绝：

- 绝对路径；
- 反斜杠；
- 空路径段；
- `.` 和 `..`；
- 控制字符；
- 未允许的扩展名。

D1 保存 R2 Key，Worker 在访问 R2 前先通过 D1 验证所有权和权限。

## 五、推荐的 Worker 目录结构

```text
apps/api-worker/
  src/
    index.ts              # Worker 入口和路由分发
    env.ts                # D1、R2、Secret 类型定义
    auth/
      password.ts
      session.ts
      routes.ts
    records/
      routes.ts
      repository.ts
      validation.ts
    objects/
      routes.ts
      keys.ts
      validation.ts
    shared/
      errors.ts
      json.ts
      ids.ts
  migrations/
    0001_initial.sql
    0002_add_object_status.sql
  wrangler.jsonc
  README.md
```

建议保持以下边界：

- 路由只负责 HTTP 输入输出；
- Repository 只负责 SQL；
- validation 只负责数据校验；
- object key 模块只负责路径和 Key 生成；
- error 模块统一错误代码和 HTTP 状态。

## 六、Wrangler 配置

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "example-api-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-01-01",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "example-db",
      "database_id": "<D1 UUID>",
      "migrations_dir": "migrations"
    }
  ],
  "r2_buckets": [
    {
      "binding": "FILES",
      "bucket_name": "example-files"
    }
  ]
}
```

可以放进配置文件的内容：

- Worker 名称；
- D1 数据库名称和 ID；
- R2 Bucket 名称；
- migration 目录；
- 非敏感的部署配置。

不能放进配置文件的内容：

- 管理员密码；
- Session 签名密钥；
- API Token；
- 初始化 Secret；
- R2 Access Key 和 Secret Key。

D1 migration 应该有明确编号，并分别应用到本地和线上数据库。Cloudflare 会在
D1 中记录已经执行的 migration，不应把“Worker 部署成功”当成“线上数据库已升级”。

## 七、账号、Session 和权限

### 7.1 推荐登录流程

```text
POST /api/auth/init
        |
        v
创建第一个管理员，只允许执行一次

POST /api/auth/login
        |
        v
校验密码，生成随机 Session Token
        |
        v
只把 Token 的摘要保存到 D1
```

具体规则：

1. 初始化接口只能成功一次。
2. 密码必须使用带盐的慢速密码哈希算法。
3. Session Token 必须随机、短期、可撤销。
4. D1 只保存 Token 的摘要，不能保存明文 Token。
5. 浏览器使用 Secure、HttpOnly、SameSite Cookie。
6. 桌面端可以使用短期 Bearer Token，并保存在系统保护的应用目录。
7. 登出时撤销服务端 Session。

不要通过重复调用初始化接口实现密码重置。密码找回应设计单独的恢复流程。

### 7.2 权限检查

所有私有查询都必须把当前用户或租户放进 SQL：

```sql
SELECT id, title, version
FROM records
WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL;
```

不要先根据 ID 查询，再在业务代码中决定是否授权。权限条件应该成为查询的一部分。

## 八、API 设计

建议从小而明确的接口开始：

```text
GET    /api/health
POST   /api/auth/init
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/records
GET    /api/records/:recordId
PUT    /api/records/:recordId/manifest
DELETE /api/records/:recordId
PUT    /api/records/:recordId/objects/:path
GET    /api/records/:recordId/objects/:path
DELETE /api/records/:recordId/objects/:path
```

统一错误格式：

```json
{
  "code": "invalid_object_metadata",
  "message": "Object metadata is invalid.",
  "details": { "field": "contentHash" }
}
```

客户端根据 `code` 决定行为，用户根据 `message` 理解问题。不要把堆栈、SQL、Token
或密码校验细节返回给客户端。

## 九、文件上传方案

### 9.1 Worker 代理上传

客户端把文件发给 Worker，Worker 负责：

1. 鉴权和权限检查；
2. 校验路径、Content-Type、声明大小和最大大小；
3. 在硬性限制下读取请求体；
4. 计算或验证 SHA-256；
5. 写入 R2；
6. 写入或更新 D1 文件元数据；
7. 返回文件回执。

这是最容易实现和控制的方式，适合小文件或必须由 Worker 统一校验的桌面端。

### 9.2 R2 预签名 URL

对于大文件，使用两阶段上传：

```text
客户端 -> Worker：申请上传地址
Worker -> 客户端：返回短时效 PUT URL
客户端 -> R2：直接上传文件
客户端 -> Worker：提交上传完成信息、哈希和大小
Worker -> R2：HEAD 校验对象
Worker -> D1：把对象标记为 ready
```

预签名 URL 本质上是 Bearer Token，任何拿到 URL 的人都可以在有效期内使用它。
因此必须：

- 设置较短的有效时间；
- 限制 HTTP 方法；
- 限制对象路径；
- 尽量绑定 Content-Type；
- 浏览器场景配置正确的 CORS；
- 绝不把 R2 长期凭据发给客户端。

R2 Worker Binding 本身不能直接生成预签名 URL，需要通过 S3 兼容客户端或签名库完成。

## 十、Manifest 和同步协议

多个文件组成一个业务对象时，应把“清单”和“文件内容”分开：

```json
{
  "recordId": "record-123",
  "title": "Example",
  "version": 1,
  "baseVersion": 3,
  "objects": [
    {
      "path": "path.json",
      "contentType": "application/json",
      "byteSize": 2048,
      "contentHash": "<64 位小写十六进制字符串>"
    }
  ]
}
```

Manifest 中不能出现文件内容。当前 Cairn 曾经遇到过类似问题：TypeScript 子类型在运行时
额外带有 `bytes` 字段，导致 JSON 清单超过 Worker 的 1 MB 限制。

正确做法是显式构造元数据：

```ts
const resource = {
  path: file.path,
  contentType: file.contentType,
  byteSize: file.byteSize,
  contentHash: file.contentHash,
};
```

不要直接展开可能携带运行时额外字段的文件对象。

### 推荐的版本同步流程

1. 客户端读取云端 Manifest 和版本号。
2. 客户端比较本地和云端的元数据。
3. 两边相同：直接完成，不传输文件。
4. 只有本地有：使用 `baseVersion: 0` 上传。
5. 只有云端有：下载并原子安装。
6. 两边都有但不同：返回冲突或 `409 stale_version`。
7. UI 明确询问用户是否覆盖。
8. 只有用户确认后，才使用当前云端版本号重试覆盖。

不要静默覆盖更新的云端版本。网络超时后的重试必须幂等：相同哈希、相同版本的重复请求
应返回成功，而不是重复创建脏数据。

## 十一、下载和本地安装

Worker 每次下载都必须先根据 D1 验证文件所有权，再读取 R2。

客户端应按以下步骤安装：

1. 获取 Manifest；
2. 只下载允许的对象；
3. 在本地校验字节大小和 SHA-256；
4. 写入临时目录；
5. 完整下载后原子替换本地数据；
6. 安装成功后再更新最后同步时间。

不能把半截下载结果直接替换可用的本地数据。如果某个资源失败，应保留旧版本，
并把同步标记为可重试错误。

## 十二、安全清单

- 生产环境只使用 HTTPS。
- 拒绝 URL 中携带账号密码。
- 密码使用带盐慢速 KDF，不保存明文。
- Session Token 使用随机值、短期有效、可撤销。
- Cookie 登录的修改接口需要 SameSite 和 CSRF 防护。
- CORS 使用明确的来源白名单，不使用带凭据的 `*`。
- 对登录、初始化、上传地址申请和删除接口限流。
- 所有 ID 和对象路径在进入 SQL 或 R2 Key 前完成校验。
- 限制单个文件、单个 Manifest 和单次请求的最大大小。
- 校验 Content-Type、声明大小和文件哈希。
- 所有私有查询都带用户或租户条件。
- 不向客户端返回 D1 或 R2 长期凭据。
- 预签名 URL 采用短有效期，并视为敏感 Bearer Token。
- Secret 不写入源码、`wrangler.jsonc`、日志或 URL。

## 十三、部署流程

### 13.1 一次性创建资源

```bash
bunx wrangler login
bunx wrangler d1 create example-db
bunx wrangler r2 bucket create example-files
```

把 D1 UUID 和 R2 Bucket 名称写入 Wrangler 配置，然后设置 Secret：

```bash
bunx wrangler secret put ADMIN_INIT_SECRET \
  --config apps/api-worker/wrangler.jsonc
```

### 13.2 每次发布

```bash
bun test
bun run typecheck

bunx wrangler d1 migrations apply example-db \
  --remote \
  --config apps/api-worker/wrangler.jsonc

bunx wrangler deploy \
  --config apps/api-worker/wrangler.jsonc

curl -fsS https://example-api-worker.example.workers.dev/api/health
```

Worker 代码和 migration 应来自同一个提交。测试环境和生产环境必须使用不同的 D1、R2
绑定。不要用本地 D1 成功来证明线上 D1 已经升级。

## 十四、测试设计

### 14.1 纯逻辑测试

- ID 和对象路径校验；
- Content-Type 映射；
- Manifest 大小限制；
- Manifest 不携带文件 bytes；
- SHA-256 校验；
- 版本比较和幂等处理；
- 租户权限条件；
- 错误代码映射。

### 14.2 Worker 接口测试

- 未登录返回 401；
- 其他租户不能读取或修改记录；
- 非法 JSON 和超大请求返回明确错误；
- 错误 Content-Type、大小、哈希和路径会被拒绝；
- Manifest 更新对客户端表现为原子操作；
- 旧版本返回 409 和当前云端版本；
- R2 失败时不能创建 `ready` 状态的 D1 记录；
- 删除操作同时处理 D1 元数据和 R2 对象。

### 14.3 客户端测试

- 只有本地数据时可以上传；
- 只有云端数据时可以下载；
- 两边一致时不重复传输；
- 两边冲突时必须确认；
- 显示书籍、资源和整体进度；
- Toast 可以关闭；
- 新状态或新进度可以重新显示 Toast；
- 网络失败时本地内容仍可使用。

## 十五、日志和运维

Worker 应返回 Request ID，并在结构化日志中记录：

- 路由和 HTTP 方法；
- HTTP 状态码和错误代码；
- 脱敏后的用户或租户 ID；
- 记录 ID；
- 字节数和耗时；
- Request ID。

禁止记录：

- 密码；
- Bearer Token；
- Cookie；
- 完整预签名 URL；
- 文件正文；
- 原始上传内容。

建议监控：

- 登录失败次数；
- Manifest 校验失败率；
- 409 冲突次数；
- 5xx 错误率；
- R2 上传和下载失败；
- 长时间处于 `pending` 的上传；
- D1 查询耗时。

## 十六、当前 Cairn 实现对应关系

| 通用设计 | Cairn 当前实现 |
| --- | --- |
| Worker API | `apps/sync-worker/src/index.ts`、`src/sync/routes.ts` |
| D1 元数据 | 书籍、资源、Session、阅读进度表 |
| R2 文件对象 | 允许同步的播放 JSON 和封面资源 |
| 本地 Manifest | `packages/core/src/sync/manifest.ts` |
| 本地 Bundle 导出 | `packages/core/src/sync/local.ts` |
| 冲突处理 | 单本书确认后覆盖云端 |
| 同步进度 | `SyncProgress` 和可关闭的书架 Toast |
| 隐私边界 | 章节正文、缓存、Trace、聊天和 MP3 保留本地 |

Cairn 的关键经验是：同步边界必须显式定义。元数据、文件内容、原始资料和生成缓存不能
混在一个上传请求或同一个存储层中。

## 十七、上线验收标准

一个项目满足以下条件后，才适合正式使用：

- `/api/health` 正常；
- 线上 D1 migration 已执行并可查询；
- D1 和 R2 binding 指向正确环境；
- 初始化和登录流程不会泄露 Secret；
- 每个私有接口都有权限测试；
- 文件上传会校验类型、大小和哈希；
- 重试是幂等的，旧版本会明确返回冲突；
- 网络失败后本地或客户端数据仍然可用；
- 已记录部署、回滚和数据恢复流程；
- 日志和错误响应不包含凭据或文件正文。

## 十八、官方参考

- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare R2 Workers API](https://developers.cloudflare.com/r2/get-started/workers-api/)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
