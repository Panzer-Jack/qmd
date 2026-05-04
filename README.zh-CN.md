# QMD - Query Markup Documents

> 以 [tobi/qmd](https://github.com/tobi/qmd) 为基础，通过 nodejieba 分词增强中文关键词召回率的本地文档搜索引擎。
>
> [English](README.md)

本地优先的 CLI 文档搜索引擎，通过 nodejieba 分词实现 CJK 感知的全文检索。追踪当前 SOTA 方案，完全本地运行。

QMD 将 BM25 全文检索、向量语义搜索和 LLM 重排序相结合，全部通过 node-llama-cpp 使用 GGUF 模型在本地运行。

![QMD 架构](assets/qmd-architecture.png)

## 本 Fork 的新功能

### 基于 nodejieba 的 CJK 关键词搜索

上游 QMD 使用 SQLite FTS5 的 `unicode61` 分词器，对英文等以空格分隔的语言效果很好，但对中日韩（CJK）文本几乎无法工作——这些语言词语之间没有空格，FTS5 会将整个句子视为单个 token，导致关键词召回率接近零。

本 fork 通过双索引方案解决这个问题：

1. **nodejieba 分词** — 新增 FTS5 侧车表（`documents_fts_cjk`），存储经 [nodejieba](https://github.com/yanyiwu/nodejieba) 搜索模式分词后的文本。查询 `开放时间` 会被分词为 `开放 时间`，然后在分词索引中匹配。
2. **Trigram 兜底** — 第二张侧车表（`documents_fts_trigram`）提供子串匹配，覆盖 jieba 可能分不准的词（如专有名词、新词）。
3. **RRF 融合** — CJK 结果通过 Reciprocal Rank Fusion 与标准 BM25 结果融合，英文查询不受影响。

特性：
- 零配置——CJK 查询自动检测并路由到分词索引
- 支持自定义用户词典（`QMD_JIEBA_USER_DICT` 环境变量）
- 优雅降级——如果 nodejieba 不可用，自动回退到 trigram 模式
- 侧车索引在词典或版本变更时自动重建

### 可配置的嵌入模型

通过 `QMD_EMBED_MODEL` 环境变量覆盖默认嵌入模型，获得更好的多语言向量搜索效果：

```sh
export QMD_EMBED_MODEL="hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf"
qmd embed -f
```

### 其他变更

- npm 包名：`@panzerjack/qmd`（上游：`@tobilu/qmd`）
- 仓库地址：[Panzer-Jack/qmd](https://github.com/Panzer-Jack/qmd)

## 快速开始

```sh
# 全局安装
npm install -g @panzerjack/qmd
# 或
bun install -g @panzerjack/qmd

# 也可以直接运行
npx @panzerjack/qmd ...
bunx @panzerjack/qmd ...

# 为你的笔记、文档和会议记录创建集合
qmd collection add ~/notes --name notes
qmd collection add ~/Documents/meetings --name meetings
qmd collection add ~/work/docs --name docs

# 添加上下文以提升搜索质量
qmd context add qmd://notes "个人笔记和想法"
qmd context add qmd://meetings "会议记录"
qmd context add qmd://docs "工作文档"

# 生成向量嵌入
qmd embed

# 搜索
qmd search "项目时间线"              # 快速关键词搜索（中文自动分词）
qmd search "开放时间"                # 中文关键词搜索（无需空格）
qmd vsearch "如何部署"               # 语义搜索
qmd query "季度规划流程"             # 混合搜索 + 重排序（最佳质量）
```

### 与 AI Agent 配合使用

QMD 的 `--json` 和 `--files` 输出格式专为 Agent 工作流设计：

```sh
# 获取结构化结果供 LLM 使用
qmd search "认证" --json -n 10

# 列出所有超过阈值的相关文件
qmd query "错误处理" --all --files --min-score 0.4

# 获取完整文档内容
qmd get "docs/api-reference.md" --full
```

### MCP 服务器

QMD 提供 MCP（Model Context Protocol）服务器，支持更紧密的 Agent 集成：

- `query` — 使用类型化子查询（`lex`/`vec`/`hyde`）搜索，通过 RRF + 重排序组合
- `get` — 通过路径或 docid 获取文档（支持模糊匹配建议）
- `multi_get` — 批量获取，支持 glob 模式、逗号分隔列表或 docid
- `status` — 索引健康状态和集合信息

```json
{
  "mcpServers": {
    "qmd": {
      "command": "qmd",
      "args": ["mcp"]
    }
  }
}
```

#### HTTP 传输

```sh
qmd mcp --http                    # 前台运行，localhost:8181
qmd mcp --http --port 8080        # 自定义端口
qmd mcp --http --daemon           # 后台守护进程
qmd mcp stop                      # 停止守护进程
```

## 搜索模式

| 命令 | 说明 |
|------|------|
| `qmd search` | BM25 全文检索（快速，基于关键词，CJK 使用 nodejieba 分词） |
| `qmd vsearch` | 向量语义搜索 |
| `qmd query` | 混合搜索：FTS + 向量 + 查询扩展 + LLM 重排序 |

## CJK 关键词搜索详解

`qmd search` 和 `lex:` 查询支持中日韩文本的关键词召回。QMD 使用 nodejieba 搜索模式分词建立侧车 FTS 索引，并以 SQLite trigram 索引作为子串兜底。

查询 `开放时间` 可以匹配 `图书馆开放时间在哪里` 这样的句子，同时不影响英文 BM25 搜索路径。

### 自定义用户词典

对于项目特有的中文术语，可以提供 jieba 用户词典：

```sh
export QMD_JIEBA_USER_DICT=/path/to/userdict.utf8
qmd update   # 重建索引
```

词典格式（每行一个词）：
```
云原生 5
微服务 5
```

更换 `QMD_JIEBA_USER_DICT` 后，QMD 会在下次打开数据库时自动重建 CJK 侧车索引。

## 常用选项

```sh
-n <num>           # 结果数量（默认 5，--files/--json 时为 20）
-c, --collection   # 限制搜索到特定集合
--all              # 返回所有匹配（配合 --min-score 过滤）
--min-score <num>  # 最低分数阈值
--full             # 显示完整文档内容
--explain          # 包含检索分数追踪
--json             # JSON 输出
--files            # 文件列表输出
--md               # Markdown 输出
```

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     QMD 混合搜索管线                              │
└─────────────────────────────────────────────────────────────────┘

                          ┌─────────────┐
                          │   用户查询   │
                          └──────┬──────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
           ┌──────────────┐          ┌──────────────┐
           │   查询扩展    │          │   原始查询    │
           │ （微调模型）   │          │  （×2 权重）  │
           └──────┬───────┘          └──────┬───────┘
                  │                         │
     ┌────────────┼────────────┐            │
     ▼            ▼            ▼            ▼
┌─────────┐ ┌─────────┐ ┌─────────┐  ┌─────────┐
│  BM25   │ │  CJK    │ │  向量   │  │  向量   │
│ (FTS5)  │ │(jieba)  │ │  搜索   │  │  搜索   │
└────┬────┘ └────┬────┘ └────┬────┘  └────┬────┘
     │           │           │            │
     └─────┬─────┘           └─────┬──────┘
           │                       │
           └───────────┬───────────┘
                       ▼
          ┌───────────────────────┐
          │   RRF 融合 + 排名奖励  │
          │   原始查询 ×2 权重     │
          │   Top 30 候选         │
          └───────────┬───────────┘
                      ▼
          ┌───────────────────────┐
          │    LLM 重排序          │
          │  （qwen3-reranker）    │
          └───────────┬───────────┘
                      ▼
          ┌───────────────────────┐
          │   位置感知混合         │
          │  Top 1-3:  75% RRF   │
          │  Top 4-10: 60% RRF   │
          │  Top 11+:  40% RRF   │
          └───────────────────────┘
```

## 系统要求

- **Node.js** >= 22
- **Bun** >= 1.0.0
- **macOS**：需要 Homebrew SQLite（用于扩展支持）
  ```sh
  brew install sqlite
  ```

### GGUF 模型（首次使用时自动下载）

| 模型 | 用途 | 大小 |
|------|------|------|
| `embeddinggemma-300M-Q8_0` | 向量嵌入（默认） | ~300MB |
| `qwen3-reranker-0.6b-q8_0` | 重排序 | ~640MB |
| `qmd-query-expansion-1.7B-q4_k_m` | 查询扩展（微调） | ~1.1GB |

模型缓存在 `~/.cache/qmd/models/`。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `XDG_CACHE_HOME` | `~/.cache` | 缓存目录 |
| `QMD_JIEBA_USER_DICT` | 未设置 | jieba 用户词典路径 |
| `QMD_EMBED_MODEL` | embeddinggemma | 自定义嵌入模型 |

## 安装

```sh
npm install -g @panzerjack/qmd
# 或
bun install -g @panzerjack/qmd
```

### 开发

```sh
git clone https://github.com/Panzer-Jack/qmd
cd qmd
npm install
npm link
```

## 数据存储

索引存储在：`~/.cache/qmd/index.sqlite`

```sql
collections            -- 索引目录及 glob 模式
documents              -- 文档内容、元数据和 docid
documents_fts          -- FTS5 全文索引（标准分词）
documents_fts_cjk      -- FTS5 侧车索引（nodejieba 分词）
documents_fts_trigram  -- FTS5 侧车索引（trigram 子串兜底）
content_vectors        -- 嵌入向量块
vectors_vec            -- sqlite-vec 向量索引
llm_cache              -- LLM 响应缓存
```

## 许可证

MIT
