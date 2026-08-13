# 第 4 章 第一个查询

本章带你走完"抽取 → 编写 → 查询 → 读结果"的完整闭环。先以 Java 为例（最成熟），再演示 C/C++。

## 4.1 准备一个示例代码库

创建一个小 Java 项目：

```java
// HelloWorld.java
public class HelloWorld {
    public static void main(String[] args) {
        HelloWorld tmp = new HelloWorld();
        String hello = tmp.getHello();
        String world = tmp.getWorld();
        System.out.println(hello + " " + world);
    }

    public String getHello() {
        return "Hello";
    }

    public String getWorld() {
        return "World";
    }
}
```

## 4.2 抽取代码数据（创建数据库）

```bash
sparrow database create -s <源码目录> -lang java -o ./db
```

- `-s`：源码根目录
- `-lang`：分析语言（可多语言空格分隔，如 `-lang java xml`）
- `-o`：数据库输出目录，产物为 `./db/coref_java_src.db`

产物是一个 SQLite 数据库文件，用 `sqlite3` 可查看表结构：

```bash
sqlite3 db/coref_java_src.db ".tables"
```

## 4.3 编写 GödelScript 脚本

```rust
// script
use coref::java::*

// 定义全局 java 数据库
fn default_db() -> JavaDB {
    return JavaDB::load("coref_java_src.db")
}

// 遍历所有方法，返回方法名
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

保存为 `example.gdl`。

## 4.4 执行查询

```bash
sparrow query run -d ./db -gdl example.gdl -o ./
```

- `-d`：数据库目录
- `-gdl`：脚本路径（目录则执行其中全部 `.gdl`/`.gs`）
- `-o`：输出目录，结果写入 `<脚本名>.json`

## 4.5 查看结果

```json
[{"name": "getHello"},
 {"name": "getWorld"},
 {"name": "main"}]
```

> 官方原例见 `doc/3_install_and_run.md` 结尾。

## 4.6 C/C++ 版本的第一步

C/C++（cfamily）抽取器**依赖编译数据库**，因为它用 Clang 真实编译每个编译单元来解析 AST。

### 生成 compile_commands.json

以 CMake 项目为例：

```bash
cmake -S . -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
# 生成 build/compile_commands.json
```

或使用 `bear` 包装构建命令：

```bash
bear -- make -j$(nproc)
# 生成 ./compile_commands.json
```

### 抽取

```bash
sparrow database create -s <含compile_commands.json的目录> -lang cfamily -o ./db
```

> 注意：cfamily 抽取器使用 `--compile-commands=<source_root>`（见 `cli/extractor/extractor.py`），它会在 `<source_root>` 下查找 `compile_commands.json`。

### 查询：统计所有函数名

```rust
// script
use coref::cfamily::*

fn default_db() -> CfamilyDB {
    return CfamilyDB::load("coref_cfamily_src.db")
}

fn getAllFunctionName(name: string) -> bool {
    for (f in FunctionDeclaration(default_db())) {
        if (name = f.getName()) {
            return true
        }
    }
}

fn main() {
    output(getAllFunctionName())
}
```

执行：

```bash
sparrow query run -d ./db -gdl cfamily_example.gdl -o ./
```

### 查询：找出所有调用关系（调用图）

```rust
// script
use coref::cfamily::*

fn default_db() -> CfamilyDB {
    return CfamilyDB::load("coref_cfamily_src.db")
}

// 输出每个调用表达式的"被调用声明文本"与"调用点文本"
fn callEdges(calleeName: string, callExpr: string) -> bool {
    for (c in CallExpression(default_db())) {
        if (calleeName = c.getCalleeDeclaration().getPrintableText()) {
            if (callExpr = c.getPrintableText()) {
                return true
            }
        }
    }
}

fn main() {
    output(callEdges())
}
```

> 说明：`CallExpression.getCalleeDeclaration()` 返回被调用的 `Declaration`（`language/cfamily/lib/Expression.gdl`），`getPrintableText()` 返回源码文本。若要得到"调用方"，需结合 `CallableEnclosingStatement` 表（语句→所属函数）join，见第 11 章。

## 4.7 排错速查

| 现象 | 原因与处理 |
| --- | --- |
| `database` 目录中没有 `.db` | 抽取失败，查看 sparrow 日志（`--log-dir`） |
| `JavaDB::load("...")` 找不到文件 | 脚本里的数据库名要与产物文件名一致（`coref_java_src.db`） |
| 提示"godel version judge error" | 脚本编码问题；确保首行就是 `// script` |
| cfamily 抽取空库 | 没有找到 `compile_commands.json`，或 Clang 无法解析编译单元 |

下一章系统讲解 Sparrow CLI 的全部命令与参数。
