/**
 * CNB 图片上传(搬运自用户项目 my-app/worker/cnb.ts,已验证可用)
 *
 * CNB OpenAPI 三步上传,全程零 git 操作:
 *   ① POST /{repo}/-/upload/imgs          → 拿预签名 upload_url + form 参数
 *   ② PUT  {upload_url}(带 form 头)       → 流式上传图片二进制
 *   ③ 返回 assets.path,拼成公开 URL
 *
 * 环境变量(在 Cloudflare Pages 后台 → 设置 → 环境变量 配置):
 *   CNB_TOKEN — CNB 访问令牌
 *   CNB_REPO  — 仓库 git 地址,如 https://cnb.cool/zzgs219/cdn-img.git
 * 参考文档:https://api.cnb.cool/swagger.json(operationId: UploadImgs)
 */

/** https://cnb.cool/zzgs219/cdn-img.git → zzgs219/cdn-img */
function repoSlug(repoUrl) {
    const m = /https?:\/\/[^/]+\/(.+?)(?:\.git)?\/?$/.exec(repoUrl);
    if (!m) throw new Error(`无法从 CNB_REPO 解析仓库路径: ${repoUrl}`);
    return m[1];
}

/** https://cnb.cool/zzgs219/cdn-img.git → https://cnb.cool/zzgs219/cdn-img */
function repoPage(repoUrl) {
    return repoUrl.replace(/\.git$/, '');
}

/** https://cnb.cool/zzgs219/cdn-img.git → https://cnb.cool */
function repoOrigin(repoUrl) {
    const m = /^(https?:\/\/[^/]+)/.exec(repoUrl);
    if (!m) throw new Error(`无法从 CNB_REPO 解析站点地址: ${repoUrl}`);
    return m[1];
}

/**
 * 上传文件到 CNB（通用文件接口）
 * @param {Object} opts
 * @param {string} opts.repoUrl - CNB_REPO 环境变量
 * @param {string} opts.token - CNB_TOKEN 环境变量
 * @param {string} opts.fileName - 原始文件名
 * @param {Uint8Array} opts.content - 文件二进制
 * @param {string} opts.contentType - MIME 类型
 * @returns {Promise<{url: string, name: string, size: number, path: string}>}
 */
export async function uploadFileToCnb(opts) {
    const slug = repoSlug(opts.repoUrl);

    // ① 申请预签名上传地址（通用文件接口）
    const applyResp = await fetch(`https://api.cnb.cool/${slug}/-/upload/files`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${opts.token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify({ name: opts.fileName, size: opts.content.byteLength }),
    });
    if (!applyResp.ok) {
        const text = await applyResp.text().catch(() => '');
        throw new Error(`CNB 申请上传地址失败(HTTP ${applyResp.status})${text.slice(0, 200)}`);
    }
    const apply = await applyResp.json();

    // ② 用预签名地址流式上传二进制
    const putResp = await fetch(apply.upload_url, {
        method: 'PUT',
        headers: {
            ...(apply.form ?? {}),
            'Content-Type': opts.contentType,
        },
        body: opts.content,
    });
    if (!putResp.ok) {
        const text = await putResp.text().catch(() => '');
        throw new Error(`CNB 上传文件失败(HTTP ${putResp.status})${text.slice(0, 200)}`);
    }

    // ③ 拼公开 URL
    const path = apply.assets?.path;
    if (!path) throw new Error('CNB 返回缺少 assets.path');
    const slugPrefix = `/${slug}/`;
    const base = path.startsWith(slugPrefix) ? repoOrigin(opts.repoUrl) : repoPage(opts.repoUrl);
    const storedName = path.split('/').pop() || opts.fileName;
    return {
        url: `${base}${path}`,
        name: storedName,
        size: opts.content.byteLength,
        path,
    };
}

/**
 * 上传图片到 CNB（图片专用接口，可能有压缩/缩略图等优化）
 * @param {Object} opts
 * @param {string} opts.repoUrl - CNB_REPO 环境变量
 * @param {string} opts.token - CNB_TOKEN 环境变量
 * @param {string} opts.fileName - 原始文件名(仅作 multipart 元数据)
 * @param {Uint8Array} opts.content - 文件二进制
 * @param {string} opts.contentType - MIME 类型
 * @returns {Promise<{url: string, name: string, size: number, path: string}>}
 *   url - 图片公开访问 URL;path - assets.path(存 metadata.CnbUrl 用)
 */
export async function uploadImageToCnb(opts) {
    const slug = repoSlug(opts.repoUrl);

    // ① 申请预签名上传地址（图片专用接口）
    const applyResp = await fetch(`https://api.cnb.cool/${slug}/-/upload/imgs`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${opts.token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify({ name: opts.fileName, size: opts.content.byteLength }),
    });
    if (!applyResp.ok) {
        const text = await applyResp.text().catch(() => '');
        throw new Error(`CNB 申请上传地址失败(HTTP ${applyResp.status})${text.slice(0, 200)}`);
    }
    const apply = await applyResp.json();

    // ② 用预签名地址流式上传二进制(PUT,带表单参数)
    const putResp = await fetch(apply.upload_url, {
        method: 'PUT',
        headers: {
            ...(apply.form ?? {}),
            'Content-Type': opts.contentType,
        },
        body: opts.content,
    });
    if (!putResp.ok) {
        const text = await putResp.text().catch(() => '');
        throw new Error(`CNB 上传图片失败(HTTP ${putResp.status})${text.slice(0, 200)}`);
    }

    // ③ 拼公开 URL:assets.path 可能已含仓库 slug 前缀,分别用 origin 或仓库页地址拼接
    const path = apply.assets?.path;
    if (!path) throw new Error('CNB 返回缺少 assets.path');
    const slugPrefix = `/${slug}/`;
    const base = path.startsWith(slugPrefix) ? repoOrigin(opts.repoUrl) : repoPage(opts.repoUrl);
    // 存储文件名由 CNB 对象存储生成(UUID),从 assets.path 末段提取
    const storedName = path.split('/').pop() || opts.fileName;
    return {
        url: `${base}${path}`,
        name: storedName,
        size: opts.content.byteLength,
        path,
    };
}

/**
 * 从上传返回的 assets.path 提取删除接口所需的相对路径
 * CNB 删除接口要求传「访问链接中 /-/imgs/ 或 /-/files/ 之后的部分」
 * 参考: https://api.cnb.cool swagger - DeleteRepoImgs / DeleteRepoFiles
 *   示例: 链接 https://cnb.cool/{repo}/-/imgs/abc/123.png → imgPath = abc/123.png
 * assets.path 形如 `{repo}/abc/123.png`（含 repo 前缀），需去掉
 */
function extractDeletePath(fullPath, slug) {
    let p = (fullPath || '').replace(/^\/+/, '');
    // 已含 /-/imgs/ 或 /-/files/ 标记 → 取标记之后的部分
    for (const marker of ['/-/imgs/', '/-/files/']) {
        const idx = p.indexOf(marker);
        if (idx !== -1) return p.slice(idx + marker.length);
    }
    // 否则去掉 repo slug 前缀（org/repo）
    const prefix = `${slug}/`;
    if (p.startsWith(prefix)) return p.slice(prefix.length);
    return p;
}

/** 按路径段编码（保留 / 分隔符，encodeURIComponent 会把 / 也编码掉） */
function encodeAssetPath(p) {
    return p.split('/').map(encodeURIComponent).join('/');
}

/**
 * 从 CNB 删除图片
 * @param {Object} opts
 * @param {string} opts.repoUrl - CNB_REPO 环境变量
 * @param {string} opts.token - CNB_TOKEN 环境变量（需 repo-manage:rw 权限）
 * @param {string} opts.filePath - CNB 存储路径 (metadata.CnbFilePath)
 * @returns {Promise<boolean>} 删除是否成功
 */
export async function deleteImageFromCnb(opts) {
    const slug = repoSlug(opts.repoUrl);
    const imgPath = extractDeletePath(opts.filePath, slug);
    // 删除接口: DELETE /{repo}/-/imgs/{imgPath}
    const deleteUrl = `https://api.cnb.cool/${slug}/-/imgs/${encodeAssetPath(imgPath)}`;
    
    const resp = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
            Authorization: `Bearer ${opts.token}`,
            Accept: 'application/json',
        },
    });
    
    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`CNB 删除图片失败(HTTP ${resp.status})${text.slice(0, 200)}`);
    }
    
    return true;
}

/**
 * 从 CNB 删除文件(通用文件)
 * @param {Object} opts
 * @param {string} opts.repoUrl - CNB_REPO 环境变量
 * @param {string} opts.token - CNB_TOKEN 环境变量（需 repo-manage:rw 权限）
 * @param {string} opts.filePath - CNB 存储路径
 * @returns {Promise<boolean>} 删除是否成功
 */
export async function deleteFileFromCnb(opts) {
    const slug = repoSlug(opts.repoUrl);
    const filePath = extractDeletePath(opts.filePath, slug);
    // 删除接口: DELETE /{repo}/-/files/{filePath}
    const deleteUrl = `https://api.cnb.cool/${slug}/-/files/${encodeAssetPath(filePath)}`;
    
    const resp = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
            Authorization: `Bearer ${opts.token}`,
            Accept: 'application/json',
        },
    });
    
    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`CNB 删除文件失败(HTTP ${resp.status})${text.slice(0, 200)}`);
    }
    
    return true;
}
