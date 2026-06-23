#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""llm_adapter.py — OpenAI-compatible LLM client for meeting-quality-scorer."""
from __future__ import annotations
import json
import sys
import time
from pathlib import Path

ENV_PREFIX = "MQS"


class LLMUnavailableError(Exception):
    pass


def resolve_config(env_prefix: str = "MQS", config_path: str | None = None) -> dict:
    import os

    result = {}
    # 1. Try env vars
    for key in ("base_url", "api_key", "model"):
        env_key = f"{env_prefix}_{key.upper()}"
        if val := os.environ.get(env_key):
            result[key] = val

    # 2. Try config file for missing keys
    if len(result) < 3:
        paths = []
        if config_path:
            paths.append(Path(config_path))
        paths.append(Path.home() / ".config" / "meeting-quality-scorer" / "config.yaml")
        for p in paths:
            if p.exists():
                import yaml
                try:
                    data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
                    for k in ("base_url", "api_key", "model"):
                        if k not in result and k in data:
                            result[k] = data[k]
                except Exception:
                    pass
                break

    # 3. Validate
    missing = [k for k in ("base_url", "api_key", "model") if k not in result]
    if missing:
        print(
            f"配置缺失: 请设置 {env_prefix}_BASE_URL / {env_prefix}_API_KEY / {env_prefix}_MODEL 或创建 config.yaml",
            file=sys.stderr,
        )
        sys.exit(2)
    return result


class LLMClient:
    def __init__(self, base_url: str, api_key: str, model: str, timeout: int = 60):
        from openai import OpenAI
        self.model = model
        self._timeout = timeout
        self._openai = OpenAI(base_url=base_url, api_key=api_key, timeout=timeout)

    def chat(self, messages: list[dict], schema: dict | None = None) -> object:
        import openai
        for attempt in range(3):
            try:
                resp = self._openai.chat.completions.create(
                    model=self.model, messages=messages
                )
                content = resp.choices[0].message.content
                try:
                    return json.loads(content)
                except json.JSONDecodeError:
                    if attempt < 1:
                        continue
                    return None
            except (openai.APITimeoutError, openai.APIConnectionError) as e:
                if attempt == 2:
                    raise LLMUnavailableError(str(e)) from e
                time.sleep(2 ** attempt)
        return None
