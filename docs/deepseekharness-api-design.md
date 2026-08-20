# DeepSeek Harness HTTP / WebSocket 接口参考

本文是对仓库提交 `47f943859bef` 的源码级接口审计，描述 Web Host 对外提供的 HTTP 与 WebSocket 协议、请求头、请求体、响应头、响应体、错误与部署参数。

## 1. 范围

本文收录 59 个 unary HTTP RPC、`POST /api/respond`、`GET|HEAD /api/session.export` 和两条 WebSocket 下行流。

本文不收录以下接口：

- `subagent.list`、`subagent.history`、`subagent.prompt`、`subagent.interrupt`；
- `/plugins/*`、客户端插件 bundle、插件 HMR/SSE；
- `dynamicCordisRunner/*`、`pluginInventory/*` 及 `cordis/*` 动态插件管理 Remote；
- SPA 静态文件与前端 fallback；
- 仅供进程内载体使用的 `/api/events.*` SSE 实现。

通用 Session/Host 视图的实际线协议保留 `parentSessionId`、`origin` 等兼容字段，`session.export` 也保留 `includeDescendants` 查询参数；本文只记录其字段形状，不展开任何 subagent API 或行为。

## 2. 基础地址和部署参数

默认 Web 地址为 `http://127.0.0.1:3080`，WebSocket 使用同一 authority，将协议替换为 `ws:` 或 `wss:`。

相关 Host 配置可用下面的 JSON Schema 表示：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "DeepSeekHarnessWebTransportConfig",
  "type": "object",
  "properties": {
    "host": {
      "type": "string",
      "enum": ["127.0.0.1", "0.0.0.0"],
      "default": "127.0.0.1"
    },
    "port": {
      "type": "integer",
      "minimum": 0,
      "maximum": 65535,
      "default": 3080,
      "description": "0 表示由操作系统分配端口"
    },
    "trustedHosts": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "description": "规范形 host 或 host:port authority；带端口时精确匹配，不带端口时匹配任意端口"
      },
      "default": []
    },
    "maxRequestBodyBytes": {
      "type": "integer",
      "minimum": 1,
      "default": 167772160,
      "description": "所有 /api HTTP 请求体的最大缓冲字节数；默认 160 MiB"
    },
    "nativeOpen": {
      "type": "boolean",
      "description": "覆盖原生路径/文档打开能力探测"
    },
    "sessionExportCompressionLevel": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9,
      "default": 6
    },
    "coldBlankProbeMaxBytes": {
      "type": "integer",
      "minimum": 0,
      "default": 1024
    }
  }
}
```

`dsh web` 命令行当前拒绝 `--host 0.0.0.0`；底层 WebServer Schema 仍允许该值。服务没有 TLS、登录、Bearer Token、Cookie Session 或其他认证层，`trustedHosts` 只用于 Host/Origin/DNS-rebinding 可达性约束，不能当作身份认证。

## 3. HTTP 请求头 Schema

HTTP 头名称不区分大小写；下列 Schema 统一使用小写键表示。未列出的标准头可以存在。

### 3.1 所有 `/api` 请求的信任头

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ApiTrustRequestHeaders",
  "type": "object",
  "required": ["host"],
  "properties": {
    "host": {
      "type": "string",
      "minLength": 1,
      "description": "必须是 loopback authority，或命中 trustedHosts"
    },
    "origin": {
      "type": "string",
      "format": "uri",
      "description": "可省略；存在时其 URL.host 必须与 Host 归一化后完全相同，null origin 被拒绝"
    },
    "sec-fetch-site": {
      "type": "string",
      "not": { "const": "cross-site" },
      "description": "显式 cross-site 一律拒绝"
    }
  },
  "additionalProperties": true,
  "x-dsh-cross-field-rules": [
    "origin 缺省时仅执行 Host 检查",
    "origin 存在时 origin.host 必须等于规范化后的 host",
    "host 缺失、不可解析或不可信时返回 403"
  ]
}
```

### 3.2 所有 JSON POST 的请求头

以下 Schema 在 `ApiTrustRequestHeaders` 基础上增加 JSON 媒体类型要求：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "JsonPostRequestHeaders",
  "type": "object",
  "required": ["host", "content-type"],
  "properties": {
    "host": { "type": "string", "minLength": 1 },
    "content-type": {
      "type": "string",
      "pattern": "^[Aa][Pp][Pp][Ll][Ii][Cc][Aa][Tt][Ii][Oo][Nn]/[Jj][Ss][Oo][Nn](?:\\s*;.*)?$",
      "examples": ["application/json", "application/json; charset=utf-8"]
    },
    "content-length": {
      "type": "string",
      "pattern": "^[0-9]+$",
      "description": "可省略；声明值或实际累计值超过 maxRequestBodyBytes 时返回 413"
    },
    "origin": { "type": "string", "format": "uri" },
    "sec-fetch-site": { "type": "string", "not": { "const": "cross-site" } },
    "accept": { "type": "string" }
  },
  "additionalProperties": true
}
```

`Content-Type` 缺失，或媒体类型不是 `application/json`，返回 `415`。服务不提供 CORS `OPTIONS` 预检接口。`Authorization` 没有协议含义，即使发送也不会形成认证。

### 3.3 导出请求头

`GET|HEAD /api/session.export` 只要求信任头；不需要 `Content-Type`。客户端通常发送 `Accept: application/zip`，但服务不强制检查。

### 3.4 HTTP 响应头 Schema

成功或业务失败的 RPC 都返回 JSON：

```json
{
  "title": "JsonRpcResponseHeaders",
  "type": "object",
  "required": ["content-type"],
  "properties": {
    "content-type": {
      "type": "string",
      "pattern": "^application/json(?:\\s*;.*)?$"
    }
  },
  "additionalProperties": true
}
```

导出成功的响应头：

```json
{
  "title": "SessionExportResponseHeaders",
  "type": "object",
  "required": ["content-type", "content-disposition"],
  "properties": {
    "content-type": { "const": "application/zip" },
    "content-disposition": {
      "type": "string",
      "pattern": "^attachment; filename=\"dsh-session-[A-Za-z0-9_-]+\\.zip\"$"
    }
  },
  "additionalProperties": true
}
```

载体错误通常是 UTF-8 文本；部分由 `node:http` 直接产生的 `403`/`413` 不保证 `Content-Type`。`413` 还带 `Connection: close`。普通 `GET /api/events.mux` 或 `GET /api/events.host` 返回 `426`，并带 `Connection: Upgrade` 与 `Upgrade: websocket`。

## 4. RPC 公共消息 Schema

### 4.1 ClientRequest

所有 unary `POST /api/<endpoint>` 都使用下面的外层请求体。`rpcId` 是调用方生成的任意字符串回显令牌，没有最小长度；`method` 必须与 URL 中 `<endpoint>` 完全相同。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "ClientRequest.schema.json",
  "type": "object",
  "required": ["type", "rpcId", "method", "payload"],
  "properties": {
    "type": { "const": "client-request" },
    "rpcId": { "type": "string" },
    "method": { "type": "string" },
    "payload": {}
  }
}
```

完整请求体 Schema 的组合规则为：将本节 `method` 改为对应 endpoint 的 `const`，并将 `payload` 替换为后文该 endpoint 的 `payload` Schema。外层结构或 payload 不合法时，HTTP 状态仍为 `200`，响应的 `result.error.code` 为 `bad-request`；JSON 本身无法解析才返回 `400`。

普通 Zod `object` 对未知字段的行为是“接受后剥离”，而不是 `additionalProperties: false`；Typert Remote 的 `payload.args` 是例外，它要求字段集合精确匹配。

### 4.2 ServerResponse

所有 unary RPC 的响应体为下面的判别联合。HTTP `200` 只表示载体完成；业务成功必须检查 `result.ok`。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "ServerResponse.schema.json",
  "type": "object",
  "required": ["type", "rpcId", "result"],
  "properties": {
    "type": { "const": "server-response" },
    "rpcId": { "type": "string" },
    "result": {
      "oneOf": [
        {
          "type": "object",
          "required": ["ok"],
          "properties": {
            "ok": { "const": true },
            "value": {}
          }
        },
        {
          "type": "object",
          "required": ["ok", "error"],
          "properties": {
            "ok": { "const": false },
            "error": { "$ref": "#/$defs/RpcError" }
          }
        }
      ]
    }
  },
  "$defs": {
    "RpcError": {
      "type": "object",
      "required": ["code", "message", "details"],
      "properties": {
        "code": { "type": "string" },
        "message": { "type": "string" },
        "details": { "type": "object" }
      }
    }
  }
}
```

除明确允许 `undefined` 的接口外，每个 endpoint 的成功 value Schema 都要求 `result.value` 存在。当成功值在类型上是 `undefined` 时，JSON 序列化会省略 `value`；本文收录的现有公开接口中，`commands/execute` 未解析到命令时属于这种情况。

### 4.3 公共标量与复用对象

后续 Schema 使用以下别名：

- `SessionId`、`WorkspaceId`、`MessageId`、`AttachmentId`：非空字符串；旧 Goal API 的 `sessionId` 和 `GoalRef.id` 只要求字符串。
- `RpcId`：任意字符串。
- `JsonValue`：`null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }`。
- `ContentBlock`：至少含 `{ "type": string }` 的开放对象，其余字段由具体内容块所有者定义。
- 时间字段除 Workspace 的 `createdAt`/`updatedAt` 外均为 Unix epoch 毫秒数；Workspace 时间为字符串，当前实现使用 ISO 时间。

复用响应对象 Schema：

```json
{
  "$defs": {
    "SessionEvent": {
      "type": "object",
      "required": ["type", "seq", "time", "data"],
      "properties": {
        "type": { "type": "string" },
        "seq": { "type": "integer", "minimum": 0 },
        "time": { "type": "number" },
        "data": {},
        "sourceEventSeqs": { "type": "array", "items": { "type": "number" } },
        "surfaceOp": {},
        "ignorable": { "const": true }
      }
    },
    "ToolEventView": {
      "type": "object",
      "required": ["for", "view"],
      "properties": {
        "for": { "enum": ["call", "result"] },
        "view": {
          "type": "object",
          "required": ["card"],
          "properties": { "card": { "type": "string" } },
          "additionalProperties": true
        }
      }
    },
    "SessionProjections": {
      "type": "object",
      "required": ["asOfSeq", "values"],
      "properties": {
        "asOfSeq": { "type": "integer", "minimum": -1 },
        "values": { "type": "object", "additionalProperties": true }
      }
    },
    "ModelSelection": {
      "type": "object",
      "required": ["provider", "model"],
      "properties": {
        "provider": { "type": "string", "minLength": 1 },
        "model": { "type": "string", "minLength": 1 },
        "reasoningEffort": { "type": "string", "minLength": 1 }
      }
    },
    "ModelCatalogModel": {
      "type": "object",
      "required": ["id", "name"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "name": { "type": "string", "minLength": 1 },
        "description": { "type": "string" },
        "reasoning": {
          "type": "object",
          "required": ["efforts"],
          "properties": {
            "efforts": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "object",
                "required": ["id", "name"],
                "properties": {
                  "id": { "type": "string", "minLength": 1 },
                  "name": { "type": "string", "minLength": 1 },
                  "description": { "type": "string" }
                }
              }
            },
            "defaultEffort": { "type": "string", "minLength": 1 }
          }
        }
      }
    },
    "ModelProviderGroup": {
      "type": "object",
      "required": ["id", "name", "models"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "name": { "type": "string", "minLength": 1 },
        "models": { "type": "array", "items": { "$ref": "#/$defs/ModelCatalogModel" } }
      }
    },
    "ModelCatalogFailure": {
      "type": "object",
      "required": ["id", "name", "message"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "name": { "type": "string", "minLength": 1 },
        "message": { "type": "string" }
      }
    },
    "WorkspaceView": {
      "type": "object",
      "required": ["workspaceId", "path", "title", "sessionIds", "createdAt", "updatedAt"],
      "properties": {
        "workspaceId": { "type": "string", "minLength": 1 },
        "path": { "type": "string" },
        "title": { "type": "string" },
        "sessionIds": { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "createdAt": { "type": "string" },
        "updatedAt": { "type": "string" }
      }
    }
  }
}
```

## 5. Legacy API Proxy unary 接口

以下接口都使用 `POST /api/<method>`、`JsonPostRequestHeaders`、`ClientRequest` 和 `ServerResponse`。每项中的“请求 payload”替换 `ClientRequest.payload`，“成功 value”替换 `ServerResponse.result.value`；失败分支统一为 `RpcError`。

### 5.1 Session

#### `POST /api/session.list`

- `method`: `session.list`
- 请求 payload: `{ "cursor"?: string }`；`cursor` 是预留字段，当前未实现分页语义。
- 成功 value:

```json
{
  "type": "object",
  "required": ["items"],
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["sessionId", "updatedAt", "running", "blank"],
        "properties": {
          "sessionId": { "type": "string", "minLength": 1 },
          "updatedAt": { "type": "number" },
          "running": { "type": "boolean" },
          "blank": { "type": "boolean" },
          "cwd": { "type": "string" },
          "agentPreset": { "type": "string" },
          "projections": { "$ref": "#/$defs/SessionProjections" },
          "parentSessionId": {
            "type": "string",
            "minLength": 1,
            "description": "兼容字段；本文不展开"
          },
          "origin": { "const": "subagent", "description": "兼容字段；本文不展开" }
        }
      }
    }
  }
}
```

#### `POST /api/session.search`

- `method`: `session.search`
- 请求 payload: `{ "query": string }`；服务先 trim，长度 `1..500`，不得含 NUL。
- 成功 value: `{ "items": [{ "sessionId": non-empty string, "snippet": string }], "hasMore": boolean }`；`items` 最多 20 项，`snippet` 最多 240 个 Unicode code point。

#### `POST /api/session.create`

- `method`: `session.create`
- 请求 payload: `{ "workspaceId"?: non-empty string, "cwd"?: string, "sessionId"?: non-empty string, "agentPreset"?: string }`；`workspaceId` 与 `cwd` 最多出现一个。
- 成功 value: `{ "sessionId": non-empty string, "agentPreset"?: string }`。
- 业务错误可包括 `session-conflict`、`workspace-not-found`、`workspace-attach-failed`、`agent-preset-not-found`、`agent-preset-invalid`。

#### `POST /api/session.history`

- `method`: `session.history`
- 请求 payload: `{ "sessionId": non-empty string, "beforeSeq"?: integer >= 0, "maxMessages"?: integer > 0 }`。
- 成功 value:

```json
{
  "type": "object",
  "required": ["events", "hasMore"],
  "properties": {
    "events": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["event"],
        "properties": {
          "event": { "$ref": "#/$defs/SessionEvent" },
          "view": { "$ref": "#/$defs/ToolEventView" }
        }
      }
    },
    "hasMore": { "type": "boolean" },
    "projections": { "$ref": "#/$defs/SessionProjections" }
  }
}
```

`projections` 只随尾页返回。默认 `maxMessages` 为 50。不存在的会话返回 `session-not-found`。

#### `POST /api/session.models`

- `method`: `session.models`
- 请求 payload: `{ "sessionId": non-empty string }`。
- 成功 value: `{ "current": ModelSelection, "routable": boolean, "groups": ModelProviderGroup[], "failures": ModelCatalogFailure[] }`。

#### `POST /api/session.selectModel`

- `method`: `session.selectModel`
- 请求 payload: `{ "sessionId": non-empty string, "provider": non-empty string, "model": non-empty string, "reasoningEffort"?: non-empty string }`。
- 成功 value: `{ "selected": ModelSelection }`。
- 业务错误可包括 `session-not-found`、`model-unavailable`。

#### `POST /api/session.rename`

- `method`: `session.rename`
- 请求 payload: `{ "sessionId": non-empty string, "title": string }`；标题的 trim/可接受性由 Host 业务层判断。
- 成功 value: `{ "title": non-empty string, "seq": integer >= 0 }`。
- 业务错误可包括 `session-not-found`、`title-invalid`。

#### `POST /api/session.fork`

- `method`: `session.fork`
- 请求 payload: `{ "sessionId": non-empty string, "atSeq"?: integer >= 0 }`。
- 成功 value: `{ "sessionId": non-empty string }`。
- 业务错误可包括 `session-not-found`、`fork-unavailable`。

#### `POST /api/session.prompt`

- `method`: `session.prompt`
- 请求 payload:

```json
{
  "type": "object",
  "required": ["sessionId", "mode", "content"],
  "properties": {
    "sessionId": { "type": "string", "minLength": 1 },
    "mode": { "enum": ["queue", "steer"] },
    "content": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "type": "object",
            "required": ["type", "text"],
            "properties": { "type": { "const": "text" }, "text": { "type": "string" } }
          },
          {
            "type": "object",
            "required": ["type", "mediaType", "data"],
            "properties": {
              "type": { "const": "image" },
              "mediaType": { "enum": ["image/png", "image/jpeg", "image/webp", "image/gif"] },
              "data": { "type": "string", "description": "Base64 图像数据，不含 data: URL 前缀" },
              "name": { "type": "string" }
            }
          }
        ]
      }
    },
    "clientTimeZone": { "type": "string" }
  }
}
```

- 成功 value: `{ "accepted": true, "command"?: { "kind": "success", "text"?: string } }`。
- 业务错误可包括 `session-not-found`、`invalid-time-zone`、`agent-busy`、`attachment-error`、`command-error`、`unknown-command`。

#### `POST /api/session.attachment`

- `method`: `session.attachment`
- 请求 payload: `{ "sessionId": non-empty string, "attachmentId": non-empty string }`。
- 成功 value:

```json
{
  "type": "object",
  "required": ["attachment", "data"],
  "properties": {
    "attachment": {
      "type": "object",
      "required": ["attachmentId", "mediaType", "bytes", "width", "height"],
      "properties": {
        "attachmentId": { "type": "string", "minLength": 1 },
        "mediaType": { "enum": ["image/png", "image/jpeg", "image/webp", "image/gif"] },
        "bytes": { "type": "integer", "minimum": 1 },
        "width": { "type": "integer", "minimum": 1 },
        "height": { "type": "integer", "minimum": 1 },
        "name": { "type": "string" }
      }
    },
    "data": { "type": "string", "description": "Base64 图像数据" }
  }
}
```

#### `POST /api/session.updateQueue`

- `method`: `session.updateQueue`
- 请求 payload:

```json
{
  "type": "object",
  "required": ["sessionId", "itemId", "action"],
  "properties": {
    "sessionId": { "type": "string", "minLength": 1 },
    "itemId": { "type": "string", "minLength": 1 },
    "action": {
      "oneOf": [
        {
          "type": "object",
          "required": ["kind", "content"],
          "properties": {
            "kind": { "const": "edit" },
            "content": {
              "type": "array",
              "items": {
                "type": "object",
                "required": ["type"],
                "properties": { "type": { "type": "string" } },
                "additionalProperties": true
              }
            }
          }
        },
        { "type": "object", "required": ["kind"], "properties": { "kind": { "const": "remove" } } },
        { "type": "object", "required": ["kind"], "properties": { "kind": { "const": "steer" } } }
      ]
    }
  }
}
```

- 成功 value: `{ "accepted": true }`。
- 业务错误可包括 `session-not-found`、`queue-item-not-found`、`steer-unavailable`。

#### `POST /api/session.cancel`

- `method`: `session.cancel`
- 请求 payload: `{ "sessionId": non-empty string }`。
- 成功 value: `{ "accepted": true }`。

### 5.2 Host

#### `POST /api/host.describe`

- 请求 payload: `{}`。
- 成功 value: `{ "version": string, "cwd": string, "provider"?: string, "model"?: string, "attachedSessions": integer >= 0, "canOpenPath": boolean }`。

#### `POST /api/host.pickDirectory`

- 权限：仅 loopback。
- 请求 payload: `{}`。
- 成功 value: `{ "path": string | null }`；`null` 表示用户取消。
- 业务错误可包括 `directory-picker-unavailable`。

#### `POST /api/host.listDirectory`

- 请求 payload: `{ "path"?: string }`；缺省时列出 home。
- 成功 value:

```json
{
  "type": "object",
  "required": ["path", "home", "crumbs", "entries", "truncated"],
  "properties": {
    "path": { "type": "string" },
    "home": { "type": "string" },
    "crumbs": { "type": "array", "items": { "$ref": "#/$defs/DirectoryEntry" } },
    "entries": { "type": "array", "items": { "$ref": "#/$defs/DirectoryEntry" } },
    "truncated": { "type": "boolean" }
  },
  "$defs": {
    "DirectoryEntry": {
      "type": "object",
      "required": ["name", "path", "hidden"],
      "properties": {
        "name": { "type": "string" },
        "path": { "type": "string" },
        "hidden": { "type": "boolean" }
      }
    }
  }
}
```

#### `POST /api/host.createDirectory`

- 请求 payload: `{ "path": string, "name": string }`；`name` trim 后非空，不得为 `.`/`..`，不得含 `/` 或 `\\`。
- 成功 value: `{ "path": string }`。
- 业务错误可包括 `directory-unreadable`、`directory-exists`、`directory-create-failed`。

#### `POST /api/host.openPath`

- 权限：仅 loopback。
- 请求 payload: `{ "path": non-empty string }`。
- 成功 value: `{ "opened": true }`。

### 5.3 Workspace

所有 Workspace 响应中的 `WorkspaceView` 使用第 4.3 节 Schema。

#### `POST /api/workspace.list`

- 请求 payload: `{}`。
- 成功 value: `{ "items": WorkspaceView[], "archivedSessionIds": non-empty-string[] }`。

#### `POST /api/workspace.create`

- 请求 payload: `{ "path": string }`。
- 成功 value: `{ "workspace": WorkspaceView, "created": boolean }`。
- 业务错误可包括 `workspace-invalid-path`、`workspace-name-conflict`。

#### `POST /api/workspace.rename`

- 请求 payload: `{ "workspaceId": non-empty string, "title": string }`；`title.trim()` 必须非空。
- 成功 value: `{ "workspace": WorkspaceView }`。

#### `POST /api/workspace.delete`

- 请求 payload: `{ "workspaceId": non-empty string }`。
- 成功 value: `{ "deleted": true }`。

#### `POST /api/workspace.insertBefore`

- 请求 payload: `{ "workspaceId": non-empty string, "beforeWorkspaceId"?: non-empty string }`；缺省 anchor 表示移到末尾。
- 成功 value: `{ "workspaceIds": non-empty-string[] }`。

#### `POST /api/workspace.insertSessionBefore`

- 请求 payload: `{ "workspaceId": non-empty string, "sessionId": non-empty string, "beforeSessionId"?: non-empty string }`。
- 成功 value: `{ "workspace": WorkspaceView }`。
- 业务错误可包括 `workspace-not-found`、`workspace-move-invalid`。

#### `POST /api/workspace.archiveSession`

- 请求 payload: `{ "sessionId": non-empty string }`。
- 成功 value: `{ "archivedSessionIds": non-empty-string[] }`。

### 5.4 Skill

#### `POST /api/skill.list`

- 请求 payload: `{ "sessionId": non-empty string }`。
- 成功 value:

```json
{
  "type": "object",
  "required": ["skills"],
  "properties": {
    "skills": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "description", "modelInvocable"],
        "properties": {
          "name": { "type": "string", "minLength": 1 },
          "description": { "type": "string" },
          "whenToUse": { "type": "string" },
          "modelInvocable": { "type": "boolean" }
        }
      }
    }
  }
}
```

### 5.5 Agent Preset

`agentPreset.read`、`agentPreset.copy`、`agentPreset.openDocument`、`agentPreset.remove` 仅 loopback；`list` 和 `select` 可由 trusted host 调用。

#### `POST /api/agentPreset.list`

- 请求 payload: `{}`。
- 成功 value: `{ "presets": AgentPresetEntry[], "authorable": boolean, "hasDocument": boolean }`。
- `AgentPresetEntry`: `{ "id": non-empty string, "trust": "system"|"user", "isDefault": boolean, "name"?: string, "description"?: string, "broken"?: non-empty string }`。

#### `POST /api/agentPreset.select`

- 请求 payload: `{ "sessionId": non-empty string, "agentPreset": non-empty string }`。
- 成功 value: `{ "agentPreset": string }`。
- 业务错误可包括 `agent-preset-locked`、`agent-preset-conflict`、`agent-preset-not-found`、`agent-preset-invalid`。

#### `POST /api/agentPreset.read`

- 请求 payload: `{ "agentPreset": non-empty string }`。
- 成功 value: `{ "agentPreset": string, "trust": "system"|"user", "content": string, "name"?: string, "description"?: string }`。

#### `POST /api/agentPreset.copy`

- 请求 payload: `{ "from": non-empty string, "agentPreset": non-empty string, "name"?: string }`。
- 成功 value: `{ "agentPreset": string }`。

#### `POST /api/agentPreset.openDocument`

- 请求 payload: `{ "agentPreset": non-empty string }`。
- 成功 value: `{ "opened": true } | { "opened": false, "path": string }`。

#### `POST /api/agentPreset.remove`

- 请求 payload: `{ "agentPreset": non-empty string }`。
- 成功 value: `{}`。
- 业务错误可包括 `agent-preset-read-only`、`agent-preset-not-found`。

### 5.6 旧 Goal API

这些点号 endpoint 是 API Proxy 的 mutation acknowledgement；第 6 节的 `goals/*` 是较新的 Typert Remote，二者请求/响应并不相同。

`GoalRef` Schema 为 `{ "id": string, "revision": integer >= 1 }`。

#### `POST /api/goal.create`

- 请求 payload: `{ "sessionId": string, "objective": non-empty string, "maxGoalRounds"?: integer >= 1 }`。
- 成功 value: `{ "ref": GoalRef }`。

#### `POST /api/goal.edit`

- 请求 payload: `{ "sessionId": string, "ref": GoalRef, "objective"?: non-empty string, "maxGoalRounds"?: integer >= 1 }`；两个可编辑字段至少存在一个。
- 成功 value: `{ "ref": GoalRef }`。

#### `POST /api/goal.pause`、`POST /api/goal.resume`、`POST /api/goal.complete`

- 请求 payload: `{ "sessionId": string, "ref": GoalRef }`。
- 成功 value: `{ "ref": GoalRef }`。

#### `POST /api/goal.clear`

- 请求 payload: `{ "sessionId": string, "ref": GoalRef }`。
- 成功 value: `{ "cleared": true }`。

### 5.7 Settings

本域所有接口仅 loopback。

`SettingsNamespaceView` Schema：

```json
{
  "type": "object",
  "required": ["ns", "schema", "value", "applies", "secrets", "revision"],
  "properties": {
    "ns": { "type": "string", "minLength": 1 },
    "schema": {},
    "value": {},
    "base": {},
    "user": {},
    "applies": { "enum": ["live", "restart"] },
    "secrets": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["path", "set"],
        "properties": {
          "path": { "type": "array", "items": { "type": "string" } },
          "set": { "type": "boolean" }
        }
      }
    },
    "revision": { "type": "number" }
  }
}
```

#### `POST /api/settings.describe`

- 请求 payload: `{}`。
- 成功 value: `{ "writable": boolean, "hasDocument": boolean, "namespaces": SettingsNamespaceView[] }`。

#### `POST /api/settings.openDocument`

- 请求 payload: `{}`。
- 成功 value: `{ "opened": true }`。

#### `POST /api/settings.update`

- 请求 payload: `{ "ns": non-empty string, "patch": object, "expectedRevision"?: number }`。
- 成功 value: `SettingsNamespaceView`。

#### `POST /api/settings.replace`

- 请求 payload: `{ "ns": non-empty string, "section": object, "expectedRevision"?: number }`。
- 成功 value: `SettingsNamespaceView`。

#### `POST /api/settings.mutate`

- 请求 payload: `{ "ns": non-empty string, "ops": SettingsPathOp[], "expectedRevision"?: number }`。
- `SettingsPathOp`: `{ "op": "set", "path": string[], "value": any } | { "op": "unset", "path": string[] }`。
- 成功 value: `SettingsNamespaceView`。
- Settings 写入错误可包括 `settings-rejected`、`settings-not-exposed`、`settings-conflict`。

### 5.8 Credentials

本域所有接口仅 loopback。`CredentialRef` 必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`。

#### `POST /api/credentials.describe`

- 请求 payload: `{ "refs": CredentialRef[] }`；最多 64 项。
- 成功 value: `{ "credentials": { [ref: string]: { "configured": boolean, "source"?: string, "writable": boolean } } }`。

#### `POST /api/credentials.set`

- 请求 payload: `{ "ref": CredentialRef, "value": non-empty string }`。
- 成功 value: `{}`。

#### `POST /api/credentials.unset`

- 请求 payload: `{ "ref": CredentialRef }`。
- 成功 value: `{}`。
- 写入可能返回 `credential-rejected`。

### 5.9 LLM

#### `POST /api/llm.providers`

- 请求 payload: `{}`。
- 成功 value: `{ "providers": ConfigurableProviderView[] }`。
- `ConfigurableProviderView`: `{ "provider": non-empty string, "displayName": non-empty string, "settingsNs": string, "settingsPath": string[], "active": boolean, "declared"?: boolean }`。

#### `POST /api/llm.models`

- 请求 payload: `{}`。
- 成功 value: `{ "groups": ModelProviderGroup[], "failures": ModelCatalogFailure[] }`。

#### `POST /api/llm.discoverModels`

- 权限：仅 loopback。
- 请求 payload: `{ "settingsNs": non-empty string, "provider"?: non-empty string, "baseURL"?: non-empty string, "api"?: non-empty string, "apiKey"?: non-empty string }`。
- `apiKey` 只用于本次探测，不存储、不返回。
- 成功 value: `{ "models": [{ "id": non-empty string, "name"?: non-empty string, "contextWindow"?: integer >= 1, "maxTokens"?: integer >= 1 }] }`。
- 业务错误可包括 `model-discovery-failed`。

## 6. Typert Remote unary 接口

Typert Remote 与旧 API Proxy 共享 `POST /api/<namespace>/<method>` 和同一个 `ClientRequest`/`ServerResponse` 外层。它的 payload 必须严格等于 `{ "args": { ... } }`，`args` 的键也必须与生成 descriptor 完全一致，多键、少键或额外键都会失败。

Typert Gateway 的 descriptor、lookup、binding、输入或返回验证异常在 HTTP 线上统一折叠为 `result.ok=false`、`error.code="internal"`；载体取消映射为 `cancelled`。具体业务方法返回的判别联合仍作为成功 `value` 原样传输。

### 6.1 Commands

#### `POST /api/commands/list`

- `method`: `commands/list`
- 请求 payload: `{ "args": { "agentId": non-empty string } }`。
- 成功 value:

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "required": ["name", "description"],
    "properties": {
      "name": { "type": "string" },
      "description": { "type": "string" },
      "input": {
        "type": "object",
        "required": ["hint"],
        "properties": { "hint": { "type": "string" } }
      }
    }
  }
}
```

#### `POST /api/commands/execute`

- `method`: `commands/execute`
- 请求 payload: `{ "args": { "agentId": non-empty string, "line": string } }`；`AbortSignal` 是 HTTP 连接取消信号，不进入 JSON。
- 成功 value:

```json
{
  "oneOf": [
    {
      "type": "object",
      "required": ["commandId", "result"],
      "properties": {
        "commandId": { "type": "string" },
        "result": {
          "oneOf": [
            {
              "type": "object",
              "required": ["kind"],
              "properties": {
                "kind": { "const": "success" },
                "text": { "type": "string" },
                "sourceEventSeq": { "type": "number" }
              }
            },
            {
              "type": "object",
              "required": ["kind", "text"],
              "properties": { "kind": { "const": "error" }, "text": { "type": "string" } }
            }
          ]
        }
      }
    },
    { "type": "null", "description": "类型层的 undefined；实际 JSON 响应会省略 result.value" }
  ]
}
```

语法无效或命令不存在时不算错误，成功分支中的 `value` 被省略。

### 6.2 新 Goals Remote

本节 `GoalRef` 为 `{ "id": string, "revision": integer >= 1 }`；`CreateGoalRequest` 为 `{ "objective": string, "maxGoalRounds"?: number }`；`EditGoalRequest` 为 `{ "objective"?: string, "maxGoalRounds"?: number }`，业务服务再执行非空、正整数和至少一字段的规则。

`GoalView` Schema：

```json
{
  "type": "object",
  "required": [
    "id",
    "revision",
    "objective",
    "phase",
    "maxGoalRounds",
    "roundsStarted",
    "createdAt",
    "updatedAt",
    "activation"
  ],
  "properties": {
    "id": { "type": "string" },
    "revision": { "type": "integer", "minimum": 1 },
    "objective": { "type": "string" },
    "phase": { "enum": ["active", "paused", "blocked", "complete"] },
    "blockedReason": {
      "type": "object",
      "required": ["code", "message"],
      "properties": {
        "code": { "type": "string" },
        "message": { "type": "string", "minLength": 1 }
      }
    },
    "maxGoalRounds": { "type": "number" },
    "roundsStarted": { "type": "number" },
    "createdAt": { "type": "number" },
    "updatedAt": { "type": "number" },
    "activation": { "enum": ["armed", "disarmed"] }
  }
}
```

#### `POST /api/goals/create`

- 请求 payload: `{ "args": { "agentId": non-empty string, "request": CreateGoalRequest } }`。
- 成功 value: `{ "ref": GoalRef }`。

#### `POST /api/goals/edit`

- 请求 payload: `{ "args": { "agentId": non-empty string, "ref": GoalRef, "request": EditGoalRequest } }`。
- 成功 value: `GoalView`。

#### `POST /api/goals/pause`、`POST /api/goals/resume`、`POST /api/goals/complete`

- 请求 payload: `{ "args": { "agentId": non-empty string, "ref": GoalRef } }`。
- 成功 value: `GoalView`。

#### `POST /api/goals/clear`

- 请求 payload: `{ "args": { "agentId": non-empty string, "ref": GoalRef } }`。
- 成功 value: `GoalRef`，表示被清除的精确 revision。

### 6.3 Message Feedback

本域的 `ServerResponse.result.ok=true` 只表示 Typert 调用成功，`result.value` 自身还是一个业务 `ok` 联合；调用方必须检查两层 `ok`。

`MessageFeedbackItem` Schema：

```json
{
  "type": "object",
  "required": ["messageId", "rating", "version", "createdAt", "updatedAt"],
  "properties": {
    "messageId": { "type": "string" },
    "rating": { "enum": ["positive", "negative"] },
    "note": { "type": "string" },
    "version": { "type": "string" },
    "createdAt": { "type": "number" },
    "updatedAt": { "type": "number" }
  }
}
```

业务错误 Schema：

```json
{
  "oneOf": [
    {
      "type": "object",
      "required": ["code", "sessionId"],
      "properties": { "code": { "const": "session-not-found" }, "sessionId": { "type": "string" } }
    },
    {
      "type": "object",
      "required": ["code", "sessionId", "messageId"],
      "properties": {
        "code": { "const": "target-not-found" },
        "sessionId": { "type": "string" },
        "messageId": { "type": "string" }
      }
    },
    {
      "type": "object",
      "required": ["code", "current"],
      "properties": {
        "code": { "const": "version-conflict" },
        "current": { "oneOf": [{ "$ref": "#/$defs/MessageFeedbackItem" }, { "type": "null" }] }
      }
    },
    { "type": "object", "required": ["code"], "properties": { "code": { "const": "note-blank" } } },
    {
      "type": "object",
      "required": ["code", "maxBytes", "actualBytes"],
      "properties": {
        "code": { "const": "note-too-large" },
        "maxBytes": { "type": "number" },
        "actualBytes": { "type": "number" }
      }
    }
  ]
}
```

#### `POST /api/messageFeedback/list`

- 请求 payload: `{ "args": { "request": { "sessionId": string } } }`。
- 成功 value: `{ "ok": true, "value": { "items": MessageFeedbackItem[] } } | { "ok": false, "error": SessionNotFound }`。

#### `POST /api/messageFeedback/put`

- 请求 payload: `{ "args": { "request": { "sessionId": string, "messageId": string, "rating": "positive"|"negative", "note"?: string, "ifVersion": string|null } } }`。
- `note` 存在时 trim 后必须非空，完整 UTF-8 字节长度不得超过部署的 `maxNoteBytes`。
- 成功 value: `{ "ok": true, "value": MessageFeedbackItem } | { "ok": false, "error": MessageFeedbackBusinessError }`。

#### `POST /api/messageFeedback/delete`

- 请求 payload: `{ "args": { "request": { "sessionId": string, "messageId": string, "ifVersion": string } } }`。
- 成功 value: `{ "ok": true, "value": { "absent": true } } | { "ok": false, "error": SessionNotFound|VersionConflict }`。
- 目标条目已经不存在时仍返回成功，且忽略传入 version。

## 7. `POST /api/respond`

该接口用于回答 WS 流中的 approval 或 question 请求，不使用 `ClientRequest`，而使用 `ClientResponse`。

请求体 Schema：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["type", "rpcId", "result"],
  "properties": {
    "type": { "const": "client-response" },
    "rpcId": { "type": "string", "description": "必须回显待处理 ServerRequest 的 rpcId" },
    "result": {
      "oneOf": [
        {
          "type": "object",
          "required": ["ok", "value"],
          "properties": {
            "ok": { "const": true },
            "value": {
              "oneOf": [
                {
                  "type": "object",
                  "required": ["sessionId", "approvalId", "outcome"],
                  "properties": {
                    "sessionId": { "type": "string", "minLength": 1 },
                    "approvalId": { "type": "string", "minLength": 1 },
                    "outcome": { "enum": ["allowed-once", "rejected"] }
                  }
                },
                {
                  "type": "object",
                  "required": ["sessionId", "answer"],
                  "properties": {
                    "sessionId": { "type": "string", "minLength": 1 },
                    "answer": {
                      "type": "object",
                      "required": ["answers"],
                      "properties": {
                        "answers": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "required": ["id", "selected"],
                            "properties": {
                              "id": { "type": "string" },
                              "selected": { "type": "array", "items": { "type": "string" } },
                              "custom": { "type": "string" }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              ]
            }
          }
        },
        {
          "type": "object",
          "required": ["ok", "error"],
          "properties": {
            "ok": { "const": false },
            "error": {
              "type": "object",
              "required": ["code", "message", "details"],
              "properties": {
                "code": { "const": "cancelled" },
                "message": { "type": "string" },
                "details": { "type": "object" }
              }
            }
          },
          "description": "只对 question 取消有效；approval 不接受失败分支"
        }
      ]
    }
  }
}
```

成功 HTTP 响应始终是 `200 application/json`，响应体 Schema：

```json
{
  "oneOf": [
    { "type": "object", "required": ["accepted"], "properties": { "accepted": { "const": true } } },
    {
      "type": "object",
      "required": ["accepted", "reason"],
      "properties": {
        "accepted": { "const": false },
        "reason": { "enum": ["not-pending", "bad-response"] }
      }
    }
  ]
}
```

完整 JSON 形状无法解析为 `ClientResponse` 时不会返回 `ServerResponse`，而是直接返回 `{ "accepted": false, "reason": "bad-response" }`；JSON 语法错误仍为 HTTP `400`。

## 8. `GET|HEAD /api/session.export`

请求 URL：

```text
/api/session.export?sessionId=<non-empty>&includeDescendants=true|false
```

查询参数 Schema：

```json
{
  "type": "object",
  "required": ["sessionId"],
  "properties": {
    "sessionId": { "type": "string", "minLength": 1 },
    "includeDescendants": { "enum": ["true", "false"] }
  }
}
```

`includeDescendants` 缺省或为 `false` 时只导出根 Session。该字段的后代会话行为不属于本文接口范围。

响应：

- `GET 200`: `application/zip` 二进制流，`Content-Disposition` 见第 3.4 节；
- `HEAD 200`: 与 GET 相同的状态和响应头，响应体为空；
- `400`: 查询参数缺失或非法，文本体 `missing or invalid sessionId query parameter`；
- `404`: Session 不存在，文本体 `session not found`；
- `500`: 依赖服务缺失或导出准备失败；
- `501`: persistence backend 不支持 raw artifact。

成功响应体 Schema：

```json
{
  "title": "SessionExportBody",
  "type": "string",
  "contentEncoding": "binary",
  "contentMediaType": "application/zip"
}
```

## 9. WebSocket

### 9.1 Upgrade 请求头 Schema

两条流分别连接：

```text
ws://<authority>/api/events.mux
ws://<authority>/api/events.host
```

TLS 反向代理下使用 `wss:`。握手头 Schema：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "WebSocketUpgradeHeaders",
  "type": "object",
  "required": ["host", "connection", "upgrade", "sec-websocket-version", "sec-websocket-key"],
  "properties": {
    "host": { "type": "string", "minLength": 1 },
    "connection": {
      "type": "string",
      "pattern": "(^|.*,\\s*)[Uu][Pp][Gg][Rr][Aa][Dd][Ee](\\s*,.*|$)"
    },
    "upgrade": { "type": "string", "pattern": "^[Ww][Ee][Bb][Ss][Oo][Cc][Kk][Ee][Tt]$" },
    "sec-websocket-version": { "const": "13" },
    "sec-websocket-key": { "type": "string", "minLength": 1 },
    "sec-websocket-protocol": { "type": "string" },
    "sec-websocket-extensions": { "type": "string" },
    "origin": { "type": "string", "format": "uri" },
    "sec-fetch-site": { "type": "string", "not": { "const": "cross-site" } }
  },
  "additionalProperties": true,
  "x-dsh-trust-rules": [
    "Host 必须是 loopback 或 trustedHosts",
    "Origin 存在时必须与 Host authority 相同",
    "不可信握手在升级前返回 HTTP 403"
  ]
}
```

握手成功为 HTTP `101 Switching Protocols`。客户端不得在 socket 上发送应用数据；收到任意客户端 message 后，Host 以 close code `1008`、reason `downlink only` 关闭连接。上行回答统一走 `POST /api/respond`。

### 9.2 公共 WS 消息 envelope

Host 发送的每个 WS text frame 都是一个完整 JSON `ServerRequest`：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["type", "rpcId", "method", "payload"],
  "properties": {
    "type": { "const": "server-request" },
    "rpcId": { "type": "string" },
    "method": { "type": "string", "description": "必须等于 payload.type" },
    "payload": { "type": "object", "required": ["type"] }
  }
}
```

流源异常时，Host 尽力发送一个 `stream/error` frame，然后关闭 socket。任一 socket 断开会使客户端当前 connection generation 失效，客户端需要同时重建两条流并重新调用 `host.describe`。

### 9.3 `/api/events.mux` payload 联合

```json
{
  "oneOf": [
    {
      "title": "SessionEventFrame",
      "type": "object",
      "required": ["type", "sessionId", "event"],
      "properties": {
        "type": { "const": "session/event" },
        "sessionId": { "type": "string", "minLength": 1 },
        "event": { "$ref": "#/$defs/SessionEvent" },
        "view": { "$ref": "#/$defs/ToolEventView" }
      }
    },
    {
      "title": "SessionSubscribedFrame",
      "type": "object",
      "required": ["type", "sessionId", "lastSeq"],
      "properties": {
        "type": { "const": "session/subscribed" },
        "sessionId": { "type": "string", "minLength": 1 },
        "lastSeq": { "type": "integer" }
      }
    },
    {
      "title": "ApprovalRequestedFrame",
      "type": "object",
      "required": ["type", "sessionId", "approvalId", "toolName"],
      "properties": {
        "type": { "const": "approval/requested" },
        "sessionId": { "type": "string", "minLength": 1 },
        "approvalId": { "type": "string", "minLength": 1 },
        "toolName": { "type": "string" },
        "callId": { "type": "string" },
        "reason": { "type": "string" }
      }
    },
    {
      "title": "ApprovalResolvedFrame",
      "type": "object",
      "required": ["type", "sessionId", "approvalId", "outcome"],
      "properties": {
        "type": { "const": "approval/resolved" },
        "sessionId": { "type": "string", "minLength": 1 },
        "approvalId": { "type": "string", "minLength": 1 },
        "outcome": { "enum": ["allowed-once", "rejected", "cancelled", "unavailable"] }
      }
    },
    {
      "title": "QuestionRequestedFrame",
      "type": "object",
      "required": ["type", "sessionId", "questions"],
      "properties": {
        "type": { "const": "question/requested" },
        "sessionId": { "type": "string", "minLength": 1 },
        "questions": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/QuestionItem" }
        }
      }
    },
    {
      "title": "QuestionResolvedFrame",
      "type": "object",
      "required": ["type", "sessionId", "questionRpcId", "outcome"],
      "properties": {
        "type": { "const": "question/resolved" },
        "sessionId": { "type": "string", "minLength": 1 },
        "questionRpcId": { "type": "string" },
        "outcome": { "enum": ["answered", "cancelled"] }
      }
    },
    {
      "title": "SessionQueueFrame",
      "type": "object",
      "required": ["type", "sessionId", "items"],
      "properties": {
        "type": { "const": "session/queue" },
        "sessionId": { "type": "string", "minLength": 1 },
        "items": { "type": "array", "items": { "$ref": "#/$defs/QueueItem" } }
      }
    },
    {
      "title": "SessionJobsFrame",
      "type": "object",
      "required": ["type", "sessionId", "jobs"],
      "properties": {
        "type": { "const": "session/jobs" },
        "sessionId": { "type": "string", "minLength": 1 },
        "jobs": { "type": "array", "items": { "$ref": "#/$defs/JobView" } }
      }
    },
    {
      "title": "SessionProjectionFrame",
      "type": "object",
      "required": ["type", "sessionId", "key", "value", "seq"],
      "properties": {
        "type": { "const": "session/projection" },
        "sessionId": { "type": "string", "minLength": 1 },
        "key": { "type": "string", "minLength": 1 },
        "value": {},
        "seq": { "type": "integer", "minimum": 0 }
      }
    },
    {
      "title": "StreamErrorFrame",
      "type": "object",
      "required": ["type", "error"],
      "properties": {
        "type": { "const": "stream/error" },
        "error": { "$ref": "#/$defs/RpcError" }
      }
    }
  ],
  "$defs": {
    "QuestionItem": {
      "type": "object",
      "required": ["id", "question"],
      "properties": {
        "id": { "type": "string" },
        "question": { "type": "string" },
        "header": { "type": "string" },
        "detail": { "type": "string" },
        "options": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["label"],
            "properties": { "label": { "type": "string" }, "description": { "type": "string" } }
          }
        },
        "multiSelect": { "type": "boolean" },
        "intent": {
          "type": "object",
          "required": ["kind", "approve"],
          "properties": { "kind": { "const": "plan-review" }, "approve": { "type": "string" } }
        }
      }
    },
    "QueueItem": {
      "type": "object",
      "required": ["id", "placement", "message"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "placement": { "enum": ["queued", "steering", "context"] },
        "message": {
          "type": "object",
          "required": ["id", "role", "content", "source"],
          "properties": {
            "id": { "type": "string", "minLength": 1 },
            "role": { "enum": ["system", "user", "assistant"] },
            "content": {
              "type": "array",
              "items": {
                "type": "object",
                "required": ["type"],
                "properties": { "type": { "type": "string" } },
                "additionalProperties": true
              }
            },
            "source": {
              "type": "object",
              "required": ["kind"],
              "properties": { "kind": { "type": "string" } },
              "additionalProperties": true
            }
          }
        }
      }
    },
    "JobView": {
      "type": "object",
      "required": ["id", "kind", "label", "status", "startedAt"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "kind": { "type": "string", "minLength": 1 },
        "label": { "type": "string", "minLength": 1 },
        "status": { "enum": ["running", "stopping", "completed", "killed", "failed"] },
        "detail": { "type": "string" },
        "startedAt": { "type": "integer", "minimum": 0 },
        "finishedAt": { "type": "integer", "minimum": 0 }
      }
    }
  }
}
```

### 9.4 `/api/events.host` payload 联合

```json
{
  "oneOf": [
    {
      "type": "object",
      "required": ["type", "sessionId", "blank"],
      "properties": {
        "type": { "const": "host/session-added" },
        "sessionId": { "type": "string", "minLength": 1 },
        "blank": { "type": "boolean" },
        "cwd": { "type": "string" },
        "agentPreset": { "type": "string" },
        "parentSessionId": {
          "type": "string",
          "minLength": 1,
          "description": "兼容字段；本文不展开"
        },
        "origin": { "const": "subagent", "description": "兼容字段；本文不展开" }
      }
    },
    {
      "type": "object",
      "required": ["type", "sessionId"],
      "properties": {
        "type": { "const": "host/session-removed" },
        "sessionId": { "type": "string", "minLength": 1 }
      }
    },
    {
      "type": "object",
      "required": ["type", "sessionId", "running"],
      "properties": {
        "type": { "const": "host/session-status" },
        "sessionId": { "type": "string", "minLength": 1 },
        "running": { "type": "boolean" }
      }
    },
    {
      "type": "object",
      "required": ["type", "sessionId", "message"],
      "properties": {
        "type": { "const": "host/agent-error" },
        "sessionId": { "type": "string", "minLength": 1 },
        "message": { "type": "string" }
      }
    },
    {
      "type": "object",
      "required": ["type", "workspace"],
      "properties": {
        "type": { "const": "host/workspace-changed" },
        "workspace": { "$ref": "#/$defs/WorkspaceView" }
      }
    },
    {
      "type": "object",
      "required": ["type", "workspaceId"],
      "properties": {
        "type": { "const": "host/workspace-removed" },
        "workspaceId": { "type": "string", "minLength": 1 }
      }
    },
    {
      "type": "object",
      "required": ["type", "workspaceIds"],
      "properties": {
        "type": { "const": "host/workspace-order-changed" },
        "workspaceIds": { "type": "array", "items": { "type": "string", "minLength": 1 } }
      }
    },
    {
      "type": "object",
      "required": ["type", "archivedSessionIds"],
      "properties": {
        "type": { "const": "host/archived-sessions-changed" },
        "archivedSessionIds": { "type": "array", "items": { "type": "string", "minLength": 1 } }
      }
    },
    {
      "type": "object",
      "required": ["type", "event", "args"],
      "properties": {
        "type": { "const": "host/remote-event" },
        "event": {
          "enum": [
            "agent-preset/selected",
            "commands/change",
            "credentials/updated",
            "llm/adapters-updated",
            "settings/document-updated"
          ]
        },
        "args": { "type": "array", "items": {} }
      },
      "description": "这里只列非插件管理事件；实际开放 wrapper 的 event 字段为任意非空字符串"
    },
    {
      "type": "object",
      "required": ["type", "error"],
      "properties": { "type": { "const": "stream/error" }, "error": { "$ref": "#/$defs/RpcError" } }
    }
  ]
}
```

`host/remote-event.args` 在载入队列前必须可 JSON 序列化；具体参数由事件所有者定义。本文刻意省略所有 Cordis 动态插件事件名。

本文收录的非插件管理事件参数为：

- `agent-preset/selected`: `[sessionId: non-empty string, agentPreset: string]`；
- `commands/change`: `[]`；
- `credentials/updated`: `[ref: CredentialRef]`；
- `llm/adapters-updated`: `[]`；
- `settings/document-updated`: `[ns: string, revision: number]`。

## 10. RpcError Schema

本文范围内的 `RpcError` 都有 `{ code, message, details }`。`message` 是人类可读诊断，客户端分支应以 `code` 和 `details` 为准。

`bad-request.details.issues` 是 Zod issue 数组；每项至少包含 `code: string`、`path: (string|integer)[]`、`message: string`，并可能带校验器特有字段。

非 subagent 错误分支的 `details` Schema 如下：

```json
{
  "bad-request": { "issues": "ZodIssue[]" },
  "cancelled": {},
  "session-not-found": { "sessionId": "string" },
  "model-unavailable": { "provider": "string", "model": "string" },
  "session-conflict": { "sessionId": "string", "requestedCwd": "string", "existingCwd?": "string" },
  "invalid-time-zone": { "value": "string" },
  "workspace-attach-failed": { "sessionId": "string", "workspaceId": "string" },
  "workspace-not-found": { "workspaceId": "string" },
  "workspace-invalid-path": { "path": "string" },
  "workspace-name-conflict": { "name": "string" },
  "workspace-move-invalid": {
    "workspaceId": "string",
    "sessionId": "string",
    "beforeSessionId?": "string"
  },
  "directory-unreadable": { "path": "string" },
  "directory-exists": { "path": "string" },
  "directory-create-failed": { "path": "string" },
  "directory-picker-unavailable": { "capability": "string" },
  "agent-preset-read-only": { "agentPreset": "string", "reason": "string" },
  "agent-preset-locked": { "sessionId": "string", "agentPreset": "string" },
  "agent-preset-conflict": {
    "sessionId": "string",
    "requestedPreset": "string",
    "existingPreset?": "string"
  },
  "agent-preset-not-found": { "agentPreset": "string", "available": "string[]" },
  "agent-preset-invalid": { "agentPreset": "string", "reason": "string" },
  "agent-busy": { "reason": "string" },
  "attachment-error": { "reason": "string" },
  "queue-item-not-found": { "itemId": "string" },
  "steer-unavailable": { "itemId": "string" },
  "command-error": {},
  "unknown-command": {},
  "settings-rejected": { "ns": "string" },
  "settings-not-exposed": { "ns": "string" },
  "settings-conflict": { "ns": "string", "expected": "number", "actual": "number" },
  "credential-rejected": { "ref": "string" },
  "model-discovery-failed": { "settingsNs": "string", "baseURL?": "string" },
  "title-invalid": { "sessionId": "string" },
  "fork-unavailable": { "sessionId": "string" },
  "internal": {}
}
```

上面的块是按 `code` 查找 `details` 的规范映射；其等价完整联合为：每个键 `K` 生成 `{ "code": const K, "message": string, "details": Details[K] }`。本文刻意不列 subagent 专用错误码。

## 11. HTTP 状态码

- `101`: WebSocket upgrade 成功。
- `200`: unary RPC 成功或业务失败；必须继续检查 `result.ok`。`/api/respond` 的 receipt 也使用 200。
- `400`: JSON 语法错误、导出查询非法，或 WebServer 路由处理在发头前抛出。
- `403`: Host/Origin/Fetch-Metadata 信任检查失败，或 trusted host 调用了仅 loopback 方法。
- `404`: 路径/方法不匹配、Remote 未被认领后 fallback 也不存在，或导出目标 Session 不存在。
- `413`: 请求体声明长度或实际累计长度超过 `maxRequestBodyBytes`。
- `415`: POST 媒体类型不是 `application/json`。
- `426`: 对 WS 路径执行普通 GET，没有 Upgrade。
- `500`: unary handler 意外抛出、导出依赖缺失或准备失败。
- `501`: 导出所用 persistence backend 不支持 raw artifact。

## 12. 最小调用示例

普通 API Proxy 调用：

```http
POST /api/session.models HTTP/1.1
Host: 127.0.0.1:3080
Content-Type: application/json

{
  "type": "client-request",
  "rpcId": "models-1",
  "method": "session.models",
  "payload": { "sessionId": "session-123" }
}
```

Typert Remote 调用：

```http
POST /api/commands/list HTTP/1.1
Host: 127.0.0.1:3080
Content-Type: application/json

{
  "type": "client-request",
  "rpcId": "commands-1",
  "method": "commands/list",
  "payload": { "args": { "agentId": "session-123" } }
}
```

业务成功响应：

```json
{
  "type": "server-response",
  "rpcId": "commands-1",
  "result": {
    "ok": true,
    "value": [{ "name": "compact", "description": "Compact the current session" }]
  }
}
```

业务失败响应：

```json
{
  "type": "server-response",
  "rpcId": "models-1",
  "result": {
    "ok": false,
    "error": {
      "code": "session-not-found",
      "message": "session not found",
      "details": { "sessionId": "session-123" }
    }
  }
}
```

## 13. 源码依据

本文主要依据以下当前源码：

- [`packages/host/apiproxy/src/api/rpc-map.ts`](packages/host/apiproxy/src/api/rpc-map.ts)：旧 unary endpoint 清单；
- [`packages/host/apiproxy/src/api/`](packages/host/apiproxy/src/api/)：请求、响应和 WS frame Zod Schema；
- [`packages/host/apiproxy/src/fetch/handler.ts`](packages/host/apiproxy/src/fetch/handler.ts)：HTTP path、媒体类型、状态码、envelope 与导出分发；
- [`packages/client/connection/src/index.ts`](packages/client/connection/src/index.ts)、[`api-request-trust.ts`](packages/client/connection/src/api-request-trust.ts)、[`http-bridge.ts`](packages/client/connection/src/http-bridge.ts)：Host/Origin 信任、loopback 限制、请求体上限；
- [`packages/client/connection/src/websocket-downlink.ts`](packages/client/connection/src/websocket-downlink.ts)：WS upgrade、只下行约束与 close code；
- [`packages/api/gateway/src/index.ts`](packages/api/gateway/src/index.ts)：Typert Remote 拦截、严格 args、错误折叠；
- [`packages/interaction/commands/lib/typert.remote-client.d.ts`](packages/interaction/commands/lib/typert.remote-client.d.ts)、[`packages/goal/goal/lib/typert.remote-client.d.ts`](packages/goal/goal/lib/typert.remote-client.d.ts)、[`packages/feedback/message-feedback/lib/typert.remote-client.d.ts`](packages/feedback/message-feedback/lib/typert.remote-client.d.ts)：生成的 Remote endpoint 与参数顺序；
- [`packages/interaction/commands/src/types.ts`](packages/interaction/commands/src/types.ts)、[`packages/goal/goal/src/types.ts`](packages/goal/goal/src/types.ts)、[`packages/feedback/message-feedback/src/types.ts`](packages/feedback/message-feedback/src/types.ts)：Typert 业务返回模型。
