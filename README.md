# codex_token_saver

Measured token savings for Codex CLI and the ChatGPT desktop app.

Every number below was measured on an Apple Silicon Mac against a local router, not
estimated. The scripts that produced them are in `bench/`.

## The problem

An agent turn is not one request. It is many, and each one re-sends:

- every tool schema
- the whole conversation so far
- the tool output, which is part of the conversation

Nothing in the protocol makes any of that cheaper. The savings here come from
sending less, not from asking the provider for a discount.

## What this installs

Three hooks in `~/.codex/hooks.json`, plus [rtk](https://github.com/rtk-ai/rtk).

| Hook | Event | What it does |
|---|---|---|
| `rtk-codex-hook` | `PreToolUse` | Rewrites shell commands to `rtk <cmd>` so output is condensed before it reaches the model |
| `session-guard` | `SessionStart` | Verifies rtk and claude-mem are up, restarts what is down, reports status |
| `concise-output-toggle` | `UserPromptSubmit` | Reports whether concise output is on |

## Install

```bash
brew install rtk      # or: cargo install --git https://github.com/rtk-ai/rtk
git clone https://github.com/SuperHelix77/codex_token_saver
./codex_token_saver/install.sh
```

Restart Codex. The installer never overwrites an existing hook without
`--force`.

## Measured results

### Tool schemas: about 60 input tokens each, re-sent on every request

Identical prompt, one sample per point, via `/v1/responses`:

| tools | input tokens | per tool |
|---|---|---|
| 0 | 9 | - |
| 2 | 143 | 67.0 |
| 5 | 320 | 62.2 |
| 10 | 615 | 60.6 |
| 20 | 1205 | 59.8 |

Confirmed across all three models. `gpt-6-luna`, `gpt-6.1-sol` and
`gpt-6-astra` all reported 13 bare / 1229 with twenty tools. **1,216 input
tokens per request**, so about 48,600 over a 40-request turn.

### Reasoning effort is billed as output

Same prompt, one sample each:

| model | medium | max |
|---|---|---|
| gpt-6-luna | 19 | 57 |
| gpt-6.1-sol | 0 | 39 |
| gpt-6-astra | 0 | 34 |

On a delegated subagent task, `max` to `medium` saved **160 / 1,560 / 1,720**
reasoning tokens per turn of 40 requests. That is why
`default_subagent_reasoning_effort` should be `medium`, with the root owning
escalation.

### Output condensing

`ls -la src` 22,839 B to 1,842 B. `rg -n function src/` 367,761 B to 17,512 B
(95.2 percent). Over 201 commands rtk removed **297,806 tokens**.

Condensed output is not lost output: every filter prints a recovery hash
(`rtk recall <hash>`), and `recall mode: sqlite` keeps the full text.

## Two silent failures worth knowing about

**1. `permission_mode: "never"` disables rtk.** rtk 0.51.0 recognises
`default`, `acceptEdits`, `plan`, `dontAsk` and `bypassPermissions`, and fails
open on anything else. With `approval_policy = "never"` in `config.toml`, Codex
sends `never`, so rtk was installed, registered, trusted, and never fired once.
`rtk-codex-hook` normalises the mode before forwarding. All six modes now
rewrite.

**2. `tools.omit_tools_from` and `rollout_budget` are ignored.** Both appear in
the config schema and both are discarded by current Codex builds, which warns
`is ignored`. They are feature-gated off. An ignored key is worse than an
absent one: it looks like a working control.

## Configuration that matters

```toml
tool_output_token_limit = 8000

[agents]
default_subagent_model = "gpt-6-luna"
default_subagent_reasoning_effort = "medium"

[features]
memories = true
```

rtk awareness should be `default`, not `high`: with a hook installed the model
never types `rtk` itself, so `high` spends about 132 tokens per request
describing a tool the model is not driving.

## Concise output

Off by default, because it costs 286 input tokens per request. On for the
conversations that want it:

```bash
~/.codex/bin/concise-output-toggle on
```

It governs the report, never the reasoning. Dropping a calculation, a check or
a caveat to shorten an answer costs more than the tokens it saves.

## Verify

```bash
rtk gain                    # savings ledger
~/.codex/bin/session-guard  # is everything up?
```

## License

MIT. Bundles hooks that wrap [rtk](https://github.com/rtk-ai/rtk) (MIT).
