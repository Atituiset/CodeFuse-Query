# 第 14 章 查询打包、合并与 SARIF 输出

> 生产化三件套：**package**（分发查询包）、**merge**（批量脚本合并执行）、**sarif**（CI 卡点输出）。本章补充源码级实现细节。

## 14.1 打包分发（package）

### 14.1.1 命令

```bash
sparrow package create --manifest            # 生成 manifest.json
sparrow package create --pack out.zip        # 打包
sparrow package create --install out.zip     # 解包安装
sparrow package run -d <db> -gdl <script>    # 带包执行
```

底层：`cli/package/manifest.py`（manifest 模型）、`pack.py`（打包）、`compile_and_run.py`（带依赖执行）。

### 14.1.2 包路径映射（前端侧）

Gödel 前端 `package/` 目录（`module_tree.cpp`、`package.cpp`）实现 `-p` 目录扫描 → 模块树 → 包路径映射。规则：
- 相对路径 → `coref::java`、`coref::a::b` 形式；
- 纯数字文件名、含 `-` 的路径段被**忽略**；
- 路径冲突**报错终止**。

## 14.2 多脚本合并执行（--merge）

### 14.2.1 动机

批量规则扫描时，合并成一个脚本**共享一次数据库加载与求值**，避免重复加载。

### 14.2.2 合并算法（`cli/query/run.py::merge_execute`）

1. **预编译校验**：每个脚本 `precompiled`（`godel -p <lib> --semantic-only`）。
2. **位置提取**：用 `godel <script> -l <tmp.json>` 提取每个 schema/函数的位置信息（`location_extractor`）。
3. **头文件合并**：收集 `use coref::<lang>::*` 去重。
4. **schema 合并**：同名 schema 仅保留一份；定义不一致（忽略空白比较）→ 报错 `"merge error: same schema"`。
5. **函数合并**：键为 `函数名#schema`；同名但行为不同 → 报错 `"merge error: same function"`。
6. **输出合并**：收集各脚本 `main` 的 `output(...)`，写入合并后 `main`。
7. **执行合并脚本**，按各脚本 output 函数**切分结果**回 `<脚本名>.json`。

### 14.2.3 注意事项

- 仅支持 GödelScript（`// script`）。
- 命名冲突且行为不同会失败——公共 helper 应独立成库，规则脚本只 import + output。
- 切分逻辑：单输出→数组；多输出→`{"fn1": [...], "fn2": [...]}`。

## 14.3 SARIF 输出

### 14.3.1 命令

```bash
sparrow query run -d ./db -gdl rules/ -o ./out --sarif
# 产物：out/sparrow-cli-report.sarif
```

### 14.3.2 字段约定（`json_to_sarif`）

每条记录需含：`ruleName`、`filePath`、`startLine`、`ruleDescription`（可选 `message`、`level`、`Importance`）。

SARIF 2.1.0 结构生成逻辑（`cli/query/run.py`）：
- `ruleName` → `tool.driver.rules[].id`
- `Importance=high` → `level=error`，否则 `warning`
- 每条命中 → `results[]`，含 `location.physicalLocation.artifactLocation.uri` + `region.startLine`

### 14.3.3 规则模板（可转 SARIF）

```rust
// script
use coref::cfamily::*

fn default_db() -> CfamilyDB {
    return CfamilyDB::load("coref_cfamily_src.db")
}

// 演示 SARIF 字段约定的规则：输出所有函数声明及其位置
fn functionReport(filePath: string, startLine: int,
                  ruleName: string, ruleDescription: string, message: string) -> bool {
    for (f in FunctionDeclaration(default_db())) {
        let (loc = f.getLocation()) {
            if (filePath = loc.getFile().relative_path &&
                startLine = loc.start_line_number) {
                if (ruleName = "AllFunctions" &&
                    ruleDescription = "函数声明清单") {
                    if (message = f.getName()) {
                        return true
                    }
                }
            }
        }
    }
}

fn main() {
    output(functionReport())
}
```

> API 依据：`FunctionDeclaration.getName()`（继承自 `NamedDeclaration`）、`Declaration.getLocation() -> Location`（Declaration.gdl）、`Location.getFile() -> File` + 字段 `start_line_number`（Location.gdl）、`File.relative_path`（Container.gdl）。实际规则需按业务替换判定条件（如查找特定危险 API 调用）。

## 14.4 生产化建议

- **规则库分层**：`core/`（公共 schema/函数）+ `rules/`（具体规则）。
- **结果约定**：统一输出 `filePath/startLine/ruleName/ruleDescription`。
- **批处理**：优先 `--merge`；大脚本单独跑并加大 `-t`。
- **CI 链路**：`database create`（增量/白名单）→ `query run --merge --sarif` → 消费 SARIF 做卡点。

> 完整 CI 落地与平台集成见第 15 章。
