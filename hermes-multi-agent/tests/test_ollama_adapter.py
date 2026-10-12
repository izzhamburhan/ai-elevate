"""Explicit synthetic protocol fixtures; these tests are not real model inference."""

import json
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import pytest

from elevate_hermes.config import Settings
from elevate_hermes.ollama_adapter import ChatRequest, native_request, openai_response, router


SETTINGS = Settings(model="qwen3.5:9b", ollama_url="http://127.0.0.1:11434")
NATIVE_REPLY = {
    "model": "qwen3.5:9b", "done": True, "done_reason": "stop",
    "message": {"role": "assistant", "content": "Synthetic test protocol answer"},
    "prompt_eval_count": 42, "eval_count": 7,
}


def client():
    app = FastAPI()
    app.include_router(router(SETTINGS))
    return TestClient(app)


def request(**extra):
    return ChatRequest(model=SETTINGS.model, messages=[{"role": "user", "content": "Protocol fixture"}], **extra)


def test_native_request_enforces_context_model_and_output(monkeypatch):
    monkeypatch.setenv("HERMES_CONTEXT_LENGTH", "65536")
    payload = native_request(request(max_tokens=1800, temperature=0.2, seed=7), SETTINGS)
    assert payload["options"] == {"num_ctx": 65536, "num_predict": 900, "temperature": 0.2, "seed": 7}
    assert payload["model"] == SETTINGS.model and payload["think"] is False and payload["stream"] is False


def test_native_request_preserves_smaller_output_limit():
    assert native_request(request(max_completion_tokens=80), SETTINGS)["options"]["num_predict"] == 80


def test_native_request_translates_prior_tool_calls_and_identity():
    value = ChatRequest(model=SETTINGS.model, messages=[
        {"role": "assistant", "content": None, "tool_calls": [{"id": "call_fixture", "type": "function", "function": {"name": "get_weather_model_status", "arguments": "{}"}}]},
        {"role": "tool", "content": "Synthetic protocol fixture", "name": "get_weather_model_status", "tool_call_id": "call_fixture"},
    ])
    messages = native_request(value, SETTINGS)["messages"]
    assert messages[0]["tool_calls"][0]["function"]["arguments"] == {}
    assert messages[0]["tool_calls"][0]["id"] == "call_fixture"
    assert messages[1]["tool_name"] == "get_weather_model_status"
    assert messages[1]["tool_call_id"] == "call_fixture"


@pytest.mark.parametrize("arguments", ["not-json", "[]", "1"])
def test_invalid_prior_tool_arguments_fail(arguments):
    value = ChatRequest(model=SETTINGS.model, messages=[{"role": "assistant", "tool_calls": [{"function": {"name": "fixture", "arguments": arguments}}]}])
    with pytest.raises(HTTPException):
        native_request(value, SETTINGS)


def test_other_model_and_nontext_requests_fail():
    value = ChatRequest(model="unapproved-model", messages=[{"role": "user", "content": "fixture"}])
    with pytest.raises(HTTPException):
        native_request(value, SETTINGS)
    value = ChatRequest(model=SETTINGS.model, messages=[{"role": "user", "content": [{"type": "image_url"}]}])
    with pytest.raises(HTTPException):
        native_request(value, SETTINGS)


def test_real_response_wrapping_uses_actual_usage_and_calls():
    native = {**NATIVE_REPLY, "message": {"content": "", "tool_calls": [{"id": "call_fixture", "function": {"name": "get_weather_model_status", "arguments": {}}}]}}
    wrapped = openai_response(native, SETTINGS.model)
    choice = wrapped["choices"][0]
    assert choice["finish_reason"] == "tool_calls"
    assert choice["message"]["tool_calls"][0]["id"] == "call_fixture"
    assert json.loads(choice["message"]["tool_calls"][0]["function"]["arguments"]) == {}
    assert wrapped["usage"] == {"prompt_tokens": 42, "completion_tokens": 7, "total_tokens": 49}


def test_incomplete_native_reply_is_not_success():
    with pytest.raises(HTTPException):
        openai_response({**NATIVE_REPLY, "done": False}, SETTINGS.model)


def test_nonstreaming_endpoint_calls_only_native_fixed_destination():
    mock = AsyncMock(return_value=NATIVE_REPLY)
    with patch("elevate_hermes.ollama_adapter._native", mock):
        response = client().post("/ollama/v1/chat/completions", json={"model": SETTINGS.model, "messages": [{"role": "user", "content": "fixture"}], "options": {"num_ctx": 999999}, "url": "https://unapproved.invalid"})
    assert response.status_code == 200
    args = mock.call_args.args
    assert args[:3] == (SETTINGS, "POST", "/api/chat")
    assert args[3]["options"]["num_ctx"] == 65536
    assert "url" not in args[3]


def test_streaming_standard_chunks_and_done():
    mock = AsyncMock(return_value=NATIVE_REPLY)
    with patch("elevate_hermes.ollama_adapter._native", mock):
        response = client().post("/ollama/v1/chat/completions", json={"model": SETTINGS.model, "messages": [{"role": "user", "content": "fixture"}], "stream": True})
    lines = [line.removeprefix("data: ") for line in response.text.splitlines() if line.startswith("data: ")]
    assert response.status_code == 200 and lines[-1] == "[DONE]"
    assert json.loads(lines[0])["choices"][0]["delta"]["content"] == NATIVE_REPLY["message"]["content"]
    assert json.loads(lines[1])["choices"][0]["finish_reason"] == "stop"


def test_streaming_actual_tool_envelope_has_id_index_and_json_arguments():
    native = {**NATIVE_REPLY, "message": {"content": "", "tool_calls": [{"function": {"name": "get_weather_model_status", "arguments": {}}}]}}
    with patch("elevate_hermes.ollama_adapter._native", AsyncMock(return_value=native)):
        response = client().post("/ollama/v1/chat/completions", json={"model": SETTINGS.model, "messages": [{"role": "user", "content": "fixture"}], "stream": True})
    frames = [json.loads(line.removeprefix("data: ")) for line in response.text.splitlines() if line.startswith("data: {")]
    call = frames[0]["choices"][0]["delta"]["tool_calls"][0]
    assert call["id"].startswith("call_") and call["index"] == 0
    assert json.loads(call["function"]["arguments"]) == {}
    assert frames[1]["choices"][0]["finish_reason"] == "tool_calls"


def test_metadata_filters_existing_models_without_fabrication():
    value = {"models": [{"name": SETTINGS.model, "digest": "synthetic-protocol-only"}, {"name": "unapproved"}]}
    with patch("elevate_hermes.ollama_adapter._native", AsyncMock(return_value=value)):
        response = client().get("/ollama/api/tags")
    assert response.json()["models"] == [value["models"][0]]


def test_metadata_show_accepts_hermes_name_field():
    mock = AsyncMock(return_value={"capabilities": ["tools"], "model_info": {}})
    with patch("elevate_hermes.ollama_adapter._native", mock):
        response = client().post("/ollama/api/show", json={"name": SETTINGS.model})
    assert response.status_code == 200
    assert mock.call_args.args == (SETTINGS, "POST", "/api/show", {"model": SETTINGS.model})


def test_upstream_failure_remains_explicit():
    mock = AsyncMock(side_effect=HTTPException(502, "Fixture unavailable"))
    with patch("elevate_hermes.ollama_adapter._native", mock):
        response = client().post("/ollama/v1/chat/completions", json={"model": SETTINGS.model, "messages": [{"role": "user", "content": "fixture"}]})
    assert response.status_code == 502
    assert "choices" not in response.json()
