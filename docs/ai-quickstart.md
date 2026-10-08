# CloudFlare-ImgBed 项目快速上手指南（AI 专用）

> 目标：让 AI 在 5 分钟内理解项目架构、核心流程、关键文件位置，能独立完成增删改查任务

---

## 1. 项目概览

| 维度 | 说明 |
|------|------|
| **类型** | Cloudflare Pages + Functions 全栈图床 |
| **前端** | Vue 3 + Vite + Element Plus（在 `Sanyue-ImgHub` 仓库） |
| **后端** | Cloudflare Pages Functions（本仓库 `functions/`） |
| **存储** | 多渠道：R2 / S3 / CNB / Discord / HuggingFace / WebDAV / 外链 |
| **数据库** | Cloudflare KV（文件元数据）+ 索引系统 |
| **部署** | `wrangler pages deploy` 或 Git 推送自动部署 |

---

## 2. 目录结构（只看关键路径）

```
CloudFlare-ImgBed/
├── functions/                    # 后端核心（Cloudflare Pages Functions）
│   ├── api/                      # REST API 路由
│   │   ├── auth/                 # 登录/会话
│   │   ├── manage/               # 管理后台 API（需认证）
│   │   │   ├── delete/           # 删除：单个/批量/文件夹
│   │   │   ├── list.js           # 文件列表
│   │   │   ├── metadata/         # 元数据编辑
│   │   │   ├── move/             # 移动文件
│   │   │   ├── rename/           # 重命名
│   │   │   ├── tags/             # 标签管理
│   │   │   ├── sysConfig/        # 系统配置（上传渠道、页面设置等）
│   │   │   └── ...
│   │   ├── channels.js           # 获取可用上传渠道
│   │   ├── public/               # 公开 API
│   │   └── userConfig.js         # 用户配置
│   ├── dav/                      # WebDAV 协议支持
│   ├── file/[[path]].js          # 文件访问/重定向（核心：/file/xxx）
│   ├── random/                   # 随机图片 API
│   ├── upload/                   # 上传入口
│   │   └── index.js              # 统一上传分发（按渠道分发）
│   └── utils/                    # 工具库
│       ├── storage/              # 各存储渠道 SDK
│       │   ├── cnbAPI.js         # 🆕 CNB 上传/删除
│       │   ├── discordAPI.js
│       │   ├── huggingfaceAPI.js
│       │   ├── webdavAPI.js
│       │   └── ...
│       ├── databaseAdapter.js    # KV 数据库统一接口
│       ├── indexManager.js       # 索引管理（列表/统计/搜索）
│       ├── purgeCache.js         # CF 缓存清理
│       ├── metadata/             # 元数据处理
│       └── ...
├── frontend-dist/                # 构建产物（前端打包后放这，由 Functions 托管）
├── database/                     # 数据库迁移/初始化脚本
├── deploy/                       # 部署相关脚本
├── docs/                         # 📚 文档目录
│   ├── cnb-api.md                # CNB 接口对接文档
│   └── 历史修改.md
└── package.json
```

---

## 3. 核心流程图解

### 3.1 上传流程

```
用户上传
    │
    ▼
POST /upload?uploadChannel=cnb
    │
    ▼
functions/upload/index.js → uploadFileToCnb()
    │
    ├─ 读取渠道配置（后台优先 > 环境变量）
    ├─ 调用 cnbAPI.uploadImageToCnb() 三步上传
    │   1. POST /{repo}/-/upload/imgs → 拿预签名 URL
    │   2. PUT {upload_url} → 上传二进制
    │   3. 返回 assets.path + 公开 URL
    │
    ├─ 写入 KV: metadata = { Channel: "CNB", CnbFilePath, CnbUrl, ChannelName }
    │
    └─ 返回 { src: "CNB直链" }（不走 Cloudflare /file/ 路由）
```

### 3.2 删除流程

```
用户删除
    │
    ▼
DELETE /api/manage/delete/{fileId}  或  POST /api/manage/delete/batch
    │
    ▼
functions/api/manage/delete/[[path]].js → deleteFile()
    │
    ├─ 读取 KV 获取 metadata
    ├─ 根据 Channel 分发删除：
    │   ├─ R2: env.img_r2.delete(fileId)
    │   ├─ S3: deleteS3File()
    │   ├─ Discord: deleteDiscordFile()
    │   ├─ HuggingFace: deleteHuggingFaceFile()
    │   ├─ WebDAV: deleteWebDAVFile()
    │   └─ 🆕 CNB: deleteCnbFile() → cnbAPI.deleteImageFromCnb()
    │       DELETE https://api.cnb.cool/{slug}/-/imgs/{CnbFilePath}
    │
    ├─ 删除 KV 记录
    ├─ 清理 CF 缓存 + 列表缓存
    │
    └─ 返回成功/失败
```

### 3.3 文件访问流程（/file/xxx）

```
GET /file/{fileId}
    │
    ▼
functions/file/[[path]].js
    │
    ├─ 读取 KV metadata
    ├─ 如果 Channel === "CNB" 且有 CnbUrl
    │   └─ 302 重定向到 CNB 直链（国内直连）
    ├─ 如果 Channel === "R2/S3/其他"
    │   └─ 从对应存储读取/签名 URL 返回
    └─ 否则 404
```

---

## 4. 关键文件速查表

| 任务 | 核心文件 | 备注 |
|------|----------|------|
| **新增存储渠道** | `functions/upload/index.js` + `functions/utils/storage/xxxAPI.js` + `functions/api/manage/delete/[[path]].js` | 三处必改 |
| **修改上传逻辑** | `functions/upload/index.js` | 统一分发入口 |
| **修改删除逻辑** | `functions/api/manage/delete/[[path]].js` | 单删/批量/文件夹共用 |
| **文件访问/重定向** | `functions/file/[[path]].js` | 核心路由 |
| **列表/搜索/统计** | `functions/utils/indexManager.js` | 索引系统 |
| **数据库操作** | `functions/utils/databaseAdapter.js` | KV 封装 |
| **系统配置** | `functions/api/manage/sysConfig/` | 上传/页面/安全设置 |
| **CNB 专用** | `functions/utils/storage/cnbAPI.js` | 上传/删除封装 |
| **CNB 文档** | `docs/cnb-api.md` | 接口细节 |

---

## 5. 常用开发模式

### 5.1 添加新存储渠道（Checklist）

```mermaid
flowchart TD
    A[新建 utils/storage/xxxAPI.js] --> B[实现 upload/delete 函数]
    B --> C[在 upload/index.js 引入并分发]
    C --> D[在 delete/[[path]].js 添加删除分支]
    D --> E[在 channels.js 暴露渠道名]
    E --> F[在 sysConfig/upload.js 后台配置项]
    F --> G[前端 Sanyue-ImgHub 添加 UI]
```

### 5.2 读取渠道配置的标准模式

```javascript
// 所有渠道统一：优先后台配置，回退环境变量
const settingsKV = await db.get('settings');
let token = null, repo = null;

if (settingsKV?.value?.xxx?.channels?.length > 0) {
    const channel = settingsKV.value.xxx.channels.find(ch => ch.name === channelName) 
                 || settingsKV.value.xxx.channels[0];
    token = channel.token;
    repo = channel.repoUrl;
}
token = token || env.XXX_TOKEN;
repo = repo || env.XXX_REPO;
```

### 5.3 错误处理规范

```javascript
try {
    await xxxAPI.delete(...);
    return true;
} catch (error) {
    console.error("XXX Delete Failed:", error);
    return false;  // 不抛出，让主流程记录失败并继续
}
```

---

## 6. 环境变量清单

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `CNB_TOKEN` | 否* | CNB 令牌（后台配置优先） |
| `CNB_REPO` | 否* | CNB 仓库地址 |
| `R2_BUCKET` | 否 | Cloudflare R2 绑定名 |
| `S3_ENDPOINT` | 否 | S3 兼容存储端点 |
| `DISCORD_BOT_TOKEN` | 否 | Discord Bot Token |
| `HF_TOKEN` | 否 | HuggingFace Token |
| `WEBDAV_URL` | 否 | WebDAV 服务地址 |
| `ADMIN_USERNAME` | 是 | 管理员用户名 |
| `ADMIN_PASSWORD` | 是 | 管理员密码（或哈希） |
| `JWT_SECRET` | 是 | JWT 签名密钥 |

> * 有后台配置时环境变量可不填

---

## 7. 本地开发/调试

```bash
# 安装依赖
npm install

# 本地预览（需 wrangler）
npx wrangler pages dev ./frontend-dist --compatibility-date=2024-01-01

# 或使用开发脚本
npm run dev
```

> ⚠️ Functions 依赖 Cloudflare 绑定（KV、R2、Secrets），本地需配置 `.dev.vars` 或用远程预览

---

## 8. 部署流程

```bash
# 1. 前端构建（在 Sanyue-ImgHub 仓库）
npm run build
# 产物复制到 CloudFlare-ImgBed/frontend-dist/

# 2. 部署 Pages Functions
npx wrangler pages deploy ./frontend-dist --project-name=your-project
# 或 Git push 触发自动部署
```

---

## 9. 常见坑点提醒

| 问题 | 原因 | 解决 |
|------|------|------|
| 删除 CNB 图片不生效 | 没存 `CnbFilePath` | 检查上传时是否写入 metadata |
| 后台配置不生效 | 缓存/部署未更新 | 重新部署 Functions，KV 设置同步需等待 |
| 上传报 401 | Token 过期/权限不足 | 检查 CNB Token 权限（需仓库写入权限） |
| 列表为空/统计不对 | 索引未更新 | 检查 `indexManager.js` 队列消费、手动触发重建 |
| CORS 报错 | 响应头缺失 | 所有 API 统一返回 `corsHeaders` |

---

## 10. AI 协作建议

1. **先读文档**：`docs/cnb-api.md`、`docs/历史修改.md`
2. **找入口**：上传→`upload/index.js`，删除→`delete/[[path]].js`，访问→`file/[[path]].js`
3. **改渠道必改三处**：上传分发、删除分发、渠道列表
4. **保持风格**：错误处理用 `try/catch + console.error + return false`，不抛出
5. **配置优先级**：后台配置 > 环境变量，代码中体现此逻辑
6. **写日志**：关键节点 `console.log/warn/error` 方便排查

---

## 11. 版本/更新记录

| 日期 | 变更 | 涉及文件 |
|------|------|----------|
| 2025-10-08 | 新增 CNB 删除接口对接 | `cnbAPI.js`、`delete/[[path]].js`、`docs/cnb-api.md` |
| 2025-09-22 | CNB 上传直链优化、修复浏览器缓存 404 | `upload/index.js`、前端 `AdminDashBoard.vue` |
| ... | ... | ... |

---

> **一句话心法**：这是个「配置驱动、渠道解耦、KV 为主」的图床，核心逻辑集中在 `functions/upload/` 和 `functions/api/manage/delete/`，其余皆为围绕这两条主线的辅助设施。