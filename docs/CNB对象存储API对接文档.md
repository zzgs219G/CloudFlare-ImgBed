# CNB 对象存储 API 对接文档

> 供 AI/开发者参考：CNB 渠道上传/删除的 API 细节与本项目对接实现。
> API 部分依据官方 swagger 实测整理，勿凭猜测修改路径格式。

---

## 0. 通用信息

- **API 根地址**: `https://api.cnb.cool`
- **鉴权方式**: Bearer Token（Header：`Authorization: Bearer <token>`）
- **路径参数 `{repo}` 格式**: `组织名/仓库名`，不带 `.git` 后缀
- **响应类型**: `application/vnd.cnb.api+json` 或 `application/json`
- **官方文档**: https://api.cnb.cool/swagger.json

### Token 所需权限（重要）

| 操作 | 接口 | 所需权限 |
|------|------|---------|
| 上传图片 | `POST /{repo}/-/upload/imgs` | `repo-code:rw` |
| 上传文件 | `POST /{repo}/-/upload/files` | `repo-notes:rw` |
| 删除图片 | `DELETE /{repo}/-/imgs/{imgPath}` | **`repo-manage:rw`** |
| 删除文件 | `DELETE /{repo}/-/files/{filePath}` | **`repo-manage:rw`** |

> ⚠️ 删除权限与上传权限不同。Token 必须勾选 `repo-manage:rw`，否则删除返回 403。上传正常不代表能删除。

---

## 1. 本项目配置方式

| 配置项 | 说明 | 优先级 |
|--------|------|--------|
| `CNB_TOKEN` | CNB 访问令牌 | 环境变量兜底 |
| `CNB_REPO` | 仓库 Git 地址，如 `https://cnb.cool/user/repo.git` | 环境变量兜底 |
| 后台配置 | 网页后台 → 系统配置 → 上传渠道 → CNB，可配多渠道（token/repoUrl/name/returnUrl/uploadMode） | **优先使用** |

> 代码统一逻辑：**优先读后台配置的渠道，回退环境变量**。上传（`fetchUploadConfig`）与删除（`deleteCnbFile`）保持一致。

### CNB 渠道配置项

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `name` | string | 必填 | 渠道显示名称 |
| `token` | string | 必填 | CNB Token |
| `repoUrl` | string | 必填 | 仓库 Git 地址 |
| `returnUrl` | boolean | `true` | `false` 时返回 `/file/` 链接而非 CNB 直链 |
| `uploadMode` | string | `'auto'` | **上传模式**：`'auto'` 自动识别、`'image'` 强制图片接口、`'file'` 强制文件接口 |

### 上传模式判断逻辑（`uploadMode`）

```javascript
const isImageAuto = contentType.startsWith('image/');  // 自动识别
let isImage = isImageAuto;
if (uploadMode === 'image') isImage = true;      // 强制图片接口
else if (uploadMode === 'file') isImage = false; // 强制文件接口
// 'auto' 保持自动识别结果
```

| `uploadMode` | 行为 | 适用场景 |
|--------------|------|----------|
| `'auto'`（默认） | 按 MIME `image/*` 自动判断 | 绝大多数情况 |
| `'image'` | 强制走 `/upload/imgs` | 想让非图片也走图片接口 |
| `'file'` | 强制走 `/upload/files` | 传图片但想按文件原样存储 |

> 后台 CNB 渠道配置里有「上传模式」下拉框（自动识别/强制图片接口/强制文件接口），默认「自动识别」。

---

## 2. 上传文件

```text
POST /{repo}/-/upload/files
operationId: UploadFiles
权限: repo-notes:rw
```

**请求参数**（body: `dto.UploadRequestParams`）：

```json
{
  "name": "文件名",
  "size": 12345,
  "ext": { "key": "value" }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 文件名 |
| `size` | integer | 文件大小（字节） |
| `ext` | object | 扩展信息，键值对 |

**响应 200**（`dto.UploadAssetsResponse`）：

```json
{
  "assets": {
    "content_type": "文件类型",
    "ext": {},
    "name": "文件名",
    "path": "/{slug}/-/assets/xxx/xxx/xxxx-xxx.png",
    "size": 12345
  },
  "form": {},
  "token": "后续确认用 token",
  "upload_url": "预签名上传地址"
}
```

**使用流程**：

1. `POST /{repo}/-/upload/files` 获取 `upload_url`
2. 对 `upload_url` 发起 `PUT`，Body 为文件二进制，设置 `Content-Type`
3. 上传后文件通过 `assets.path` 拼出的访问链接访问

> ⚠️ **注意**：上传返回的 `assets.path` 是 `/-/assets/...` 格式，而删除文件接口要求的是 `/-/files/...` 链接中的 filePath。**不要直接把 assets.path 当作 filePath 使用**（见第 6 节路径转换）。

---

## 3. 上传图片

```text
POST /{repo}/-/upload/imgs
operationId: UploadImgs
权限: repo-code:rw
```

请求参数与响应结构同上传文件，返回 `dto.UploadAssetsResponse`。

**使用流程**：

1. `POST /{repo}/-/upload/imgs` 获取 `upload_url`
2. 对 `upload_url` 发起 `PUT`，Body 为图片二进制，设置 `Content-Type`

> ⚠️ 同上：`assets.path` 不能直接用于删除接口的 `imgPath`。

---

## 4. 删除文件

```text
DELETE /{repo}/-/files/{filePath}
operationId: DeleteRepoFiles
权限: repo-manage:rw
```

| 位置 | 参数 | 说明 |
|------|------|------|
| path | `repo` | 仓库完整路径，`组织名/仓库名` |
| path | `filePath` | **文件访问链接中 `/-/files/` 后面的部分** |

**filePath 提取示例**：

```text
文件访问链接：https://cnb.cool/cnb/feedback/-/files/abc/1234abcd/test.zip
则 filePath = abc/1234abcd/test.zip
```

**说明**：

- 只能删除通过 UploadFiles 上传的附件
- 不能删除 Release 和 Commit 附件
- 无批量删除参数

---

## 5. 删除图片

```text
DELETE /{repo}/-/imgs/{imgPath}
operationId: DeleteRepoImgs
权限: repo-manage:rw
```

| 位置 | 参数 | 说明 |
|------|------|------|
| path | `repo` | 仓库完整路径，`组织名/仓库名` |
| path | `imgPath` | **图片访问链接中 `/-/imgs/` 后面的部分** |

**imgPath 提取示例**：

```text
图片访问链接：https://cnb.cool/cnb/feedback/-/imgs/abc/1234abcd.png
则 imgPath = abc/1234abcd.png
```

**说明**：

- 只能删除通过 UploadImgs 上传的图片
- 无批量删除参数

---

## 6. 路径转换（本项目核心，勿改动）

**metadata 里存的 `CnbFilePath` 是上传返回的 `assets.path`**，形如：

```text
/zzgs219/cdn-img/-/assets/2025/10/uuid.png
```

而删除接口需要 `/-/imgs/` 或 `/-/files/` 之后的**相对路径**。本项目由 `extractDeletePath()` 统一转换（`functions/utils/storage/cnbAPI.js`）：

```text
存储值:  /zzgs219/cdn-img/-/assets/2025/10/uuid.png
                ↓ extractDeletePath() 剥离 /-/assets/ 前缀
相对路径: 2025/10/uuid.png
                ↓ encodeAssetPath() 按段编码（保留斜杠）
删除 URL: https://api.cnb.cool/zzgs219/cdn-img/-/files/2025/10/uuid.png
```

兼容四种历史格式：含 `/-/assets/` 标记、含 `/-/imgs/`/`/-/files/` 标记、纯 `{slug}/` 前缀、已是相对路径。

> ⚠️ 两个历史 bug 教训：
> 1. 不要把 `assets.path` 原样传给删除接口（路径重复）
> 2. 不要用 `encodeURIComponent` 编码整段路径（斜杠会被编成 `%2F`），必须按段编码

---

## 7. 存储的元数据

上传成功后写入数据库 metadata：

```javascript
metadata.Channel = "CNB";
metadata.ChannelName = "渠道名称";   // 后台配置的 name 或 "CNB_env"
metadata.CnbFilePath = "/zzgs219/cdn-img/-/assets/xxx/xxx/uuid.png";  // assets.path 原始值，删除时需转换
metadata.CnbUrl = "https://cnb.cool/zzgs219/cdn-img/-/assets/...";   // 公开直链
metadata.FileType = "image/webp";    // 原始 MIME，删除时用于选 imgs/files 接口
```

---

## 8. 关键区别与常见陷阱

| 项目 | 上传文件 | 上传图片 | 删除文件 | 删除图片 |
|------|---------|---------|---------|---------|
| 方法 | POST | POST | DELETE | DELETE |
| 路径 | `/{repo}/-/upload/files` | `/{repo}/-/upload/imgs` | `/{repo}/-/files/{filePath}` | `/{repo}/-/imgs/{imgPath}` |
| 路径前缀 | `/-/upload/files` | `/-/upload/imgs` | `/-/files/` | `/-/imgs/` |
| 权限 | `repo-notes:rw` | `repo-code:rw` | `repo-manage:rw` | `repo-manage:rw` |

**最容易犯的错误**：

1. 把 `filePath` 和 `imgPath` 搞混（图片走 imgs、文件走 files，按 `FileType` 判断）
2. 把上传返回的 `assets.path`（`/-/assets/...`）直接用于删除接口 → **必须先转换**
3. 以为有批量删除接口（没有，只能客户端循环）
4. Token 只给了上传权限没给 `repo-manage:rw` → 删除 403

**错误码处理**：

- `401`：未鉴权
- `403`：无权限（检查 token 是否含 `repo-manage:rw`）
- `404`：资源不存在（可视为已删除，忽略）
- `422`：Release/Commit 附件不能用 DeleteAsset
- `429`：限流，需重试
- `5xx`：服务端错误，需重试

---

## 9. 批量删除方案（暂未使用）

CNB 无批量删除接口。备选方案：

**方案 A：ListAssets + DeleteAsset**（按 record_type 过滤，`slug_img`/`slug_file` 可删，`repo_release`/`repo_commit` 不可删）：

```text
GET  /{slug}/-/list-assets?page=1&page_size=100   (权限: repo-manage:r)
DELETE /{repo}/-/assets/{assetID}                (权限: repo-manage:rw)
```

**方案 B：循环调用删除接口**（本项目当前做法，按文件逐个删）：

```text
循环 DELETE /{repo}/-/files/{filePath}
循环 DELETE /{repo}/-/imgs/{imgPath}
```

注意：无事务，部分成功正常；404 视为已删除；注意限流。

---

## 10. 代码实现位置

| 文件 | 作用 |
|------|------|
| `functions/utils/storage/cnbAPI.js` | 核心 API 封装：`uploadImageToCnb` / `uploadFileToCnb`（上传）、`extractDeletePath` / `encodeAssetPath`（路径转换）、`deleteImageFromCnb` / `deleteFileFromCnb`（删除） |
| `functions/upload/index.js` | 上传入口：`uploadFileToCnbChannel()` 按 `uploadMode` + `FileType` 分发 |
| `functions/api/manage/delete/[[path]].js` | 删除入口：`deleteCnbFile()` 读后台配置（`JSON.parse` 后取 `cnb.channels`）+ 按 `FileType` 分发；CNB 删除失败会阻止数据库删除 |
| `functions/api/manage/delete/batch.js` | 批量删除，复用 `deleteFile()` |

---

## 11. curl 示例

```bash
# 上传文件：① 获取 upload_url
curl -X POST "https://api.cnb.cool/{repo}/-/upload/files" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"test.zip","size":12345,"ext":{}}'

# 上传文件：② PUT 到预签名地址
curl -X PUT "$UPLOAD_URL" \
  -H "Content-Type: application/zip" \
  --data-binary @test.zip

# 上传图片：① 获取 upload_url
curl -X POST "https://api.cnb.cool/{repo}/-/upload/imgs" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"test.png","size":12345,"ext":{}}'

# 删除文件（filePath = 访问链接 /-/files/ 之后的部分）
curl -X DELETE "https://api.cnb.cool/{repo}/-/files/abc/1234abcd/test.zip" \
  -H "Authorization: Bearer $TOKEN"

# 删除图片（imgPath = 访问链接 /-/imgs/ 之后的部分）
curl -X DELETE "https://api.cnb.cool/{repo}/-/imgs/abc/1234abcd.png" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 更新记录

- 2025-10-09（三）：删除功能修复完成（详见《历史修改.md》问题 2）；合并两份 CNB 文档为一份
- 2025-10-09（二）：按 swagger 更正 `assets.path` 格式（`/-/assets/...`）、删除路径提取规则、权限说明
- 2025-10-09：新增通用文件上传/删除支持，上传/删除自动按 `FileType` 分发
- 2025-10-08：新增删除图片接口对接
