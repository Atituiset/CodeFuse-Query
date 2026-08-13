# 第 3 章 安装与配置

> 官方安装文档见仓库 `doc/3_install_and_run.md`。本章在此基础上补充源码构建与注意事项。

## 3.1 硬件与软件要求

| 项 | 要求 |
| --- | --- |
| 硬件 | 官方最低 **4C8G**；大规模仓库建议更高（详见第 10 章） |
| 操作系统 | macOS、Linux |
| Java | **Java 1.8+**（用于 Java/XML/SQL/Properties 等基于 jar 的抽取器） |
| Python | **Python 3.8+**（用于 Sparrow CLI 本身） |

## 3.2 方式一：使用官方 Release 包（推荐）

1. 从 [GitHub Releases](https://github.com/codefuse-ai/CodeFuse-Query/releases) 下载对应平台的压缩包（如 `2.0.0`）。
2. 解压到某个目录 `<extraction-root>`。
3. 两种使用方式：
   ```bash
   # 直接调用
   <extraction-root>/sparrow-cli/sparrow
   # 或加入 PATH
   export PATH=<extraction-root>/sparrow-cli:$PATH
   ```
4. macOS 若提示验证开发者：`xattr -d com.apple.quarantine /path/to/sparrow` 或在"系统设置→隐私与安全性"中允许。

## 3.3 方式二：从源码构建

源码采用 **Bazel** 构建 CLI 包（`.github/workflows/bazel_cli_build.yml`），各组件也可单独构建：

### 3.3.1 构建 Sparrow CLI 包（Bazel）

```bash
bazel build //cli:sparrow_cli
```

### 3.3.2 构建 C/C++ 抽取器（CMake，依赖 Clang/LLVM 13）

```bash
# 需要 llvm-13 clang-13 libclang-13-dev libsqlite3-dev（见 dev.Dockerfile）
cd language/cfamily/extractor
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_COMPILER="clang" -DCMAKE_CXX_COMPILER="clang++"
make -j4
# 产物: build/coref-cfamily-src-extractor
```

### 3.3.3 构建 GödelScript 编译器（CMake，C++17）

```bash
# 先准备依赖
sudo apt install -y git build-essential libffi-dev m4 cmake libsqlite3-dev zlib1g-dev

# 初始化 souffle 子模块并打补丁
cd godel-script/godel-backend
git submodule init && git submodule update --recursive
cd souffle && git am ../0001-init-self-used-souffle-from-public-souffle.patch

# 编译
cd godel-script
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build .
# 产物: build/godel
```

## 3.4 验证安装

```bash
sparrow -v        # 打印版本号（来自 <sparrow-home>/version.txt）
sparrow -h        # 打印帮助与全部子命令
```

预期子命令体系：

```
usage: sparrow-cli.py [-h] [--version] [--sparrow-home ...]
                      {query,package,database,rebuild} ...

子命令：
  query    执行 godel 脚本（run）
  package  godel 脚本包管理（create / run）
  database 数据抽取（create）
  rebuild  重建工具（lib）
```

## 3.5 目录布局速览

安装包内目录与 `cli/sparrow_schema/schema.py` 中的路径约定：

| 路径 | 内容 |
| --- | --- |
| `<home>/language/<lang>/extractor/` | 各语言抽取器可执行文件 |
| `<home>/language/<lang>/lib/` | 各语言 Gödel 标准库（如 `coref.java.gdl` 等） |
| `<home>/godel-script/usr/bin/godel` | GödelScript 编译器 |
| `<home>/godel-0.3/usr/bin/godel` | 旧版 Gödel 0.3 编译器 |
| `<home>/lib/` | GödelScript 打包库目录 |
| `<home>/lib-03/` | 旧版库目录 |

> `sparrow --sparrow-home <path>` 可显式指定安装根，方便多版本并存。

## 3.6 常见问题

- **`database create` 报错**：确认 `-lang` 拼写正确（`java`、`cfamily`、`go`、`javascript`、`python`、`sql`、`xml`、`properties`、`swift`、`arkts`），见 `cli/extractor/extractor.py` 的 `Extractor` 类。
- **C++ 抽取找不到头文件**：cfamily 抽取器基于 `compile_commands.json`（见第 9 章），请先用 `bear` 或 `cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON` 生成。
- **Java 抽取 JVM 内存**：默认按机器内存自动算 `-Xmx`（上限 32G），可用 `jvm_opts` 配置覆盖。

下一章：写你的第一个查询。
