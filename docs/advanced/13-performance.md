# 第 13 章 性能调优与大规模查询

> 性能核心是 Soufflé（Datalog 引擎）。本章把编译期优化、运行期求值、抽取端并行，以及大规模仓库的工程策略讲透。

## 13.1 性能模型：编译期下沉 + 运行期 Datalog

从第 8、9 章可知，Gödel 的面向对象语法糖在**编译期**被展平为 Soufflé 谓词，运行期只剩纯 Datalog 求值。性能由两部分决定：

1. **编译期**：语义分析 + IR 优化 + Soufflé 编译（小头，秒级到分钟级）。
2. **运行期**：Soufflé 装载 facts + 推导到不动点（大头，随 facts 与 join 规模增长）。

## 13.2 编译期优化开关（cli.cpp 全量）

| 开关 | 作用 | 建议 |
| --- | --- | --- |
| `-O1/-O2/-O3` | 代码生成优化级别 | `-O2` 官方推荐稳定 |
| `-Of` | for 语句优化 | SPARROW 默认启用 |
| `-Ol` | let 语句优化 | 不建议（官方标注） |
| `-Osc` | self data-constraint 优化 | 配合 `@data_constraint` |
| `-Ojr` | join 重排（实验性） | 复杂查询可试 |
| `--disable-inst-combine` | 关指令合并 | 调试用 |
| `--disable-remove-unused` | 关死代码消除 | 调试用 |
| `--disable-do-schema-opt` | 关 DO schema 优化 | 调试用 |

## 13.3 运行期：Soufflé 已关闭的慢 transformer

`engine.cpp:385` 显示，Gödel 默认**禁用** Soufflé 三个慢 transformer：

```
SubsumptionQualifierTransformer, SemanticChecker, MinimiseProgramTransformer
```

因为它们的工作已由 Gödel 前端完成。若显式需要可 `--souffle-slow-transformers` 打开（通常没必要）。

## 13.4 定位性能瓶颈：Soufflé Profiling

`godel` 支持 `--enable-souffle-profiling`（`engine.cpp:397`）：

```bash
godel -p <lib> script.gdl -r -Of -f <db> --enable-souffle-profiling
# 生成 souffle.prof.log（含 --index-stats）
```

`prof` 日志记录每个关系的求值时间、元组数，可精准定位"哪个 join 爆炸了"。

> SPARROW 未透传 profiling 开关，需直接调 `godel` 命令（见第 5 章底层命令）来做性能分析。

## 13.5 查询端优化（Gödel 侧）

### 13.5.1 先过滤后联结（最重要）

Datalog 瓶颈几乎都是 join 规模爆炸。原则：**先缩小集合，再联结**。

```rust
// 坏：大集合直接 join
for (a in AllA(db), b in AllB(db)) { if (a.id = b.aid && a.getName() = "x") {...} }
// 好：先构造过滤后的子 schema
for (a in FilteredA(db), b in AllB(db)) { if (a.id = b.aid) {...} }
```

`FilteredA` 通过自定义 `__all__` 提前过滤（如第 7 章 `SpecifiedCallable` 模式）。

### 13.5.2 善用集合与聚合

```rust
yield m.getAnAncestorCaller()     // 返回集合
if (x in set) {...}               // 集合成员判断
let (n = set.len()) {...}         // 聚合
```

### 13.5.3 避免无界字符串推导

递归中拼接字符串（`x = x + suffix`）会导致 Datalog 值域无界增长。整数/oid 传播，字符串只在输出层计算。

### 13.5.4 `@data_constraint` 与 `@inline`

库内大量方法带 `@data_constraint`（标注全集受数据约束，供 `-Osc` 优化）与 `@inline`（内联展开）。热路径自定义方法可加。

## 13.6 抽取端优化

| 语言 | 手段 |
| --- | --- |
| Java | `incremental=true` 增量 + `white-list` 白名单 + `jvm_opts` 内存 + `--parallel`（默认） |
| C++ | `compile_commands.json` 完整性 + ClangTool 多线程（`-j`）+ 分模块分库 |
| JS/ArkTS | `black-list`、`file-size-limit`、`use-gitignore`、`extract-deps` |
| Go | `extract-config` 排除路径、`go-build-flag` |

## 13.7 大规模仓库（千万行级）策略

| 阶段 | 建议 |
| --- | --- |
| 评估期 | 先抽代表性子系统，实测吞吐/内存/覆盖 |
| 编译数据库 | 一次性稳定生成 `compile_commands.json`；缺失单元=数据空洞 |
| 资源 | Soufflé 全内存装载 facts；千万行 C++ 需实测（预估几十 GB，64GB+ 机器或分片） |
| 分治 | 按模块/子系统建多个库，查询按需 `load` |
| 增量 | C++ 无增量，接受周期全量或二次开发 |
| 超时 | 全量调用链闭包可能超时，放大 `-t` 并观察日志 |
| CI | `--merge` + `--sarif` 固化规则集 |

## 13.8 性能可观测性

- `Runner` 打印实际命令与退出码；`--verbose` 开 DEBUG。
- `conf_check` 打印数据库大小（估算 facts 规模）。
- `--enable-souffle-profiling` + `--index-stats` 定位热点关系。
- `util::time_stamp`（`util/util.cpp`）在 verbose 下输出 lex/parse/semantic 各阶段耗时（`prof.dump`）。

## 13.9 小结

性能优化分三层：
1. **Gödel 层**：先过滤后联结、集合/聚合、`@data_constraint`/`@inline`。
2. **编译层**：`-O2/-Of/-Osc` 等开关。
3. **运行层**：Soufflé profiling 定位、分片、资源规划。

> 千万行 C/C++ 可行但需规划，硬核论据见专项评估报告。
