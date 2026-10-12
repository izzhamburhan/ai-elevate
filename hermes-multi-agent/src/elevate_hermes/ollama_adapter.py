"""Narrow OpenAI-to-Ollama adapter for the local Hermes reasoning model.

Ollama 0.35.1 ignores ``options.num_ctx`` on its OpenAI route. Its documented
native ``/api/chat`` accepts runtime options, so this adapter preserves Hermes'
actual agent loop while selecting a context window per request. It never creates
models, downloads weights, changes host configuration, or executes tools.

Streaming envelopes are emitted after the real native reply completes. Tool
execution/activity remains the responsibility of the real Hermes workers.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
import httpx
from pydantic import BaseModel, ConfigDict, Field

from elevate_hermes.config import Settings


OUTPUT_TOKEN_LIMIT = 900


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    model: str
    messages: list[dict[str, Any]] = Field(min_length=1, max_length=100)
    tools: list[dict[str, Any]] | None = Field(default=None, max_length=40)
    stream: bool = False
    max_tokens: int | None = Field(default=None, ge=1)
    max_completion_tokens: int | None = Field(default=None, ge=1)
    temperature: float | None = Field(default=None, ge=0, le=2, allow_inf_nan=False)
    top_p: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    seed: int | None = None


def native_request(request: ChatRequest, settings: Settings) -> dict[str, Any]:
    """Translate supported OpenAI fields; unsupported fields cannot change routing."""
    if request.model != settings.model:
        raise HTTPException(400, "Only the configured local reasoning model is available")
    messages = []
    for original in request.messages:
        role = original.get("role")
        if role not in {"system", "developer", "user", "assistant", "tool"}:
            raise HTTPException(400, "Unsupported message role")
        content = original.get("content")
        if content is not None and not isinstance(content, str):
            raise HTTPException(400, "This local investigation adapter supports text messages only")
        message: dict[str, Any] = {
            "role": "system" if role == "developer" else role,
            "content": content or "",
        }
        if isinstance(original.get("name"), str):
            message["tool_name"] = original["name"]
        if isinstance(original.get("tool_call_id"), str):
            message["tool_call_id"] = original["tool_call_id"]
        if original.get("tool_calls"):
            if not isinstance(original["tool_calls"], list):
                raise HTTPException(400, "Invalid prior tool calls")
            converted = []
            for call in original["tool_calls"]:
                if not isinstance(call, dict) or not isinstance(call.get("function"), dict):
                    raise HTTPException(400, "Invalid prior tool call")
                function = call["function"]
                arguments = function.get("arguments", {})
                if isinstance(arguments, str):
                    try:
                        arguments = json.loads(arguments)
                    except (json.JSONDecodeError, TypeError):
                        raise HTTPException(400, "Invalid prior tool arguments") from None
                if not isinstance(arguments, dict) or not isinstance(function.get("name"), str):
                    raise HTTPException(400, "Prior tool arguments must be a JSON object")
                native_call = {"function": {"name": function["name"], "arguments": arguments}}
                if isinstance(call.get("id"), str):
                    native_call["id"] = call["id"]
                converted.append(native_call)
            message["tool_calls"] = converted
        messages.append(message)
    tools = request.tools or []
    for tool in tools:
        function = tool.get("function")
        if tool.get("type") != "function" or not isinstance(function, dict):
            raise HTTPException(400, "Only function tools are supported")
        if not isinstance(function.get("name"), str) or not isinstance(function.get("parameters", {}), dict):
            raise HTTPException(400, "Invalid function tool schema")
    context_length = int(os.environ.get("HERMES_CONTEXT_LENGTH", "65536"))
    if not 64000 <= context_length <= 262144:
        raise HTTPException(503, "Invalid deployment context window")
    requested_output = request.max_completion_tokens or request.max_tokens or OUTPUT_TOKEN_LIMIT
    options: dict[str, Any] = {
        "num_ctx": context_length,
        "num_predict": min(requested_output, OUTPUT_TOKEN_LIMIT),
    }
    for field in ("temperature", "top_p", "seed"):
        value = getattr(request, field)
        if value is not None:
            options[field] = value
    return {
        "model": settings.model, "messages": messages, "tools": tools,
        "stream": False, "think": False, "options": options,
    }


def openai_response(native: dict[str, Any], model: str) -> dict[str, Any]:
    """Wrap only an actual completed native reply; malformed replies fail explicitly."""
    message = native.get("message")
    if native.get("done") is not True or not isinstance(message, dict):
        raise HTTPException(502, "Local Ollama returned an incomplete response")
    content = message.get("content", "")
    if not isinstance(content, str):
        raise HTTPException(502, "Local Ollama returned invalid response content")
    tool_calls = []
    calls = message.get("tool_calls", [])
    if not isinstance(calls, list):
        raise HTTPException(502, "Local Ollama returned invalid tool calls")
    for call in calls:
        function = call.get("function") if isinstance(call, dict) else None
        if not isinstance(function, dict) or not isinstance(function.get("name"), str):
            raise HTTPException(502, "Local Ollama returned an invalid tool call")
        arguments = function.get("arguments", {})
        if not isinstance(arguments, dict):
            raise HTTPException(502, "Local Ollama returned invalid tool arguments")
        tool_calls.append({
            "id": call["id"] if isinstance(call.get("id"), str) and call["id"] else "call_" + uuid.uuid4().hex,
            "type": "function",
            "function": {"name": function["name"], "arguments": json.dumps(arguments, ensure_ascii=False)},
        })
    prompt_tokens = native.get("prompt_eval_count")
    completion_tokens = native.get("eval_count")
    if (not isinstance(prompt_tokens, int) or isinstance(prompt_tokens, bool) or prompt_tokens < 0
            or not isinstance(completion_tokens, int) or isinstance(completion_tokens, bool) or completion_tokens < 0):
        raise HTTPException(502, "Local Ollama returned invalid usage metrics")
    output: dict[str, Any] = {"role": "assistant", "content": content}
    if tool_calls:
        output["tool_calls"] = tool_calls
    finish = "tool_calls" if tool_calls else "length" if native.get("done_reason") == "length" else "stop"
    return {
        "id": "chatcmpl_" + uuid.uuid4().hex,
        "object": "chat.completion", "created": int(time.time()), "model": model,
        "choices": [{"index": 0, "message": output, "finish_reason": finish}],
        "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens,
                  "total_tokens": prompt_tokens + completion_tokens},
    }


async def _native(settings: Settings, method: str, path: str, payload: dict | None = None) -> dict:
    """Fixed server-side destination; errors contain no credentials or raw upstream text."""
    try:
        async with httpx.AsyncClient(timeout=settings.task_timeout) as client:
            response = await client.request(method, settings.ollama_url.rstrip("/") + path, json=payload)
            response.raise_for_status()
            value = response.json()
            if not isinstance(value, dict) or value.get("error"):
                raise HTTPException(502, "Local Ollama returned an invalid response")
            return value
    except httpx.TimeoutException:
        raise HTTPException(504, "Local Ollama inference timed out") from None
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "Local Ollama service unavailable or returned an invalid response") from None


def router(settings: Settings) -> APIRouter:
    """Register the minimal model transport and actual read-only metadata routes."""
    routes = APIRouter(prefix="/ollama")

    @routes.post("/v1/chat/completions")
    async def chat(request: ChatRequest):
        payload = native_request(request, settings)
        reply = openai_response(await _native(settings, "POST", "/api/chat", payload), settings.model)
        if not request.stream:
            return JSONResponse(reply)

        async def frames():
            choice = reply["choices"][0]
            delta = dict(choice["message"])
            if "tool_calls" in delta:
                delta["tool_calls"] = [{"index": index, **call} for index, call in enumerate(delta["tool_calls"])]
            common = {key: reply[key] for key in ("id", "created", "model")}
            chunk = {**common, "object": "chat.completion.chunk",
                     "choices": [{"index": 0, "delta": delta, "finish_reason": None}]}
            yield "data: " + json.dumps(chunk, ensure_ascii=False) + "\n\n"
            finish = {**common, "object": "chat.completion.chunk",
                      "choices": [{"index": 0, "delta": {}, "finish_reason": choice["finish_reason"]}],
                      "usage": reply["usage"]}
            yield "data: " + json.dumps(finish, ensure_ascii=False) + "\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(frames(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @routes.post("/api/show")
    async def show(body: dict[str, Any]):
        model = body.get("model", body.get("name", settings.model))
        if model != settings.model:
            raise HTTPException(400, "Only the configured local reasoning model is available")
        return await _native(settings, "POST", "/api/show", {"model": settings.model})

    @routes.get("/api/tags")
    async def tags():
        value = await _native(settings, "GET", "/api/tags")
        value["models"] = [model for model in value.get("models", [])
                           if isinstance(model, dict) and model.get("name") == settings.model]
        return value

    @routes.get("/v1/models")
    async def models():
        value = await _native(settings, "GET", "/v1/models")
        value["data"] = [model for model in value.get("data", [])
                         if isinstance(model, dict) and model.get("id") == settings.model]
        return value

    return routes
