# 第 6 章 典型分析示例

本章摘录仓库 `example/` 中若干有代表性的 GödelScript，帮你建立"问题 → 查询"的直觉。代码均来自仓库原文，可对照学习。

## 6.1 圈复杂度计算（Java）

`example/CodeFuse/CyclomaticComplexityJava.gdl` 展示了用声明式规则描述"判定节点数 + 1"这类度量。

```rust
// script
use coref::java::*

fn default_db() -> JavaDB {
    return JavaDB::load("coref_java_src.db")
}

// 判定类型：if/for/while/case/&&/||/catch 等
fn isDecisionExpression(e: Expression) -> bool {
    if (e.is<IfStatement>() || e.is<ForStatement>() || e.is<WhileStatement>()
        || e.is<DoStatement>() || e.is<SwitchStatement>() || e.is<CatchClause>()) {
        return true
    }
    if (e.is<BinaryOperator>() && (e.getOperatorType() = "&&" || e.getOperatorType() = "||")) {
        return true
    }
    if (e.is<ConditionalOperatorExpression>()) {
        return true
    }
}

fn cyclomaticComplexityOfMethod(m: Method) -> int {
    for (s in Statement(default_db())) {
        // 统计方法体内的判定点
    }
}
```

> 核心技巧：用 `is<T>()` 做类型下转判断；用 `getOperatorType()` 识别逻辑运算符。仓库还提供了 `MethodComment`、`CommentRatio` 等代码质量类示例（`example/CodeFuse/`）。

## 6.2 调用链分析（Java，可指定入口）

`example/java/CallChain.gdl` 是调用图分析的经典写法——先定义"指定的可调用者集合"，再求**直接/间接**被调用者（递归传递闭包）。

```rust
// script
use coref::java::*

pub fn default_java_db() -> JavaDB {
    return JavaDB::load("coref_java_src.db")
}

// 指定入口方法签名（按需修改）
pub fn specified_callable_signature(name: string) -> bool {
    [
        {"com.alipay.demo.Main.test:void()"},
        {"xxx"},
        {"xxx"}
    ]
}

// 限定在指定集合内的可调用者
schema SpecifiedCallable extends Callable {}

impl SpecifiedCallable {
    @data_constraint
    pub fn __all__(db: JavaDB) -> *Self {
        for(c in Callable(db)) {
            if (specified_callable_signature(c.getSignature())) {
                yield SpecifiedCallable { id: c.id }
            }
        }
    }
}

// 间接调用边：a 的祖先被调用者 b，且 b 又调用 c
pub fn getIndirectEdges(b: Callable, c: Callable) -> bool {
    for(a in SpecifiedCallable(default_java_db())) {
        if (b in a.getAnAncestorCallee() && c in b.getCallee()) {
            return true
        }
    }
}

// 直接调用边
pub fn getDirectEdges(b: Callable, c: Callable) -> bool {
    for(a in SpecifiedCallable(default_java_db())) {
        if (c in a.getCallee() && b.key_eq(a)) {
            return true
        }
    }
}

pub fn output_signature(caller: string, callee: string) -> bool {
    for(b in Callable(default_java_db()), c in Callable(default_java_db())) {
        if (getIndirectEdges(b, c) || getDirectEdges(b, c)) {
            return caller = b.getSignature() && callee = c.getSignature()
        }
    }
}

pub fn main() {
    output(output_signature())
}
```

> 学习要点：`schema X extends Callable` + 自定义 `__all__` 是"过滤/定制集合"的标准手法；`getAnAncestorCallee()` 是库中提供的**递归祖先调用者**方法，一次调用即得传递闭包。

## 6.3 类继承关系（Java）

`example/java/ClassHierarchy.gdl`：

```rust
// script
use coref::java::*

fn default_db() -> JavaDB {
    return JavaDB::load("coref_java_src.db")
}

fn classHierarchy(child: string, parent: string) -> bool {
    for (class in Class(default_db())) {
        for (superClass in class.getAnAncestorClass()) {
            if (child = class.getName() && parent = superClass.getName()) {
                return true
            }
        }
    }
}

fn main() {
    output(classHierarchy())
}
```

> `getAnAncestorClass()` 返回所有祖先类集合，Datalog 递归在此表现得非常优雅。

## 6.4 函数注释率（Go）

`example/go/FunctionComment.gdl` 展示如何借助库方法判断"函数是否有注释"：

```rust
// script
use coref::go::*

fn default_db() -> GoDB {
    return GoDB::load("coref_go_src.db")
}

fn hasCommentFunction(f: Function) -> bool {
    let (doc = f.getDocumentation()) {
        if (doc.getContent() != "") {
            return true
        }
    }
}
```

## 6.5 基于 XML 的依赖分析（Spring Bean）

`example/xml/GetBean.gdl` 展示 XML 配置文件查询（分析 `applicationContext.xml` 中的 bean 定义）：

```rust
// script
use coref::xml::*

fn default_db() -> XmlDB {
    return XmlDB::load("coref_xml_src.db")
}

fn getBean(id: string, class: string) -> bool {
    for (element in XmlElement(default_db())) {
        if (element.getName() = "bean") {
            if (id = element.getAttr("id")) {
                if (class = element.getAttr("class")) {
                    return true
                }
            }
        }
    }
}
```

## 6.6 ICSE 2025 论文复现（微服务变更影响分析）

`example/icse25/` 包含了论文 *Datalog-Based Language-Agnostic Change Impact Analysis for Microservices* 的全部规则（`rules/rule1.gdl` … `rules/rule19.gdl`、`ecgforpom.gdl`、`ecgforspring.gdl` 等），覆盖：

- 变更入口识别（HTTP 入口、HSF/服务入口）
- 从入口到变更方法的调用链路
- 数据库操作（表、操作类型）
- 配置文件（POM、Spring）影响

这是"语言无关"思想的最佳实证：同一套分析逻辑，通过不同语言的 COREF 库复用。参考 `example/icse25/procedure.md` 与 `motivation example.md`。

## 6.7 编程模式小结

| 需求 | 模式 |
| --- | --- |
| 遍历某类实体 | `for (x in SchemaName(db))` |
| 按属性过滤 | `if (cond(x))` + 绑定比较 `=` |
| 定制实体集合 | `schema My extends Base` + 自定义 `__all__` |
| 传递闭包/图遍历 | 库方法 `getAnAncestor*` / 自写递归 `yield` |
| 多表联结 | 多重 `for` + 外键 `oid` 相等 |
| 输出 | `main(){ output(f()) }` 或 `@output` 注解 |
| 类型判断 | `x.is<T>()`、`x.to<T>()`、`x.key_eq(y)` |

下一部分进入进阶级：Gödel 语言全量语法。
