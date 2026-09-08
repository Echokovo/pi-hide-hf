# Hide HuggingFace Models Extension

## 问题

pi 只要检测到 `HF_TOKEN` 就会把 huggingface 下所有 22 个模型都标记为「可用」。
但 HF 是 marketplace — 一个 token 不等于所有模型都有权限。
pi 的模型可见性是 **provider 粒度**（有 token = 该 provider 所有模型可见），
而 HuggingFace 是 **marketplace**（一个 token ≠ 所有模型可用），两者不匹配。

## 解决方案

两层策略：
1. **扩展插件** — 在 `session_start` 时 patch `getAvailable()`，过滤掉 HF 模型
2. **Shell 包装脚本** — `pi-nohf` 启动前去掉 `HF_TOKEN`（`--list-models` 也能生效）

## 使用方法

### 方案 A：扩展插件（推荐）

**通过 npm 安装：**
```bash
pi install npm:@winterchenhuan/pi-hide-hf
```

**通过 git 安装：**
```bash
pi install git:github.com/winterhuan/pi-hide-hf
```

> ⚠️ 安装后需要**新启动** pi 或在已有会话中输入 **`/reload`** 才能加载新扩展。

重启后扩展自动生效：HF 模型不会出现在 `/model` 与模型选择器中，且 pi 不再把 huggingface 模型目录拉取/写入 `models-store.json`。

```bash
# 默认行为：HF_TOKEN 存在时自动隐藏所有 HF 模型
pi

# 不隐藏，显示 HF 模型
HF_HIDE_MODELS=0 pi

# 只保留指定模型
HF_ALLOWED_MODELS="moonshotai/Kimi-K2.6,zai-org/GLM-5" pi
```

### 方案 B：Shell 包装脚本

```bash
~/.local/bin/pi-nohf          # 启动 pi，不带 HF_TOKEN
~/.local/bin/pi-nohf -p "hi"  # 同上，-p 模式
```

优点：`pi --list-models` 也不会显示 HF 模型。
缺点：HF_TOKEN 在 pi 内部完全不可用（如 huggingface-cli）。

## 配置项

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HF_HIDE_MODELS` | HF_TOKEN 存在时为 `1` | 是否隐藏 HF 模型 |
| `HF_ALLOWED_MODELS` | *(空)* | 逗号分隔的模型 ID 白名单 |
| `HF_UNSET_TOKEN` | `0` | 如果设为 `1`，同时从进程环境中移除 HF_TOKEN |
