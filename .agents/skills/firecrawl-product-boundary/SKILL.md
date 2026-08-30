---
name: firecrawl-product-boundary
description: Full Firecrawl usage boundary for PreBase product integration vs forbidden agent research use.
---

# Firecrawl product boundary (full)

Firecrawl is a **product-development dependency only**.

## Allowed

Work on PreBase code that intentionally uses Firecrawl: API integration, adapters, runtime, tests, mocks, product docs, verifying the product integration.

## Forbidden for Cursor

Agent web search, library research, competitor/docs scraping, using Firecrawl MCP as a substitute for normal research, gathering context for the coding agent.

## Credentials

Treat keys as product secrets. Never put them in source, logs, screenshots, or prompts. Prefer mocks in tests.

## Development exception

Running product integration tests that call Firecrawl is allowed when exercising **product-owned** functionality.
