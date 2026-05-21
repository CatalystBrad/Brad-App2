# Session Handoff — Web → Local Terminal

Use this file to resume a Claude Code (web) session in a local terminal Claude Code session.

## Source session
- Repo: `CatalystBrad/Brad-App2`
- Branch: `claude/desktop-terminal-connection-4H2AW`
- Date: 2026-05-21

## Plan (what was decided here)
<!-- Fill in before ending the web session -->
- Goal:
- Approach:
- Files to touch:
- Out of scope:

## Resume locally — copy/paste

```bash
# 1. Go to your local clone (or clone it fresh)
cd ~/path/to/Brad-App2 || git clone git@github.com:CatalystBrad/Brad-App2.git ~/Brad-App2 && cd ~/Brad-App2

# 2. Pull the branch the web session was working on
git fetch origin claude/desktop-terminal-connection-4H2AW
git checkout claude/desktop-terminal-connection-4H2AW
git pull origin claude/desktop-terminal-connection-4H2AW

# 3. Launch Claude Code in this repo
claude
```

## Prompt to paste into local Claude Code
> I was working on this in a Claude Code web session. Read `SESSION_HANDOFF.md` at
> the repo root for the plan, then continue from the "Next steps" section. Don't
> redo work already committed on this branch.

## Next steps (todo list for the local session)
<!-- Fill in before ending the web session -->
- [ ]
- [ ]
- [ ]

## Notes / gotchas
<!-- Anything the local session needs to know but isn't obvious from the diff -->
-
