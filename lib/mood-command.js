import fs from "node:fs";

/** 跨归属投递失败时仍保留提示牌；slash_result 本身不进历史。 */
export const MOOD_PROMPT = "想听什么状态？单独发一条普通消息告诉我（别写在 /mood 后面），例如「今天很累，帮我建个安静的心情歌单」，我就去选歌建单。";

function realPath(value) {
  try { return typeof value === "string" && value ? fs.realpathSync(value) : null; }
  catch { return null; } // 路径暂不存在或 AppHost 不可读时仍可精确比较原串，不能猜会话。
}

export function createMoodCommand(ctx) {
  let off = null, pending = null, confirmed = false, disposed = false;
  const fallback = async (reason) => {
    try { await ctx.logger?.warn?.(`[mood] 一步直达降级: ${reason}`); }
    catch { /* 日志失败也不能把用户可用的提示牌变成命令错误。 */ }
    return MOOD_PROMPT;
  };
  const handler = async (invocation) => {
    const sessionPath = invocation?.sessionPath;
    if (typeof sessionPath !== "string" || !sessionPath) return fallback("缺少会话路径");
    let stage = "读取会话列表失败";
    try {
      // slash 没有工具 callToken；先用公共列表换稳定 id，绝不把 path 当发送凭据。
      const result = await ctx.bus.request("session:list", { scope: "all", lifecycle: "active" });
      const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
      const canonical = realPath(sessionPath);
      let target = canonical && sessions.find((x) => realPath(x?.path) === canonical);
      if (!target) target = sessions.find((x) => x?.path === sessionPath);
      if (typeof target?.sessionId !== "string" || !target.sessionId) return fallback("未找到当前会话的稳定标识");
      const args = typeof invocation.args === "string" ? invocation.args : "";
      const text = args
        ? `用户敲了 /mood，并说明：${args}。请据此读他的音乐库、选歌，保存成一个心情歌单；\n需要补充时先问一句。`
        : "用户敲了 /mood，想生成今日心情歌单。请先问他现在想听什么样的状态（一句话就够），\n然后读他的音乐库、选歌，保存成一个心情歌单。";
      stage = "投递会话消息失败";
      const sent = await ctx.bus.request("session:send", { text, sessionId: target.sessionId, scope: "all" });
      if (sent?.accepted !== true) return fallback("会话消息未被接纳");
      // accepted 只证明接纳，不代表模型已回复；成功不另发一个浮提示。
      return undefined;
    } catch (err) {
      // 不打印 RPC 异常原文、args、path 或 token；只保留可安全识别的失败类别。
      const message = String(err?.message || "");
      const cause = message.includes("No models available") ? "（No models available）"
        : message.includes("not authorized") || message.includes("permission") ? "（未授权）" : "";
      return fallback(stage + cause);
    }
  };
  const release = async () => {
    const registration = off;
    off = null;
    if (registration?.disposeAsync) await registration.disposeAsync();
    else registration?.();
  };
  const register = async (withAlias) => {
    off = ctx.commands.register({
      name: "mood", ...(withAlias ? { aliases: ["心情"] } : {}),
      description: "生成今日心情歌单：先按提示说出状态，由当前 agent 选歌建单。",
      usage: withAlias ? "/mood（或 /心情）· 生成今日心情歌单" : "/mood · 生成今日心情歌单",
      handler,
    });
    // raw ctx 的 disposer 也带回执；同步 try/catch 抓不到 RPC 拒绝，必须等 ready。
    if (off?.ready) await off.ready;
  };
  const ensure = () => {
    if (disposed) return Promise.resolve(false);
    if (confirmed) return Promise.resolve(true);
    if (pending) return pending;
    pending = (async () => {
      try {
        // 同版本真实隔离宿主已测 apply → ready → listOwn 成功（MOOD-HOST-PROBE.md）。
        // 先读目录：无 engine 的验证组合不会留下一个注定拒绝的注册去毒化 apply 的排干。
        const before = await ctx.commands.listOwn();
        if (disposed) return false;
        if (!before.some((x) => x.name === "mood")) {
          try { await register(true); }
          catch (err) {
            // 真宿主会整体回滚非法中文别名；只对这个明确拒绝降级，不吞掉其他注册错误。
            if (!String(err?.message || err).includes('could not register command alias "心情"')) throw err;
            await release();
            if (disposed) return false;
            ctx.logger?.warn?.("[mood] 宿主拒绝 /心情 别名，改为仅注册 /mood");
            await register(false);
          }
        }
        if (disposed) { await release(); return false; }
        confirmed = (await ctx.commands.listOwn()).some((x) => x.name === "mood");
        if (!confirmed) throw new Error("/mood 未在 commands.listOwn() 中读回");
        return true;
      } catch (err) {
        try { await release(); } catch { /* 已失败的注册也要清理，不能在重试时留 mood_2。 */ }
        ctx.logger?.warn?.(`[mood] 注册尚未确认: ${err?.message || err}`);
        return false;
      }
    })().finally(() => { pending = null; });
    return pending;
  };
  return {
    ensure,
    dispose() { disposed = true; confirmed = false; off?.(); off = null; },
  };
}
