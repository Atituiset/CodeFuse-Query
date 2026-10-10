# 第 2 章 核心概念：COREF 与 Gödel

## 2.1 COREF：代码数据化模型

COREF 是 CodeFuse-Query 定义的**代码数据化与标准化模型**。它的目标是：无论源语言是什么，最终都落到同一套可查询的关系数据上。

```
源代码
  │  (语言抽取器 Extractor)
  ▼
COREF 数据 = AST + ASG + CFG + PDG + Call Graph + Class Hierarchy + Documentation
  │  (存储为关系表：SQLite 数据库 / Soufflé facts)
  ▼
Gödel 查询脚本  →  分析结果
```

### 2.1.1 COREF 的组成部分

| 组件 | 含义 | 当前支持情况 |
| --- | --- | --- |
| AST | 抽象语法树：语法结构全量展开 | 除 OC/C++ 外全部语言支持完整 AST + Documentation |
| ASG | 抽象语义图：符号绑定、类型解析、名称解析 | Java 等成熟语言支持 |
| CFG | 控制流图 | 建设中（部分语言部分支持） |
| PDG | 程序依赖图（数据依赖 + 控制依赖） | 建设中 |
| Call Graph | 函数调用图：谁调用了谁 | Java 等成熟语言支持；C++ 可推导出调用关系表 |
| Class Hierarchy | 类继承关系 | Java 支持；C++ 有 ClassHierarchy 表 |
| Documentation | 注释/文档 | 注意：**C++ 抽取器当前未提取注释**（见第 9 章） |

### 2.1.2 COREF 数据长什么样

以 C++ 为例，抽取器把每个代码实体落到一张表（`language/cfamily/extractor/Model/Models.hpp`）：

```cpp
struct FunctionDeclaration {
    CorefOid oid;                 // 实体唯一标识
    CorefOid parentOid;           // 父节点
    int indexOrder;
    CorefOid locationOid;         // 位置
    std::string kindName;
    std::string debugMessage;
};
struct CallExpression {
    CorefOid oid;
    CorefOid calleeDeclarationOid; // 被调用声明 → 形成调用边
    std::string debugMessage;
};
struct ClassHierarchy {
    CorefOid childOid;
    CorefOid parentOid;            // 继承边
};
```

- `oid` 是跨表关联的外键，Gödel 查询本质上就是在这张"巨大的关系网"上做推导。
- 最终数据库是一个 SQLite 文件（如 `coref_cfamily_src.db`），其中每张表对应一个 COREF 实体。

## 2.2 Gödel：声明式查询语言

### 2.2.1 什么是 Datalog

Datalog 是逻辑编程（Prolog 族）中一个限定子集：

- 由**事实（Fact）**和**规则（Rule）**组成；
- 通过规则不断**推导**出新事实，直到不动点；
- 具有**单调性**（推导只增不减）和**终止性**（有限范围内必然收敛）；
- 递归是天然支持的（这是相对 SQL 的最大优势）。

CodeFuse-Query 的 Gödel 编译器把 Gödel 脚本编译成 **Soufflé**（一个高性能 Datalog 引擎）代码执行。

### 2.2.2 Gödel 相对 SQL / SDK 的优势

- **递归表达**：例如"计算某方法的所有间接被调用者"（传递闭包），SQL 写起来极其繁琐，Gödel 两三行搞定。
- **声明式**：用户只描述"要什么"，不用关心中间过程。
- **性能**：Datalog 的约束换来了可并行、可优化的执行（Soufflé 擅长处理上亿条事实的推导）。

### 2.2.3 Gödel 脚本的两种形式

仓库中存在两代 Gödel 语言：

| 形式 | 首行标记 | 编译器 | 说明 |
| --- | --- | --- | --- |
| 旧版 Gödel 0.3 | 无 `// script` 标记 | `godel-0.3/usr/bin/godel` | 老语法（`use coref::java::*` + `fn main(){ output(...) }`） |
| **GödelScript** | 文件首行 `// script` | `godel-script/usr/bin/godel` | 当前主推语法，支持 schema/impl/database/query 等 |

判断逻辑见 `cli/godel/godel_compiler.py` 中的 `godel_version_judge()`：读脚本第一行，若匹配 `//[ \t]*script` 则视为 GödelScript，否则视为旧版 0.3。

> **建议**：新写脚本一律使用 **GödelScript**（首行 `// script`）。本文档后续全部基于 GödelScript 语法。

### 2.2.4 一个最小 GödelScript 示例

```rust
// script
use coref::java::*

fn default_db() -> JavaDB {
    return JavaDB::load("coref_java_src.db")
}

// 遍历所有方法，获取方法名
fn getFunctionName(name: string) -> bool {
    let (db = default_db()) {
        for (method in Method(db)) {
            if (name = method.getName()) {
                return true
            }
        }
    }
}

fn main() {
    output(getFunctionName())
}
```

关键语法点：

- `// script` 声明这是 GödelScript。
- `use coref::java::*` 导入某语言的 COREF 库（位于 `language/java/lib/`，或安装后的 `lib/` 目录）。
- `JavaDB::load("...")` 加载抽取出的数据库文件。
- `for (x in Set(db))` 遍历一个 schema 的全集。
- `if (name = method.getName())` —— 注意这里 `=` 是**绑定比较**：若左侧未绑定则为其绑定值并返回 true。
- `fn main() { output(f()) }` 输出查询结果（`@output` 注解是新式写法）。

## 2.3 端到端工作流

```
1. 准备源代码目录 <src>
2. sparrow database create -s <src> -lang cfamily -o ./db
        └─ 抽取器 → <db>/coref_cfamily_src.db（SQLite）
3. 编写 query.gdl（GödelScript）
4. sparrow query run -d ./db -gdl query.gdl -o ./out
        └─ Gödel 编译器 → Soufflé → 结果 out/query.json
```

`cli/sparrow-cli.py` 正是这样把命令分派到 `database.create`、`query.run` 等模块的。

## 2.4 平台组件与目录对照

| 仓库目录 | 作用 |
| --- | --- |
| `language/<lang>/extractor/` | 各语言抽取器（C++ 用 Clang，Java 用 Java 解析器等） |
| `language/<lang>/lib/` | 各语言的 Gödel 标准库（定义 `*DB`、schema 与方法） |
| `godel-script/` | Gödel 编译器前端 + 后端（含自研的 Soufflé） |
| `cli/` | Sparrow CLI（Python），编排抽取与查询 |
| `external/` | 外部依赖 |
| `example/` | 各语言查询示例 + ICSE 2025 论文复现规则 |
| `tutorial/` | Jupyter 交互式教程（Godel Kernel） |

下一章开始动手安装与配置。
