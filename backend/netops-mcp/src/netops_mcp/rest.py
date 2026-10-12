"""Plain REST access to every MCP tool, served by the same HTTP server.

    GET  /api/<tool>?arg=value&...   scalar arguments as query parameters
    POST /api/<tool>                 JSON body = the tool's arguments
    GET  /api/tools                  tool names, descriptions and input schemas
    GET  /geojson/<tool>?arg=value   only the tool's `geojson` FeatureCollection (CORS open, for map clients)
    GET  /openapi.json               OpenAPI 3 spec (import into Postman)
    GET  /docs                       Swagger UI

Calls go through FastMCP's own call_tool, so validation and the
{"ok": false, "error": ...} contract are identical to MCP. Tool errors map to
HTTP status codes (validation_error 400, auth_error 403, not_found 404, else 500)."""

import copy
import json

from fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse

from netops_mcp.tools import ALL_TOOLS

STATUS = {"validation_error": 400, "auth_error": 403, "not_found": 404}
TAGS = {fn.__name__: fn.__module__.rsplit(".", 1)[-1] for fn in ALL_TOOLS}
SCALARS = {"string", "integer", "number", "boolean"}

SWAGGER_HTML = """<!doctype html><html><head><meta charset="utf-8"><title>NetOps API</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css"></head>
<body><div id="ui"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({url: "/openapi.json", dom_id: "#ui"});</script></body></html>"""


def _query_value(raw: list[str]):
    """Query strings arrive as text; FastMCP's lax validation coerces numbers/bools.
    JSON-looking values (objects/arrays) are decoded; repeated keys become lists."""
    vals = []
    for v in raw:
        s = v.strip()
        if s[:1] in "[{":
            try:
                vals.append(json.loads(s))
                continue
            except ValueError:
                pass
        vals.append(v)
    return vals if len(vals) > 1 else vals[0]


def _is_scalar(schema: dict, defs: dict) -> bool:
    if "$ref" in schema:
        schema = defs.get(schema["$ref"].rsplit("/", 1)[-1], {})
    if "anyOf" in schema:
        return all(_is_scalar(s, defs) for s in schema["anyOf"] if s.get("type") != "null")
    return schema.get("type") in SCALARS or "enum" in schema


def _rewrite_refs(node):
    if isinstance(node, dict):
        return {k: (v.replace("#/$defs/", "#/components/schemas/") if k == "$ref" else _rewrite_refs(v))
                for k, v in node.items()}
    if isinstance(node, list):
        return [_rewrite_refs(v) for v in node]
    return node


def add_rest_routes(mcp: FastMCP, catalog: FastMCP | None = None) -> None:
    """Register the REST routes on `mcp`. `catalog` is the server whose tools are listed and called
    (a plain instance when `mcp` uses the tool-search transform, which hides the real listing)."""
    catalog = catalog or mcp

    async def tools():
        return {t.name: t for t in await catalog.list_tools()}

    @mcp.custom_route("/api/tools", methods=["GET"])
    async def list_tools(request: Request):
        ts = await tools()
        return JSONResponse([{"name": n, "tag": TAGS.get(n), "description": t.description,
                              "input_schema": t.parameters} for n, t in sorted(ts.items())])

    async def run(name: str, args: dict) -> JSONResponse | tuple[dict, int]:
        """Call a tool; returns (data, http_status), or an error response for unknown tools / bad arguments."""
        if name not in await tools():
            return JSONResponse({"ok": False, "error": {"code": "not_found", "message": f"Unknown tool '{name}'"}},
                                status_code=404)
        try:
            result = await catalog.call_tool(name, args)
        except Exception as exc:  # argument validation failures surface here
            return JSONResponse({"ok": False, "error": {"code": "validation_error", "message": str(exc)}},
                                status_code=400)
        data = result.structured_content
        if data is None:
            data = {"content": [getattr(c, "text", None) for c in result.content]}
        status = 200
        if isinstance(data, dict) and data.get("ok") is False:
            status = STATUS.get(data["error"]["code"], 500)
        return data, status

    @mcp.custom_route("/geojson/{tool}", methods=["GET"])
    async def geojson(request: Request):
        """Just the `geojson` FeatureCollection of a layer tool, for map clients that load data by URL
        (kepler fetches it from the browser, hence the CORS header)."""
        args = {k: _query_value(request.query_params.getlist(k)) for k in request.query_params.keys()}
        out = await run(request.path_params["tool"], args)
        if isinstance(out, JSONResponse):
            out.headers["Access-Control-Allow-Origin"] = "*"
            return out
        data, status = out
        if status == 200 and not (isinstance(data, dict) and isinstance(data.get("geojson"), dict)):
            data, status = {"ok": False, "error": {"code": "validation_error",
                                                   "message": f"{request.path_params['tool']} returns no geojson"}}, 400
        return JSONResponse(data["geojson"] if status == 200 else data, status_code=status,
                            headers={"Access-Control-Allow-Origin": "*"})

    @mcp.custom_route("/api/{tool}", methods=["GET", "POST"])
    async def call(request: Request):
        name = request.path_params["tool"]
        if request.method == "GET":
            args = {k: _query_value(request.query_params.getlist(k)) for k in request.query_params.keys()}
        else:
            body = await request.body()
            try:
                args = json.loads(body) if body.strip() else {}
            except ValueError:
                return JSONResponse({"ok": False, "error": {"code": "validation_error",
                                                            "message": "Body must be JSON"}}, status_code=400)
            if not isinstance(args, dict):
                return JSONResponse({"ok": False, "error": {"code": "validation_error",
                                                            "message": "Body must be a JSON object"}}, status_code=400)
        out = await run(name, args)
        if isinstance(out, JSONResponse):
            return out
        data, status = out
        return JSONResponse(data, status_code=status)

    @mcp.custom_route("/openapi.json", methods=["GET"])
    async def openapi(request: Request):
        base = str(request.base_url).rstrip("/")
        schemas, paths = {}, {}
        for name, t in sorted((await tools()).items()):
            params = copy.deepcopy(t.parameters or {"type": "object", "properties": {}})
            defs = params.pop("$defs", {})
            schemas.update(_rewrite_refs(defs))
            params = _rewrite_refs(params)
            required = set(params.get("required", []))
            props = params.get("properties", {})
            summary = (t.description or "").split(". ")[0][:120]
            ok = {"200": {"description": "Tool result", "content": {"application/json": {"schema": {"type": "object"}}}},
                  "400": {"description": "Validation error"}, "404": {"description": "Not found"}}
            path = {"post": {"tags": [TAGS.get(name, "tools")], "summary": summary, "description": t.description,
                             "operationId": f"{name}_post",
                             "requestBody": {"required": bool(required),
                                             "content": {"application/json": {"schema": params}}},
                             "responses": ok}}
            if all(_is_scalar(s, defs) for s in props.values()):
                path["get"] = {"tags": [TAGS.get(name, "tools")], "summary": summary, "description": t.description,
                               "operationId": name,
                               "parameters": [{"name": p, "in": "query", "required": p in required,
                                               "schema": s, "description": s.get("description", "")}
                                              for p, s in props.items()],
                               "responses": ok}
            paths[f"/api/{name}"] = path
        return JSONResponse({
            "openapi": "3.1.0",
            "info": {"title": "NetOps API (synthetic)", "version": "0.1.0",
                     "description": "REST view of the NetOps MCP tools. GET takes query parameters; POST takes the "
                                    "same arguments as a JSON body. MCP endpoint: /mcp"},
            "servers": [{"url": base}],
            "paths": paths,
            "components": {"schemas": schemas},
        })

    @mcp.custom_route("/docs", methods=["GET"])
    async def docs(request: Request):
        return HTMLResponse(SWAGGER_HTML)
