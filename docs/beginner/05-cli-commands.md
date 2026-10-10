# 第 5 章 Sparrow CLI 命令详解

Sparrow CLI 入口为 `cli/sparrow-cli.py`，Python 实现，顶层四大子命令：`database`、`query`、`package`、`rebuild`。

```
sparrow
├── database create     数据抽取
├── query    run        执行 godel 脚本
├── package  create     创建/打包 godel 包
├── package  run        带包执行脚本
└── rebuild  lib        重建库
```

## 5.1 全局参数

| 参数 | 说明 |
| --- | --- |
| `-v / --version` | 打印版本（读 `<home>/version.txt`） |
| `--sparrow-home <path>` | 指定安装根目录 |
| `--verbose`（各子命令） | 打开 DEBUG 日志 |
| `--log-dir <dir>` | 日志目录，会生成 `sparrow-cli-error.log` / `sparrow-cli-warn.log` / `sparrow-cli-info.log` |

## 5.2 database create：数据抽取

```
sparrow database create -s <source-root> -lang <lang...> -o <output> [选项]
```

| 参数 | 说明 |
| --- | --- |
| `-s, --source-root` | **必填**，源码根目录 |
| `-lang, --data-language-type` | **必填**，语言列表，空格分隔，如 `-lang java xml` |
| `-o, --output` | **必填**，数据库输出目录 |
| `-t, --timeout` | 抽取超时秒数，默认 3600 |
| `--overwrite` | 覆盖已存在的数据库（默认会交互式询问） |
| `--extraction-config-file <json>` | 抽取配置文件（JSON） |
| `--extraction-config a.b=c ...` | 命令行抽取配置项 |

### 5.2.1 抽取配置

两种方式等价。配置文件格式（见 `cli/database/create.py` 的 `conf_option_deal`）：

```json
[
  {
    "extractor": "java",
    "extractor_options": [
      { "name": "incremental", "value": { "config": "true" } },
      { "name": "cache-dir",   "value": { "config": "/path/cache" } },
      { "name": "commit",      "value": { "config": "abcdef1" } }
    ]
  }
]
```

命令行等价形式：`--extraction-config java.incremental=true java.cache-dir=/path/cache`

### 5.2.2 各语言抽取器支持的配置

| 语言 | 配置项 | 效果 |
| --- | --- | --- |
| cfamily | （无额外配置） | 需要 `compile_commands.json` |
| java | `white-list`/`whiteList` | 白名单文件 |
| java | `cp`/`classpath` | 额外 classpath |
| java | `incremental=true` | 增量抽取（配 `cache-dir`、`commit`、`remote-cache-type`、`oss-*`） |
| java | `jvm_opts` | JVM 参数，如 `-Xmx16g` |
| go | `extract-config` | 排除路径（逗号分隔） |
| go | `go-build-flag` | 构建标志 |
| javascript | `black-list` | 黑名单路径 |
| javascript | `use-gitignore` | 遵循 .gitignore |
| javascript | `extract-deps` | 抽取依赖 |
| javascript | `file-size-limit` | 文件大小上限 |
| sql | `sql-dialect-type` | SQL 方言 |
| swift | `corpus` | corpus 列表 |
| arkts | `blacklist`、`use-gitignore`、`extract-text`、`extract-deps`、`paths`、`file-size-limit` | 见 `extractor.py` |

> 实现参考 `cli/extractor/extractor.py`。抽取器按语言名动态查找 `xxx_extractor_cmd()` 函数拼出命令行，再用 `Runner` 执行（`cli/run/runner.py`，带超时保护）。

## 5.3 query run：执行查询

```
sparrow query run -d <database> -gdl <gdl|目录> -o <output> [选项]
```

| 参数 | 说明 |
| --- | --- |
| `-d, --database` | 数据库目录（含 `.db` 文件） |
| `-gdl, --godel` | **必填**，脚本路径或目录（目录会执行其中所有 `.gdl` 与 `.gs`） |
| `-o, --output` | 输出目录，结果 `<脚本名>.<format>` |
| `-f, --format` | `json`（默认）/ `csv` / `sqlite` |
| `-t, --timeout` | 查询超时秒数，默认 3600 |
| `-m, --merge` | 多脚本合并执行（同名函数/类只保留一份，头文件与输出合并） |
| `--sarif` | 生成 SARIF 报告 `sparrow-cli-report.sarif`（要求输出含 `filePath`/`startLine`/`ruleName`/`ruleDescription`） |
| `--verbose` | 详细日志 |

### 5.3.1 执行流程

`cli/query/run.py` 的 `query_run()`：

1. `conf_check()`：校验数据库目录存在且含 `.db` 文件（并打印库大小）。
2. 收集 `-gdl` 下的所有 `.gdl`/`.gs` 文件。
3. 逐个调用 `godel_compiler.execute()`：
   - **GödelScript**（首行 `// script`）：`godel -p <lib> -f <db> -Of -r <script> --output-json <out>`
   - **旧版 0.3**：`godel-0.3 ... --run-souffle-directly --package-path <lib-03> --souffle-fact-dir <db> --souffle-output-format json ...`
4. 检查结果是否为空，记录耗时。

### 5.3.2 输出格式

- **json**：`[ {"col1": v1, "col2": v2}, ... ]`，多输出则 `{"out1": [...], "out2": [...]}`
- **csv**：逗号分隔
- **sqlite**：结果写入 SQLite 文件

### 5.3.3 SARIF 输出

`--sarif` 会把每个脚本的 json 结果转换为 SARIF 2.1.0 格式。要求每条记录包含：

- `ruleName`：规则 ID
- `filePath`：文件路径
- `startLine`：起始行
- `ruleDescription`：规则描述
- 可选 `message`、`level`、`Importance`

转换逻辑见 `cli/query/run.py` 的 `json_to_sarif()`。非常适合把 Gödel 查询固化成 CI 卡点规则。

## 5.4 package：Gödel 包管理

```
sparrow package create [--manifest | --pack <zip> | --install <zip>]
sparrow package run -d <db> -gdl <script>
```

- `--manifest`：在当前目录生成 `manifest.json`。
- `--pack`：打包成 zip。
- `--install`：解包安装。
- `package run`：执行带依赖包的脚本（`package/compile_and_run.py`）。

## 5.5 rebuild lib：重建库

```
sparrow rebuild lib -lang <lang... | all>
```

用于重建各语言的标准库（Gödel 编译所需的库文件）。`open_lib()`（`cli/rebuild/lib.py`）返回支持重建的语言列表。

## 5.6 一个完整示例

```bash
# 1. 抽取（C++ + 依赖的 XML 配置）
sparrow database create -s ./src -lang cfamily xml -o ./db

# 2. 编写 rules/rule1.gdl

# 3. 执行并输出 SARIF（用于 CI 卡点）
sparrow query run -d ./db -gdl rules/ -o ./out --sarif -f json

# 4. 产物
#    out/rule1.json
#    out/sparrow-cli-report.sarif
```

下一章给出更多典型查询示例。
