# Survey Netlify

面向用户填写问卷的前端入口。当前范围只包含公开问卷填写、条件题展示、前端校验、答卷 JSON 生成和 Supabase Postgres 提交；问卷设计后台和数据库管理后台暂不包含。

## 本地运行

```bash
npm install
npm run dev
```

## Netlify 部署

Netlify 会读取 `netlify.toml`：

- build command: `npm run build`
- publish directory: `dist`
- SPA fallback: `/* -> /index.html`

在 Netlify 环境变量里配置：

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
VITE_SURVEY_RESPONSES_TABLE=survey_responses
```

如果没有配置 Supabase，提交会写入浏览器 `localStorage`，方便前端开发时预览流程。

## Supabase 表结构建议

```sql
create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id text not null,
  survey_version integer not null,
  respondent_id text not null,
  submitted_at timestamptz not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

create index survey_responses_survey_idx
  on public.survey_responses (survey_id, survey_version, submitted_at desc);
```

如果前端匿名提交，建议为该表加只允许 `insert` 的 RLS policy，查询和管理走服务端或后台。

## JSON 文件

- 问卷储存格式：[src/data/survey.example.json](src/data/survey.example.json)
- 答卷储存格式：[src/data/response.example.json](src/data/response.example.json)

问卷 JSON 的关键字段：

- `pages[].questions[]`：题目列表
- `type`：`singleChoice`、`multipleChoice`、`rating`、`text`、`textarea`
- `required`：是否必填
- `options[].allowText`：选项后追加自由填写
- `visibleIf`：条件显示，用来支持回答 A 显示 C、回答 B 跳过 C
- `validation`：邮箱正则、多选最少最多项等校验

答卷 JSON 会保存：

- `surveyId` / `surveyVersion`
- `respondent`
- `startedAt` / `submittedAt` / `durationMs`
- `answers`
- `skipped`，记录因为条件不满足而跳过的问题
- `metadata`

## 主要代码

- [src/App.jsx](src/App.jsx)：问卷页面、分页和提交状态
- [src/lib/surveyEngine.js](src/lib/surveyEngine.js)：条件显示、校验、答卷 payload 生成
- [src/lib/supabaseClient.js](src/lib/supabaseClient.js)：Supabase 插入适配层
