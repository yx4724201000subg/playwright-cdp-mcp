# AGENTS.md

本文件为在本仓库工作的 Agent（含 opencode）提供执行规则。所有规则必须遵守。

## Git 操作

- 身份已配置：`user.name=yx4724201000subg`，`user.email=yx4724201000subg@users.noreply.github.com`。
- 远端：`origin` → `https://github.com/yx4724201000subg/playwright-cdp-mcp.git`，默认分支 `dev`。
- 凭据：通过 `gh` 作为 git credential helper 提供，配置为：
  ```
  git config --local credential.https://github.com.helper '!GH_CONFIG_DIR=/root/.config/gh-yx4724201000subg gh auth git-credential'
  ```
  `gh` 登录信息位于 `GH_CONFIG_DIR=/root/.config/gh-yx4724201000subg`。若凭据失效，重新登录：
  ```bash
  GH_CONFIG_DIR=/root/.config/gh-yx4724201000subg gh auth login
  ```
- 提交信息遵循 [CLAUDE.md](CLAUDE.md) 中的语义化约定：`label(scope): description`，labels 为 `fix`/`feat`/`chore`/`docs`/`test`/`devops`。禁止添加 `Co-Authored-By` agents。
- 推送前不要 force-push、不要改 git config、不要用交互式 `-i`。
- **代码改完后必须提交并推送到 `origin dev`**（除非用户明确说不要）。流程：
  ```bash
  git status
  git diff
  git add <相关文件>
  git commit -m "label(scope): 描述"
  git push origin dev
  ```

## 网络 / 代理

- 仓库克隆已成功，直连可用。若遇到网络问题，可使用以下代理之一：
  - SOCKS5：`socks5://127.0.0.1:2090`
  - HTTP：`http://127.0.0.1:2091`
- 临时为单条 git 命令启用代理：
  ```bash
  # HTTPS over HTTP 代理
  https_proxy=http://127.0.0.1:2091 git push origin dev
  # 或 socks5
  https_proxy=socks5://127.0.0.1:2090 git push origin dev
  ```
- 为仓库持久配置代理（按需，默认不配）：
  ```bash
  git config --local http.proxy http://127.0.0.1:2091
  git config --local --unset http.proxy   # 取消
  ```
- `gh` 命令如需代理：`HTTPS_PROXY=http://127.0.0.1:2091 GH_CONFIG_DIR=/root/.config/gh-yx4724201000subg gh ...`

## 进程 Kill 安全规则

**核心要求**：杀任何进程前，必须先查看该进程的完整命令行参数（带全部参数），确认无误后才能执行。严禁跳过此步骤。

### 绝对禁止
- 严禁 `taskkill /F /IM node.exe`、`killall node`、`pkill node` 等 broad kill 命令。

### 杀进程前必须做的事
1. **必须先查看完整命令行**：
   - Linux/macOS：`ps auxww` 或 `pgrep -a -f <pattern>`
   - Windows：`Get-CimInstance Win32_Process` 或 `wmic process get CommandLine`
2. **特别小心 node 和 opencode 相关进程**：
   - 凡是包含 `node` 的进程，必须额外确认它**不是 OpenCode 自身**，否则严禁杀死。
   - OpenCode 运行时涉及的 node 进程禁止杀死。

### 推荐的安全做法
- 使用精确匹配：`pkill -f "next dev"`、`pkill -f "vite"`
- 实在要杀 node 进程时，必须先确认完整命令行，且明确排除 OpenCode 相关进程。

**总结**：看完整命令行 → 确认不是 OpenCode/node 自身 → 再精准 kill。

## 后台命令执行指引

- **禁止使用 `nohup xxx &`**：任何情况下不得通过 `nohup` 与后台符号 `&` 运行进程，这种方式不可控且不安全。
- **必须使用 `systemd-run`**：所有后台执行的命令必须通过 `systemd-run` 启动，例如：
  ```bash
  systemd-run --unit=example-service \
      --working-directory=/opt/example \
      --setenv=PATH=/usr/local/bin:/usr/bin:/bin \
      /usr/bin/example-command --flag
  ```
- **限制参数**：除非必要，禁止在 `systemd-run` 中使用 `--scope` 或 `--user` 参数。
- **使用场景**：`systemd-run` 在非必要情况下不得出现在脚本中，仅限 Agent 的 Shell 工具在临时操作时使用。
- **日志与追踪**：后台命令必须由 systemd 管理，确保有日志、状态与清理机制，禁止孤儿进程存在。

## 代码质量

- 改完代码后，若仓库提供了 `lint` / `typecheck` 命令（见 `package.json` 的 `scripts`），必须运行确认通过后再提交。
- 本仓库的 MCP 源码改动直接在 `playwright/packages/playwright-core/src/tools/` 下编辑（git subtree，非 patch）。改完源码后**必须** `npm run build:pw` 重建 `lib/coreBundle.js` + `lib/utilsBundle.js`，否则改动不生效（这些 `lib/` 目录是 gitignored，不进 commit）。
- 关键脚本：
  - `npm run build:pw` — 重建 bundle（esbuild 秒级）。
  - `node scripts/direct-mcp-multi-cdp-check.mjs` — 端到端多 CDP 验证，应输出 `DIRECT_MULTI_CDP_OK`。
  - `npm run lint` — 从 bundle 抽取工具元数据刷新 README。
- 本 fork vs 上游的 TS 改动集中在 `playwright/packages/playwright-core/src/` 和 `playwright/packages/utils/network.ts`（见 [CONTRIBUTING.md](CONTRIBUTING.md) 的完整文件清单），改动必须保持精简、有注释，方便 subtree 升级时 rebase。
- 禁止在代码中添加注释，除非用户明确要求。但本 fork 维护的 6 个 TS 改动属于例外 —— 它们标记了 "dynamic CDP" 的关键逻辑，必须保留注释。
- 遵循仓库现有代码风格与约定。
