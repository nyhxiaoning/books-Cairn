下面是当前 Cairn Cloudflare Worker 的配置流程。

## 1. 创建 D1 和 R2

在项目根目录执行：

```bash
bun install
bunx wrangler login

bunx wrangler d1 create cairn-sync
bunx wrangler r2 bucket create cairn-book-resources
```

将 `d1 create` 返回的 UUID 填入：

[apps/sync-worker/wrangler.jsonc](/Users/henryheng/Code/personCode/books-Cairn/apps/sync-worker/wrangler.jsonc)

```jsonc
"database_id": "这里填写 D1 返回的 UUID"
```

R2 名称保持：

```jsonc
"bucket_name": "cairn-book-resources"
```

不要把密码、API Token 或 Secret 写进 `wrangler.jsonc`。

## 2. 创建初始化 Secret

这个 Secret 只用于首次创建管理员账号，不是日常登录密码：

```bash
openssl rand -hex 32 | bunx wrangler secret put ADMIN_INIT_SECRET --config apps/sync-worker/wrangler.jsonc
```

因为还会用到密码,注意使用下面的内容更好
```bash
ADMIN_INIT_SECRET="$(openssl rand -hex 32)"

echo "请保存下面的 ADMIN_INIT_SECRET："
echo "$ADMIN_INIT_SECRET"

printf '%s' "$ADMIN_INIT_SECRET" \
  | bunx wrangler secret put ADMIN_INIT_SECRET \
    --config apps/sync-worker/wrangler.jsonc
```


然后执行 migration：

```bash
bunx wrangler d1 migrations apply cairn-sync --remote --config apps/sync-worker/wrangler.jsonc
```

## 3. 部署 Worker 并获取地址

```bash
bunx wrangler deploy --config apps/sync-worker/wrangler.jsonc
```

部署完成后 Wrangler 会输出类似地址：

```text
https://cairn-sync-worker.<account>.workers.dev
```

这个就是桌面端要填写的 Worker 地址：

```text
https://cairn-sync-worker.<account>.workers.dev

https://cairn-sync-worker.henryheng1119.workers.dev
```

生产环境必须使用 HTTPS。

## 4. 初始化管理员账号和密码

先设置环境变量：直接写入如下,不用新建配置文件
export CAIRN_SYNC_URL="https://你的-worker地址.workers.dev"
export CAIRN_ADMIN_INIT_SECRET="前面生成的ADMIN_INIT_SECRET"
export CAIRN_ADMIN_USERNAME="admin"
export CAIRN_ADMIN_PASSWORD="设置一个至少8位的强密码"
export CAIRN_ADMIN_PASSWORD="nyh1139..."
CAIRN_SYNC_PASSWORD
说明
CAIRN_SYNC_URL：Worker 地址，例如 https://cairn-sync-worker.xxx.workers.dev
CAIRN_ADMIN_INIT_SECRET：前面通过 Wrangler 设置的 ADMIN_INIT_SECRET
CAIRN_ADMIN_USERNAME：你要登录系统的管理员账号
CAIRN_ADMIN_PASSWORD：你要登录系统的管理员密码





调用初始化接口：直接使用:

```bash
curl -fsS -X POST "$CAIRN_SYNC_URL/api/auth/init" \
  -H 'content-type: application/json' \
  -H "x-admin-init-secret: $CAIRN_ADMIN_INIT_SECRET" \
  --data "$(CAIRN_INIT_USERNAME="$CAIRN_ADMIN_USERNAME" \
    CAIRN_INIT_PASSWORD="$CAIRN_ADMIN_PASSWORD" \
    bun -e 'console.log(JSON.stringify({
      username: process.env.CAIRN_INIT_USERNAME,
      password: process.env.CAIRN_INIT_PASSWORD
    }))')"
```


curl -fsS -X POST "https://cairn-sync-worker.henryheng1119.workers.dev/api/auth/init" \
  -H 'content-type: application/json' \
  -H "x-admin-init-secret: $CAIRN_ADMIN_INIT_SECRET" \
  --data "$(CAIRN_INIT_USERNAME="$CAIRN_ADMIN_USERNAME" \
    CAIRN_INIT_PASSWORD="$CAIRN_ADMIN_PASSWORD" \
    bun -e 'console.log(JSON.stringify({
      username: process.env.CAIRN_INIT_USERNAME,
      password: process.env.CAIRN_INIT_PASSWORD
    }))')"


export CAIRN_ADMIN_INIT_SECRET="c8364a179b235998e0cc7c79d567c2a5b9be83710134b776893dbd15c2860d3e"
完成后清理环境变量：

```bash
unset CAIRN_ADMIN_INIT_SECRET
unset CAIRN_ADMIN_USERNAME
unset CAIRN_ADMIN_PASSWORD
```

账号要求：

- 用户名：3–128 个字符，只允许小写字母、数字、`.`、`_`、`-`；
- 密码：8–256 个字符；
- 只支持一个管理员账号；
- 如果返回 `admin_exists`，说明管理员已经初始化过。

## 5. 在 Cairn 桌面端登录

打开 Cairn：

1. 进入“设置”；
2. 打开“云端同步”；
3. 填写 Worker URL；
4. 填写刚才初始化的管理员用户名；
5. 填写管理员密码；
6. 点击“配置”或“登录”。

登录成功后会自动：

- 拉取云端书架；
- 下载云端新增书籍；
- 上传本地云端不存在的书籍；
- 云端版本优先覆盖本地冲突版本。

`chapters.json`、`.cache`、原始书籍和聊天记录不会上传。

完整说明见：

[docs/CLOUDFLARE_SYNC.md](/Users/henryheng/Code/personCode/books-Cairn/docs/CLOUDFLARE_SYNC.md)