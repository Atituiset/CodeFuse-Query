# 第 7 章 Gödel 语言深入

> 本章基于 `godel-script/docs/language-reference/` 全量文档与 `language/cfamily/lib/`、`example/` 的实战代码编写。

## 7.1 程序结构

GödelScript 程序可包含以下组成部分（顺序不限，但 `// script` 必须位于**首行**）：

```rust
// script
use coref::java::{Annotation, Class, JavaDB}   // ① 导入
enum Status { running, suspend }                // ② 枚举
schema Student { @primary id: int, name: string } // ③ schema 声明
database NewDB { file: *File }                  // ④ 数据库声明
impl Student { ... }                            // ⑤ 方法实现
fn getStudents() -> *Student { ... }            // ⑥ 函数
query get_all from ... select ...               // ⑦ 查询声明（语法糖）
fn main() { output(getStudents()) }             // ⑧ 入口
```

## 7.2 类型系统

### 7.2.1 基础类型

`bool`、`string`、`float`、`int`。集合类型用 `*T` 前缀：`*int`、`*string`、`*Annotation`。

### 7.2.2 string 内建方法（`docs/language-reference/type.md`）

```rust
to_int() substr(begin,len) len() get_regex_match_result() matches() contains()
to_set() to_upper() to_lower() replace_all() replace_once()
```

### 7.2.3 int 内建方法

```rust
bitxor() bitor() bitand() rem() pow() le() lt() gt() ne() ge() eq()
div() mul() sub() add() bitnot() neg() to_string() range(begin,end) -> *int  to_set()
```

### 7.2.4 集合聚合（对 `*T` 生效）

```rust
fn len(self: *T) -> int;      // 集合大小
fn sum(self: *int) -> int;    // 求和
fn min(self: *int) -> int;
fn max(self: *int) -> int;
fn find(self: *T0, instance: T1) -> T0;  // 查找
```

> 聚合是 Datalog 中"汇总计算"的关键工具，常用于代码度量。

## 7.3 Schema 与继承

### 7.3.1 声明与主键

```rust
schema Student {
    @primary id: int,
    name: string,
    phone: string
}
```

### 7.3.2 全集构造器 `__all__`

GödelScript 要求每个 schema 提供 `pub fn __all__(...)` 作为"全集"（universal set），类似构造函数。只接受 `__all__` 这个名字。

从数据库加载（最常用）：

```rust
impl Student {
    pub fn __all__(db: DB) -> *Student {
        return db.students
    }
}
```

从字面量构造（测试用）：

```rust
impl Student {
    pub fn __all__() -> *Student {
        yield Student {id: 1, name: "zxj", phone: "11451419"}
        yield Student {id: 2, name: "fxj", phone: "11451419"}
    }
}
```

> 注意：初始器创建出的实例**必须**存在于该 schema 的全集中，否则创建失败。

### 7.3.3 继承

```rust
schema Lee extends Student {
    for_example: int   // 父类字段排前面，自动继承
}
```

- 方法自动继承（除 `__all__`）。
- 可覆盖（override）同名方法。
- 初始化继承 schema 用 spread 语法：

```rust
impl Lee {
    pub fn __all__(db: DB) -> *Lee {
        for (parent in Student(db)) {
            yield Lee { ..parent, for_example: 114 }
        }
    }
}
```

> 库中大量用 `schema SpecifiedCallable extends Callable {}` + 自定义 `__all__` 来**按业务过滤全集**（见 `example/java/CallChain.gdl`）。

### 7.3.4 比较与类型转换

| 方法 | 说明 |
| --- | --- |
| `a.key_eq(b)` / `key_neq` | 按主键比较（要求 schema 有 int 主键） |
| `x.to<T>()` | 转换为另一 schema（duck-type 检查） |
| `x.is<T>()` | 判断 x 是否在 T 的全集中（类型下转判断） |

## 7.4 Database

```rust
database School {
    student: *Student,
    classes: *Class as "class"   // 表名冲突时用 as 映射真实表名
}
```

- 表名即 SQLite 表名（运行 Soufflé 时按此读表）。
- 加载数据库：`DB::load("example.db")`，**参数必须是字符串字面量**。

```rust
fn default_db() -> School {
    return School::load("example_db_school.db")
}
```

## 7.5 语句

### 7.5.1 for（集合遍历）

```rust
for (a in Annotation(db), c in Class(db), m in Method(db)) {
    ...
}
```

从左到右初始化；每个变量来自一个**集合**。

### 7.5.2 let（单值绑定）

```rust
let (file = c.getLocation().getFile(), name = a.getName()) {
    ...
}
```

### 7.5.3 if（条件）

```rust
if (xxxxx) { ... }
```

> **不支持 `else`**：else 分支在 Soufflé 中易引发 ungrounded error。用 `||` 或拆分函数表达相反分支。

### 7.5.4 match

```rust
match(type) {
    0 => return true,
    1 => return false,
    2 => for (b in BinaryOperator(db)) { ... }
}
```

- 匹配变量须为 `int` 或 `string`；匹配值必须是字面量。

### 7.5.5 Fact 语句（实验性）

生成临时事实集，一旦使用则函数内不允许其他语句；数据只能是 int/string 字面量：

```rust
fn multi_input_test(a: int, b: string) -> bool {
    [{1, "1"}, {2, "2"}, {3, "3"}]
}
```

### 7.5.6 return 与 yield

```rust
return 0      // 单值返回
yield 0       // 集合返回（*T）
yield int_set()   // 可 yield 另一个集合
```

## 7.6 表达式

### 7.6.1 运算符

| 类别 | 运算符 |
| --- | --- |
| 数学 | `+` `-` `*` `/` |
| 比较 | `=`（绑定比较）`<` `>` `<=` `>=` `!=` |
| 逻辑 | `&&` `\|\|` |
| 一元 | `!` `-` |

> **`=` 是绑定操作符**：若左侧未绑定，则绑定并返回 true。这是 Gödel 写的"赋值"方式，但语义是逻辑绑定。

### 7.6.2 调用链

- 函数调用：`global_function(a, b)`
- 字面量调用：`"hello".len()`、`(1+2).add(3)`
- 字段访问：`stu.name`、`db.students`
- 静态调用：`Student::type()`、`DB::load("x.db")`
- 枚举成员：`Status::running`

### 7.6.3 初始化器（Initializer）

```rust
return Student {id: 0, name: "xxx"}   // 实例必须存在于全集中
yield Lee { ..parent, for_example: 114 }  // spread 展开
```

## 7.7 Query 声明（语法糖）

`query` 语法自动等价于一个 `@output fn`：

```rust
query this_is_example_query from
    anno in Annotation(db()),
    class in Class(db()),
    loc in class.getLocation()
where
    anno = class.getAnnotation() &&
    loc.getFile().getRelativePath().contains(".java")
select
    anno.getName() as annotationName,
    loc.getFile() as fileName,
    class.getName()
```

等价展开为 `@output fn`（见 `docs/language-reference/queries.md`）。

## 7.8 输出机制

- 旧式：`fn main() { output(f()) }`，`output` 只能在 main 中调用。
- 新式：`@output` 注解函数，直接输出。

```rust
@output
pub fn hello() -> string {
    return "Hello World!"
}
```

## 7.9 包管理与导入

`-p {package dir}` 启用包管理。扫描目录下所有 `.gdl`/`.gs`，相对路径映射为包路径：

```
Library
|-- coref.java.gdl
+-- coref
    +-- a.gdl
=>
coref::java
coref::a
```

- 文件名为纯数字或含 `-` 等非法字符会被**忽略**。
- 包路径冲突会**报错终止**。

导入：
```rust
use coref::java::*                    // 全量
use coref::java::{Annotation, Class}  // 部分
```

## 7.10 高级技巧与陷阱

| 技巧/陷阱 | 说明 |
| --- | --- |
| 多重 `for` 是大规模计算主因 | 联结数 × 各集合规模，注意裁剪（先过滤再联结） |
| `=` 双向绑定 | `a = b` 若 a 未绑定、b 有值则绑定 a；反过来亦然。利用它做"反向查找" |
| 递归必须收敛 | Datalog 终止性保证，但避免写无界字符串拼接导致的爆炸 |
| `@data_constraint` | 库中 `__all__` 常见注解，标识该全集受数据约束，供编译器优化 |
| `@inline` | 建议内联，小函数加注解减少中间表 |
| `is<T>()` 成本 | 每调用一次是一次全集查找，批量场景尽量一次取全集再过滤 |

## 7.11 手写一个 C++ 规则（完整示例）

目标：找出所有 C++ 中"在 for 循环里调用同一函数"的模式（近似死循环调用），只作为语法综合练习：

```rust
// script
use coref::cfamily::*

fn default_db() -> CfamilyDB {
    return CfamilyDB::load("coref_cfamily_src.db")
}

fn callInFor(file: string, line: int, callee: string) -> bool {
    for (c in CallExpression(default_db())) {
        // 判断该调用是否位于某个 ForStatement 的循环体内
        // getAnAncestor() 来自 Statement（Statement.gdl），返回祖先 ElementParent
        for (anc in c.getAnAncestor()) {
            if (anc.is<ForStatement>()) {
                if (callee = c.getPrintableText()) {
                    let (loc = c.getLocation()) {
                        // Location 字段：start_line_number / file_oid（Location.gdl）
                        if (file = loc.getFile().relative_path) {
                            if (line = loc.start_line_number) {
                                return true
                            }
                        }
                    }
                }
            }
        }
    }
}

fn main() {
    output(callInFor())
}
```

> API 依据（`language/cfamily/lib/`）：`Statement.getAnAncestor() -> *ElementParent`（Statement.gdl）、`CallExpression.getCalleeDeclaration() -> Declaration`（Expression.gdl）、`Location.getFile() -> File` 与字段 `start_line_number`（Location.gdl）、`File.relative_path`（Container.gdl）。`ElementParent.is<ForStatement>()` 是 schema 全集类型判断（第 7.3 节）。
