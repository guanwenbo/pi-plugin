---
name: ponytail-help
description: Quick reference for ponytail levels and skills in PI-Desktop. One-shot display. Use for /ponytail-help, "ponytail help", "how do I use ponytail".
---

# Ponytail Help (PI-Desktop)

Display this reference card when invoked. One-shot, do NOT change mode or
persist anything. This pack is adapted from DietrichGebert/ponytail (MIT);
Claude Code-only features (band, board, hooks, auto-update) do not exist here.

## Levels

| Level | Trigger | What changes |
|-------|---------|--------------|
| **Lite** | say "ponytail lite" | Build what was asked, name the smaller option in one line. |
| **Full** | say "ponytail" | The smallest complete change, a check where the logic needs one, and a reply that names what was skipped and any risk. Default. |
| **Ultra** | say "ponytail ultra" | Also questions the request and pushes back before building. |

Level sticks for the session until changed. Slash forms typed as plain text
(`/ponytail ultra`) mean the same.

## Skills in this pack

| Skill | Trigger | What it does |
|-------|---------|--------------|
| **ponytail** | "ponytail", "be lazy", "simplest solution", any coding task | Lazy mode itself: least new code, clear replies that name skipped work and risks. |
| **ponytail-review** | "review this", "review my PR", /ponytail-review | Quality review of a diff: bugs, security, load, missing tests, speed, what to cut. Each finding says what goes wrong and how to fix it. |
| **ponytail-audit** | "audit this codebase", /ponytail-audit | The same quality review for the whole repo, ranked. |
| **ponytail-debt** | "ponytail debt", /ponytail-debt | Harvest `shortcut:` comments into a tracked ledger. |
| **ponytail-help** | "ponytail help", /ponytail-help | This card. |

## Deactivate

Say "stop ponytail" or "normal mode" to end lazy mode for the session.
To remove the pack entirely, disable or uninstall it on the PI-Desktop
plugins page.

## Configure

No config file or environment variable is needed. The default level is
**full**; ask for lite or ultra in chat. Updates come from new `.piplug`
releases installed on the plugins page.

## More

Upstream docs + examples: https://github.com/DietrichGebert/ponytail