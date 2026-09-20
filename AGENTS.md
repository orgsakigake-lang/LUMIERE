# LUMIÈRE repository instructions

## Graphify

Use the project Graphify skill for broad architecture, dependency, caller,
callee, and impact questions when `graphify-out/graph.json` exists. Prefer a
scoped `graphify query`, `graphify path`, or `graphify explain` result before
opening many source files. Read the exact source before editing it.

Build or refresh the local structural graph with:

```sh
graphify extract . --code-only
```

The code-only graph is advisory. Never use it to decide which CI checks can be
skipped; `tools/ci-scope.mjs` is the release policy. Never enable a hosted MCP,
OAuth connection, semantic document pass, or model key for this repository
without an explicit request.
