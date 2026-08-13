# 第 10 章 COREF 模型与 oid/URI 机制

> 本章回答 COREF 最核心的工程问题：**实体如何标识（oid）、如何保证全局唯一、如何跨语言对齐**。这是 CodeFuse-Query "语言无关"主张的技术基石，也是评估大型代码库时最容易被忽视的风险点。

## 10.1 oid：COREF 的身份证

每个 COREF 实体都有一个 `oid`（Object Identifier），它是跨表关联的外键。

### 10.1.1 类型定义

`language/cfamily/extractor/Coref/CorefDef.hpp`：

```cpp
using CorefOid = long;   // 64 位有符号整数
```

### 10.1.2 生成算法：URI 哈希

`Coref/CorefUri.cpp`：

```cpp
const std::string URI_TEMPLATE = "coref://{0}?path={1}";   // {corpus}?path={signature}

CorefOid CorefUri::generateOId(corpus, signature) {
    return Hash::hashString(generateCorefUri(corpus, signature));
}
// 即 oid = hash("coref://<corpus>?path=<signature>")
```

关键点：

1. **corpus**（语料库名）：区分不同代码库。同一符号在不同 corpus 下 oid 不同。
2. **signature**（签名）：区分同一 corpus 内的不同实体。**不同语言、不同实体类型的签名生成方式不同**（见下）。
3. **哈希**：`Hash::hashString`（`Coref/Utils/Hash.cpp`，64 位字符串哈希）。

## 10.2 C/C++ 的签名生成（位置签名）

`Coref/SignatureGenerator.cpp` 揭示了关键差异：

```cpp
// 语句/声明/TypeLoc：用"位置签名"
std::string SignatureGenerator::generate(const clang::Stmt* stmt, ctx) {
    return generateLocationSignature(ctx.getSourceManager(), stmt->getSourceRange());
}
std::string SignatureGenerator::generateLocationSignature(sm, range) {
    return range.printToString(sm);   // 形如 </test.cpp:13:3, line:14:27>
}

// 类型：用"类型字符串"
std::string SignatureGenerator::generate(const clang::QualType* qt, ctx) {
    return qt->getAsString(ctx.getPrintingPolicy());
}
```

**这是评估报告的关键论据**：C/C++ 的 oid 本质是**基于"文件路径+起止行列"的哈希**，而非基于符号语义（如限定名、签名）的稳定标识。后果：

| 后果 | 影响 |
| --- | --- |
| 代码改动行号 → oid 变化 | 跨版本、增量对齐困难 |
| 同一符号在不同编译单元位置不同 → oid 不同 | 无法直接用 oid 做跨单元符号统一 |
| 头文件 vs 源文件声明 | 依赖 `getCanonicalDecl()`（`FieldDecl` 用它）部分缓解 |

> 注意 `Location` 的 oid 也有 TODO：`// TODO location oid is the same as the node's oid for now, should improve it`（`CorefASTVisitor.cpp:113`）——当前 location oid 与节点 oid 相同，未来会改进。

## 10.3 Java 的签名生成（语义哈希）

Java 抽取器用 `hash_id`（如 `element_hash_id`、`location_hash_id`），从 DDL（`coref_db_ddl.sql`）可见字段以 `_hash_id` 结尾，是基于**符号语义**（FQN、签名等）生成的稳定哈希。

> 结论：Java 的 oid 语义稳定（可跨版本对齐），C/C++ 的 oid 位置敏感（改动即变）。这是两者"成熟度"差异的深层技术原因之一。

## 10.4 表结构对比：数据模型层面的差距

| 维度 | Java | C/C++（cfamily） |
| --- | --- | --- |
| 物理表数量 | **128**（`coref_db_ddl.sql`） | **59**（`Models.hpp`） |
| 注释/文档 | `javadoc_comment`、`javadoc_tag`、`javadoc_data_token`、`javadoc_tag_value` 等 | ❌ 无 |
| 独立调用图表 | `callable_binding(caller_hash_id, callee_hash_id)` | ❌ 无，调用边散落 `CallExpression` |
| 修饰符 | `modifier`、`modifier_list` | ❌ 无 |
| 完整类型系统 | `primitive`、`type_parameter`、`reference_type` 等 | `Type`/`QualifiedType`/`PointerType`/`TagType` 简化版 |
| 语句/表达式覆盖 | 130+ 细分（lambda/assert/synchronized/yield...） | 约 20 种控制流语句 |

### 10.4.1 Java 的 128 张表（节选）

```
class, class_hierarchy, class_implement_list, interface, method, constructor,
field, parameter, local_variable, annotation, modifier, javadoc_comment,
callable_binding, callable_enclosing_statement, comment, literal, identifier,
binary_expression, if_statement_with_else, for_statement, lambda_expression,
token, location, program, file, folder, module, ...
```

### 10.4.2 C/C++ 的 59 张表（节选）

```
Declaration, FunctionDeclaration, VariableDeclaration, FieldDeclaration,
CxxRecordDeclaration, ClassHierarchy, CallExpression, CxxMemberCallExpression,
IfStatement, ForStatement, WhileStatement, SwitchStatement, Type, PointerType,
Location, SymbolTable, ...（Objective-C 约 15 张）
```

## 10.5 C/C++ 模型的表字段结构

`Models.hpp` 用"骨架字段 + 特化字段"模式：

```cpp
// 声明骨架
struct Declaration {
    CorefOid oid;
    CorefOid parentOid;      // 语法树父节点
    int indexOrder;          // 兄弟节点序号
    CorefOid locationOid;    // → Location
    std::string kindName;    // 节点种类名
    std::string debugMessage; // printable text（源码文本）
};
// 调用边
struct CallExpression {
    CorefOid oid;
    CorefOid calleeDeclarationOid;  // 被调用声明 → 形成调用边
};
// 继承边
struct ClassHierarchy { CorefOid childOid; CorefOid parentOid; };
```

## 10.6 存储层：sqlite_orm 模板 ORM

`Storage/StorageFacade.hpp` 用 **sqlite_orm**（第三方库，固定 commit）做对象关系映射：

```cpp
template <typename T> static inline void insertClassObj(T&& obj) {
    auto storage = coref::Storage::getInstance().getStorage();
    auto statement = storage->prepare(replace(std::forward<T>(obj)));  // INSERT OR REPLACE
    storage->execute(statement);
}
static inline void transaction(fn) { storage->transaction(fn); }
```

- `insertClassObj<T>`：模板化插入（`INSERT OR REPLACE`）。
- `transaction`：事务包装，批量写入提升性能。
- `checkDeclOidExist`/`getDeclNameByOid` 等：供 visitor 判断去重/查询。

> `Storage.hpp` 与 `Models.hpp` 一样是 jinja 模板生成（`.j2` 源），改模型需改 `.j2` 再重新生成。

## 10.7 oid 机制对"语言无关"的意义与边界

- **意义**：所有语言的实体都用统一 URI→hash 规则标识，查询语言可以跨语言用同一套 `oid` 关联逻辑；COREF 标准模型 + 统一标识 = 数据中心设计的基础。
- **边界**：
  1. **corpus 隔离**：不同代码库天然隔离（URI 含 corpus）。
  2. **签名语义不一**：Java 语义稳定 vs C++ 位置敏感，导致**跨语言的对齐精度不一致**。
  3. **哈希碰撞**：64 位哈希理论上存在碰撞（`Hash::hashString` 未做开放寻址校验），在亿级实体下是低概率但非零风险。

## 10.8 对大型 C/C++ 库的直接推论

1. **增量/变更分析受限**：oid 随行号漂移，无法像 Java 那样用稳定 hash_id 做跨版本 diff。变更分析需按"文件+行号"定位（这正是 ICSE 论文 change impact 的输入约定），而非依赖 oid 稳定性。
2. **跨编译单元符号统一难**：同一函数声明在多处出现会得到不同 oid（位置不同），需要额外的符号合并逻辑（目前 `getCanonicalDecl` 只对部分节点生效）。
3. **抽取必须可复现**：位置签名依赖编译环境稳定；环境变化（路径、行号）会改变 oid。

> 这些机制细节是评估报告"可行但需规划"结论的技术根源。
