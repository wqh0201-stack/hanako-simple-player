/** /mood 的 slash_result 不进历史；提示必须让用户下一句自带建单意图。 */
export const MOOD_PROMPT = "想听什么状态？单独发一条普通消息告诉我（别写在 /mood 后面），例如「今天很累，帮我建个安静的心情歌单」，我就去选歌建单。";

export function createMoodCommand(ctx) {
  let off = null, pending = null, confirmed = false, disposed = false;
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
      // 字符串由宿主派发器回给客户端；跨进程 invocation 不依赖 reply 函数。
      handler() { return MOOD_PROMPT; },
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
