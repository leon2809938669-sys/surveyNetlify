# Survey Netlify

一个部署在 Netlify 上的二合一问卷系统：

- 管理者访问 `/admin`，输入统一管理密码后创建/编辑问卷、发布/关闭问卷、预览问卷、查看答卷、展开答卷详情、导出 xlsx、删除答卷、复制填写链接和二维码。
- 被调查者访问 `/s/<slug>` 或扫码进入填写页，提交后由 Netlify Functions 写入 Supabase Postgres。

浏览器不会直接连接 Supabase。所有读写都经过 `netlify/functions/*`，Supabase service role key 只配置在 Netlify 环境变量中。

## 本地运行

安装依赖：

```bash
npm install
```

前端构建验证：

```bash
npm run build
```

本地运行前端和 Functions：

```bash
npm run dev
```

只运行 Vite 前端，不运行 Functions：

```bash
npm run dev:vite
```

注意：二合一架构依赖 Netlify Functions。只跑 `dev:vite` 时，公开问卷和管理接口不会工作。

## Netlify 环境变量

在 Netlify 站点的 `Site configuration -> Environment variables` 添加：

```bash
ADMIN_PASSWORD=你的统一管理密码
NETLIFY_ADMIN_SECRET=一个很长的随机字符串，用来签发管理登录 token
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=你的 Supabase service_role key
```

说明：

- `ADMIN_PASSWORD`：管理者在 `/admin` 输入的统一密码。
- `NETLIFY_ADMIN_SECRET`：只用于签名管理 token，不需要给管理者。
- `SUPABASE_SERVICE_ROLE_KEY`：只能放在 Netlify 环境变量里，不要放进 `VITE_*` 或前端代码。

## Supabase 建表

在 Supabase SQL Editor 执行：

```sql
create extension if not exists pgcrypto;

create table public.surveys (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  status text not null default 'unpublished' check (status in ('published', 'unpublished')),
  title text not null,
  description text not null default '',
  version integer not null default 1,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete restrict,
  survey_version integer not null,
  respondent_id text,
  submitted_at timestamptz not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

create index surveys_slug_status_idx
  on public.surveys (slug, status);

create index survey_responses_survey_idx
  on public.survey_responses (survey_id, submitted_at desc);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger surveys_set_updated_at
before update on public.surveys
for each row execute function public.set_updated_at();
```

可选：开启 RLS。因为本项目通过 service role 从 Netlify Functions 访问，开启 RLS 后也能正常运行：

```sql
alter table public.surveys enable row level security;
alter table public.survey_responses enable row level security;
```

不要给 anon key 开公开读写 policy，公开访问已经由 Netlify Functions 控制。

如果你已经按旧版本建过表，执行下面的迁移把状态改为 `published/unpublished`：

```sql
alter table public.surveys
drop constraint if exists surveys_status_check;

update public.surveys
set status = case when status = 'published' then 'published' else 'unpublished' end;

alter table public.surveys
alter column status set default 'unpublished';

alter table public.surveys
add constraint surveys_status_check
check (status in ('published', 'unpublished'));
```

## 创建第一个问卷

1. 部署到 Netlify。
2. 打开 `https://你的站点.netlify.app/admin`。
3. 输入 `ADMIN_PASSWORD`。
4. 点击“新建问卷”。
5. 编辑 `Slug`，例如 `customer-feedback-2026`。
6. 点击“编辑问卷”，可选择可视化编辑或 JSON 编辑。
7. 点击“发布”。
8. 如有内容修改，点击“保存”。
9. 复制填写链接或下载/展示二维码，被调查者访问 `/s/customer-feedback-2026`。

## 管理端功能

- 问卷编辑：支持可视化编辑和 JSON 编辑两种模式，可随时切换。
- 发布控制：使用“发布/关闭”按钮切换 `published/unpublished` 状态。
- 管理预览：管理页“预览”不受发布状态限制，预览页也可以提交答卷；公开链接仍只允许已发布问卷访问和提交。
- 预览答卷：通过预览页提交的答卷同样写入 `survey_responses`，并在 `response.metadata.isPreview` 中标记为 `true`。
- 答卷查看：答卷列表可点击展开，查看自动计算值和各题中文答案。
- 答卷导出：支持将当前问卷全部答卷导出为 xlsx。
- 答卷删除：支持删除单份答卷、删除勾选的多份答卷、清空当前问卷全部答卷。
- 数据安全：所有管理操作都通过 Netlify Functions 校验管理 token 后访问 Supabase。

## 问卷 JSON 格式

示例文件：[src/data/survey.example.json](src/data/survey.example.json)

核心字段：

- `id`：问卷业务 ID。
- `version`：问卷版本，写入每份答卷。
- `title` / `description`：填写页标题和说明。
- `pages[].questions[]`：页面和题目。
- `type`：`singleChoice`、`multipleChoice`、`rating`、`text`、`textarea`。
- `required`：是否必填。
- `options[].allowText`：选项后自由填写。
- `visibleIf`：条件显示，用来实现“回答 A 显示 C，回答 B 跳过 C”。
- `validation`：正则、多选最少最多项等。

`visibleIf` 支持：

```json
{ "questionId": "role", "operator": "equals", "value": "developer" }
```

也支持组合：

```json
{
  "all": [
    { "questionId": "satisfaction", "operator": "lte", "value": 3 },
    { "questionId": "role", "operator": "notEquals", "value": "developer" }
  ]
}
```

支持的 operator：

- `answered`
- `notAnswered`
- `equals`
- `notEquals`
- `includes`
- `notIncludes`
- `gt`
- `gte`
- `lt`
- `lte`

## 答卷 JSON 格式

示例文件：[src/data/response.example.json](src/data/response.example.json)

每份答卷会作为 `survey_responses.response` 的 `jsonb` 保存，包含：

- `surveyId`：Supabase `surveys.id`。
- `surveyVersion`：提交时问卷版本。
- `respondent`：匿名提交者信息。
- `startedAt` / `submittedAt` / `durationMs`。
- `answers`：实际回答的问题。
- `skipped`：因为条件不满足而跳过的问题。
- `metadata`：应用版本和存储说明。
- `metadata.isPreview`：是否来自管理预览提交。
- `metadata.previewToken`：预览提交时使用的管理 token，仅用于服务端校验。

## 主要文件

- [src/App.jsx](src/App.jsx)：根据路径切换公开填写页和管理页。
- [src/components/SurveyRunner.jsx](src/components/SurveyRunner.jsx)：问卷填写引擎。
- [src/pages/AdminApp.jsx](src/pages/AdminApp.jsx)：管理后台。
- [src/pages/PublicSurveyPage.jsx](src/pages/PublicSurveyPage.jsx)：公开填写页。
- [src/lib/surveyEngine.js](src/lib/surveyEngine.js)：条件判断、校验、答卷 payload。
- [netlify/functions](netlify/functions)：登录、问卷 CRUD、答卷提交与查询。
