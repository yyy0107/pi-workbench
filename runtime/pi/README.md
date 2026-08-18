# Workbench Pi Runtime

Workbench Pi Runtime embeds Pi directly inside the Workbench Next.js server.

`pi-web` is reference only.

The browser never talks to `pi-web`.
The server does not proxy an external Pi service.

The Workbench server owns the Pi runtime lifecycle and exposes a UI-oriented transport layer to the browser.

---

# Architecture Overview

The runtime is built on top of:

```

@earendil-works/pi-coding-agent

```

The main runtime layers:

```

```
                Browser

                   |
                   |
             SSE / UI API

                   |
                   |

          Workbench Next.js Server

                   |
                   |

         AgentSessionRuntime

                   |
      +------------+------------+

      |                         |
```

AgentSession              SessionManager

```
      |

      |

   Agent Core

      |
```

+--------+---------+

|                  |

Models            Tools

|

Extensions

````

---

# Design Goals

Workbench Pi Runtime provides:

- Embedded Pi execution
- Multiple independent conversations
- Background agent execution
- Persistent sessions
- Workspace isolation
- Custom UI support
- Server controlled permissions
- Extension based customization

The browser is only a presentation layer.

---

# Pi SDK Integration

Workbench uses the public SDK:

```ts
import {
  AgentSession,
  AgentSessionRuntime,

  createAgentSession,
  createAgentSessionServices,
  createAgentSessionFromServices,
  createAgentSessionRuntime,

  AgentSessionServices,

  SessionManager,
  SessionInfo,

  sessionEntryToContextMessages,

  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
````

---

# Runtime Components

## AgentSessionRuntime

`AgentSessionRuntime` manages the lifecycle of active sessions.

It is responsible for:

* creating sessions
* switching sessions
* forking sessions
* importing sessions
* replacing active sessions

It represents the application-level runtime.

Example:

```ts
const runtime =
  await createAgentSessionRuntime(
    factory,
    options
  );
```

Current session:

```ts
runtime.session
```

---

## AgentSession

`AgentSession` represents one running Pi agent.

Responsibilities:

* prompt execution
* tool execution
* model streaming
* context management
* message history
* compaction
* steering
* follow-up queue

Architecture:

```
AgentSession

 |
 +-- Agent
 |
 +-- Model
 |
 +-- Tools
 |
 +-- Extensions
 |
 +-- SessionManager
```

---

# AgentSession API

## Send Prompt

Normal user message:

```ts
await session.prompt(
  "Analyze this repository"
);
```

---

## Steering

Modify current running task:

```ts
await session.steer(
  "Stop and inspect another file"
);
```

Behavior:

```
Current turn

    |
    |
 Tool execution

    |
    |
 Steering message

    |
    |
 Continue execution
```

---

## Follow Up

Queue next user message:

```ts
await session.followUp(
  "Also update documentation"
);
```

Behavior:

```
Current turn

    |
    |
 Finish

    |
    |
 Follow-up message
```

---

## Subscribe Events

Workbench listens to:

```ts
session.subscribe(
  (event: AgentSessionEvent)=>{

  }
);
```

Events include:

```
session_start

message_start
message_update
message_end

tool_execution_start
tool_execution_update
tool_execution_end

turn_start
turn_end

session_compact

session_tree

session_info_changed
```

The browser never subscribes directly.

---

# AgentSessionServices

`AgentSessionServices` contains infrastructure required to create an AgentSession.

Created by:

```ts
createAgentSessionServices()
```

Structure:

```ts
interface AgentSessionServices {

  cwd:string;

  agentDir:string;


  modelRuntime:
    ModelRuntime;


  settingsManager:
    SettingsManager;


  resourceLoader:
    ResourceLoader;


  diagnostics:
    AgentSessionRuntimeDiagnostic[];
}
```

---

# Services Responsibilities

## cwd

Current workspace directory.

Every session belongs to exactly one canonical workspace.

Example:

```
Session A
 |
 +-- /projects/app1


Session B
 |
 +-- /projects/app2
```

---

## ModelRuntime

Responsible for:

* model providers
* authentication
* model discovery
* streaming

Examples:

```
OpenAI

Anthropic

Google

Local models

Extension providers
```

---

## SettingsManager

Controls:

* Pi configuration
* thinking level
* retry strategy
* tool settings

---

## ResourceLoader

Loads:

* extensions
* skills
* prompts
* project resources

---

# SessionManager

`SessionManager` handles persistent session storage.

Pi sessions are stored as JSONL.

Structure:

```
Session File


Header

 |

Messages

 |

Tool Results

 |

Branches

 |

Compaction Entries
```

Responsibilities:

* create sessions
* load sessions
* list sessions
* branch navigation
* persistence

---

# SessionInfo

Metadata returned to UI.

Example:

```ts
interface SessionInfo {

 id:string;

 cwd:string;

 createdAt:number;

 updatedAt:number;

 title?:string;

}
```

Used by:

```
SessionManager

      |

Session list

      |

Workbench sidebar
```

---

# Session History Conversion

Pi stores internal entries.

Convert to LLM context:

```ts
sessionEntryToContextMessages()
```

Flow:

```
Session JSONL

      |

sessionEntryToContextMessages

      |

Context Messages
```

Used for:

* restoring sessions
* cold loading
* debugging
* export

---

# Session Lifecycle

## Browser State

The browser maintains:

```
PiClientSession
```

for every opened conversation.

Switching conversations:

```
Conversation A

        |

Switch

        |

Conversation B
```

does not destroy A.

---

# Running Sessions

Every Pi session can execute independently.

Example:

```
Sidebar


Chat A
 |
 running


Chat B
 |
 running


Chat C
 |
 idle
```

Background sessions continue execution.

---

# SSE Connection Model

Each running session has:

```
AgentSession

      |

SSE Stream

      |

Browser
```

When idle:

* SSE closes after 30 seconds grace period
* AgentSession remains alive
* Messages remain stored

---

# Runtime Cache

The server keeps:

```
AgentSession
```

instances resident for:

```
10 minutes idle timeout
```

After expiration:

```
AgentSession

       |

dispose
```

History remains available through:

```
SessionManager
```

---

# Global Runtime Stream

A separate SSE channel provides:

```
running session ids
```

Example:

```json
{
 "running":[
   "session-a",
   "session-b"
 ]
}
```

Used for:

* sidebar status
* background completion indicators
* activity badges

---

# Session Creation Flow

```
User selects workspace

        |

Canonical path validation

        |

createAgentSessionServices()

        |

createAgentSessionFromServices()

        |

AgentSession created

        |

SSE connected

        |

UI ready
```

---

# Workspace Model

Workbench does not have a default workspace.

Before creating a conversation:

1. User selects directory
2. Server validates directory
3. Server canonicalizes path
4. Pi runtime initializes session

Workspace identity:

```
workspaceId

=

hash(canonical cwd)
```

---

# Project Trust

Environment variable:

```
PI_WORKBENCH_TRUST_PROJECT=1
```

enables:

* project-local settings
* project extensions
* project resources

Default:

```
disabled
```

because project code is not trusted automatically.

---

# Server Responsibilities

Workbench Server owns:

```
Session lifecycle

Authentication

Workspace validation

Runtime cache

SSE transport

Permission control

API layer
```

---

# Pi Runtime Responsibilities

Pi owns:

```
Agent loop

LLM calls

Tool execution

Extensions

Skills

Compaction

Session format

Context management
```

---

# Browser Responsibilities

Browser owns:

```
UI rendering

Assistant UI state

Message display

SSE subscription

Optimistic interactions
```

Browser never imports:

```
@earendil-works/pi-coding-agent
```

---

# Recommended Runtime Structure

```
apps/
 |
 +-- workbench-web


packages/
 |
 +-- pi-runtime
 |      |
 |      +-- session-manager.ts
 |      +-- runtime-cache.ts
 |      +-- sse.ts
 |      +-- workspace.ts
 |
 +-- ui
        |
        +-- assistant-ui components
```

---

# Future Extensions

Possible additions:

* WebSocket transport
* Multi-agent orchestration
* Remote Pi workers
* Distributed session execution
* Agent permissions
* Execution tracing
* Token accounting
* Runtime metrics
