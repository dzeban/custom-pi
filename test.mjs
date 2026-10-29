import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = process.env.PI_PACKAGE_ROOT ?? join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const hostRequire = createRequire(join(root, "package.json"));
const hostPath = join(root, "dist/index.js");
const tuiPath = hostRequire.resolve("@earendil-works/pi-tui");
const { visibleWidth, CombinedAutocompleteProvider } = await import(pathToFileURL(tuiPath).href);
const { createJiti } = hostRequire("jiti");
const jiti = createJiti(import.meta.url, { alias: { "@earendil-works/pi-coding-agent": hostPath, "@earendil-works/pi-tui": tuiPath } });
const extension = await jiti.import(new URL("./index.ts", import.meta.url).pathname, { default: true });
const { AssistantMessageComponent, ToolExecutionComponent, FooterComponent, initTheme } = await import(pathToFileURL(hostPath).href);
initTheme("dark");

test("four states, existing/new tool rows, images, footer, cleanup, and non-TUI modes", async () => {
  const events = new Map();
  let resolveRenderer;
  let autoCompact = true;
  const pi = { getSettings: () => ({ compaction: { enabled: autoCompact } }), getThinkingLevel: () => "medium" };
  extension({ ...pi, registerToolRenderer: (resolver) => { resolveRenderer = resolver; }, on: (name, handler) => events.set(name, handler), registerShortcut: () => { assert.fail("Reserved shortcuts must not be registered"); } });
  const custom = { renderShell: "self" };
  assert.equal(resolveRenderer("custom", () => custom), custom);
  const original = ToolExecutionComponent.prototype.render;
  const originalAssistantUpdate = AssistantMessageComponent.prototype.updateContent;
  let footer;
  let redraws = 0;
  let workingMessage;
  let usage = { tokens: 25000, contextWindow: 100000, percent: 25 };
  const assistants = new Set();
  const tui = { invalidate() { for (const component of assistants) component.invalidate(); }, requestRender() { redraws++; } };
  const forwardedInput = [];
  const previousEditor = () => ({ handleInput(data) { forwardedInput.push(data); } });
  let editorFactory = previousEditor;
  let editor;
  const shortcut = () => editor.handleInput("\x0f");
  const thinkingShortcut = () => editor.handleInput("\x08");
  const provider = new CombinedAutocompleteProvider([{ name: "model", description: "Select model" }, { name: "settings", description: "Pi settings" }, { name: "example", description: "Example extension command" }], process.cwd());
  const ctx = { mode: "tui", model: { contextWindow: 100000, id: "test-model", provider: "test-provider", reasoning: true }, getContextUsage: () => usage, ui: { addAutocompleteProvider(wrap) { wrap(provider); }, getEditorComponent: () => editorFactory, setEditorComponent(factory) { editorFactory = factory; editor = factory?.(tui, {}, {}); }, setWorkingMessage(message) { workingMessage = message; }, setFooter(factory) { footer = factory(tui, { fg: (_color, text) => text }, { getAvailableProviderCount: () => 2 }); } } };
  const makeRow = (name = "mcp__example__tool") => {
    const row = new ToolExecutionComponent(name, "id", { path: "example" }, {}, resolveRenderer(name, () => undefined), tui, process.cwd());
    row.updateResult({ content: [{ type: "text", text: Array.from({ length: 30 }, (_, n) => `result-line-${n}`).join("\n") }], details: undefined, isError: false });
    return row;
  };
  try {
    events.get("session_start")({}, ctx);
    assert.equal(workingMessage, "");
    assert.notEqual(editorFactory, previousEditor);
    editor.handleInput("ordinary text");
    editor.handleInput("\x1b");
    assert.deepEqual(forwardedInput, ["ordinary text", "\x1b"]);
    const message = { role: "assistant", content: [{ type: "thinking", thinking: "SECRET REASONING" }], stopReason: "stop" };
    const thinkingOnly = new AssistantMessageComponent(message, true);
    assistants.add(thinkingOnly);
    assert.deepEqual(thinkingOnly.render(100), []);
    assert.equal(thinkingOnly.lastMessage, message);
    const mixedMessage = { ...message, content: [{ type: "thinking", thinking: "FIRST THOUGHT" }, { type: "text", text: "Visible answer" }, { type: "thinking", thinking: "LAST THOUGHT" }] };
    const mixed = new AssistantMessageComponent(mixedMessage);
    assistants.add(mixed);
    const textOnly = new AssistantMessageComponent({ ...message, content: [{ type: "text", text: "Visible answer" }] });
    assert.deepEqual(mixed.render(100), textOnly.render(100));
    await thinkingShortcut(ctx);
    assert.match(thinkingOnly.render(100).join("\n"), /SECRET REASONING/);
    assert.match(mixed.render(100).join("\n"), /FIRST THOUGHT/);
    const newVisible = new AssistantMessageComponent(message, true);
    assistants.add(newVisible);
    assert.match(newVisible.render(100).join("\n"), /SECRET REASONING/);
    await thinkingShortcut(ctx);
    assert.deepEqual(thinkingOnly.render(100), []);
    assert.deepEqual(newVisible.render(100), []);
    assert.deepEqual(mixed.render(100), textOnly.render(100));
    thinkingOnly.updateContent(message, true);
    assert.deepEqual(thinkingOnly.render(100), []);
    const failed = new AssistantMessageComponent({ ...message, stopReason: "error", errorMessage: "Important failure" });
    assert.match(failed.render(100).join("\n"), /Important failure/);
    assert.doesNotMatch(failed.render(100).join("\n"), /SECRET REASONING/);
    assert.equal(message.content[0].thinking, "SECRET REASONING");
    const row = makeRow();
    assert.deepEqual(row.render(100), []);
    assert.deepEqual(makeRow("bash").render(100), []);
    const changeRows = [makeRow("edit"), makeRow("write")];
    const diffRow = makeRow("custom_diff");
    assert.deepEqual(diffRow.render(100), []);
    diffRow.updateResult({ content: [{ type: "text", text: "DIFF RESULT" }], details: { diff: "+ added\n- removed" }, isError: false });
    const assertChangesVisible = () => {
      for (const change of changeRows) assert.match(change.render(100).join("\n"), /result-line-29/);
    };
    assertChangesVisible();
    assert.deepEqual(diffRow.render(100), []);
    await shortcut(ctx); // All tools collapsed
    for (const change of [...changeRows, makeRow("edit"), makeRow("write")]) {
      assert.match(change.render(100).join("\n"), /result-line-0/);
      assert.doesNotMatch(change.render(100).join("\n"), /result-line-29/);
    }
    assert.match(diffRow.render(100).join("\n"), /DIFF RESULT/);
    let output = row.render(100).join("\n");
    assert.match(output, /result-line-0/);
    assert.doesNotMatch(output, /result-line-29/);
    await shortcut(ctx);
    assertChangesVisible();
    assert.match(row.render(100).join("\n"), /result-line-29/);
    assert.match(makeRow().render(100).join("\n"), /result-line-29/);
    // The host draws image components outside custom renderers. Hidden must
    // bypass the entire host render, not just the text rendering slots.
    row.imageComponents = [{ render: () => ["INLINE-IMAGE"] }];
    await shortcut(ctx); // All tools hidden, including edit/write and images
    for (const hidden of [row, ...changeRows, diffRow, makeRow("edit"), makeRow("write")]) {
      assert.deepEqual(hidden.render(100), []);
    }
    await shortcut(ctx); // Back to the default edit/write-only state
    assertChangesVisible();
    assert.deepEqual(row.render(100), []);
    assert.deepEqual(diffRow.render(100), []);
    const { stripVTControlCharacters } = await import("node:util");
    const native = new FooterComponent({
      state: { model: ctx.model, thinkingLevel: "medium" },
      modelRuntime: { isUsingSubscription: () => false },
      sessionManager: { getCwd: () => "/tmp", getSessionName: () => undefined },
    }, { getGitBranch: () => undefined, getExtensionStatuses: () => new Map(), getAvailableProviderCount: () => 2 });
    // With unrelated usage totals absent, our sole line must exactly match the
    // native stats/model line, at every width and context/compaction state.
    native.getSessionStats = () => ({ usageTotals: {}, contextUsage: usage });
    for (const percent of [0, 25, 71, 91, null]) {
      usage = { tokens: percent == null ? null : percent * 1000, contextWindow: 100000, percent };
      for (const auto of [false, true]) {
        autoCompact = auto;
        native.setAutoCompactEnabled(auto);
        for (const width of [5, 12, 30, 60, 100]) {
          assert.equal(stripVTControlCharacters(footer.render(width)[0]), stripVTControlCharacters(native.render(width)[1]));
          assert.ok(visibleWidth(footer.render(width)[0]) <= width);
        }
      }
    }
    usage = undefined;
    assert.match(footer.render(100)[0], /^0\.0%\/100k \(auto\)/);
    assert.ok(redraws >= 4);
  } finally {
    events.get("session_shutdown")();
    footer?.dispose();
  }
  assert.equal(ToolExecutionComponent.prototype.render, original);
  assert.equal(AssistantMessageComponent.prototype.updateContent, originalAssistantUpdate);
  assert.equal(editorFactory, previousEditor);
  assert.deepEqual(forwardedInput, ["ordinary text", "\x1b"]);
  for (const mode of ["rpc", "json", "print"]) {
    events.get("session_start")({}, { mode });
    assert.equal(ToolExecutionComponent.prototype.render, original);
    assert.equal(editorFactory, previousEditor);
    assert.equal(AssistantMessageComponent.prototype.updateContent, originalAssistantUpdate);
    events.get("session_shutdown")();
  }
  events.get("session_start")({}, ctx);
  assert.deepEqual(makeRow().render(100), []);
  for (const component of assistants) assert.doesNotMatch(component.render(100).join("\n"), /SECRET REASONING|FIRST THOUGHT|LAST THOUGHT/);
  events.get("session_shutdown")();
  assert.equal(ToolExecutionComponent.prototype.render, original);
  assert.equal(editorFactory, previousEditor);

  // Also exercise the normal installation path with Pi's real CustomEditor,
  // not just an existing extension's editor, and wire native action handlers
  // exactly as InteractiveMode does after it creates a custom editor.
  const { getEditorTheme } = await import(pathToFileURL(join(root, "dist/modes/interactive/theme/theme.js")).href);
  const { KeybindingsManager } = await import(pathToFileURL(join(root, "dist/core/keybindings.js")).href);
  let nativeFactory;
  let nativeEditor;
  let dialog;
  let menuCount = 0;
  const { theme } = await import(pathToFileURL(join(root, "dist/modes/interactive/theme/theme.js")).href);
  const submitted = [];
  const nativeCtx = { ...ctx, ui: { ...ctx.ui,
    getEditorComponent: () => nativeFactory,
    custom(factory, options) {
      menuCount++;
      assert.equal(options.overlay, true);
      const placement = options.overlayOptions();
      assert.equal(placement.anchor, "top-center");
      assert.ok(placement.margin.top >= 1);
      return new Promise((resolve) => {
        dialog = factory(tui, theme, new KeybindingsManager(), (value) => { dialog.dispose(); resolve(value); });
      });
    },
    notify(message) { assert.fail(message); },
    setEditorComponent(factory) {
      nativeFactory = factory;
      nativeEditor = factory?.(tui, getEditorTheme(), new KeybindingsManager());
    },
  } };
  try {
    events.get("session_start")({}, nativeCtx);
    let builtinActions = 0;
    let thinkingCycles = 0;
    nativeEditor.onAction("app.tools.expand", () => { builtinActions++; });
    nativeEditor.onAction("app.thinking.toggle", () => { builtinActions++; });
    nativeEditor.onAction("app.thinking.cycle", () => { thinkingCycles++; });
    nativeEditor.handleInput("hello");
    assert.equal(nativeEditor.getText(), "hello");
    const row = makeRow();
    assert.deepEqual(row.render(100), []);
    nativeEditor.handleInput("\x0f");
    assert.match(row.render(100).join("\n"), /result-line-0/);
    assert.doesNotMatch(row.render(100).join("\n"), /result-line-29/);
    nativeEditor.handleInput("\x1b[111;5u"); // Kitty Ctrl-O
    assert.match(row.render(100).join("\n"), /result-line-29/);
    nativeEditor.handleInput("\x0f"); // Hidden
    assert.deepEqual(row.render(100), []);
    assert.deepEqual(makeRow("edit").render(100), []);
    nativeEditor.handleInput("\x0f"); // Edit/write only
    assert.deepEqual(row.render(100), []);
    assert.match(makeRow("edit").render(100).join("\n"), /result-line-29/);
    assert.match(makeRow("write").render(100).join("\n"), /result-line-29/);
    const thinking = new AssistantMessageComponent({ role: "assistant", content: [{ type: "thinking", thinking: "REVEALED" }], stopReason: "stop" });
    assistants.add(thinking);
    assert.deepEqual(thinking.render(100), []);
    nativeEditor.handleInput("\x14");
    nativeEditor.handleInput("\x1b[116;5u"); // Kitty Ctrl-T
    assert.equal(thinkingCycles, 2);
    assert.deepEqual(thinking.render(100), []);
    nativeEditor.handleInput("\x1b[Z"); // Shift-Tab is disabled
    assert.deepEqual(thinking.render(100), []);
    assert.equal(thinkingCycles, 2);
    nativeEditor.handleInput("\x08"); // Ctrl-H
    assert.match(thinking.render(100).join("\n"), /REVEALED/);
    nativeEditor.handleInput("\x1b[104;5u"); // Kitty Ctrl-H
    assert.deepEqual(thinking.render(100), []);
    assert.equal(thinkingCycles, 2);
    assert.equal(builtinActions, 0);
    assert.equal(nativeEditor.getText(), "hello");
    nativeEditor.onAction("app.model.cycleForward", () => { assert.fail("Ctrl-P must not cycle models"); });
    nativeEditor.onSubmit = async (command) => { submitted.push(command); nativeEditor.setText(""); };
    nativeEditor.handleInput("\x10"); // Ctrl-P
    nativeEditor.handleInput("\x10"); // Do not stack dialogs
    assert.equal(menuCount, 1);
    await new Promise(setImmediate);
    assert.match(dialog.render(70).join("\n"), /\/model/);
    assert.match(dialog.render(70).join("\n"), /\/example/);
    dialog.focused = true;
    assert.equal(dialog.focused, true);
    dialog.handleInput("settings");
    await new Promise(setImmediate);
    assert.match(dialog.render(70).join("\n"), /\/settings/);
    assert.doesNotMatch(dialog.render(70).join("\n"), /\/model/);
    assert.equal(submitted.length, 0);
    dialog.handleInput("\r"); // Run immediately, without preview
    await new Promise(setImmediate);
    assert.deepEqual(submitted, ["/settings"]);
    assert.equal(nativeEditor.getText(), "hello");
    nativeEditor.handleInput("\x10");
    await new Promise(setImmediate);
    dialog.handleInput("nonexistentcommand");
    await new Promise(setImmediate);
    assert.match(dialog.render(70).join("\n"), /No matching commands/);
    dialog.handleInput("\r"); // No match must not run anything
    assert.equal(submitted.length, 1);
    dialog.handleInput("\x1b");
    await new Promise(setImmediate);
    assert.equal(nativeEditor.getText(), "hello");
    assert.equal(submitted.length, 1);
  } finally {
    events.get("session_shutdown")();
    footer?.dispose();
  }
  assert.equal(nativeFactory, undefined);
});
