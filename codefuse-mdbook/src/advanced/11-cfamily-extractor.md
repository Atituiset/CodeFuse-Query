# 第 11 章 C/C++ 抽取器源码剖析

> 本章逐方法剖析 `language/cfamily/extractor/AST/CorefASTVisitor.cpp`（743 行）——C/C++ 抽取器的核心逻辑。读完你能精确判断：哪些代码结构被抽取、精度如何、有哪些边界情况。

## 11.1 技术栈与执行模型（回顾）

| 项 | 值 |
| --- | --- |
| 解析器 | Clang/LLVM 13 libTooling（真实编译） |
| 存储 | sqlite_orm（INSERT OR REPLACE） |
| 入口 | `main.cpp` → `ClangTool(fcd, allfiles).run(CorefFrontendActionFactory)` |
| oid | `hash("coref://corpus?path=<位置签名>")`（见第 10 章） |

`main.cpp` 读取 `compile_commands.json` 的全部编译单元，逐个编译并遍历 AST。

## 11.2 Visitor 核心工具方法

### 11.2.1 oid 生成（重载）

```cpp
CorefOid getOid(const clang::Stmt* stmt)  // SignatureGenerator::generate(stmt, ctx)
CorefOid getOid(const clang::Decl* decl)  // SignatureGenerator::generate(decl)
CorefOid getOid(const clang::Type* type)  // SignatureGenerator::generate(type, ctx)
CorefOid getOid(const clang::QualType*)   // 转 getTypePtrOrNull
CorefOid getOid(const clang::TypeLoc&)
```

### 11.2.2 父节点获取

```cpp
template <typename NodeT> CorefOid getParentOid(const NodeT& node) {
    // ASTContext.getParents(node) → 首个父节点
    // 按 Stmt / Decl / TypeLoc 分支取 oid
}
```

### 11.2.3 位置

```cpp
Location getLocation(const clang::SourceRange&) {
    // getPresumedLineNumber / getPresumedColumnNumber → 起止行列
    // 注意 TODO：location oid 当前 = node oid（尚未独立）
}
```

### 11.2.4 文本

`astToString(stmt/decl/type)`：`printPretty` / `print` 生成 printable text（存入 `debugMessage`）。

## 11.3 语句抽取（VisitStmt 族）

| 访问器 | 抽取内容 |
| --- | --- |
| `VisitStmt`（通用） | `Statement{oid, parentOid, indexOrder, locationOid, stmtClassName, printableText}` |
| `VisitDeclStmt` | `DeclarationStatement`（局部变量声明语句） |
| `VisitIfStmt` | `IfStatement{oid, cond, then}` + `ElseStatementInIf{else, if}`（若有 else） |
| `VisitSwitchStmt` | `SwitchStatement{oid, cond, switchCaseList}` + 逐个 `SwitchCase{oid, subStmt, nextCase, isDefault}` |
| `VisitWhileStmt` | `WhileStatement{oid, cond, body}` |
| `VisitDoStmt` | `DoStatement{oid, cond, body}` |
| `VisitForStmt` | `ForStatement{oid, init, body, cond, inc}` |
| `VisitCXXForRangeStmt` | `CxxForRangeStatement{oid, body, loopVar, rangeInit}` |
| `VisitValueStmt` | `ValueStatement` |
| `VisitExpr`（通用） | `Expression` |

### 11.3.1 一个值得注意的细节：SwitchCase 反序

```cpp
// Cases are not stored in order, sort them first.
// (In fact they seem to be stored in reverse order, don't rely on this)
```

Clang 内部 `SwitchCase` 链表是**反序**的，visitor 先收集到 vector 再 `rbegin()/rend()` 倒序重建 `nextCase` 指针链，保证 case 顺序正确。这类"编译前端存储顺序陷阱"正是"真编译抽取"要处理的边界情况。

## 11.4 声明抽取（VisitDecl 族）

| 访问器 | 抽取内容 |
| --- | --- |
| `VisitDecl`（通用） | `Declaration{oid, parentOid, indexOrder, locationOid, declKindName, printableText}` |
| `VisitNamedDecl` | `NamedDeclaration{oid, qualifiedNameAsString}` + `SymbolTable{oid, symbolName}` |
| `VisitVarDecl` | `VariableDeclaration` |
| `VisitFieldDecl` | `FieldDeclaration{canonicalDeclOid, typeOid, recordOid}`（用 `getCanonicalDecl` 去重） |
| `VisitDeclaratorDecl` | `DeclaratorDeclaration` |
| `VisitValueDecl` | `ValueDeclaration` |
| `VisitTypeDecl` | `TypeDeclaration{oid, qualTypeOid, printableText}` |
| `VisitTagDecl` | `TagDeclaration{oid, tagKind(class/enum/struct/union/interface), isDefinition}` |

### 11.4.1 符号名生成

`VisitNamedDecl` 调用 `getDeclName` → `sbrella::c7::NameGenerator`（`SymbolNameGenerator.cpp`），处理复杂符号名（含模板参数 `TP(x,y)` → `type-parameter-x-y` 等特殊规则，见 `SymbolNameGenerator.cpp:561` 注释）。

## 11.5 类型抽取（VisitType 族）

```cpp
bool VisitType(const clang::Type* type) {
    if (type->isAnyPointerType()) {
        PointerType{oid, pointeeTypeOid};     // 指针类型记录被指类型
    }
    Type{oid, typeClassName, printableText};  // 通用类型
}
VisitTagType  → TagType{oid, declOid}
VisitObjCObjectType → ObjCObjectType{oid, interfaceOid}
```

## 11.6 调用关系抽取（关键能力）

### 11.6.1 普通函数调用

```cpp
bool VisitCallExpr(const clang::CallExpr* expr) {
    traverseDeclIfNotVisited((clang::Decl*)expr->getCalleeDecl());  // 确保 callee 被抽取
    CallExpression{oid, getOid(expr->getCalleeDecl())};             // 调用边
    for (arg : expr->arguments())
        CallExpressionArguments{argOid, exprOid};                   // 实参
}
```

### 11.6.2 成员调用

```cpp
bool VisitCXXMemberCallExpr(expr) {
    CxxMemberCallExpression{oid, objectTypeOid, methodDeclOid, recordDeclOid};
}
```

### 11.6.3 函数/方法定义

```cpp
VisitFunctionDecl → FunctionDeclaration{oid, returnTypeOid, isDefinition}
                     + ParamVariableDeclaration{paramOid, funcOid, typeOid} × N
                     + generateCallableEnclosingStatement(body, funcOid)
VisitCXXMethodDecl → CxxMethodDeclaration{oid, parentOid}
```

### 11.6.4 CallableEnclosingStatement：语句→所属函数

```cpp
void generateCallableEnclosingStatement(stmt, callableOid) {
    for (child : stmt->children()) {
        if (child is Stmt) CallableEnclosingStatement{childOid, callableOid};
        generateCallableEnclosingStatement(child, callableOid);  // 递归
    }
}
```

> 这张表是**重建调用图的关键**：`CallableEnclosingStatement.statementOid` 找到某个 `CallExpression` 位于哪个函数体内，从而得到 caller。

## 11.7 继承抽取

```cpp
bool VisitRecordDecl(decl) {
    RecordDeclaration{oid};
    if (auto cxx = dyn_cast<CXXRecordDecl>(decl)) {
        CxxRecordDeclaration{oid};
        if (decl->isThisDeclarationADefinition()) {  // 前向声明无基类
            for (base : cxx->bases())
                ClassHierarchy{childOid=decl, parentOid=base};  // 继承边
        }
    }
}
```

## 11.8 traverseDeclIfNotVisited：跨单元符号追踪（重点）

这是理解 C++ 抽取器"怎么处理头文件"的核心方法（`CorefASTVisitor.cpp:718`）：

```cpp
void CorefASTVisitor::traverseDeclIfNotVisited(clang::Decl* decl) {
    // 跳过：null / 无效位置 / 系统头文件 / 系统宏 / 已抽取
    if (decl == nullptr || !decl->getLocation().isValid() ||
        sourceMngr.isInSystemHeader(decl->getLocation()) ||
        sourceMngr.isInSystemMacro(decl->getLocation()) ||
        checkDeclOidExist(getOid(decl))) return;

    // 计算文件 oid，登记到 File 表
    // 切换 _fileOid 上下文后 TraverseDecl(decl)
}
```

含义与影响：

1. **系统头文件被排除**：`isInSystemHeader` / `isInSystemMacro` 为真则跳过。标准库、第三方 SDK 头文件默认不抽取。
2. **被引用时按需补抽**：当某节点引用了一个"被过滤掉的头文件里的声明"（如函数声明、类），会**手动触发一次 TraverseDecl** 获取其符号信息，保证调用边完整。
3. **上下文切换**：用 `sbrella::c7::Switcher` 临时切换当前 fileOid，使补抽的声明归属到正确的文件。

> 这解释了为什么抽取器必须真实编译：它依赖 Clang 的符号解析能力，才能从"使用处"回溯到"被过滤的声明处"并补抽。

## 11.9 能力边界（源码级确认）

| 能力 | 结论 | 依据 |
| --- | --- | --- |
| AST 全量 | ✅ | 59 张表 + 全 Visit 重载 |
| 显式调用边 | ✅ | `CallExpression.calleeDeclarationOid` |
| 成员调用（静态类型） | ✅ | `CxxMemberCallExpression`（记录静态 record/method） |
| 继承 | ✅ | `ClassHierarchy` |
| 类型（简化） | ⚠️ | 指针/qualified/tag 类型，无完整 template 展开 |
| 符号表 | ✅ | `SymbolTable`（NameGenerator） |
| 注释/Documentation | ❌ | Visitor 无 comment 处理 |
| 宏 | ❌ | 系统宏排除，用户宏未记录 |
| CFG/PDG | ❌ | 未实现 |
| 函数指针/虚调用解析 | ❌ | 仅静态类型，无 RTTI/虚表分析 |
| 模板 | ⚠️ | 按实例化结果抽取（Clang 语义），未实例化模板仅声明层 |

## 11.10 单元测试覆盖

`Tests/` 目录（Catch2）：
- `ClassTest`（类与继承）
- `IfStmtTest`（if 语句）
- `TypeTest`（类型）
- `SymbolNameTest`（符号名）
- 样例：`ClassSample.cpp`、`IfElseStmtSample.cpp`、`TypeSample.cpp`、`ObjCClassSample.m` 等

> 测试聚焦"单文件语法结构"，未见大规模/跨单元/模板/宏的集成测试——这侧面说明 C++ 抽取器仍是 Beta，工程化验证不足。

## 11.11 小结

C++ 抽取器是"**真编译 + 位置签名 oid + 按需补抽头文件声明**"的 AST 抽取器。它适合结构型分析，但：
- oid 位置敏感（见第 10 章）；
- 无注释/CFG/PDG/宏；
- 调用图需在 Gödel 侧自行聚合（无独立 `CallGraph` 表）。

这些是评估大型 C/C++ 库（电信系统）时必须纳入的工程约束。
