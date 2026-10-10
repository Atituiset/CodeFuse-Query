# 第 16 章 与 mcp-language-server（LLM 代码审核）的结合

> 本章梳理 CodeFuse-Query 与 **mcp-language-server**（一个用于 LLM 代码审核的 MCP 上下文提取器）的结合点。目标场景：**百万级 C/C++ 代码库的 LLM 安全漏洞检视**，优先级为「先保证 LLM 审核质量，再深入静态分析研究」。

## 16.1 两个工具，两种范式

### 16.1.1 mcp-language-server：在线、按需、精确局部

一个 Go 实现的 MCP 服务器（fork 自 `isaacphi/mcp-language-server`），把语言服务器能力暴露给 LLM。核心是**三层漏斗**：

```
L1 ripgrep（文本，⚡⚡⚡） → L2 tree-sitter（AST，⚡⚡，仅 C/C++） → L3 clangd LSP（语义，🐢）
```

- 提供工具：`definition` / `references` / `callers` / `callees` / `hover` / `diagnostics` / `search` 等。
- 针对大型 C/C++ 库做了深度工程化：
  - **IncludeMap Neighborhood**：用 `compile_commands.json` 的 include 目录关系，把全仓库搜索剪枝到 50–400 个「编译邻居」，天然排除 multi-board / macro-gated 代码里不相关的分支。
  - **CodeAtom IR**：把异构搜索结果归一化、合并、去重、按 8KB 预算裁剪，三级优先级 `clangd(3) > tree-sitter(2) > rg(1)`。
- 定位（摘自其 `CLAUDE.md`）：**「LLM 辅助代码分析的上下文提取器，而非分析工具。代码库 → 提取上下文 → LLM 分析 → 安全报告。」**

### 16.1.2 CodeFuse-Query：离线、批量、全量图

数据中心静态分析平台（本书主体）：COREF 抽取 → Gödel/Datalog 推理。强在全量关系推导、传递闭包、代码度量、规则卡点。

### 16.1.3 关键事实：两者当前零重叠

在 mcp-language-server 源码中检索 `codefuse/coref/godel/souffle/datalog` 均无命中——它完全基于 clangd + tree-sitter + ripgrep，未接入任何预计算的关系数据。这意味着结合是从零开始设计，但也没有历史包袱。

## 16.2 本质互补：「在线精确」vs「离线全量」

| 维度 | mcp-language-server | CodeFuse-Query |
| --- | --- | --- |
| 模式 | 在线、按需、交互 | 离线、批量、全量 |
| C++ 语义深度 | **精确**（clangd：定义/引用/hover/诊断/callHierarchy） | **浅**（Beta：AST+调用边+继承，无 CFG/PDG/注释） |
| 全量图 / 闭包 | **弱**（callers 深度受限、热点爆炸、函数指针/虚调用不准） | **强**（Datalog 传递闭包一次求完） |
| 度量 / 规则 | 无 | 强（圈复杂度、扇入扇出、规则卡点） |
| 新鲜度 | 实时（clangd 索引） | 滞后（离线抽取） |
| 输出 | 给 LLM 的上下文文本 | 结构化关系数据（JSON/SQLite/SARIF） |

一句话：**clangd 给你「一个点看得准」，CodeFuse-Query 给你「整张图看得全」。** LLM 审核的典型痛点是「只见树木不见森林」——正好用后者补前者的短板。

### 16.2.1 mcp 侧的具体短板（结合动机）

`internal/tools/call_hierarchy.go` 的实现暴露了三个痛点：

1. **深度受限**：`callers/callees` 递归 depth 默认 1、上限 10。
2. **热点爆炸**：源码注释明言「hot-function results (hundreds of callers at depth 3) bounded」——热点函数在 depth 3 就有几百个 caller，必须裁剪。
3. **语义不精确**：clangd `callHierarchy` 基于静态类型解析，对**函数指针、虚函数多态、跨编译单元**的调用关系不精确。

而 CodeFuse-Query 的 Datalog 传递闭包恰好能以预计算方式一次给出完整调用链。

## 16.3 结合总体架构

```
┌─ 离线预计算层（CodeFuse-Query）─────────────────────┐
│  抽取 COREF → Gödel 预计算：                         │
│    · 全量调用图（传递闭包，不限 depth）               │
│    · 类继承图 / 模块依赖图                            │
│    · 复杂度 / 扇入扇出度量                            │
│    · 高风险模式预扫描（危险 API / 全局变量 / …）       │
│  → 导出 SQLite / JSON 图数据 + 风险清单              │
└───────────────────────┬─────────────────────────────┘
                        │ 作为「全局知识」注入
┌─ 在线实时层（mcp-language-server）───────────────────┐
│  clangd / tree-sitter / ripgrep                     │
│  + 新增数据源：预计算的全量图 / 度量 / 风险清单        │
└───────────────────────┬─────────────────────────────┘
                        ▼
        LLM 审核（局部精确语义 + 全局图 + 风险引导）
```

## 16.4 结合点详解（按目标优先级）

### 结合点 1：全量调用链补 depth 短板（ROI 最高）

**现状痛点**：LLM 审核函数 X 时，需要知道「谁调用 X、X 影响谁」的完整链路；mcp 的 `callers/callees` 受 depth≤10 限制，热点函数 depth3 就爆炸，函数指针/虚调用不准。

**CodeFuse-Query 补什么**：预计算全量调用边，Datalog 递归一次求传递闭包，不限 depth。

```rust
// script
use coref::cfamily::*

fn default_db() -> CfamilyDB {
    return CfamilyDB::load("coref_cfamily_src.db")
}

// 全量直接调用边
fn callEdge(caller: string, callee: string) -> bool {
    for (c in CallExpression(default_db())) {
        for (e in CallableEnclosingStatement(default_db())) {
            // 调用点归属的 callable 是 caller
            if (e.getStatementOid() = c.oid) {
                if (caller = e.getCallable().getName()) {
                    if (callee = c.getCalleeDeclaration().getPrintableText()) {
                        return true
                    }
                }
            }
        }
    }
}

fn main() {
    output(callEdge())
}
```

> 库中已有 `Callable.getCallee() / getAnAncestorCaller() / getAnAncestorCallee()`（`language/cfamily/lib/CodeMetric.gdl`），可在此基础上直接产出传递闭包。导出结果（SQLite/JSON）作为 mcp 的一个新数据源：LLM 问「X 的完整调用链」时直接查预计算结果，无需实时递归。

### 结合点 2：高风险模式预扫描 → 引导 LLM 审核

**现状痛点**：百万行代码让 LLM 从头逐个审，范围太大、命中率低。

**CodeFuse-Query 补什么**：用 Gödel 规则预扫全库危险模式，产出「风险清单（file:line:rule）」，LLM 审核时**带着清单优先看高风险点**。

示例规则（危险 API、全局变量）：

```rust
// script
use coref::cfamily::*

fn dangerousCall(filePath: string, startLine: int, callee: string) -> bool {
    for (c in CallExpression(default_db())) {
        let (name = c.getCalleeDeclaration().getPrintableText()) {
            if (name = "strcpy" || name = "sprintf" || name = "gets"
                || name = "memcpy" || name = "strcat") {
                let (loc = c.getLocation()) {
                    if (filePath = loc.getFile().relative_path &&
                        startLine = loc.start_line_number) {
                        if (callee = name) { return true }
                    }
                }
            }
        }
    }
}

fn main() {
    output(dangerousCall())
}
```

风险清单可作为 mcp 的「审核引导」输入，或作为 `diagnostics` 的补充数据源。

### 结合点 3：复杂度 / 度量热区 → 审核优先级

- 预计算圈复杂度、函数规模、扇入扇出。
- 产出「复杂度热区」，LLM 优先审复杂函数（复杂度与缺陷率强相关）。
- `example/CodeFuse/CyclomaticComplexityJava.gdl` 提供了度量范式，C++ 可复用（基于 AST 判定节点）。

### 结合点 4：类继承 / 依赖图 → 架构上下文

- 审核一个类时，LLM 需要它的继承树、依赖关系。
- CodeFuse-Query 预计算 `ClassHierarchy` + `referencedDependency/callerDependency/inheritedDependency`（`language/cfamily/lib/Class.gdl` 已提供）。
- 作为 mcp 的「架构上下文」数据源，审核类/模块时注入。

### 结合点 5：静态分析研究回灌（第二目标）

- CodeFuse-Query 是研究载体：用 Gödel 声明式快速验证新规则、新度量。
- 研究产出（新风险模式、新度量）**回灌**到审核流程，形成「研究 → 规则 → 审核」闭环。

## 16.5 小结

- 两者是「在线精确」vs「离线全量」的互补，不是替代。
- 结合的核心是**把 CodeFuse-Query 的预计算全量图/度量/风险清单，作为 mcp-language-server 的「全局知识」数据源**。
- 结合点 1（全量调用链）+ 结合点 2（风险预扫描）对「LLM 审核质量」的提升最直接，ROI 最高。
- 但一切的前提是 **C++ 抽取能跑通且覆盖率达标**——见下一章的落地路线与验证。
