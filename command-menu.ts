import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Container, Input, SelectList, Text, type AutocompleteProvider, type EditorComponent } from "@earendil-works/pi-tui";

/** Use Pi's live autocomplete provider, including built-ins, skills, and extensions. */
export async function showCommandMenu(ctx: ExtensionContext, provider: AutocompleteProvider, editor: EditorComponent, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  let revision = 0;
  let disposed = false;
  const selected = await ctx.ui.custom<string | undefined>((tui, theme, keys, done) => {
    const cancel = () => done(undefined);
    signal?.addEventListener("abort", cancel, { once: true });
    const container = new Container();
    const frame = new Box(1, 1, (s) => theme.bg("toolPendingBg", s));
    frame.addChild(container);
    const input = new Input({ prompt: "> ", placeholder: "Filter commands" });
    const listTheme = {
      selectedPrefix: (s: string) => theme.fg("accent", s),
      selectedText: (s: string) => theme.fg("accent", s),
      description: (s: string) => theme.fg("muted", s),
      scrollInfo: (s: string) => theme.fg("dim", s),
      noMatch: (s: string) => theme.fg("warning", s),
    };
    let list = new SelectList([], 10, listTheme);
    let resultsRevision = 0;
    const rebuild = () => {
      container.clear();
      container.addChild(new Text(theme.fg("accent", theme.bold("Commands")), 1, 0));
      container.addChild(input);
      container.addChild(list);
      container.addChild(new Text(theme.fg("dim", "Type to filter · ↑↓ select · Enter run · Esc cancel"), 1, 0));
      tui.requestRender();
    };
    const search = async () => {
      // Keep previous results until new ones arrive to avoid an empty frame.
      const request = ++revision;
      const query = `/${input.getValue().replace(/^\//, "")}`;
      try {
        const result = await provider.getSuggestions([query], 0, query.length, { signal: new AbortController().signal });
        if (disposed || request !== revision) return;
        resultsRevision = request;
        list = new SelectList((result?.items ?? []).map((item) => ({ ...item, label: `/${item.label}` })), 10, listTheme);
        rebuild();
      } catch {
        if (!disposed && request === revision) {
          list = new SelectList([], 10, listTheme);
          rebuild();
        }
      }
    };
    rebuild();
    void search();
    return {
      get focused() { return input.focused; },
      set focused(value: boolean) { input.focused = value; },
      invalidate() { frame.invalidate(); },
      dispose() { disposed = true; revision++; signal?.removeEventListener("abort", cancel); },
      render(width: number) { return frame.render(width); },
      handleInput(data: string) {
        if (keys.matches(data, "tui.select.cancel")) { done(undefined); return; }
        if (keys.matches(data, "tui.select.confirm")) {
          // Do not execute an old match while a new filter is still loading.
          if (resultsRevision !== revision) return;
          const item = list.getSelectedItem();
          if (item) done(`/${item.value}`);
          return;
        }
        if (keys.matches(data, "tui.select.up") || keys.matches(data, "tui.select.down") || keys.matches(data, "tui.select.pageUp") || keys.matches(data, "tui.select.pageDown")) {
          list.handleInput(data);
          tui.requestRender();
          return;
        }
        input.handleInput(data);
        void search();
        tui.requestRender();
      },
    };
  }, {
    overlay: true,
    // Anchor the top edge at a fixed row: filtering changes only the bottom
    // edge instead of re-centering (and moving) the whole dialog.
    overlayOptions: () => ({
      anchor: "top-center",
      margin: { top: Math.max(1, Math.floor((process.stdout.rows || 24) * 0.1)) },
      width: "80%",
      maxHeight: "80%",
      minWidth: 30,
    }),
  });
  if (!selected || signal?.aborted) return;

  // Pi's native slash-command handler clears its editor. Prevent that clear
  // while it runs so the existing prompt, cursor, and undo history survive.
  // Nonempty setText calls (e.g. commands intentionally editing a draft) pass
  // through. Always restore the editor method, including on errors/reload.
  const setText = editor.setText;
  const protectedSetText = function (this: EditorComponent, text: string) {
    if (text !== "") return setText.call(this, text);
  };
  editor.setText = protectedSetText;
  try {
    await editor.onSubmit?.(selected);
  } finally {
    if (editor.setText === protectedSetText) editor.setText = setText;
  }
}
