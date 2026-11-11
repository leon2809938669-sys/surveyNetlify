# 问卷工作台 · 自有服务器版

`aliyun` 分支使用 **React + Node.js 24 + SQLite**，可部署到阿里云 ECS 或其他 Linux 服务器。
运行时不需要 Netlify、Supabase、第三方数据库或外部字体服务。后端仅使用 Node 内置模块。

## 功能

- `/admin`：安全登录、问卷搜索、可视化 / JSON 编辑、导入 / 下载问卷定义、发布 / 关闭、预览、链接与二维码。
- `/s/<slug>`：手机友好的分页填写、条件跳题、日期与自动计算、进度提示、必填检查。
- 填写草稿仅保存在当前标签页的 `sessionStorage`，24 小时失效，成功提交即清除；网络重试不会重复入库。
- 答卷：来源筛选、内容搜索、分页、展开详情、xlsx 导出、单份 / 批量删除。
- 顶部「备份数据」下载完整、可恢复的 JSON；服务器每天生成一致性 SQLite 备份。
- 管理预览需要同一浏览器的登录会话，预览答卷单独标记。预览链接中**没有管理 token**。

## 本地开发

需要 **Node.js 24 LTS**（包含 `node:sqlite`），不支持旧的 Node 18。

```bash
npm ci --ignore-scripts
cp .env.example .env
# 编辑 .env：设置自己的 ADMIN_PASSWORD 和 AUTH_SECRET
npm run dev
```

前端为 `http://127.0.0.1:5173`，`/api` 代理到本机 `4317` 端口。

```bash
npm test
npm run build
npm start
```

构建后访问 `http://127.0.0.1:4317/admin`。所有资源由同一个 Node 服务提供，无需开发服务器。
公开访问需要先创建并发布问卷；应用不会自动创建或发布演示数据。

### 服务端配置

| 环境变量 | 用途 |
| --- | --- |
| `ADMIN_PASSWORD` | 管理密码，建议至少 16 位且不重复使用 |
| `AUTH_SECRET` | 至少 32 字符的随机会话签名密钥，必须与管理密码不同 |
| `HOST` | 默认 `127.0.0.1`，只接受本机连接 |
| `PORT` | 默认 `4317` |
| `SURVEY_DB_PATH` | 默认 `.data/survey.sqlite`；正式服务使用仓库外路径 |
| `COOKIE_SECURE` | SSH 隧道预览为 `false`；正式 HTTPS 上线必须改为 `true` |
| `ENV_FILE` | 可选，指定私有配置文件，而不是项目根目录的 `.env` |

生成签名密钥：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

密钥仅放在服务端 `.env` 或 `/etc/survey/survey.env`，权限 `600`。
**不要使用 `VITE_` 前缀保存任何秘密，不要把真实地址、SSH 配置、密码、数据或凭证写进仓库。**

## Linux 部署

以下都是通用路径和占位示例，不包含任何真实服务器信息。
仓库可以放在任意目录，部署脚本将只把运行代码和 `dist/` 复制为只读发布版本。

```bash
# 安装独立 Node 24，不更换服务器现有的系统 Node
sudo bash deploy/install-node.sh
export PATH=/opt/survey/runtime/bin:$PATH

npm ci --ignore-scripts
npm test
npm run build

sudo install -d -m 700 /etc/survey
sudo install -m 600 .env.example /etc/survey/survey.env
# 编辑 /etc/survey/survey.env，配置真实密码与随机签名密钥，并设置：
# NODE_ENV=production
# SURVEY_DB_PATH=/var/lib/survey/survey.sqlite
# HOST=127.0.0.1
# COOKIE_SECURE=false

sudo bash deploy/install-service.sh
```

部署布局：

```text
/opt/survey/runtime/       独立 Node 24
/opt/survey/releases/      只读应用版本（不含配置、数据库或 node_modules）
/opt/survey/app            指向当前版本的符号链接
/etc/survey/survey.env     私有配置，600，仅服务管理器读取
/var/lib/survey/           数据库和备份，700，专用低权限用户拥有
```

`survey-workspace.service` 使用专用非 root 用户、只读系统和内存限制，自动启动并在异常退出后重启。
更新时重新运行构建与部署脚本；数据库不随发布替换，健康检查失败会恢复上一应用版本。

```bash
sudo systemctl status survey-workspace --no-pager
sudo journalctl -u survey-workspace -n 50 --no-pager
sudo systemctl list-timers survey-workspace-backup.timer
curl -fsS http://127.0.0.1:4317/api/health
```

### 通过 SSH 隧道预览

在你的本机执行，`<ssh-alias>` 替换成已有的 SSH 别名：

```bash
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L 127.0.0.1:4317:127.0.0.1:4317 <ssh-alias>
```

打开 `http://127.0.0.1:4317/admin`。远端服务和本机隧道都仅监听回环地址，不需要开放安全组端口。
此时二维码和分享链接只能在隧道所在本机访问，不能直接用于手机或外部受访者。

正式公网发布前，配置域名、有效 TLS 证书和反向代理，把 `COOKIE_SECURE` 改为 `true`。
后端继续保留 `127.0.0.1` 监听。当前限流按直连 IP 计算；反向代理后的大规模收集还应在代理层配置真实客户端限流。

## 从旧 Supabase 导入

保留两张原表的字段：

- `surveys`：`id, slug, status, title, description, version, definition, created_at, updated_at`。
- `survey_responses`：`id, survey_id, survey_version, respondent_id, submitted_at, response, created_at`。
- UUID、版本、原始时间字符串、问卷 JSON、答案、跳题、计算结果及其他元信息保持兼容。
- 唯一有意清除的旧字段是 `response.metadata.previewToken`，避免继续保存旧管理凭证。
- 新答卷仍为 `custom-survey-response.v1`；新答卷的 `metadata.storage` 为 `server-sqlite`。

### 方案一：读取源 Data API

只在服务器的 `.migration/source.env` 中临时放入旧的 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`。
这个文件被 Git 忽略；目录权限 `700`、文件 `600`。原有 `.env` 也可作为导入工具的私有源配置。

```bash
# 先读取源数据、检查约束，但不写入目标库。--output 会保存私有源快照。
npm run data -- import-supabase --env-file .migration/source.env \
  --database .migration/check.sqlite --dry-run --output .migration/source.json

# 确认检查结果后，导入正式数据库。导入工具无需管理员登录密码。
sudo /opt/survey/runtime/bin/node server/manage.js import \
  --database /var/lib/survey/survey.sqlite --input .migration/source.json
sudo chown -R survey-workspace:survey-workspace /var/lib/survey
```

源 API 分页读取全部记录，不受默认 1000 行上限影响。源凭证不进入运行配置，也不进入前端。
迁移完成后删除临时的源凭证文件；源快照属于敏感数据，妥善保管，不要提交。

### 方案二：导入 JSON 文件

支持完整备份对象 `{ "surveys": [...], "survey_responses": [...] }`，或 Supabase 两张表分别导出的 JSON 数组：

```bash
npm run data -- import --input .migration/backup.json --dry-run
npm run data -- import --surveys .migration/surveys.json \
  --responses .migration/survey_responses.json
```

导入采用单事务；外键、唯一性等约束失败会整批回滚。重复导入按原 ID 跳过，**不会覆盖服务器上较新的记录**。
向非空库导入前自动创建 SQLite 备份。旧站仍在收集时，迁移快照不是持续同步；最终切换应暂停旧站写入，再做最后一次导入。
旧记录被修改后的覆盖合并需要人工确认，工具不会擅自覆盖。

## 备份与恢复

```bash
npm run data -- verify
npm run data -- export --output .data/backups/manual.json
npm run data -- backup
```

生产环境命令加 `--env-file /etc/survey/survey.env` 或 `--database /var/lib/survey/survey.sqlite`。
默认备份使用 SQLite 在线备份 API，能一致地包含 WAL 内容，**不要在运行时只复制主 `.sqlite` 文件**。
定时任务每天备份并保留最新 30 份。磁盘内备份不能防范服务器或磁盘整体损坏，重要数据还应加密离线保存。

恢复 JSON 可导入新的空数据库后运行 `verify`，再停服切换数据库路径。
恢复 SQLite 时先停止服务，把备份放在**新的路径**，设置专用用户所有权和 `600` 权限，更新私有配置后重启。
保留原库及其 WAL/SHM 文件，不要直接覆盖正在使用的数据库。

## 安全与接口

- 会话保存在 `HttpOnly; SameSite=Strict` cookie 中，12 小时有效，不放在 `localStorage` 或 URL 里。
- 管理接口均校验会话，写请求验证同源；登录和提交有限流、请求体上限，SQL 使用参数绑定。
- 发布状态、问卷版本、所有可见页面的必填与题型在服务器再次校验；有答卷的问卷不会被直接级联删除。
- 管理编辑使用更新时间检测多窗口覆盖；预览答卷不能伪造为未登录的管理预览。
- 静态文件只暴露构建产物，不暴露源代码、私有配置或数据库。
- xlsx 生成库按需加载，明确输出文本单元格，不把受访者的字符串当作 Excel 公式。
- `node_modules/`、构建产物、私有配置和数据库不再纳入 Git 跟踪；不会重写旧分支历史。

API 位于 `/api`：`health`、`admin-session`、`admin-login`、`admin-logout`、`admin-surveys`、`admin-responses`、`admin-backup`、`public-survey`、`submit-response`。

问卷与答卷 JSON 示例仍见 [src/data/survey.example.json](src/data/survey.example.json) 和 [src/data/response.example.json](src/data/response.example.json)。
