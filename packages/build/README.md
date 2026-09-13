# 构建产物

这里是手写构建与产物校验能力包，生成产物仍使用应用原有输出目录。

| 包                                                 | 职责                                                           |
| -------------------------------------------------- | -------------------------------------------------------------- |
| [artifact-reader](artifact-reader/README.zh-CN.md) | 读取 Runtime/Web 产物清单，验证文件树、路径、哈希、目标和入口  |
| [artifact-policy](artifact-policy/README.zh-CN.md) | Workbench 原生依赖、模型资源、源码形态与 Next 运行依赖准入规则 |

应用从 policy 取得规则并注入 reader；reader 不反向依赖 policy。格式定义见 [runtime-contracts](../contracts/runtime-contracts/README.zh-CN.md)，启动进程见 [process](../process/README.md)。
