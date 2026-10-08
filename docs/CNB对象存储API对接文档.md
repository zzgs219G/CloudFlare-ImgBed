# CNB 对象存储 API 对接文档

> 供 AI/开发者参考，记录 CNB 渠道的上传/删除接口对接细节

---

## 基础信息

- **API 基础地址**: `https://api.cnb.cool`
- **认证方式**: Bearer Token (`Authorization: Bearer {CNB_TOKEN}`)
- **仓库标识**: 从 `CNB_REPO` 解析，如 `https://cnb.cool/zzgs219/cdn-img.git` → `zzgs219/cdn-img`
- **参考文档**: https://api.cnb.cool/swagger.json (operationId: UploadImgs, UploadFiles, DeleteImg, DeleteFile, DeleteAsset)

---

## 环境变量 / 后台配置

| 配置项 | 说明 | 优先级 |
|--------|------|--------|
| `CNB_TOKEN` | CNB 访问令牌 | 环境变量兜底 |
| `CNB_REPO` | 仓库 Git 地址，如 `https://cnb.cool/user/repo.git` | 环境变量兜底 |
| 后台配置 | 网页后台 → 系统配置 → 上传渠道 → CNB，可配置多个渠道（token/repo/name/returnUrl/**uploadMode**） | **优先使用** |

> 代码中统一逻辑：**优先读后台配置的渠道，回退环境变量**

### CNB 渠道配置项

每个 CNB 渠道支持以下字段：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `name` | string | 必填 | 渠道显示名称 |
| `token` | string | 必填 | CNB Token |
| `repoUrl` | string | 必填 | 仓库 Git 地址 |
| `returnUrl` | boolean | `true` | `false` 时返回 `/file/` 链接而非直链 |
| `uploadMode` | string | `'auto'` | **上传模式**：`'auto'` 自动识别、`'image'` 强制走图片接口、`'file'` 强制走文件接口 |

---

## 上传接口（自动按文件类型分发 + 可手动指定模式）

### 两个上传端点

| 文件类型 | 接口 | 说明 |
|----------|------|------|
| 图片 (`image/*`) | `POST /{repo}/-/upload/imgs` | 图片专用，可能有压缩/缩略图优化 |
| 非图片 | `POST /{repo}/-/upload/files` | 通用文件上传 |

### 接口流程（三步走，两端点一致）

```
1. POST /{repo}/-/upload/{imgs|files}  → 申请预签名上传地址
2. PUT  {upload_url}                   → 流式上传二进制
3. 返回 assets.path                    → 拼接公开 URL
```

### 请求示例

```bash
# ① 申请上传地址（图片用 imgs，文件用 files）
POST https://api.cnb.cool/zzgs219/cdn-img/-/upload/imgs
Authorization: Bearer xxx
Content-Type: application/json
{ "name": "image.webp", "size": 102400 }

# 或通用文件
POST https://api.cnb.cool/zzgs219/cdn-img/-/upload/files
Authorization: Bearer xxx
Content-Type: application/json
{ "name": "archive.zip", "size": 2048000 }

# 响应结构一致
{
  "upload_url": "https://oss.cnb.cool/...",
  "form": { "key": "xxx", "policy": "xxx", ... },
  "assets": { "path": "zzgs219/cdn-img/uuid.webp" }
}

# ② 上传文件
PUT https://oss.cnb.cool/...
Content-Type: image/webp  # 或 application/zip 等
<binary data>

# ③ 公开访问 URL
https://cnb.cool/zzgs219/cdn-img/zzgs219/cdn-img/uuid.webp
```

### 存储的元数据

上传成功后，写入数据库 metadata：
```javascript
metadata.Channel = "CNB";
metadata.ChannelName = "渠道名称";  // 如 "CNB_env" 或后台配置的 name
metadata.CnbFilePath = "zzgs219/cdn-img/uuid.webp";  // assets.path，用于删除
metadata.CnbUrl = "https://cnb.cool/zzgs219/cdn-img/...";  // 公开直链
metadata.FileType = "image/webp";  // 原始 MIME 类型，用于删除时选接口
```

### 上传模式判断逻辑（`uploadMode`）

```javascript
// 优先级：渠道配置 uploadMode > 自动识别
const isImageAuto = contentType.startsWith('image/');  // 自动识别
let isImage = isImageAuto;

if (uploadMode === 'image') isImage = true;      // 强制图片接口
else if (uploadMode === 'file') isImage = false; // 强制文件接口
// 'auto' 时保持自动识别结果
```

| `uploadMode` | 行为 | 适用场景 |
|--------------|------|----------|
| `'auto'` (默认) | 按 MIME `image/*` 自动判断 | 绝大多数情况 |
| `'image'` | 强制走 `/upload/imgs` | 想让非图片也享受图片优化（如压缩） |
| `'file'` | 强制走 `/upload/files` | 传图片但想当文件存、避免被压缩 |

> 前端后台配置 CNB 渠道时，可在渠道设置里看到 `uploadMode` 下拉选项（自动/图片/文件），默认 `自动`。

---

## 删除接口（自动按文件类型分发）

### 两个删除端点

| 文件类型 | 接口 | 说明 |
|----------|------|------|
| 图片 (`image/*`) | `DELETE /{repo}/-/imgs/{imgPath}` | 图片专用删除 |
| 非图片 | `DELETE /{repo}/-/files/{filePath}` | 通用文件删除 |

### 参数

| 参数 | 来源 | 说明 |
|------|------|------|
| `repo` | CNB_REPO 解析 | 如 `zzgs219/cdn-img` |
| `imgPath` / `filePath` | metadata.CnbFilePath | 如 `zzgs219/cdn-img/uuid.webp` |

### 请求示例

```bash
# 删除图片
DELETE https://api.cnb.cool/zzgs219/cdn-img/-/imgs/zzgs219/cdn-img/uuid.webp
Authorization: Bearer xxx
Accept: application/json

# 删除通用文件
DELETE https://api.cnb.cool/zzgs219/cdn-img/-/files/zzgs219/cdn-img/archive.zip
Authorization: Bearer xxx
Accept: application/json
```

### 代码实现位置

- **API 封装**: `functions/utils/storage/cnbAPI.js`
  - `uploadImageToCnb()` - 图片上传
  - `uploadFileToCnb()` - 通用文件上传
  - `deleteImageFromCnb()` - 图片删除
  - `deleteFileFromCnb()` - 通用文件删除
- **上传分发**: `functions/upload/index.js` → `uploadFileToCnb()` 根据 `FileType` 自动选择
- **删除分发**: `functions/api/manage/delete/[[path]].js` → `deleteCnbFile()` 根据 `FileType` 自动选择

---

## 删除 Asset 记录（暂不使用）

### 接口

```
DELETE /{repo}/-/assets/{assetID}
```

### 说明

删除对象存储的 asset 元数据记录，**当前无此需求**，暂不实现。

---

## 关键代码文件

| 文件 | 作用 |
|------|------|
| `functions/utils/storage/cnbAPI.js` | 核心 API 封装（上传/删除，图片+文件） |
| `functions/upload/index.js` | 上传入口，按 `FileType` 自动分发 |
| `functions/api/manage/delete/[[path]].js` | 删除入口，按 `FileType` 自动分发 |
| `functions/api/manage/delete/batch.js` | 批量删除，复用上述逻辑 |

---

## 测试建议

1. 后台配置 CNB 渠道（token + repo）
2. **上传图片** → 确认返回 CNB 直链、数据库有 `CnbFilePath`、`FileType=image/...`
3. **上传 zip/pdf 等非图片** → 确认上传成功、数据库有 `CnbFilePath`、`FileType=application/...`
4. **删除图片** → 确认 CNB 侧文件也被删除（访问直链 404）
5. **删除非图片** → 确认 CNB 侧文件也被删除
6. 检查日志：`CNB Delete Failed:` / `CNB upload error:` 无报错即成功

---

## 更新记录

- 2025-10-09：新增通用文件上传/删除支持（`uploadFileToCnb`、`deleteFileFromCnb`），上传/删除自动按 `FileType` 分发
- 2025-10-08：新增删除图片接口对接（`deleteImageFromCnb` + `deleteCnbFile`）