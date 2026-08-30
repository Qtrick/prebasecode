---
name: review
description: Review skill with nested metadata
argument-hint: "[file]"
user-invocable: true
disable-model-invocation: true
context: fork
allowed-tools:
  - Read
  - Grep
triggers:
  - user
license: MIT
compatibility: prebase
metadata:
  team: platform
  flags:
    beta: true
---
# Review body
