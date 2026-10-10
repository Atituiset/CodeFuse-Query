# 第 8 章 编译器前端：五层架构剖析

> 上一章学了 Gödel 语法，本章拆解它背后的编译器——一个用 C++17 写的**完整编译器**，位于 `godel-script/godel-frontend/src/`。理解它，才能真正理解 Gödel 的语义、性能与限制。

## 8.1 整体管线

`engine.cpp::run()` 揭示了完整执行顺序（每一步对应一个函数）：

```
源代码 (.gdl/.gs)
   │  ① do_lexical_analysis  词法分析（lexer.cpp）
   ▼
token 流
   │  ② do_syntax_analysis   语法分析（parse.cpp）
   ▼
AST（ast/*.cpp, ast_node.h）
   │  ③ do_semantic_analysis 语义分析（semantic.cpp + sema/*.cpp）
   ▼                          （同时完成 Soufflé 代码生成）
LIR 指令序列（ir/lir.h）
   │  ④ IR 优化 passes（ir/pass_manager.cpp）
   ▼
Soufflé 程序文本
   │  ⑤ run_souffle → souffle_entry（内嵌引擎）
   ▼
查询结果
```

关键代码（`engine.cpp:473` 起）：

```cpp
const error& engine::run(const configure& config) {
    // 0) 可选：包扫描（-p 目录 → 模块树）
    scan_package_root(...);

    // 1) 词法分析
    do_lexical_analysis(config);       // lexer.scan(file)
    // 2) 语法分析
    do_syntax_analysis(config);        // parser.analyse(tokens)
    // 3) 语义分析（内部做 souffle 代码生成）
    do_semantic_analysis(config);      // semantic.analyse(config, ast)
    // 4) 若 --semantic-only 则到此为止
    // 5) 可选 dump 生成的 souffle（--souffle-debug）
    // 6) 直接运行 souffle（-r）
    run_souffle_from_generated(config);
}
```

## 8.2 层一：词法分析（lexer）

- 文件：`lexer.cpp` / `lexer.h`（约 500 行）
- 产出：token 流（`tok::tok_id` 标识符、关键字、字面量、运算符）。
- 同时收集**注释**（`lexical_analyser.extract_comments()`），供 LSP/文档 dump 使用。
- 支持 `--lexer-dump-token` / `--lexer-dump-comment` 调试输出。

## 8.3 层二：语法分析（parser）

- 文件：`parse.cpp`（1200+ 行）/ `parse.h`
- 产出：AST。AST 节点定义在 `ast/ast_node.h`、`ast/expr.h`、`ast/decl.h`、`ast/stmt.h`。
- 提供 `--dump`（dump AST）、`--dump-resolve`（dump 带类型信息的 AST）。

## 8.4 层三：语义分析（semantic + sema/*）

这是整个前端最重的部分（`semantic.cpp` 3000+ 行，`sema/` 目录 10 余个文件）。核心职责与对应文件：

| 文件 | 职责 |
| --- | --- |
| `semantic.cpp` | 语义分析主流程、类型推导、作用域 |
| `sema/symbol_import.cpp` | `use` 导入解析、跨模块符号解析 |
| `sema/global_symbol_loader.cpp` | 全局符号收集（schema/database/enum/func） |
| `sema/inherit_schema.cpp` | schema 字段/方法继承展开 |
| `sema/function_declaration.cpp` | 函数声明/实现检查 |
| `sema/ungrounded_checker.cpp` | **Ungrounded 检查**（Datalog 变量绑定合法性） |
| `sema/self_reference_check.cpp` | 自引用检查 |
| `sema/fact_statement_checker.cpp` | Fact 语句检查（实验特性） |
| `sema/data_structure_construct.cpp` | schema/database 结构构造 |
| `sema/annotation_checker.cpp` | `@data_constraint`/`@inline` 等注解检查 |
| `sema/context.cpp` | 语义上下文（符号表、类型表） |

### 8.4.1 Schema 继承展开（inherit_schema.cpp）

从源码可见三条关键规则：

1. **字段继承**（`inherit_field` → `inherit_single_schema_field`）：父类字段复制到子类前面（与文档描述一致）。
2. **方法继承**（`inherit_single_schema_method`）：普通方法自动继承并标记 `func.inherit = true`；**但 `__all__` 不继承**——注释原文：`// __all__(...) must be written by yourself, so do not inherit it`。
3. **数据约束检查**（`check_schema_without_data_constraint`）：若 schema 被数据库使用却没有实现 `__all__`，报错 `"use in database, or implement \"__all__\" method."`。

### 8.4.2 Ungrounded 检查（ungrounded_checker.cpp，759 行）

这是 Gödel 继承 Datalog 语义的核心约束：每个变量在规则中必须"被 grounding"（有确定来源），否则 Soufflé 会报 ungrounded error。语义层提前做检查，给出更友好的定位。

这就是为什么：
- `if` 不支持 `else`（易 ungrounded）；
- `let` 初始值不能是集合类型；
- `=` 是"绑定比较"——语义层据此判断左侧变量是否被绑定。

## 8.5 层四：IR 与优化 passes

### 8.5.1 LIR 指令集（ir/lir.h）

Gödel AST 被降到一份**低级指令 IR**，指令类型：

| 指令 | 说明 |
| --- | --- |
| `inst_bool` | 布尔标志（true/false） |
| `inst_store` | 赋值 `src → dst` |
| `inst_call` | 调用（区分 function/method/database_load/find/key_cmp/to_set/basic_method/basic_static） |
| `inst_ctor` | schema 初始器（带 key） |
| `inst_record` | Soufflé record 构造 `[a, b, c]` |
| `inst_unary` / `inst_binary` | 一元/二元运算 |
| `inst_cmp` | 比较运算 |
| `inst_block` | 代码块（`;` 分隔=or，`,` 分隔=and） |
| `inst_fact` | 事实集合 |
| `inst_not` / `inst_and` / `inst_or` | 逻辑运算 |
| `inst_aggr` | 聚合（len/sum/min/max/find） |

### 8.5.2 内建方法的显式枚举

`lir.h` 中 `call` 类把 **int 与 string 的内建方法逐个枚举**，映射到 Soufflé 内建 functor：

```cpp
enum class int_method_kind { int_add, int_sub, int_div, int_mul, ... int_to_set };
enum class string_method_kind { string_substr, string_contains, string_replace_all, ... };
```

> 含义：`1.add(2)`、`"x".contains("y")` 这类方法**不是普通函数调用**，而是编译期识别并翻译为 Soufflé 的算数/字符串 functor，性能与 C++ 内建算子一致。

### 8.5.3 优化 passes（ir/pass_manager.cpp + 各 pass）

| Pass | 文件 | 作用 |
| --- | --- | --- |
| 指令合并 | `inst_combine.cpp` | 合并冗余 store/call（可 `--disable-inst-combine` 关闭） |
| 死代码消除 | `remove_unused.cpp` | 删除未用方法（可 `--disable-remove-unused` 关闭） |
| 块展平 | `flatten_block.cpp` | 展开嵌套 block |
| join 重排 | `reorder.cpp` | 实验性 join 顺序优化（`-Ojr`） |
| 聚合内联 | `aggregator_inline_remark.cpp` | 聚合谓词内联标注 |
| 调用图 | `call_graph.cpp` | 构建调用图（辅助 remove_unused） |

编译器优化级别：
- `-O1/-O2/-O3`：代码生成优化级别（`-O2` 官方推荐稳定优化）
- `-Of`：for 语句优化（SPARROW 默认）
- `-Ol`：let 语句优化（不建议）
- `-Osc`：self data-constraint 优化（`@data_constraint` 生效的关键）

## 8.6 层五：Soufflé 执行（内嵌引擎）

`engine.cpp::run_souffle` 直接以库方式调用 Soufflé（而非 fork 子进程）：

```cpp
const auto exitcode = souffle_engine::souffle_entry(
    config.at(option::cli_executable_path).c_str(),
    "<input>", souffle_content.c_str(),
    fact_path, "", "", 0, verbose, argv.data());
```

关键点：

1. **禁用 Soufflé 慢 transformer**（`engine.cpp:385`）：

```cpp
argv.push_back(
    "--disable-transformers="
    "SubsumptionQualifierTransformer,"
    "SemanticChecker,"
    "MinimiseProgramTransformer");
```

> 注释说明：这些 transformer 的**工作已由 Gödel 语义分析与 IR passes 提前完成**，所以跳过以提速。这印证了"前端越重，后端越快"的设计。

2. **性能分析**（`--enable-souffle-profiling`）：生成 `souffle.prof.log` + `--index-stats`，可定位 join 瓶颈。
3. **多输出合并**（`engine.cpp:443`）：多个 output 谓词会生成多个临时 JSON，最后合并成一个 `{"fn1": [...], "fn2": [...]}`。

## 8.7 后端扩展：get_field_by_index

`godel-backend/extension/library.cpp` 全文只有一个函数：

```cpp
extern "C" souffle::RamDomain get_field_by_index(
    souffle::SymbolTable* symbolTable,
    souffle::RecordTable* recordTable,
    souffle::RamDomain arg, souffle::RamDomain total, souffle::RamDomain index) {
    const souffle::RamDomain* myTuple = recordTable->unpack(arg, total);
    return myTuple[index];
}
```

- `RamDomain` 是 Soufflé 的内部值类型（有符号整数，通过 SymbolTable 索引字符串）。
- schema 在 Soufflé 里是 **record**（打包的 tuple），字段访问就是 `get_field_by_index(record, total_fields, field_index)` 解包。
- 这是 Gödel 与 Soufflé 之间唯一的 C 扩展胶水层，其余全部由代码生成完成。

## 8.8 编译期 vs 运行期的分工

| 阶段 | 何时 | 做什么 |
| --- | --- | --- |
| 词法/语法 | 编译期 | 文本 → AST |
| 语义 | 编译期 | 类型检查、schema 继承展开、ungrounded 检查、符号解析 |
| IR 生成 | 编译期 | AST → LIR → Soufflé 文本 |
| IR 优化 | 编译期 | inst_combine/remove_unused/reorder |
| Soufflé 求值 | 运行期 | facts 装载、规则推导到不动点、输出 |

> 一句话：**Gödel 前端负责把"面向对象的声明式语言"编译成"扁平的关系推导程序"**；所有继承、方法、多态、schema 构造都在编译期被"展开"成 Soufflé 谓词，运行期只剩纯 Datalog 求值。这正是它能承载大规模代码库的原因。
