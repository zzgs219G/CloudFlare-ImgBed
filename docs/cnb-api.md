# CNB 对象存储 API 对接文档

> 供 AI/开发者参考，记录 CNB 渠道的上传/删除接口对接细节

---

## 基础信息

- **API 基础地址**: `https://api.cnb.cool`
- **认证方式**: Bearer Token (`Authorization: Bearer {CNB_TOKEN}`)
- **仓库标识**: 从 `CNB_REPO` 解析，如 `https://cnb.cool/zzgs219/cdn-img.git` → `zzgs219/cdn-img`
- **参考文档**: https://api.cnb.cool/swagger.json (operationId: UploadImgs, DeleteImg, DeleteFile, DeleteAsset)

---

## 环境变量 / 后台配置

| 配置项 | 说明 | 优先级 |
|--------|------|--------|
| `CNB_TOKEN` | CNB 访问令牌 | 环境变量兜底 |
| `CNB_REPO` | 仓库 Git 地址，如 `https://cnb.cool/user/repo.git` | 环境变量兜底 |
| 后台配置 | 网页后台 → 系统配置 → 上传渠道 → CNB，可配置多个渠道（token/repo/name/returnUrl） | **优先使用** |

> 代码中统一逻辑：**优先读后台配置的渠道，回退环境变量**

---

## 上传图片（已实现）

### 接口流程（三步走）

```
1. POST /{repo}/-/upload/imgs     → 申请预签名上传地址
2. PUT  {upload_url}              → 流式上传二进制
3. 返回 assets.path               → 拼接公开 URL
```

### 请求示例

```bash
# ① 申请上传地址
POST https://api.cnb.cool/zzgs219/cdn-img/-/upload/imgs
Authorization: Bearer xxx
Content-Type: application/json
{ "name": "image.webp", "size": 102400 }

# 响应
{
  "upload_url": "https://oss.cnb.cool/...",
  "form": { "key": "xxx", "policy": "xxx", ... },
  "assets": { "path": "zzgs219/cdn-img/uuid.webp" }
}

# ② 上传文件
PUT https://oss.cnb.cool/...
Content-Type: image/webp
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
```

---

## 删除图片（新增实现）

### 接口

```
DELETE /{repo}/-/imgs/{imgPath}
```

### 参数

| 参数 | 来源 | 说明 |
|------|------|------|
| `repo` | CNB_REPO 解析 | 如 `zzgs219/cdn-img` |
| `imgPath` | metadata.CnbFilePath | 如 `zzgs219/cdn-img/uuid.webp` |

### 请求示例

```bash
DELETE https://api.cnb.cool/zzgs219/cdn-img/-/imgs/zzgs219/cdn-img/uuid.webp
Authorization: Bearer xxx
Accept: application/json
```

### 响应

- `200/204` 成功
- 其它：失败，抛出错误

### 代码实现位置

- **API 封装**: `functions/utils/storage/cnbAPI.js` → `deleteImageFromCnb()`
- **删除处理**: `functions/api/manage/delete/[[path]].js` → `deleteCnbFile()`
- **触发时机**: 管理后台删除文件、批量删除、文件夹删除时，自动调用

---

## 删除文件（通用文件，备选）

### 接口

```
DELETE /{repo}/-/files/{filePath}
```

### 适用场景

非图片文件（如 PDF、压缩包等），当前项目主要走图片渠道，**暂不使用**。

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
| `functions/utils/storage/cnbAPI.js` | 核心 API 封装（上传/删除） |
| `functions/api/manage/delete/[[path]].js` | 删除入口，含 `deleteCnbFile()` |
| `functions/api/manage/delete/batch.js` | 批量删除，复用上述逻辑 |
| `functions/upload/index.js` | 上传入口，写入 `CnbFilePath` |

---

## 测试建议

1. 后台配置 CNB 渠道（token + repo）
2. 上传一张图片 → 确认返回 CNB 直链、数据库有 `CnbFilePath`
3. 管理后台删除该图片 → 确认 CNB 侧文件也被删除（访问直链 404）
4. 检查日志：`CNB Delete Failed:` 无报错即成功

---

## 更新记录

- 2025-10-08：新增删除图片接口对接（`deleteImageFromCnb` + `deleteCnbFile`）