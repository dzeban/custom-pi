import { AssistantMessageComponent, CustomEditor, ToolExecutionComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, type AutocompleteProvider } from "@earendil-works/pi-tui";
import { showCommandMenu } from "./command-menu.js";
import { renderFooter } from "./footer.js";

type OutputState = "hidden" | "changes" | "collapsed" | "full";
const states: OutputState[] = ["hidden", "changes", "collapsed", "full"];

/** UI-only customization; never changes tool execution, results, or model context. */
export default function customPi(pi: ExtensionAPI) {
  let state: OutputState = "changes";
  let thinkingHidden = true;
  let redraw: (() => void) | undefined;
  let restore: (() => void) | undefined;
  let autocomplete: AutocompleteProvider | undefined;
  let menuOpen = false;
  let menuAbort: AbortController | undefined;

  // An empty renderer definition selects Pi's expandable generic fallback for
  // unknown/resumed MCP tools; its legacy no-definition fallback never collapses.
  pi.registerToolRenderer((_name, next) => next() ?? {});

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    state = "changes";
    thinkingHidden = true;
    menuOpen = false;
    restore?.();
    ctx.ui.addAutocompleteProvider((provider) => {
      autocomplete = provider;
      return provider;
    });

    // Keep the animated spinner, but without a working message beside it.
    ctx.ui.setWorkingMessage("");

    // Filter only the display copy before Pi computes spacing. Keep lastMessage
    // intact so Ctrl-H, streaming updates, and invalidation can recover thinking.
    const assistantPrototype = AssistantMessageComponent.prototype;
    const originalUpdate = assistantPrototype.updateContent;
    const updateContent: typeof originalUpdate = function (message, ...args) {
      const internal = this as unknown as {
        lastMessage: typeof message;
        hideThinkingBlock: boolean;
        thinkingVisibilityOverrides: Map<number, boolean>;
      };
      const previousHide = internal.hideThinkingBlock;
      internal.hideThinkingBlock = false;
      internal.thinkingVisibilityOverrides.clear();
      try {
        originalUpdate.call(this, thinkingHidden
          ? { ...message, content: message.content.filter((block) => block.type !== "thinking") }
          : message, ...args);
      } finally {
        internal.lastMessage = message;
        internal.hideThinkingBlock = previousHide;
      }
    };
    assistantPrototype.updateContent = updateContent;

    // Renderers cannot suppress the host's image rows or outer shell. Wrap the
    // exported component instead, preserving native/custom renderers in both
    // visible states. Install only during an interactive session and undo on exit.
    const prototype = ToolExecutionComponent.prototype;
    const original = prototype.render;
    const applied = new WeakMap<ToolExecutionComponent, OutputState>();
    const render: typeof original = function (width) {
      // Pi exposes these fields at runtime, but declares them private in types.
      const tool = this as unknown as { toolName: string };
      const isChange = tool.toolName === "edit" || tool.toolName === "write";
      const displayState = state === "changes"
        ? (isChange ? "full" : "hidden")
        : state;
      if (displayState === "hidden") return [];
      if (applied.get(this) !== displayState) {
        // setExpanded rebuilds the display; it does not request another render.
        this.setExpanded(displayState === "full");
        applied.set(this, displayState);
      }
      return original.call(this, width);
    };
    prototype.render = render;

    // These keys are reserved by Pi's shortcut registry. Handle them in the
    // main editor before its built-in actions, not in registerShortcut() or a
    // global input listener (which would also intercept picker/dialog keys).
    const previousEditor = ctx.ui.getEditorComponent();
    const editorFactory: NonNullable<ReturnType<typeof ctx.ui.getEditorComponent>> = (tui, theme, keybindings) => {
      const editor = previousEditor?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings, { embedWorkingStatus: true });
      const originalInput = editor.handleInput;
      editor.handleInput = function (data) {
        if (restore && matchesKey(data, "ctrl+o")) {
          state = states[(states.indexOf(state) + 1) % states.length];
          redraw?.();
        } else if (restore && matchesKey(data, "ctrl+p")) {
          if (!menuOpen && autocomplete) {
            menuOpen = true;
            menuAbort = new AbortController();
            void showCommandMenu(ctx, autocomplete, editor, menuAbort.signal)
              .catch((error) => ctx.ui.notify(`Command menu: ${String(error)}`, "error"))
              .finally(() => { menuOpen = false; });
          }
        } else if (restore && matchesKey(data, "ctrl+t")) {
          // Invoke Pi's actual cycle action so it handles model-specific levels,
          // updates the UI and preserves its normal status notifications.
          const handlers = (editor as Partial<CustomEditor>).actionHandlers;
          const cycle = handlers?.get("app.thinking.cycle");
          if (cycle) cycle();
          else originalInput.call(this, "\x1b[Z");
        } else if (restore && matchesKey(data, "ctrl+h")) {
          thinkingHidden = !thinkingHidden;
          redraw?.();
        } else if (restore && matchesKey(data, "shift+tab")) {
          // Disable Pi's old default thinking-level shortcut.
          return;
        } else {
          originalInput.call(this, data);
        }
      };
      return editor;
    };
    restore = () => {
      menuAbort?.abort();
      menuAbort = undefined;
      if (prototype.render === render) prototype.render = original;
      if (assistantPrototype.updateContent === updateContent) assistantPrototype.updateContent = originalUpdate;
      if (ctx.ui.getEditorComponent() === editorFactory) ctx.ui.setEditorComponent(previousEditor);
      restore = undefined;
    };
    ctx.ui.setEditorComponent(editorFactory);

    ctx.ui.setFooter((tui, theme, footerData) => {
      redraw = () => {
        tui.invalidate();
        tui.requestRender();
      };
      return {
        invalidate() {},
        dispose() { redraw = undefined; },
        render(width) {
          return renderFooter(width, theme, ctx, pi, footerData.getAvailableProviderCount());
        },
      };
    });
    redraw?.();
  });

  pi.on("session_shutdown", () => {
    restore?.();
    redraw = undefined;
    autocomplete = undefined;
    menuOpen = false;
  });
}
