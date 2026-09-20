# Change-aware CI and local Graphify design

## Purpose

LUMIÈRE currently treats every commit as a full release candidate. The latest
successful run spent about 17 minutes in CI even though the curated browser
suite took 24 seconds and the final site build took less than a second. A docs,
SQL, curated, or legacy-only change therefore pays for checks that cannot be
affected by it.

The change will make CI choose checks from the files changed in the event while
keeping a conservative fallback. It will also install Graphify as a local Codex
navigation aid. Graphify will not participate in CI decisions: its inferred
relationships cannot prove that runtime wiring, HTML, CSS, or configuration is
unaffected.

Success means:

- documentation-only changes do not install Node or Chromium;
- curated-only changes do not run the slow legacy Playwright suite;
- legacy-only changes do not run curated browser tests unless they also affect
  the combined site boundary;
- database and Edge Function changes run their relevant checks without running
  gallery rendering tests;
- shared, dependency, CI, or unclassified executable files select the full
  suite;
- a manual run and a weekly scheduled run still exercise every check;
- a main-branch site change deploys only after every selected check passes;
- Graphify works locally without uploading repository contents or consuming
  model tokens during structural indexing.

## Approaches considered

### Explicit change map with a full-suite fallback

A repository-owned script classifies changed paths into stable domains. GitHub
Actions consumes its outputs to run conditional jobs. Unknown executable paths
select every check. This is the selected approach because the policy is visible,
testable locally, and independent of a third-party action or inferred graph.

### Workflow path globs only

Each job could repeat path patterns directly in workflow YAML. This is shorter
initially, but GitHub's workflow-level path filters can leave required checks
pending, repeated job expressions drift, and developers cannot exercise the
selection logic locally. It is rejected in favor of one versioned classifier.

### Dependency-graph-selected tests

Graphify or an import-graph tool could derive a blast radius and select tests.
That is attractive for a large monorepo with strict module boundaries. This
application includes dynamically loaded TypeScript, generated HTML, styles
spliced outside esbuild's graph, Web Workers, and browser-observed behavior.
Static edges are useful for navigation but are not a safe release gate here.

## Change classification

`tools/ci-scope.mjs` will accept newline-delimited changed paths and emit both a
human-readable explanation and GitHub Action outputs. The same pure classifier
will be importable by Node tests. Matching is inclusive: one change can select
several domains.

The domains are:

| Domain | Representative inputs | Selected work |
| --- | --- | --- |
| `legacy` | `src/art/**`, `src/cloud/**`, `src/render/**`, `src/ui/**`, `src/world/**`, `src/main.js`, `src/audio.js`, `src/config.js`, `src/persist.js`, legacy Playwright tests and configuration, `build.mjs`, committed `index.html` | current-artifact check, unit tests, full legacy Playwright suite, site package |
| `curated` | `src/curated/**`, `assets/curated/**`, curated tests and configuration, `tools/build-curated.mjs`, and shared curated imports such as `src/audio.js` and `src/cloud/gallery-link.js` | typecheck, unit tests, curated Playwright suite, site package |
| `site` | either gallery domain, `tools/build-site.mjs`, route tests, `preview.jpg`, or public packaging inputs | combined site build and main-branch deployment |
| `database` | `supabase-setup.sql`, `supabase-secret-links.sql`, `tools/verify-sql.sh`, and `tools/supabase-shim.sql` | disposable PostgreSQL verification |
| `edge` | `supabase/functions/**` and the corresponding unit tests | relevant Node unit tests |
| `dependency` | `package.json`, `package-lock.json`, TypeScript and Playwright configuration | all code, browser, build, and schema checks |
| `full` | workflow files, the classifier itself and its tests, manual or scheduled invocation, and unknown executable/configuration paths | every check |

Markdown and design reference images are inert unless a future build starts
consuming them. Changes containing only those files select no expensive work,
but the workflow still reports one successful required status.

The classifier will be conservative around overlap. For example, `src/audio.js`
belongs to both gallery experiences; changing it selects both test suites.
`tools/build-site.mjs` selects curated route tests and a site build because it
controls the public root and `/endless/` boundary, while it does not select all
legacy rendering tests by itself.

## Event and data flow

A small `scope` job checks out enough history to identify the event range:

- pull requests compare the base commit with the tested merge result;
- pushes compare `github.event.before` with the pushed commit;
- a missing or all-zero base selects `full` rather than guessing;
- `workflow_dispatch` and the weekly schedule select `full` directly.

The job sends the changed paths to `tools/ci-scope.mjs` through standard input.
No branch names, commit messages, or filenames are interpolated as shell code.
It publishes boolean outputs and a Markdown summary showing which files selected
which checks.

Conditional jobs then run independently:

1. `quick-checks` installs Node only when a code domain was selected. It runs
   the applicable typecheck and inexpensive unit tests. For legacy changes it
   also rebuilds `index.html` and compares it byte-for-byte with the committed
   artifact.
2. `legacy-browser` installs Chromium and runs the 89 legacy Playwright tests
   only when `legacy` or `full` is selected.
3. `curated-browser` installs Chromium and runs the 18 curated Playwright tests
   only when `curated`, `site`, or `full` is selected.
4. `schema` runs the disposable PostgreSQL verification only when `database`,
   `dependency`, or `full` is selected.
5. `required` waits with `always()` semantics and fails if any selected job
   failed or was cancelled. Skipped jobs are accepted. This stable job is the
   branch-protection target and avoids GitHub's pending-check behavior for an
   entirely filtered workflow.
6. `pages` runs after `required` on a push to `main` when `site` was selected.
   It performs one clean site build, uploads the Pages artifact, and deploys it.

Browser jobs may run in parallel. Playwright installation is short compared
with the legacy render suite, so the first implementation will avoid custom
browser caches. A cache can be added later only if measured installation time
justifies the invalidation complexity.

## Failure handling

Any uncertainty expands coverage. An unknown source, test, tool, root-level
configuration, or workflow path selects `full` and explains the fallback in the
run summary. A classifier error also fails the `scope` job, preventing tests or
deployment from being silently skipped.

The `required` job distinguishes `success` and `skipped` from `failure` and
`cancelled`. Deployment cannot run after a selected failed check. Documentation
changes complete with a successful `required` job and no deployment because the
public artifact is unchanged.

## Graphify setup

The official `graphifyy` package will be installed in an isolated `uv` tool
environment. Project-scoped Codex integration will be generated and inspected
before it is committed. Structural indexing will run against repository code
locally; the hosted MCP service, OAuth connection, semantic document pass, and
external model keys will remain disabled.

Generated `graphify-out/` files will be ignored by Git. They remain available in
the local workspace for scoped `query`, `path`, `explain`, and impact commands
without adding a large, frequently stale graph to commits. The committed
project integration will explain how to rebuild the graph after structural
changes. Graphify remains advisory: agents must inspect source before editing,
and CI scope continues to use the explicit path policy.

Graphify can reduce code-reading tokens when a question spans several modules,
because structural indexing uses no model call and later queries return a small
subgraph. It cannot reduce Playwright time, build time, or tokens needed to
inspect exact implementation details. On this approximately 13,500-line source
tree the expected benefit is useful but smaller than headline benchmarks from
much larger repositories.

## Verification

Classifier tests will cover at least:

- docs-only changes select no expensive checks;
- one curated component selects curated, site, typecheck, and unit work but not
  the legacy browser suite;
- one renderer file selects legacy work but not unrelated SQL verification;
- shared audio and gallery-link files select both experiences;
- SQL-only and Edge Function-only changes select their respective checks;
- dependency, workflow, unknown executable, manual, and scheduled cases select
  the full suite;
- paths containing spaces or shell metacharacters are handled as data.

Workflow validation will check YAML syntax and exercise the classifier locally
against representative file lists. The first pushed run will be inspected to
confirm the summary, conditional job results, Pages artifact, and deployment.
A manual full run must pass before the optimization is considered complete.

Graphify verification will build the local graph and run a scoped query plus an
impact query against a known shared module such as `src/audio.js`. The result
must cite repository paths and be materially smaller than reading the connected
source files in full. Installation files and generated outputs will be reviewed
for credentials or unintended hosted configuration before commit.

## Scope limits

This change does not rewrite Playwright tests, split individual legacy spec
files further, adopt a monorepo build system, or make Graphify a release gate.
Per-spec legacy selection is deferred because the legacy composition root is
highly connected and the current full suite has caught cross-module rendering
regressions. The first useful boundary is between legacy, curated, database,
Edge Functions, and inert documentation.
