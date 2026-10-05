---
title: Providers
description: Choose Jev, Laya, Claude, or an OpenAI-compatible model to judge assertions.
---

AssertLens sends the same selected source, check status, and assertions to one
provider. Jev is the default and the recommended option: it answers typed questions
with calibrated probabilities. Select another provider in `.assertlens.json`:

```json
{
  "provider": "anthropic",
  "files": ["src/auth.ts"],
  "assertions": {
    "expiry": "Expired tokens are rejected before protected data is returned."
  }
}
```

| Provider | Default model | API key variable | Endpoint | Probabilities |
| --- | --- | --- | --- | --- |
| `jev` (default) | `jev-1.13.0` | `TYPESAFE_API_KEY` | TypeSafe API | Calibrated |
| `laya` | `typed-decisions` | `LAYA_API_KEY` | Laya Studio, or self-hosted with `--endpoint` | Uncalibrated as shipped |
| `anthropic` | `claude-opus-5-5` | `ANTHROPIC_API_KEY` | Anthropic API | Model-reported |
| `openai` | none; set `model` | `OPENAI_API_KEY` | OpenAI, or any compatible server with `--endpoint` | Model-reported |

## System-1 models: Jev and Laya

Jev and [Laya](https://github.com/NandhaKishorM/laya) share the `/v1/systemone`
request format: typed choice questions answered with a probability per option.
Laya is open source and can run locally with `laya-serve`, so source never leaves
your machine:

```bash
node src/assertlens.ts --endpoint http://localhost:8000/v1/systemone --snapshot
```

Laya's context is small: 512 tokens for `english` and 1,024 for `typed-decisions`
and `multilingual`, covering the state plus one question. Only very small scopes
fit; larger ones fail before sending with their estimated tokens. Laya's shipped
probabilities are over-confident until you fit temperatures on your own labelled
data, so AssertLens labels them uncalibrated. AssertLens gates on Laya's
`answer_confidence` when present.

## LLMs: Claude and OpenAI-compatible

LLM providers receive one request per scope with a JSON schema. For each assertion
the model returns probabilities for `supported`, `contradicted`, and `insufficient`
plus a short rationale naming the deciding files. The choice is the most probable
option; ties go to the cautious one (`insufficient`, then `contradicted`).
Probabilities must sum to 1 within 0.05 or the review is unavailable.

These probabilities are model-reported, not calibrated. Reports say so and show
each rationale as `Model rationale:`. The `0.8` threshold is a rough signal here.

- **Claude** defaults to `claude-opus-5-5` at `high` effort, with server-side refusal
  fallbacks on current models. A refusal or truncated answer makes review unavailable.
- **OpenAI-compatible** servers use Chat Completions with a strict JSON schema
  (`response_format`). Set `model` explicitly. Point `--endpoint` at OpenAI,
  OpenRouter, or a local server such as Ollama or vLLM; loopback servers may run
  without a key.

```bash
node src/assertlens.ts --endpoint http://localhost:11434/v1/chat/completions --snapshot --dry-run
```

## Endpoints and keys

`--endpoint` (or the action's `endpoint` input) is accepted only for `laya` and
`openai`, must use HTTPS or HTTP on `localhost`, and cannot contain credentials. It
comes from whoever runs the CLI, never from `.assertlens.json`, so a reviewed
repository cannot redirect your source or API key. Jev and Claude always use their
official endpoints.

Each provider reads only its own key variable. All four keys, plus `GITHUB_TOKEN`
and `GH_TOKEN`, are removed from check commands, and the Bubblewrap sandbox starts
with an empty environment. `--dry-run` prints the exact request bodies and their
destination without sending anything.

Choosing a provider decides where your selected source is sent. Confirm that the
provider fits your data-sharing policy before enabling it.
