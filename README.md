# Hide HuggingFace Models Extension

## 问题

pi 只要检测到 `HF_TOKEN` 就会把 huggingface 下所有 22 个模型都标记为「可用」。
但 HF 是 marketplace — 一个 token 不等于所有模型都有权限。
pi 的模型可见性是 **provider 粒度**（有 token = 该 provider 所有模型可见），
而 HuggingFace 是 **marketplace**（一个 token ≠ 所有模型可用），两者不匹配。

## 解决方案

扩展插件在 `session_start` 时 patch 模型可用性接口，把 HF 模型从可用列表里过滤掉。

## 使用方法

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

# 连 pi --list-models 也不显示 HF 模型
# （副作用：pi 内部拿不到 HF_TOKEN，huggingface-cli 之类会失效）
HF_UNSET_TOKEN=1 pi
```

## 配置项

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HF_HIDE_MODELS` | HF_TOKEN 存在时为 `1` | 是否隐藏 HF 模型 |
| `HF_ALLOWED_MODELS` | *(空)* | 逗号分隔的模型 ID 白名单 |
| `HF_UNSET_TOKEN` | `0` | 设为 `1` 时同时从进程环境中移除 HF_TOKEN，`pi --list-models` 也不再显示 HF 模型 |
