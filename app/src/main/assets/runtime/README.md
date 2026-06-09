# 内置运行时 (Built-in Runtime)

此目录用于放置 Python 和 Node.js 运行时压缩包。

## 所需文件

- `python.tar.gz` - Python 运行时（包含 bin/python3, bin/pip, lib/python3.13/ 等）
- `node.tar.gz` - Node.js 运行时（包含 bin/node, bin/npm, lib/ 等）

## 如何制作运行时包

### 前提条件
- 一台已安装 Termux 的 Android 设备（aarch64/ARM64）
- 在 Termux 中安装 Python 和 Node.js：
  ```bash
  pkg install python nodejs
  ```

### 打包 Python 运行时
```bash
cd /data/data/com.termux/files/usr
tar czf /sdcard/python.tar.gz \
  bin/python3* \
  bin/pip* \
  lib/python3.* \
  lib/libpython* \
  lib/libcrypto* \
  lib/libssl* \
  lib/libsqlite* \
  lib/libz* \
  lib/libbz2* \
  lib/liblzma* \
  lib/libreadline* \
  lib/libncurses* \
  lib/libuuid* \
  lib/libexpat* \
  share/terminfo
```

### 打包 Node.js 运行时
```bash
cd /data/data/com.termux/files/usr
tar czf /sdcard/node.tar.gz \
  bin/node \
  bin/npm \
  bin/npx \
  lib/libnode* \
  lib/libcrypto* \
  lib/libssl* \
  lib/libz* \
  lib/libcares* \
  lib/libnghttp* \
  lib/libicu* \
  lib/node_modules/npm
```

### 放置文件
将生成的 `python.tar.gz` 和 `node.tar.gz` 放到此目录（`app/src/main/assets/runtime/`）。

## 运行时提取

应用首次调用 `Bridge.executeCommand()` 时，会自动检测并提取运行时到：
```
/data/data/com.orangechat/files/runtime/
```

提取后 bin/ 下的可执行文件会自动获得执行权限。

## 注意事项

- 二进制文件必须是 **aarch64 (ARM64)** 架构
- Python 运行时大约 50-100MB（压缩后约 20-40MB）
- Node.js 运行时大约 30-50MB（压缩后约 15-25MB）
- 如果不放置压缩包，应用仍可正常运行，但无法执行 python3/node 命令