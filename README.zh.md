# dsh-ragflow

[English](README.md) | 中文

DeepSeek Harness 的 RAGFlow 知识库检索插件。为 agent 提供 `ragflow_retrieve` 工具，可向已连接的 RAGFlow 知识库发起检索，返回相关文档片段及相似度分数。

## 结构

此单一包包含 capability seam 的全部三个角色：

| 角色 | 组件 | 职责 |
|---|---|---|
| Service Definition | `RagflowRuntime` (`src/runtime.ts`) | `ctx.ragflow` provider 注册表、选择语义、结果截断 |
| Service Provider | `RagflowProvider` (`src/provider.ts`) | 调用 RAGFlow HTTP API `POST /api/v1/retrieval` |
| Consumer / Tool | `ragflow_retrieve` (`src/tool.ts`) | 模型可见工具：schema、prompt 指导、格式化 |

## 前置条件

1. **运行 RAGFlow 实例**：自托管或云端。默认连接 `http://localhost:9380`，通过 `RAGFLOW_BASE_URL` 覆盖。
2. **获取 API Key**：在 RAGFlow 中创建 API Key，通过 `RAGFLOW_API_KEY` 或 DSH 凭据服务传入。
3. **创建知识库**：在 RAGFlow 中至少创建一个数据集，并上传和解析文档。
4. **（可选）指定数据集**：通过 `RAGFLOW_DATASET_IDS` 环境变量指定（逗号分隔）。

## 安装

DSH 支持两种插件安装方式，根据场景选择。

### 方式 A — Bundle 插件安装（独立仓库推荐）

当本插件作为独立 git 仓库存在时（`lib/` 已构建并提交，或构建脚本可用），用一行命令安装到已运行的 DSH profile：

```sh
dsh plugin --profile web add "github:staff-os/dsh-ragflow#main"
```

`dsh plugin add` 会将参数原样转发给 `pnpm`，因此任何 pnpm 能识别的源都可以：git 源、`link:` 本地目录等。

```sh
# 本地目录（开发模式）
dsh plugin --profile web add link:/path/to/dsh-ragflow
```

安装后**重启 `dsh web`** 才会生效。验证组合树：

```sh
dsh web --dump-config | grep ragflow
```

### 方式 B — 手动 patch overlay（monorepo 内开发）

如果在 `deepseek-harness` monorepo 内工作，workspace 的 `examples/package.json` 已将 `@deepseek-ai/dsh-ragflow` 声明为 workspace 依赖。运行 `pnpm install` 自动链接，然后启动时传入 overlay：

```sh
dsh web --patch examples/dsh-ragflow/cordis.patch.yml
```

要跨次运行保留配置，将 `insert` 条目合并到 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: ragflow
      name: '@deepseek-ai/dsh-ragflow'
      config:
        baseURL: http://your-ragflow-host:9380
        topK: 10
        similarityThreshold: 0.2
```

### 构建（仅独立仓库）

如果 `lib/` 未提交，安装前需构建：

```sh
pnpm install
pnpm build    # tsdown → lib/index.js + .d.ts
```

`package.json` 中的 `dsh.bundle.patch` 字段指向 `cordis.patch.yml`，DSH 插件加载器据此读取 overlay。

## 凭据配置

通过以下任一方式提供 RAGFlow API Key（按优先级排序）：

| 方式 | 位置 | 说明 |
|---|---|---|
| DSH 凭据服务 | `~/.dsh/.credentials.yaml` | 托管式，原子落盘 0600 权限 |
| 环境变量 | `.env` 或 shell 中的 `RAGFLOW_API_KEY` | 进程环境 > 工作目录 `.env` > `~/.dsh/.env` |

```sh
# 方式 1：~/.dsh/.credentials.yaml
ragflow-api-key: ragflow-xxx

# 方式 2：shell 导出或 .env
export RAGFLOW_API_KEY=ragflow-xxx
export RAGFLOW_BASE_URL=http://your-ragflow-host:9380   # 可选
export RAGFLOW_DATASET_IDS=dataset_id_1,dataset_id_2    # 可选
```

## 配置项

| 配置 | 默认值 | 说明 |
|---|---|---|
| `apiKey` | — | RAGFlow API Key（优先使用 `apiKeyEnv`） |
| `apiKeyEnv` | `RAGFLOW_API_KEY` | 凭据引用名称 |
| `baseURL` | `http://localhost:9380` | RAGFlow API 端点基址 |
| `datasetIds` | — | 默认搜索的数据集 ID 列表 |
| `topK` | `10` | Provider 级 chunk 上限 |
| `similarityThreshold` | `0.2` | 相似度阈值，低于此分数的 chunk 被过滤 |
| `retrieveTopK` | `10` | 工具级 chunk 上限 |
| `retrieveTimeoutMs` | `30000` | 协作超时预算（毫秒） |

`cordis.patch.yml` 中的 `config` 是**整行替换**，非深合并。需保留的字段都要显式写出。

## 验证

```sh
# 检查插件是否已加载到组合树
dsh web --dump-config | grep ragflow

# 在 Web UI 中：设置 → 插件 → 查找 "ragflow"
```

插件激活后，`ragflow_retrieve` 工具会出现在模型的工具列表中。

## 常见问题排查

| 症状 | 原因 | 解决方法 |
|---|---|---|
| `ragflow_retrieve` 不在工具列表 | Bundle 未构建或未加载 | 运行 `pnpm build`；重启 `dsh web` |
| 裸名 `cordis`/`schemastery` 解析失败 | 闭包只含 `@deepseek-ai/*` 包 | 确保导入用 `@deepseek-ai/schemastery` |
| Patch 应用了但不生效 | `name` 不符 → 静默跳过 | 确认 patch 中 `name: '@deepseek-ai/dsh-ragflow'` |
| API Key 找不到 | 凭据引用不匹配 | 检查 `apiKeyEnv` 与凭据键名一致 |
| 卸载后 patch 残留 | `dsh plugin remove` 不回写 patch 层 | 手动删除 `cordis.patch.yml` 中的 `insert` 块 |

## 检索流程

1. 模型调用 `ragflow_retrieve`，传入 `question`。
2. 工具通过 `ctx.ragflow.retrieve()` 委托给已注册的 provider。
3. Provider 向 RAGFlow API 发送 `POST /api/v1/retrieval`。
4. 响应 chunk 被归一化，包含内容、文档来源和相似度分数。
5. 结果返回给模型，包含格式化文本和结构化元数据。

## 已知限制与待办事项

- 不支持流式检索；需等待完整响应后返回。
- 不支持数据集管理（创建/删除/上传）；仅检索。
- 除通用搜索卡片外无独立 UI 展示卡片。
