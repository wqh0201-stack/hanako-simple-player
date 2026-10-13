# Audio owner 1.1.1 开工基线（只读源码）

证据目录：`baseline-20261013T054623966657Z`。未覆盖先前在途目录，未修改源码、断言或构建号。

## 真实执行结果

| 原命令 | 完成结果 | 退出码 | 失败集合 |
| --- | --- | --- | --- |
| `node tools/verify-backend.mjs` | 102/102 | 0 | 空 |
| `node tools/verify-ui.mjs` | assertions 376/376；selfCheck 12/12；narrowSelfCheck 4/4 | 0 | 空 |

UI 的 wiring、migration、lifecycle 全为 true，runtimeErrors 为空。任务书记录的 366/367 是此前已知基线；本次实跑实际计数为 376/376，未据此改测试。既有 flaky `ripple-max-midhigh-keeps-steady-and-silence-quiet` 本次通过，原始断言结果见 `failure-set.json`。

## 原始输出与环境

- `verify-backend.stdout.log` / `verify-backend.stderr.log`：完整 stdout / stderr，未加工；`verify-backend.run.json` 保存原命令、起止时间与退出码。
- `verify-ui.stdout.log` / `verify-ui.stderr.log`：完整 stdout / stderr，未加工；`verify-ui.run.json` 保存原命令、起止时间、退出码和唯一 OUT_DIR。
- `ui-artifacts/verify.json`：UI 完整原始 JSON 报告；同目录 PNG 为该次运行截图。
- `environment.json`：Node / Chrome / Puppeteer / 平台、HEAD、开工 git status、manifest、build 和源码 SHA256。
- `source-unchanged.json`：基线前后源码与脚本哈希一致。
- `failure-set.json`：本次失败集合和既有 flaky 的原始实际断言结果。
- `evidence-sha256.json`：日志与 UI 原始报告的 SHA256。

UI 首次在沙箱内绑定 127.0.0.1 被 EPERM 拒绝，未开始断言。该尝试完整保留为 `verify-ui.sandbox.*`，不计入断言失败集合。随后申请 require_escalated 获自动审核批准，运行原命令；只用 OUT_DIR 隔离产物路径。已核对脚本内 OUT_DIR 只用于目录创建、截图路径、报告路径及最终 outDir 字段，不影响测试条件。

Node v22.22.2；Chrome 155.0.8059.40；puppeteer-core 23.11.1；manifest 1.1.0；build 1003131675；HEAD c0daa737a7a2b41de0f3bf70e32d7e1adc32482a。
