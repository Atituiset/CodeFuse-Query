# 第 9 章 名称修饰与 Soufflé 代码生成

> 本章揭示 Gödel 符号如何"翻译"成 Soufflé 谓词——即 `ir/name_mangling.cpp` 与 `ir/ir_gen.cpp` 的核心机制。理解它，你就能看懂 `--souffle-debug` 的输出、预判命名冲突、诊断 ungrounded 错误。

## 9.1 为什么需要名称修饰

Gödel 的命名空间（`coref::java::Method`）、schema 字段、方法名，需要映射到 Soufflé 的扁平谓词名与变量名。若直接拼接，会遇到两类问题：

1. **字段名与局部变量名冲突**。见 `name_mangling.cpp` 注释中的经典例子：

```rust
schema test { a: int }
impl test {
    pub fn __all__() -> *test {
        for(a in int::range(0, 10)) { yield test{a: a}; }
    }
}
```

若不修饰，生成的 Soufflé 里 `a = a` 会混淆"字段 `test.a`"与"循环变量 `a`"，导致 **ungrounded error 或空结果**。

2. **跨包/跨模块同名**。`coref::java::Class` 与 `coref::cfamily::Class` 需要区分。

## 9.2 四种修饰规则（name_mangling.cpp）

### 9.2.1 字段修饰 `field_mangle`

字段名统一加 `fld?` 前缀（Soufflé 标识符允许 `?` 字符）：

```cpp
return "fld?" + name;
```

于是 `test.a` → 变量 `fld?a`，与循环变量 `a` 区分。

### 9.2.2 路径压缩 `mangle`

把 `::` 路径转成"长度+名称"的紧凑形式（类似 JNI 命名）：

```cpp
// coref::java::Method  →  "4coref4java6Method"
```

### 9.2.3 类型修饰 `type_mangle`

自定义 schema 类型加 `T_` 前缀；基础类型保留原名：

```cpp
{"number","int","string","symbol","float","bool","DBIndex"} // 保留
// 其余 → "T_" + mangle(name)
```

### 9.2.4 规则修饰 `rule_mangle`

按规则名前缀映射到不同字母前缀：

| Gödel 前缀 | Soufflé 前缀 | 含义 |
| --- | --- | --- |
| `rule_` | `R_` | 普通规则/函数 |
| `schema_` | `S_` | schema 构造器（`__all__`） |
| `input_` | `I_` | 输入表（数据库表加载） |
| `get_field_` | `GF_` | 字段访问器 |
| `get_table_` | `GT_` | 表访问器 |
| `typecheck_` | `TC_` | 类型检查谓词 |

未知前缀会 `assert(false)`（`// unknown rule name`），说明 IR 生成层对规则名有严格约定。

## 9.3 schema 在 Soufflé 中的表示

结合 `lir.h` 与 `name_mangling.cpp`：

- **带 key 的 schema** → `inst_ctor`（构造器），生成谓词 `schema_xxx(result, [-1,-1], fld?a, fld?b, ...)`——第一个参数是主键，`[-1,-1]` 是主键索引，后续是各字段。
- **无 key 的初始器** → `inst_record`，生成 Soufflé record `[a, b, c]`。
- **字段访问** → `get_field_xxx` 谓词 + `get_field_by_index` C 扩展解包。

## 9.4 一个代码生成实例

Gödel 侧：

```rust
schema Student { @primary id: int, name: string }
impl Student {
    pub fn __all__(db: DB) -> *Student { return db.students }
    pub fn getName(self) -> string { return self.name }
}
```

大致会生成（示意，非精确）：

```
// 输入表映射
.decl I_student(id: number, name: symbol)   // db.students → SQLite 表

// schema 全集构造器（@data_constraint 优化后直接引用输入）
S_student(result, [-1,-1], fld?name) :-
    I_student(fld?id, fld?name), result = fld?id.

// 字段访问器
GF_getName(self, fld?name) :-
    S_student(self, [-1,-1], fld?name).
```

用 `--souffle-debug`（`godel ... --souffle-debug`）可 dump 出真实的 Soufflé 文本，建议读者亲自观察一次。

## 9.5 block 的 `;` 与 `,` 语义

`lir.h::block` 有一个 `flag_use_semi` 标志，注释明确：

> 在 Soufflé 中：`;` 表示 **or**，`,` 表示 **and**。

这解释了 Gödel 文档中"函数内多条语句之间是 or 条件，且执行顺序由 Soufflé 调度"的深层原因——Gödel 的语句块被翻译成 Soufflé 规则体中的 `;`（析取）分支。

## 9.6 IR 生成器（ir_gen.cpp，2515 行）

`ir_gen.cpp` 是 AST → Soufflé 文本的最大文件，职责包括：

1. **上下文管理**：`ir_context.cpp`（515 行）维护 IR 生成时的符号到 Soufflé 名的映射、输出谓词列表。
2. **谓词声明**：为每个 schema/func/database 声明 `.decl` 与 `.type`。
3. **规则体生成**：把 LIR 指令流翻译为 Soufflé 规则体（clause）。
4. **输出处理**：`@output`/`main` 里的 `output()` 生成 `.output` 声明，记录到 `souffle_output` 列表（`engine.cpp` 据此合并 JSON）。

## 9.7 对使用者的实际影响

| 现象 | 根因（现在你能看懂了） |
| --- | --- |
| ungrounded error | 变量未绑定：字段/变量重名、`else` 分支、`let` 绑定集合等 |
| 空结果但数据存在 | 名称修饰导致字段误绑（如自引用 schema 未正确 yield） |
| 大中间关系 | join 顺序：可用 `--enable-souffle-profiling` 看 `souffle.prof.log` |
| 编译慢 | IR passes 与 Soufflé 编译；`-O2` 稳定、`-O3` 更激进 |
| 想读懂底层 | `godel <script> --souffle-debug` dump 生成的 Soufflé |

## 9.8 小结

- Gödel 是"编译器"，不是"解释器"：面向对象的语法糖在**编译期**被彻底展平为 Soufflé 谓词。
- 名称修饰（`fld?`、`R_/S_/I_/GF_`、长度压缩）保证扁平化后无冲突、无歧义。
- 运行期只剩 Soufflé 的 Datalog 求值，所以大规模分析性能由 Soufflé 保证。
