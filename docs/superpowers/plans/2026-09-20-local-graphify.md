# Local Graphify Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install a project-scoped, local-only Graphify code graph that Codex can query for architecture work without uploading repository content or using Graphify to make release decisions.

**Architecture:** Install the official `graphifyy` CLI in an isolated `uv` tool environment, generate the standard project Agent Skill, and add a concise repository instruction that prefers graph queries for broad exploration while requiring source inspection before edits. Build only the code graph with `graphify extract . --code-only`; keep generated graph artifacts local and ignored, then validate usefulness with real LUMIÈRE queries and a context-size comparison.

**Tech Stack:** uv tool environments, Python 3.10+, Graphify CLI, Agent Skills, Git

**Spec:** `docs/superpowers/specs/2026-09-20-ci-scoping-and-graphify-design.md`

## Global Constraints

- Use the official PyPI package `graphifyy`; the executable is `graphify`.
- Structural indexing must be local and model-free through `graphify extract . --code-only`.
- Do not configure the hosted MCP endpoint, OAuth, telemetry, an LLM backend, or external model keys.
- Generated `graphify-out/` content must remain untracked and must not invalidate prompt caches.
- The committed integration may guide code navigation but must never choose CI coverage or replace source inspection before an edit.
- Do not install a Git hook or background watcher; graph refresh remains explicit so commits do not acquire hidden latency.

## Review Focus

- A machine without Graphify installed must still have a usable repository and clear setup command; verified by the documented install instructions in Task 1.
- Existing API-key environment variables must not cause semantic document extraction; verified by the explicit `--code-only` command and graph source-file audit in Task 2.
- Generated graphs and cost/cache data must never appear in Git status; verified by the ignore and `git check-ignore` checks in Task 1.
- The generated Agent Skill must not register hosted MCP or OAuth configuration; verified by the configuration scan in Task 1.
- Query output must be smaller than blindly reading the connected source and still cite exact files; verified by the byte comparison and citation checks in Task 2.

---

### Task 1: Install the CLI and project-scoped Agent Skill

**Files:**
- Create: `.agents/skills/graphify/SKILL.md` via the official installer
- Create: `.agents/skills/graphify/.graphify_version` via the official installer
- Create: `.agents/skills/graphify/references/add-watch.md` via the official installer
- Create: `.agents/skills/graphify/references/exports.md` via the official installer
- Create: `.agents/skills/graphify/references/extraction-spec.md` via the official installer
- Create: `.agents/skills/graphify/references/github-and-merge.md` via the official installer
- Create: `.agents/skills/graphify/references/hooks.md` via the official installer
- Create: `.agents/skills/graphify/references/query.md` via the official installer
- Create: `.agents/skills/graphify/references/transcribe.md` via the official installer
- Create: `.agents/skills/graphify/references/update.md` via the official installer
- Create: `AGENTS.md`
- Modify: `.gitignore`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: `uv 0.12.13` or newer and Python 3.10 or newer.
- Produces: `graphify` on `$PATH`, a repository-scoped `$graphify` Agent Skill under `.agents/skills/graphify/`, and repository guidance in `AGENTS.md`.

- [ ] **Step 1: Capture the pre-install state**

```bash
uv --version
python3 --version
command -v graphify || true
git status --short
```

Expected: uv and Python satisfy the minimum; `graphify` is absent; Git is clean.

- [ ] **Step 2: Install the official package in an isolated tool environment**

```bash
uv tool install graphifyy
graphify --version
uv tool list
```

If uv reports an existing installation, use `uv tool upgrade graphifyy` and record the resulting version. Do not use similarly named `graphify` PyPI packages.

- [ ] **Step 3: Generate only the project Agent Skill**

Use the generic Agent Skills target instead of Graphify's Codex hook path. The Codex hook is documented as a no-op and has open installer edge cases; this project needs the skill and repository instructions, not a hook.

```bash
graphify install --project --platform agents
find .agents/skills/graphify -maxdepth 2 -type f -print | sort
```

Expected: `SKILL.md`, `.graphify_version`, and a `references/` sidecar exist under `.agents/skills/graphify/`. No file is written outside the repository by this command.

- [ ] **Step 4: Add repository instructions with an explicit safety boundary**

Create `AGENTS.md` with this content:

````markdown
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
````

- [ ] **Step 5: Ignore generated graph output**

Append to `.gitignore`:

```gitignore
# Local Graphify index; regenerate with graphify extract . --code-only
graphify-out/
```

- [ ] **Step 6: Document setup and refresh commands**

Add a short “Graph navigation” subsection to `docs/architecture.md`:

```markdown
## Graph navigation

Install the local helper with `uv tool install graphifyy`, then generate the
code-only graph with `graphify extract . --code-only`. The graph is ignored and
local to the machine; rebuilding it uses tree-sitter and no model key. Use
`graphify query`, `graphify path`, and `graphify explain` for broad navigation,
then inspect source before changing it. CI selection remains the explicit policy
in `tools/ci-scope.mjs`.
```

- [ ] **Step 7: Inspect generated integration for hosted configuration or credentials**

```bash
rg -n "api\.graphify\.com|https://api\.graphify|oauth|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|MOONSHOT_API_KEY" .agents AGENTS.md || true
find . -maxdepth 3 -type f \( -name '.mcp.json' -o -path './.codex/*' \) -print
```

Expected: the generated skill may describe optional providers in reference documentation, but there is no active MCP endpoint, token value, `.mcp.json`, or `.codex/hooks.json`. Inspect every match; do not commit secrets or active hosted configuration.

- [ ] **Step 8: Verify ignore behavior and installation files**

```bash
mkdir -p graphify-out
touch graphify-out/probe
git check-ignore -v graphify-out/probe
test -s .agents/skills/graphify/SKILL.md
test -s .agents/skills/graphify/.graphify_version
test -s AGENTS.md
git diff --check
```

Expected: `graphify-out/probe` is ignored and every committed integration file is non-empty.

- [ ] **Step 9: Commit the project integration**

```bash
git add -- .agents/skills/graphify AGENTS.md .gitignore docs/architecture.md
git commit -m "Add local Graphify code navigation"
```

### Task 2: Build the local code graph and validate token usefulness

**Files:**
- Generate but do not commit: `graphify-out/graph.json`
- Generate but do not commit: `graphify-out/GRAPH_REPORT.md`
- Generate but do not commit: other `graphify-out/**` index and visualization files
- Modify only if validation reveals misleading guidance: `AGENTS.md` or `docs/architecture.md`

**Interfaces:**
- Consumes: the `graphify` CLI and project integration from Task 1.
- Produces: a non-empty local structural graph and query output that identifies LUMIÈRE source paths with less context than reading connected files wholesale.

- [ ] **Step 1: Remove the ignore probe and build the code-only graph**

```bash
rm -f graphify-out/probe
graphify extract . --code-only
test -s graphify-out/graph.json
```

Expected: extraction succeeds without requesting a model key or account and writes a non-empty graph.

- [ ] **Step 2: Audit graph contents for code-only behavior**

Run a local JSON inspection:

```bash
python3 - <<'PY'
import json
from pathlib import Path
graph = json.loads(Path('graphify-out/graph.json').read_text())
nodes = graph.get('nodes', [])
assert nodes, 'graph has no nodes'
files = {str(n.get('source_file', '')) for n in nodes}
assert any(f.endswith('src/main.js') for f in files), 'main.js was not indexed'
assert not any(f.endswith(('.md', '.png', '.jpg', '.webp', '.pdf')) for f in files), files
print(f'{len(nodes)} nodes across {len(files)} source files')
PY
```

Expected: code such as `src/main.js` appears; docs and images do not.

- [ ] **Step 3: Run real architecture queries**

```bash
graphify query "how do curator uploads become placements on gallery frames" > /tmp/lumiere-graphify-query.txt
graphify explain "curatorAddFiles" > /tmp/lumiere-graphify-explain.txt
graphify path "curatorAddFiles" "gatherIntoWing" > /tmp/lumiere-graphify-path.txt
cat /tmp/lumiere-graphify-query.txt
cat /tmp/lumiere-graphify-explain.txt
cat /tmp/lumiere-graphify-path.txt
```

Expected: at least one command identifies `src/main.js`; failures must be reported honestly if minified-style module structure prevents a useful path.

- [ ] **Step 4: Compare scoped output with raw source context**

```bash
QUERY_BYTES=$(wc -c < /tmp/lumiere-graphify-query.txt)
RAW_BYTES=$(wc -c < src/main.js)
printf 'query_bytes=%s raw_main_bytes=%s\n' "$QUERY_BYTES" "$RAW_BYTES"
test "$QUERY_BYTES" -lt "$RAW_BYTES"
rg -n "src/main\.js|src/cloud/client\.js|curatorAddFiles|gatherIntoWing" /tmp/lumiere-graphify-query.txt /tmp/lumiere-graphify-explain.txt /tmp/lumiere-graphify-path.txt
```

Expected: the scoped query is smaller than `src/main.js` and at least one output cites a relevant file or symbol. This demonstrates possible context savings; it does not claim a universal token multiplier.

- [ ] **Step 5: Confirm generated artifacts remain local**

```bash
git status --short
git check-ignore -v graphify-out/graph.json
git ls-files graphify-out
```

Expected: graph output does not appear in status and `git ls-files graphify-out` prints nothing.

- [ ] **Step 6: Correct guidance only if the installed CLI differs**

If the official installed version uses different query syntax, verify it with `graphify --help`, update only the command examples in `AGENTS.md` and `docs/architecture.md`, run `git diff --check`, and commit:

```bash
git add -- AGENTS.md docs/architecture.md
git commit -m "Correct Graphify query guidance"
```

Do not add hosted configuration as a workaround for a weak local query.

- [ ] **Step 7: Push the Graphify integration after CI implementation is live**

```bash
git push origin main
```

Expected: because `.agents`, `AGENTS.md`, and `.gitignore` are conservative full-fallback paths, the new change-aware workflow runs the full suite once. After it passes, future docs-only and domain-specific commits receive the optimized behavior.
