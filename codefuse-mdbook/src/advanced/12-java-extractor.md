# 第 12 章 Java 抽取器与成熟度对比

> 本章分析 Java 抽取器（`language/java/extractor/`）——所有语言中"最成熟"的代表，并逐项对比 C/C++。理解差距，才能理解 C/C++ 落地的真实工作量。

## 12.1 Java 抽取器的技术栈

| 项 | 值 |
| --- | --- |
| 解析器 | **IntelliJ IDEA PSI**（`com.intellij` 语法/语义模型，非纯 AST） |
| 项目模型 | `project/ProjectBuilder.java`、`PsiProject.java`（构建 PSI 工程） |
| 持久层 | **MyBatis** + sqlite（`dal/mybatis/mapper/*.java`） |
| DDL | `resources/coref_db_ddl.sql`（128 张表） |
| 入口 | `Extractor.java`（`Configuration.java` 配置） |
| 构建 | Maven（`pom.xml`） |

> 与 C++（Clang libTooling + sqlite_orm 模板 ORM）相比，Java 用 **PSI 语义模型 + MyBatis 显式 mapper**，抽取的是"带完整语义解析"的代码数据，这解释了为什么 Java 成熟度最高。

## 12.2 表结构：128 张物理表

`coref_db_ddl.sql` 使用 `_hash_id` 字段（**语义哈希**，跨版本稳定），核心表：

### 12.2.1 文档/注释（C++ 完全缺失的部分）

```
javadoc_comment, javadoc_tag, javadoc_data_token, javadoc_tag_value, comment
```

### 12.2.2 调用图（独立表）

```
callable_binding (caller_hash_id, callee_hash_id)     -- 直接调用边
callable_enclosing_statement                            -- 语句→方法
```

### 12.2.3 类与继承

```
class, class_hierarchy, class_implement_list, interface, method, constructor, field
```

### 12.2.4 语法全量覆盖

```
binary_expression, unary_expression, lambda_expression, assignment_expression,
array_access_expression, conditional_expression, instanceof_expression,
if_statement_with_else, if_statement_without_else, for_statement, foreach_statement,
switch_statement, try_statement_with_finally, synchronized_statement,
assert_statement, yield_statement, ...
```

### 12.2.5 元信息

```
token, modifier, modifier_list, type_parameter, reference_type, primitive,
location, program, file, folder, module, metainfo, number_of_lines
```

## 12.3 MyBatis 持久层架构

`dal/mybatis/mapper/` 下每个表对应：
- `XxxMapper.java`（数据访问接口）
- `XxxDynamicSqlSupport.java`（MyBatis Dynamic SQL 列定义）

例如 `MethodMapper.java`、`ClassHierarchyMapper.java`、`JavadocDataTokenMapper.java`。这是典型的"代码生成 + ORM"模式，抽取器把 PSI 元素映射为 DTO 后经 MyBatis 写入 sqlite。

## 12.4 与 C/C++ 的逐项对比

| 维度 | Java | C/C++（cfamily） |
| --- | --- | --- |
| 解析器 | IntelliJ PSI（完整语义） | Clang libTooling（AST + 部分语义） |
| 物理表 | 128 | 59 |
| 注释/文档 | ✅ 完整（javadoc + comment） | ❌ 无 |
| 独立调用图 | ✅ `callable_binding` | ❌ 散落 `CallExpression` |
| 修饰符/注解 | ✅ `modifier`/`annotation` | ❌ 无 |
| 模板/泛型 | ✅ `type_parameter` | ⚠️ 按实例化 |
| oid | ✅ 语义 `hash_id`（稳定） | ⚠️ 位置签名（敏感） |
| 完整类型系统 | ✅ `primitive`/`reference_type` | ⚠️ 简化 |
| CFG | 部分支持（README 提及） | ❌ |
| 增量抽取 | ✅ `--incremental` + 远程缓存 | ❌ 无 |
| 白名单 | ✅ `white-list` | ❌ 无 |

## 12.5 成熟度差异的根因

1. **解析器能力**：PSI 是"完整语义解析器"（能解析类型、引用、注解、javadoc），Clang 抽取器只用了 AST 层（`Visit*` 重载），未接 `CFG`、`Comment`、`Preprocessor` 等 Clang 能力。
2. **oid 设计**：Java 用语义哈希（符号 FQN 等），C++ 用位置签名。
3. **投入**：Java 是首个语言，模型经过多年打磨；C++ 标记 Beta，Tests 仅有单文件语法样例。

## 12.6 对 C/C++ 落地的启示

- **不要拿 Java 的成熟度预期 C++**：注释率、稳定变更 diff、完整调用图等 Java 能力，C++ 需要二次开发。
- **可借鉴 Java 的模型设计**：若为 C++ 补注释/独立调用图，可对照 Java 的 `javadoc_comment`、`callable_binding` 表结构设计 C++ 的对应表。
- **oid 是最大技术债**：C++ 位置签名 oid 是增量/跨版本分析的硬伤，若有此需求，需把 oid 改为语义签名（改动 `SignatureGenerator`）。

## 12.7 小结

Java 抽取器 = "PSI 完整语义 + 128 表 + 语义哈希 oid + MyBatis"，代表 CodeFuse-Query 的"目标态"；C++ 抽取器 = "Clang AST + 59 表 + 位置签名 oid + sqlite_orm"，代表"进行态（Beta）"。两者差距主要在**注释、调用图、oid 稳定性、类型系统**四个维度。
