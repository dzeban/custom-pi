# My Pi customizations

Fully vibecoded AI slop.

A Pi extension with four tool-output states and a minimal context/model status bar.

Ctrl-O cycles these states in order:

1. Hide all tool output, including edit/write results and inline images.
2. Show only edit/write output in full. This is the default state.
3. Show all tool output collapsed.
4. Show all tool output in full.

From the default state, Ctrl-O selects the collapsed state.
- **Ctrl-P** opens a top-anchored (fixed top edge), filterable command dialog
  without disturbing your prompt. It uses the live `/` autocomplete list,
  including built-in commands, extensions, templates, and skills. Type to
  filter; arrows navigate; Enter immediately runs the selected command (no
  preview or confirmation step). Esc cancels. The original draft stays in the
  editor (commands that intentionally replace a draft can still do so). Ctrl-P
  no longer cycles models.
- Collapsed and full use Pi's native tool formatting (including MCP/custom
  renderers). Full expands the output available in the tool result; it cannot
  recover output truncated by the tool itself.
- The footer shows only context usage on the left and the model on the right,
  using Pi's default formatting: e.g. `25.0%/100k (auto)` and `(provider)
  model-id • medium`. Keeps native context warning/error colors, compaction
  indicator, model/provider formatting, and width-dependent truncation. Omits
  path, branch, session name, token totals, cache statistics, costs, and
  extension statuses.
- Thinking starts fully hidden: no `Thinking...` label or placeholder blank
  rows. **Ctrl-H** toggles thinking for existing and new messages; **Ctrl-T**
  cycles the model's thinking level. **Shift-Tab** is disabled in the main
  editor. Normal assistant text and errors remain visible. The working spinner
  has no message beside it.
- Does not change tool execution, stored results, or model context.
  Non-interactive modes are unaffected.

## Install

    pi install <path to extension>

Then run `/reload` in Pi (or restart). To try without installing:

## Implementation notes

Pi's custom tool renderer API cannot suppress the outer shell and separately
rendered inline images. This extension therefore temporarily wraps the exported
`ToolExecutionComponent.prototype.render` method. It also wraps
`AssistantMessageComponent.prototype.updateContent` to omit thinking from the
display copy before spacing is calculated, retaining the original message so
Ctrl-H can reveal it. It restores both methods on shutdown/reload. This relies
on Pi's component implementation and may need adjustment after Pi updates. Other
extensions replacing this same method or the footer may conflict. The minimal
footer mirrors Pi's native context/model formatting; its formatting rules may
also need updating when Pi changes. User `!` shell commands are not agent tool
calls and are unchanged.

The visible states retain Pi's normal per-tool click-to-expand behavior. Ctrl-O
applies the next global state to all tool rows, including new rows. Pi
reserves Ctrl-O, Ctrl-T, and Ctrl-P, so the extension handles them (along with
Ctrl-H and disabled Shift-Tab) through a main-editor wrapper rather than
registering conflicting extension shortcuts. Other editor input is forwarded
unchanged; picker/dialog keys are unaffected. It preserves an existing editor
factory when present and restores it on shutdown/reload. No keybindings file
changes are needed. Thinking visibility is controlled globally by Ctrl-H rather
than per-block mouse clicks. In legacy terminals Ctrl-H can be indistinguishable
from Backspace (both may send `0x08`); in those terminals that Backspace
sequence also toggles thinking.

## Test

    npm test

Tests use your installed Pi package (set `PI_PACKAGE_ROOT` to override its
directory). No model credentials or network calls are required.
