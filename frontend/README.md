## Elevate frontend

Next.js + kepler.gl map workspace with an AI chat assistant in the side panel.

```bash
npm ci
cp .env.example .env.local   # then fill in keys
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Clean installation was verified with Node 22.23.2 / npm 10.9.8. Keep the project `.npmrc`: the existing React 19/Kepler dependency graph uses legacy peer resolution. The required map adapter is explicitly pinned to the existing `@deck.gl/mapbox@9.3.11`; the lock repair changes no retained package versions. Existing upstream peer-range conflicts remain a hackathon dependency limitation.

## Design

The site and the workspace share one design system. See [DESIGN.md](DESIGN.md) for the direction,
tokens, type scale and component recipes.

## AI chat assistant

Built with [assistant-ui](https://www.assistant-ui.com/) on the [AI SDK](https://ai-sdk.dev/) (`ai@7`).

```
Assistant panel (assistant-ui Thread + ModelSelector)
   │  POST /api/chat   { messages, config: { modelName }, system, tools }
   ▼
src/app/api/chat/route.ts
   ├─ lib/ai/providers.ts  model id → DeepSeek API | OpenAI API | local OpenAI-compatible server (Ollama/Gemma 4)
   ├─ lib/ai/mcp.ts        MCP clients → tools from MCP_SERVER_URLS + connectors enabled in the dialog
   └─ lib/ai/agent.ts      ToolLoopAgent (model + tools, loops up to 10 steps)
```

| File | What it does |
| --- | --- |
| `src/lib/ai/models.ts` | Models shown in the picker. Add a model here (and a provider case in `providers.ts` if it is a new provider). |
| `src/components/map/panels/assistant-panel.tsx` | Chat runtime (`useChatRuntime`), selected model state, the panel UI. |
| `src/components/assistant-ui/` | Components copied from the assistant-ui registry (`npx shadcn add @assistant-ui/<name>`). Edit freely. |

### Models

- **DeepSeek**: set `DEEPSEEK_API_KEY`.
- **OpenAI (GPT-6.1 Sol)**: set `OPENAI_API_KEY`.
- **Gemma 4 E2B (GigX)**: set `GIGX_API_KEY`. The gateway uses a self-signed cert, which is pinned in
  `certs/gigx-nexa-dev.pem` (override with `GIGX_CA_CERT` if it is rotated).
- **Gemma 4 (local)**: install [Ollama](https://ollama.com), run `ollama pull gemma4:e4b`, keep it running.
  Any OpenAI-compatible server works (LM Studio, vLLM, llama.cpp): set `LOCAL_LLM_BASE_URL` and `LOCAL_LLM_MODEL`.

### MCP tools (FastMCP)

The sliders button in the chat composer opens the **Connectors** dialog:

- **Built-in** connectors come from `src/lib/ai/mcp-catalog.ts`. NetOps (`../netops-mcp`) is listed
- **Built-in** connectors come from `src/lib/ai/mcp-catalog.ts`. NetOps (`../backend/netops-mcp`) is listed
  by default at `NEXT_PUBLIC_NETOPS_MCP_URL` (default `http://127.0.0.1:8000/mcp`). Add an entry
  there to ship another server to every user.
- **Custom** connectors are any MCP server URL the user adds (optional bearer token).

Users can switch connectors and individual tools on or off; the choice is kept in localStorage and
sent with each chat request as `mcpServers`. Servers in `MCP_SERVER_URLS` are always used as well.

Run a FastMCP server over streamable HTTP and add it as a connector or list it in `MCP_SERVER_URLS`:

```python
from fastmcp import FastMCP

mcp = FastMCP("elevate")

@mcp.tool
def city_population(city: str) -> dict:
    """Look up the population of a city."""
    ...

mcp.run(transport="http", port=8000)   # → http://localhost:8000/mcp
```

The agent connects on each request, merges the tools of every reachable server, and closes the
connections when the response ends. A server that is down is skipped (logged as a warning).

### Kepler.gl map MCP server

The **Kepler.gl Map** built-in connector is an MCP server served by this app at `/api/kepler/mcp`
(streamable HTTP). Its tools control the kepler.gl map open in the browser:

| Tool | Does |
| --- | --- |
| `kepler_get_map_state` / `kepler_get_dataset` | Datasets, fields, layers, filters, view, basemap; sample rows |
| `kepler_load_data` / `kepler_remove_dataset` | Load CSV / GeoJSON / JSON rows (URL, inline text or rows from another tool) |
| `kepler_add_layer` / `kepler_update_layer` / `kepler_remove_layer` | Point, arc, line, hexagon, grid, heatmap, cluster, geojson, H3, …; color/size by field, palette |
| `kepler_add_filter` / `kepler_remove_filter` | Range, time and category filters |
| `kepler_set_view` / `kepler_set_basemap` / `kepler_split_map` | Camera, basemap, side-by-side comparison |

The map state lives in the browser, so tool calls are relayed to the open tab:

```
agent ─ MCP ─▶ /api/kepler/mcp ─ hub ─▶ SSE /api/kepler/bridge ─▶ map tab runs it on the kepler store
                                 ◀──────── POST /api/kepler/bridge (result) ◀──┘
```

- The chat sends its tab's id in the `x-kepler-session` header, so tools act on the map the user sees.
- Other MCP clients can use the same URL and drive the most recently opened map tab, e.g.
  `claude mcp add --transport http kepler http://localhost:3000/api/kepler/mcp`.
- The relay is in memory: it needs a single server process, and the endpoint has no auth (local use).

| File | What it does |
| --- | --- |
| `src/lib/kepler/mcp-server.ts` | Tool definitions (names, descriptions, input schemas) |
| `src/lib/kepler/commands.ts` | Runs each tool against the kepler Redux store in the browser |
| `src/lib/kepler/bridge-hub.ts` | Routes tool calls to map tabs and waits for results |
| `src/components/map/use-kepler-bridge.ts` | The map tab's end of the relay |

### Moving the agent to FastAPI later

Two options:

1. **Keep the agent here** (simplest): FastAPI + FastMCP + LangChain expose tools over MCP; this route
   stays the agent. Only `MCP_SERVER_URLS` changes.
2. **Agent in Python**: set `NEXT_PUBLIC_CHAT_API_URL` to the FastAPI endpoint. It receives the same
   body (`messages`, `config.modelName`, `system`, `tools`) and must stream the
   [AI SDK UI message stream protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
   (SSE with header `x-vercel-ai-ui-message-stream: v1`). The picker and thread need no changes.
