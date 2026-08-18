# dsh-ragflow

[English](README.md) | 中文

为 [DeepSeek Harness](https://deepseekdocs.com) 提供 RAGFlow 知识库检索能力。它给智能体注册一个
`ragflow_retrieve` 工具，向你的 RAGFlow 数据集发起检索，返回带相似度与来源文档名的文本块。

## 设计

本包遵循 Harness 的[三角色能力模式](https://deepseekdocs.com/docs/learn/dev/practice)：一个接缝、
一个提供方、一个消费方 —— 以单个包、四个插件入口交付（第四个是面向人的配置页，改的仍是同一批值），
因此 profile 可以单独覆盖、替换或摘掉其中任一角色，而不影响其余几个。

| 角色 | 模块 | 插件名 | 职责 |
|---|---|---|---|
| Service Definition | [src/index.ts](src/index.ts) | `@deepseek-ai/dsh-ragflow` | 持有 `ctx.ragflow`：提供方注册表、与注册顺序无关的选择、`maxChunks` 截断 |
| Service Provider | [src/http.ts](src/http.ts) | `@deepseek-ai/dsh-ragflow/http` | 调用 `POST /api/v1/retrieval`、解析凭据、归一化 chunk |
| Consumer | [src/tool.ts](src/tool.ts) | `@deepseek-ai/dsh-ragflow/tool` | 面向模型的工具：参数模式、提示词引导、条数上限、展示 |
| Consumer | [src/config.ts](src/config.ts) | `@deepseek-ai/dsh-ragflow/config` | 面向人的配置页：读写同一批 settings 分节与凭据引用 |

提供方与消费方都只依赖 Service Definition，彼此互不依赖。更换后端只需替换一行：

```yaml
- id: ragflow-http
  name: 'your-own-ragflow-provider'
```

## 前置条件

1. **一个运行中的 RAGFlow 实例** —— 自建或云端，默认连接 `http://localhost:9380`。
2. **一个 API Key** —— 在 RAGFlow 中创建。
3. **一个已解析文档的数据集** —— RAGFlow 会拒绝既没有 dataset 也没有 document 的检索请求，因此至少
   要配置一个 dataset id。

## 安装

```sh
dsh plugin --profile web add "github:staff-os/dsh-ragflow#main"
```

`dsh plugin add` 会把来源原样交给 pnpm，因此任何 pnpm 认识的来源都可以：

```sh
dsh plugin --profile web add link:/path/to/dsh-ragflow   # 本地开发
```

`lib/` 已随仓库提交，安装期不执行构建脚本，也就不需要 pnpm 的 build 授权。安装后**重启 `dsh web`**，
再确认四行都已插入：

```sh
dsh --profile web --dump-config | grep ragflow
```

## 配置

三个入口，同一批值。配置页是最省事的那个；环境变量与 YAML 行的行为一如从前。

### 配置页

`dsh web` 运行时，打开 **http://127.0.0.1:3080/ragflow**（端口以 web 界面启动时打印的为准）。页面可
以配置接口地址、数据集、检索参数与工具上限；API Key 通过凭据服务保存，不会写进任何设置文件，字段
本身只报告"是否已配置"。

每个字段都是**留空即继承**：输入框里放的是你自己的覆盖值，占位符显示的是没有覆盖时实际生效的值。
把输入框清空，就是让该字段重新继承组装行、环境变量或 schema 默认值。**测试检索**会真的向 RAGFlow
发起一次检索，配完不必靠猜。

无论 `dsh web --host` 绑在哪，这个页面只在回环地址上提供服务 —— 它既读取部署配置，又写入凭据。想
换路径就改这一行的 `path`，想整个去掉就禁用它：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: ragflow-config
  disabled: true
```

保存下来的值落在 `~/.dsh/settings.yaml` 的 `ragflow-http` 与 `tool-ragflow` 两个命名空间，叠加在
组装层之上：schema 默认值 → `cordis.patch.yml` 条目 → 你保存的分节。除 `timeoutMs` 外都对下一次检
索立即生效；`timeoutMs` 由工具注册表在注册时读取一次，改动需重启。

### 环境变量

常见场景只需设置环境变量，既不用改 YAML 也不用开页面：

```sh
export RAGFLOW_API_KEY=ragflow-xxx
export RAGFLOW_BASE_URL=http://your-ragflow-host:9380     # 可选，默认 localhost:9380
export RAGFLOW_DATASET_IDS=dataset_id_1,dataset_id_2      # 除非写进 YAML，否则必填
```

挂载了 DSH 凭据服务时，API Key 从 `~/.dsh/.credentials.yaml` 解析；否则回落到启动环境。切勿把密钥
写进配置文件。

要覆盖某一行，在 profile 的 `cordis.patch.yml` 中重述它 —— patch 是**整体替换**该行的 `config`，
不做深合并，所以要把这一行需要的键全部写出：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: ragflow-http
      name: '@deepseek-ai/dsh-ragflow/http'
      config:
        baseURL: http://your-ragflow-host:9380
        datasetIds: ['dataset_id_1']
        similarityThreshold: 0.3
        vectorTopK: 1024
```

### `@deepseek-ai/dsh-ragflow`（接缝）

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `retrieveProvider` | 自动 | 指定提供方 id；不填时若仅有一个可用提供方则自动选中。等价于 `$DSH_RAGFLOW_PROVIDER`。 |

### `@deepseek-ai/dsh-ragflow/http`（提供方）

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `apiKey` | — | 字面量密钥，优先使用 `apiKeyEnv`。 |
| `apiKeyEnv` | `RAGFLOW_API_KEY` | 每次检索时解析的凭据引用名。 |
| `baseURL` | `$RAGFLOW_BASE_URL` → `http://localhost:9380` | 端点基址，其后追加 `/api/v1/retrieval`。 |
| `datasetIds` | `$RAGFLOW_DATASET_IDS` | 默认检索的数据集。 |
| `documentIds` | — | 在数据集之下进一步收窄检索范围。 |
| `similarityThreshold` | `0.2` | 综合相似度低于此值的 chunk 被丢弃。 |
| `vectorTopK` | RAGFlow 的 `1024` | 即 RAGFlow 的 `top_k`：向量候选池大小，**不是**返回条数。 |
| `vectorSimilarityWeight` | RAGFlow 的 `0.3` | 混合打分中的向量权重。 |
| `keyword` | `false` | 在向量检索之外同时启用关键词匹配。 |
| `rerankId` | — | 作用于候选池的重排模型。 |

### `@deepseek-ai/dsh-ragflow/tool`（消费方）

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `maxChunks` | `8` | 单次调用返回的 chunk 上限；作为 RAGFlow 的 `page_size` 下发，并由接缝再次强制。 |
| `timeoutMs` | `30000` | 单次调用的协作式超时预算。注册时读取一次，改动需重启后生效。 |

### `@deepseek-ai/dsh-ragflow/config`（配置页）

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `path` | `/ragflow` | 页面及其 JSON 接口（`/state`、`/save`、`/probe`）挂载的路径。 |

## 检索流程

1. 模型带 `question` 调用 `ragflow_retrieve`。
2. 工具校验参数并调用 `ctx.ragflow.retrieve({ question, maxChunks }, signal)`。
3. 接缝选出可用提供方并转发请求。
4. 提供方 POST 到 `/api/v1/retrieval`，归一化 `data.chunks[]`。
5. 接缝按 `maxChunks` 截断；工具渲染为可引用的文本，并附带可在会话回放中还原的结构化元数据。

空结果也是结果：工具会告诉模型知识库中没有相关内容，不要编造引用。

## 开发

```sh
pnpm install
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
pnpm build       # tsdown → lib/{index,http,tool,config}.js
```

`lib/` 随仓库提交；改动 `src/` 后需重新构建并一并提交。

## 排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `RAGFLOW_SCOPE_MISSING` | 检索范围内既无 dataset 也无 document | 设置 `datasetIds` 或 `$RAGFLOW_DATASET_IDS` |
| `RAGFLOW_PROVIDER_CREDENTIAL_MISSING` | 该凭据引用名下取不到密钥 | 设置 `$RAGFLOW_API_KEY`，或让 `apiKeyEnv` 与凭据键名一致 |
| `RAGFLOW_PROVIDER_UNAUTHORIZED` | RAGFlow 拒绝了密钥 | 在 RAGFlow 中重新签发 |
| `RAGFLOW_PROVIDER_UNAVAILABLE` | 提供方行缺失或选项非法 | 用 `--dump-config` 检查 `ragflow-http` 行 |
| `RAGFLOW_PROVIDER_AMBIGUOUS` | 注册了两个可用提供方 | 用接缝的 `retrieveProvider` 指定其一 |
| 工具列表里没有 `ragflow_retrieve` | bundle 未加载 | `dsh --dump-config \| grep ragflow`；重启 `dsh web` |
| 返回条数比预期少 | `vectorTopK` 不是返回条数 | 调高工具行的 `maxChunks` |
| 配置页返回 `NOT_LOOPBACK` | 从局域网地址访问 | 在宿主机本机打开，或把端口转发到本地 |
| 配置页返回 `SETTINGS_CONFLICT` | 页面加载后设置文档被别处改过 | 刷新页面后重新填写保存 |
| API Key 输入框不可编辑 | 启动环境里的 `RAGFLOW_API_KEY` 遮蔽了凭据存储 | 改环境变量后重启 `dsh`，或取消该变量改由页面管理 |
| `/ragflow` 打不开 | 该 surface 没有 web server，或该行被禁用 | `dsh --dump-config \| grep ragflow-config` |

## 已知限制

- 仅检索 —— 不含数据集/文档管理（创建、上传、解析）。
- 这个页面是插件自带的，而不是 DSH 内置「设置 → 插件 → 插件配置」里的一张卡片：那个页面只渲染宿主
  api-proxy 白名单（`WEB_SETTINGS_NAMESPACES`）里的 settings 命名空间，在 harness 仓库之外分发的插
  件不改动已发布的宿主包就进不去。若哪天该白名单改由 `settings.register()` 声明，这两个命名空间无
  需改动本包即可出现在那里。
- 无流式返回，需等待完整响应。
- 结果使用通用搜索卡片渲染，尚无专用引用卡片。
- 尚未暴露 RAGFlow 的 `cross_languages`、`metadata_condition`、`highlight`、`use_kg` 选项。
