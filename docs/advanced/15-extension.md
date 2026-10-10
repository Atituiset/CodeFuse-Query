# 第 15 章 平台化与二次开发

> 本章回答"如何把 CodeFuse-Query 接入团队体系"，以及"如何为 C++ 补齐能力"。

## 15.1 平台集成模式

### 15.1.1 CI / CodeReview 卡点

```yaml
# 伪 CI 片段
- sparrow database create -s $CHANGED_DIR -lang cfamily -o ./db --overwrite
- sparrow query run -d ./db -gdl rules/ -o ./out --merge --sarif
- # 消费 ./out/sparrow-cli-report.sarif 做阻断/告警
```

### 15.1.2 变更影响分析（精准测试）

借鉴 ICSE 2025 论文方案（`example/icse25/`）：
- 输入：变更文件 + 行号（**注意 C++ oid 位置敏感，恰好匹配"文件+行号"输入约定**）。
- 输出：受影响方法、入口、调用链路、数据库操作。

### 15.1.3 数据仓库对接

COREF 是 SQLite 关系表，可 ETL 入数据仓库（MaxCompute/Hive/Spark）联合分析；结果 JSON 落 OSS 供 BI 消费。

### 15.1.4 在线 Query 服务

内部可仿照"Query 中心"：数据库构建流水线 + 查询服务（封装 godel 命令为 RPC）+ 规则市场。

## 15.2 新增语言 / 增强既有抽取器

### 15.2.1 新增语言四件套

1. **抽取器**：`language/<lang>/extractor/`，产出 `coref_<lang>_src.db`。
2. **Gödel 库**：`language/<lang>/lib/`，定义 `<Lang>DB` + schema + 方法。
3. **CLI 接线**：`cli/extractor/extractor.py` 增加 `<lang>_extractor_cmd()` 与 `Extractor.<lang>_extractor` 路径。
4. **文档/示例**：`example/<lang>/`。

### 15.2.2 增强 C++（以"提取注释"为例）

当前 C++ 无 Documentation。扩展路径（对照第 11 章源码）：

1. **Model 层**：`Model/Models.hpp.j2` 增加 `Comment`/`Documentation` 结构体，重新生成 `Models.hpp`。
2. **Storage 层**：`Storage/Storage.hpp.j2` 同步生成 DAO。
3. **Visitor 层**：`AST/CorefASTVisitor.cpp` 增加处理。Clang 提供：
   - `clang::RawCommentList` / `Decl::getASTContext().getRawCommentForDeclNoCache()`；
   - `clang::FullComment` + `Comment::getASTContext()`；
   - 在 `VisitDecl` 中关联注释与声明。
4. **库层**：`language/cfamily/lib/Documentation.gdl` 写 schema + 方法，`Declaration.gdl` 挂 `getComment()`。
5. **重建**：`sparrow rebuild lib -lang cfamily` 或重编译抽取器。

### 15.2.3 增强 C++：oid 改为语义签名（重要）

若需要增量/跨版本对齐（电信系统高频变更），应把 `SignatureGenerator` 从"位置签名"改为"语义签名"：

- 声明：用 `getQualifiedNameAsString()` + 参数类型签名（类似 Java 的 `hash_id`）。
- 类型：已用 `getAsString`（语义），无需改。
- 语句/表达式：位置签名是天然选择（语句无"语义名"），可保留，但需接受其位置敏感性。

> 这是 C++ 从 Beta 走向"稳定增量分析"的关键改造，工作量集中在 `SignatureGenerator.cpp`。

### 15.2.4 增强 C++：独立调用图 + CFG

- **调用图**：`CallExpression` 边已存在，可在 Gödel 库层（`language/cfamily/lib/`）新增 `CallGraph.gdl`，用 `CallableEnclosingStatement` + `CallExpression` join 出 caller→callee 独立谓词（无需改抽取器）。
- **CFG**：需接入 Clang 的 `CFG` 构建器（`clang::CFG::buildCFG`），新增 `CFG`/`CFGBlock` 表——工作量较大，属于新能力开发。

## 15.3 构建与发布自动化

仓库 CI：
- `.github/workflows/bazel_cli_build.yml`：Bazel 构建 CLI（Linux/macOS）。
- `.github/workflows/godel_build.yml`：构建 Gödel 编译器。
- `.github/workflows/check_gdl_workflow.yml`：GDL 脚本格式检查。
- `.github/workflows/pages.yml`：COREF API 文档发布（GitHub Pages）。

## 15.4 开发工具链

### 15.4.1 VSCode 插件

基于 `godel --dump-lsp`（第 8 章 LSP 机制）提供语法高亮、补全、查询执行。`engine.cpp` 的 `dump_json_schema`/`dump_json_fn`/`dump_json_local` 等正是插件获取补全数据的后端。

### 15.4.2 Jupyter Kernel

`tutorial/` 提供 `%%godel`、`%%python`、`%db` 交互，适合培训与快速原型。

## 15.5 内部规范建议

| 规范 | 说明 |
| --- | --- |
| 规则命名 | 唯一、语义化；统一输出 `filePath/startLine/ruleName/ruleDescription` |
| 库分层 | `core/`（公共 schema）+ `domain/`（领域规则）+ `rules/`（流水线规则） |
| 版本管理 | 规则/库入 Git，`package` 分发 + manifest |
| 数据库治理 | 统一抽取流水线，定时全量 + 增量（C++ 需自建） |
| 结果去重 | `ruleName+filePath+startLine` 去重（SARIF 天然支持） |
| 变更追踪 | 规则命中入库，与研发效能/风险平台联动 |

## 15.6 小结

- 平台化：SARIF/CI、变更分析、数据仓库、在线服务四层演进。
- 扩展：四件套机制清晰；C++ 的注释/CFG/oid 改造有明确源码级扩展点。
- 生态：VSCode 插件（基于 LSP dump）+ Jupyter kernel 降低上手门槛。
