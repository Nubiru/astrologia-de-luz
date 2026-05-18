# boilerplate-workflow

A complete agentic-workflow scaffold for any project. Drop it into a new repo, fill in one config file, and have an 8-archetype agent system + 30+ slash commands + 18 atomic helper scripts + the discipline canon ready to use.

The boilerplate is **domain-agnostic**: it works for software, B2C sales, marketing, content creation, and office work. The vocabulary is neutral by default; `ADAPTING.md` shows how to skin it for each domain.

---

## What you get

- **8 archetype agents** (Greek-letter primary, functional alias) — MEGA / OMEGA / ALPHA / BETA / GAMMA / DELTA / SIGMA / MINI — the Architect, Investigator, Operations, Auditor, Executor, Maintenance, Specifier, and Admin.
- **19 specialist agents** for narrow, well-bounded sub-tasks (code review, debugging, planning, etc.).
- **30+ slash commands** covering loops (`/mega`, `/develop`, `/execute`, `/mini`, `/weekly-maintenance`), lifecycle (`/snapshot`, `/restore`, `/commit`, `/cleanup`, `/context-load`), planning (`/plan`, `/proceed`, `/propose`, `/consider`, `/ask`, `/scope`, `/task`), inspection (`/audit`, `/system-health`, `/health-dashboard`, `/compliance-score`, `/accuracy`, `/test-evaluation`, `/doc-freshness`), authoring (`/document`, `/research`, `/refactor`, `/review`, `/extract`, `/standards`, `/usage`, `/notify`), catalog (`/refresh-catalog`, `/refresh-metrics`), and verification (`/test`, `/fix`).
- **18 atomic helper scripts** under `tools/scripts/` — race-free task ID claim, atomic JSON state writer, terminal-index lifecycle, change-log discipline, hourly housekeeping, gates and validators. Pure Node 18+, no `npm install` required.
- **8 standards + 9 protocols** — Architecture, Conventions, Production Readiness, Quality Gates, Scientific Method, Verification-First Methodology, Verification Pyramid, Artifact Retention; Task ID, Domain Scope, Evidence, Crisis Response, Probe-First, Checkpoint-Task, Parallel Agent, Research-to-Execution, Mega-Context.
- **8 reusable workflows** — 13-pillar audit, Investigation Six, quality preflight, deliverable audit, log extraction, external service integration, partnership execution, sub-agent dispatch.
- **The 7 cycle disciplines canon** — Task Closure / Pairings Gate / Post-Completion Verification / Checkpoint-Task Pattern / Verify-Before-Record-Delete / State-File Freshness / Investigation Six.
- **A philosophy layer** — SOUL.md captures the Four Pillars (DEPTH / QUALITY / ARCHITECTURE / STRUCTURE), the Band-Aid Test, the Simplicity Test, and the character traits every agent reads on every session.
- **A safety hook** — `.claude/hooks/block-destructive-actions.py` blocks the universally-destructive shell commands so an agent cannot accidentally lose work.

## What you do NOT get

- Project-specific deliverables (you write those).
- Project-specific MCP servers (you wire those).
- Project-specific deploy / release scripts (you write those, or skip if your domain does not need them).
- Domain-specific examples in agent prompts — you customize via `IDENTITY.md` and the `ADAPTING.md` skin guide.

---

## Init steps

```bash
# 1. Copy boilerplate-workflow/ to your new project root
cp -r boilerplate-workflow/ /path/to/your/new-project/
cd /path/to/your/new-project/

# 2. Edit the single config file
$EDITOR .context/IDENTITY.md
# Fill in: project name, lead's name, domain, north-star metric.

# 3. Run the one-step init
bash tools/scripts/init-boilerplate.sh
# Validates IDENTITY.md, creates counter files, smoke-tests the helpers.

# 4. Copy the settings template (optional but recommended)
cp .claude/settings.template.json .claude/settings.local.json
$EDITOR .claude/settings.local.json
# Customize allow / deny lists for your project.

# 5. (Optional) Pick a domain skin from ADAPTING.md
# The vocabulary is already domain-agnostic; ADAPTING.md is examples + customization tips per domain.

# 6. Read the discipline canon
cat .context/PROCEDURE.md
# 5 minutes. Internalize the 7 disciplines.

# 7. Open Claude in this directory and invoke /mega
# The Architect loop begins. Your project has full agent orchestration from this point.
```

---

## Vocabulary

The boilerplate uses **domain-agnostic vocabulary** by default:

| Generic term | Software | Sales | Marketing | Content | Office |
|--------------|----------|-------|-----------|---------|--------|
| verification | test | A/B test | tracked metric | review check | audit step |
| change log | commit log | campaign log | activity log | draft notes | memo log |
| release | deploy | launch | launch | publish | rollout |
| deliverable | code | creative | asset | piece | document |
| pairings | tests | A/B variants | measurement plan | review checklist | audit steps |
| proposal | PR | brief | draft strategy | outline | proposal |

You can override these mappings in `.context/IDENTITY.md` if your domain prefers different terms. The agents will respect the overrides.

See `ADAPTING.md` for full per-domain skins.

---

## Architecture overview

```
boilerplate-workflow/
├── README.md                     ← you are here
├── ADAPTING.md                   ← domain skin guide
├── CHANGELOG.md                  ← boilerplate version history
├── .claude/
│   ├── CLAUDE.md                 ← project rules
│   ├── SOUL.md                   ← philosophy (read every session)
│   ├── CLAUDE-REFERENCE.md       ← quick reference
│   ├── settings.template.json    ← copy to settings.local.json
│   ├── agents/                   ← 8 archetype + 19 specialist
│   ├── commands/                 ← 30+ slash commands
│   ├── workflows/                ← 8 reusable workflows
│   ├── templates/                ← reusable scaffolds
│   └── hooks/                    ← safety hooks
├── .context/
│   ├── README.md
│   ├── IDENTITY.md               ← THE ONE CONFIG FILE
│   ├── PROCEDURE.md              ← 7 cycle disciplines canon
│   ├── CHANGES.md / ACTION.md / THREAD.md / OPTIMIZE.md / LEAD.md / QA.md
│   ├── execute/PROTOCOL.md
│   ├── active/agents/            ← live work state
│   ├── standards/                ← 8 standards + 9 protocols
│   └── templates/                ← task spec, completion report, plan
├── tools/
│   ├── scripts/                  ← 18 atomic helpers
│   │   └── probes/               ← probe-first investigation template
│   └── tests/
└── memory/
    ├── README.md
    └── MEMORY.md                 ← auto-memory index
```

---

## License + ownership

This boilerplate captures workflow IP — agent orchestration patterns, scientific-method discipline, atomic state primitives, the 7 cycle disciplines. It is yours to fork and customize.

The mechanics are domain-agnostic. The character (SOUL.md) is opinionated. Both are intentional.

If you ship something interesting on top of this boilerplate, the upstream is interested in your patterns. Contributions back into the boilerplate are welcome — keep changes domain-agnostic and ship them with the discipline they describe.
