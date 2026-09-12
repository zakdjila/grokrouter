---
name: provider
description: Show or switch the AI provider for the current GrokRouter Bot.
argument-hint: "[codex|claude|openrouter]"
user-invocable: true
disable-model-invocation: true
metadata:
  author: GrokRouter
  short-description: Show or switch this Bot's provider
---

# GrokRouter provider control

GROKROUTER_NATIVE_CONTROL: PROVIDER

Use this only through its `/provider` slash entry. Preserve the literal invocation and any `codex`, `claude` or `openrouter` argument. GrokRouter intercepts the command before model inference and returns the authoritative receipt.
