/**
 * 索引：存活探针 App 后端。
 *
 * 目的单一：接住 UI 文档 POST 上来的 Web Locks 探测结果，并让模型用工具读回。
 * 用完整个 App 会卸载，不写任何持久数据（只有一份进程内 Map）。
 *
 * 为什么不用 ctx.storage：本探针刻意不落盘，避免污染用户数据；
 * 进程内 Map 足够（探测当场读回，不需要跨重启）。
 */

const reports = new Map();

export const name = "liveness-probe";

export async function apply(ctx) {
  const appId = "liveness-probe";
  let seq = 0;

  const unregisterRoutes = await ctx.routes.register((app) => {
    // UI 文档把自己的探测结果 POST 上来。key 用文档自己的 docId（随机），
    // 每次覆盖同一条，避免同一文档反复上报堆记录。
    app.post("/api/report", async (c) => {
      let body;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ ok: false, error: "bad json" }, 400);
      }
      if (!body || typeof body !== "object" || typeof body.docId !== "string" || !body.docId) {
        return c.json({ ok: false, error: "docId required" }, 400);
      }
      reports.set(body.docId, {
        docId: body.docId,
        at: Date.now(),
        seq: ++seq,
        ...body,
        // docId 已在 body 里，避免重复字段
        ...(delete body.docId, {}),
      });
      return c.json({ ok: true, recorded: reports.size });
    });

    // 探针面板自己拉一次全量，方便肉眼核对。
    app.get("/api/reports", async (c) => c.json({ ok: true, reports: [...reports.values()] }));
  });

  const disposeToolCard = ctx.tools.register({
    name: "liveness_probe_card",
    description:
      "投递存活探针卡片（临时诊断用）。在聊天流里打开探针卡；把同一张卡拖出成独立窗口后再调用 liveness_probe_report 对比。",
    parameters: { type: "object", properties: {} },
    async execute() {
      return {
        content: [{ type: "text", text: "存活探针卡片已投递。" }],
        details: {
          card: {
            type: "iframe",
            pluginId: appId,
            channel: "app",
            route: "/index.html",
            title: "存活探针",
          },
        },
      };
    },
  });

  const disposeToolReport = ctx.tools.register({
    name: "liveness_probe_report",
    description:
      "读回所有存活探针文档上报的 Web Locks 探测结果（origin / isSecureContext / navigator.locks / query 是否 SecurityError / 跨文档持锁可见性）。",
    parameters: { type: "object", properties: {} },
    async execute() {
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, reports: [...reports.values()] }, null, 2) }] };
    },
  });

  const disposeToolClear = ctx.tools.register({
    name: "liveness_probe_clear",
    description: "清空存活探针已收集的结果（重新做一轮探测前用）。",
    parameters: { type: "object", properties: {} },
    async execute() {
      const n = reports.size;
      reports.clear();
      return { content: [{ type: "text", text: `已清空 ${n} 条探针结果。` }] };
    },
  });

  ctx.logger?.info?.("[liveness-probe] ready");

  return () => {
    reports.clear();
    for (const off of [unregisterRoutes, disposeToolCard, disposeToolReport, disposeToolClear]) {
      try { off?.(); } catch { /* teardown */ }
    }
  };
}

export default { name, apply };
