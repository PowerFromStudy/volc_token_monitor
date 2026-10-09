# volc-token-monitor

火山引擎（Volcengine）AI 套餐用量监控与 Key 管理桌面应用（Electron）。

## 功能特性

- **桌面悬浮球**：三层用量环（5 小时 / 周期 / 月度）实时展示**当前激活 Key** 的用量占比，按阈值变色（绿 → 黄 → 红），可拖拽、点击展开面板
- **用量监控**：定时轮询所有账号/席位的用量，支持 Coding Plan 与 Agent Plan、个人版（账号级）与企业版（席位级）
- **一键切 Key**：切换时改写 `~/.claude/settings.json` 的 `env` 块（`ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL`），按套餐自动选择接入地址：
  - Coding Plan → `https://ark.cn-beijing.volces.com/api/coding`
  - Agent Plan → `https://ark.cn-beijing.volces.com/api/plan`
  - 只改目标字段，保留 settings.json 其余配置；**对已开启的 Claude Code 会话不生效，新开会话生效**
- **模型切换**：从火山 `ListModelRateLimit` 拉取可用模型列表，切换时同步 `ANTHROPIC_MODEL` 及各档位（OPUS/SONNET/HAIKU/FABLE）默认模型变量
- **告警与自动切换**：用量/到期阈值告警（系统通知），触发自动切换阈值时自动切到余量充足的席位
- **多账号管理**：火山 AK/SK 本地存储（electron-store），支持从火山同步企业席位、手动录入个人版 Key

## 技术栈

Electron 33 · electron-vite · Vue 3（`<script setup>`）· Pinia · TypeScript · axios

## 目录结构

| 目录 | 说明 |
| --- | --- |
| `src/main/` | Electron 主进程（双窗口：悬浮球 80×80 + 面板 380×520、托盘、IPC） |
| `src/main/services/` | 用量轮询（usage-monitor）、告警引擎（alert-engine）、Claude Code 配置写入（claude-settings）、火山 API 客户端（volc-api） |
| `src/preload/` | 预加载脚本，暴露 `window.volc` 安全 IPC API |
| `src/renderer/` | 渲染进程（悬浮球 BallApp / 面板 PanelApp / Pinia store） |
| `src/shared/` | 主渲染共享类型 |
| `out/` | 构建产物（入库） |
| `更新日志.md` | 每次有意义改动的背景/改动/影响记录 |

## 快速开始

```bash
npm install
npm run dev      # 开发模式
npm run build    # 构建到 out/
npm start        # 预览构建产物
```

## 使用说明

1. 在面板「账号管理」添加火山账号的 Access Key / Secret Key
2. 企业版点「同步席位」拉取席位列表；个人版手动录入 ARK_API_KEY
3. 悬浮球点击展开面板，选择 Key 一键切换（写入 `~/.claude/settings.json`）
4. 阈值、轮询间隔、自动切换等在「设置」中调整

## Git 分支策略

GitFlow 三层模型（项目已上线）：

- `master`：永远等于线上版本，只接受测试合并，配 tag 发版
- `develop`：开发集成分支，所有功能/修复分支合到这里
- `feat/*`、`fix/*`、`refactor/*`、`chore/*`：日常工作分支
- `hotfix/*`：线上紧急修复，从 master 拉出、合回 master

> ⚠️ **安全提示**：本仓库为**公开仓库**，严禁提交任何真实 Token、AK/SK、`.env` 等敏感信息。账号凭据仅存于本机 electron-store，不入库。
