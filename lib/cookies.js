/**
 * lib/cookies.js — 播放凭证：读取 / 保存 / 清除 / 验活。
 *
 * v1 用 cookies.env 存网易云 / 腾讯的登录 cookie，用来向 full-url 端点换取
 * 完整音频（绕开试听限制）。
 *
 * v2 安装目录只读，凭证落在可写的 app-data：
 *   app-data/<appId>/cookies.env     NETEASE_COOKIE / TENCENT_COOKIE
 *   app-data/<appId>/bilibili.env    BILIBILI_COOKIE（B站，2026-10-11 起）
 *
 * 为什么 B站单开一个文件：它解锁的是**音源码率层级**（匿名封顶 AAC 192K；
 * 带上 SESSDATA 才会吐 Hi-Res FLAC 30251 / 杜比 30250），与网易云「绕试听
 * 限制」是两件事，分开存方便单独清、也方便 README 分别讲。读取时两文件合并。
 *
 * 格式（每行一条，`#` 开头是注释）：
 *   NETEASE_COOKIE=MUSIC_U=xxx; __csrf=xxx; ...
 *   TENCENT_COOKIE=uin=xxx; qqmusic_key=xxx; ...
 *   BILIBILI_COOKIE=SESSDATA=xxx; bili_jct=xxx; ...
 *
 * 没有文件或没有对应条目 → 空串，调用方自然回退，不报错。
 *
 * ⚠️ 本模块绝不打印 cookie 明文；对外只回显 mask 后的片段。
 */
import fs from "node:fs";
import path from "node:path";

/** 落盘键名 → 存放文件。新增平台时在这里登记。 */
const KEY_FILE = {
  NETEASE_COOKIE: "cookies.env",
  TENCENT_COOKIE: "cookies.env",
  BILIBILI_COOKIE: "bilibili.env",
};

/** 对外的平台别名 → 落盘键名。路由 / 工具都用这套别名。 */
export const PLATFORM_KEY = {
  netease: "NETEASE_COOKIE",
  tencent: "TENCENT_COOKIE",
  bilibili: "BILIBILI_COOKIE",
};

/** 平台别名 → 给人看的名字。 */
export const PLATFORM_LABEL = {
  netease: "网易云音乐",
  tencent: "QQ 音乐",
  bilibili: "B站",
};

function filePathOf(dataDir, key) {
  const file = KEY_FILE[key];
  return file ? path.join(dataDir, file) : "";
}

/** 从一段 .env 文本里抠出 { KEY: value }（忽略注释与空行）。 */
function parseEnv(raw) {
  const out = {};
  for (const line of String(raw || "").split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const val = m[2].trim();
    if (val) out[m[1]] = val;
  }
  return out;
}

/** 合并读取两个文件，返回全部已知键（缺省空串）。 */
export function loadCookies(dataDir) {
  const out = { NETEASE_COOKIE: "", TENCENT_COOKIE: "", BILIBILI_COOKIE: "" };
  for (const file of new Set(Object.values(KEY_FILE))) {
    try {
      const p = path.join(dataDir, file);
      if (!fs.existsSync(p)) continue;
      const parsed = parseEnv(fs.readFileSync(p, "utf8"));
      for (const [k, v] of Object.entries(parsed)) {
        if (k in out) out[k] = v;
      }
    } catch (e) {
      console.warn(`[audio-player] ${file} load failed:`, e?.message);
    }
  }
  return out;
}

/** 写入 / 覆盖某个键，保留文件里的注释与其他条目。 */
export function saveCookie(dataDir, key, value) {
  const file = filePathOf(dataDir, key);
  if (!file) throw Object.assign(new Error(`unknown credential key: ${key}`), { code: 400 });
  const val = String(value || "").trim();
  if (!val) return clearCookie(dataDir, key);

  let lines = [];
  try {
    if (fs.existsSync(file)) lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  } catch { /* 文件不存在，从空开始 */ }

  const re = new RegExp(`^${key}=`);
  let replaced = false;
  const next = lines.map((line) => {
    if (re.test(line.trim())) { replaced = true; return `${key}=${val}`; }
    return line;
  });
  if (!replaced) {
    while (next.length && next[next.length - 1].trim() === "") next.pop();
    next.push(`${key}=${val}`);
    next.push("");
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, next.join("\n"), { encoding: "utf8", mode: 0o600 });
  return { key, file: path.basename(file) };
}

/** 清空某个键（置空行，保留注释与同文件的其他键）。 */
export function clearCookie(dataDir, key) {
  const file = filePathOf(dataDir, key);
  if (!file) throw Object.assign(new Error(`unknown credential key: ${key}`), { code: 400 });
  try {
    if (!fs.existsSync(file)) return { key, file: path.basename(file), cleared: true };
    const re = new RegExp(`^${key}=`);
    const next = fs.readFileSync(file, "utf8").split(/\r?\n/).map((line) => (re.test(line.trim()) ? `${key}=` : line));
    fs.writeFileSync(file, next.join("\n"), { encoding: "utf8", mode: 0o600 });
  } catch (e) {
    throw Object.assign(new Error(`clear failed: ${e?.message}`), { code: 500 });
  }
  return { key, file: path.basename(file), cleared: true };
}

/** 只留首尾各 4 个字符，用于回显确认「存的是不是你那份」。 */
export function maskSecret(value) {
  const s = String(value || "");
  if (s.length <= 10) return s ? "••••" : "";
  return `${s.slice(0, 4)}…${s.slice(-4)}（${s.length} 字符）`;
}

/** 每个平台的「这个 cookie 里必须有什么」——缺了就一定无效，先挡在本地。 */
const REQUIRED_TOKEN = {
  NETEASE_COOKIE: "MUSIC_U",
  TENCENT_COOKIE: "qqmusic_key",
  BILIBILI_COOKIE: "SESSDATA",
};

/** 便宜的形状校验：省掉一次注定失败的往返。返回 null 表示 OK。 */
export function validateShape(key, value) {
  const v = String(value || "").trim();
  if (!v) return "cookie 是空的。";
  const need = REQUIRED_TOKEN[key];
  if (need && !v.includes(`${need}=`)) return `${PLATFORM_LABEL[key]} 的 cookie 里没找到 ${need}，多半是复制漏了。`;
  if (!/[;=]/.test(v)) return "看起来不是 cookie 串（既没有 = 也没有 ;）。";
  return null;
}

/**
 * 验活：拿这份 cookie 去平台问一句「我是谁」。
 * 返回 { ok, message, account? }；网络异常时 ok=false 但 message 说明原因。
 */
export async function probeCookie(ctx, key, value) {
  const v = String(value || "").trim();
  if (!v) return { ok: false, message: "未配置" };

  if (key === "NETEASE_COOKIE") {
    try {
      const res = await ctx.network.fetch("https://music.163.com/api/nuser/account/get", {
        method: "GET",
        headers: {
          Cookie: v,
          Referer: "https://music.163.com",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeoutMs: 10000,
      });
      const data = await res.json().catch(() => null);
      const profile = data?.profile || data?.account || null;
      const name = profile?.nickname || "";
      if (data?.code === 200 && profile) return { ok: true, message: name ? `已登录：${name}` : "已登录", account: name };
      return { ok: false, message: "登录态无效或已过期" };
    } catch (e) {
      return { ok: false, message: `校验失败：${e?.message || e}` };
    }
  }

  if (key === "BILIBILI_COOKIE") {
    try {
      const res = await ctx.network.fetch("https://api.bilibili.com/x/web-interface/nav", {
        method: "GET",
        headers: {
          Cookie: v,
          Referer: "https://www.bilibili.com/",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
        timeoutMs: 10000,
      });
      const data = await res.json().catch(() => null);
      if (data?.code === 0 && data?.data?.isLogin) {
        const vip = Number(data.data.vipStatus) === 1;
        const name = data.data.uname || "";
        return { ok: true, message: `${name ? `已登录：${name}` : "已登录"}${vip ? "（大会员）" : ""}`, account: name, vip };
      }
      return { ok: false, message: "登录态无效或已过期" };
    } catch (e) {
      return { ok: false, message: `校验失败：${e?.message || e}` };
    }
  }

  if (key === "TENCENT_COOKIE") {
    // QQ 的验活要打私有端点，成本高；这里只做形状确认，留给取链时暴露失效。
    return { ok: true, message: "已保存（QQ 音乐暂不做在线验活）" };
  }

  return { ok: false, message: "未知平台" };
}

/**
 * 一次拿全：三个平台的「是否已配 / 掩码 / 验活结果」。
 * 供 UI 与 agent 工具共用。
 */
export async function credentialsStatus(ctx, { probe = true } = {}) {
  const all = loadCookies(ctx.dataDir);
  const out = [];
  for (const [alias, key] of Object.entries(PLATFORM_KEY)) {
    const value = all[key] || "";
    const item = {
      platform: alias,
      label: PLATFORM_LABEL[alias],
      configured: Boolean(value),
      masked: value ? maskSecret(value) : "",
    };
    if (value && probe) {
      const p = await probeCookie(ctx, key, value);
      item.valid = p.ok;
      item.message = p.message;
      if (p.account) item.account = p.account;
    }
    out.push(item);
  }
  return out;
}
