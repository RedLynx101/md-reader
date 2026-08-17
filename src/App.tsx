import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { load, type Store } from "@tauri-apps/plugin-store";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "github-markdown-css/github-markdown.css";
import "./App.css";

type ThemeMode = "light" | "dark" | "system";
type FontFamily = "inter" | "segoe" | "georgia" | "jetbrains";

interface Settings {
  theme: ThemeMode;
  fontSize: number;
  lineHeight: number;
  fontFamily: FontFamily;
}

interface MarkdownDocument {
  path: string;
  content: string;
  fileName: string;
}

const SETTINGS_FILE = "settings.json";
const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  fontSize: 16,
  lineHeight: 1.65,
  fontFamily: "inter",
};
const DEFAULT_STORE_SETTINGS: Record<string, unknown> = {
  ...DEFAULT_SETTINGS,
};
const PROJECT_URL = "https://github.com/RedLynx101/md-reader";
const IS_TAURI = "__TAURI_INTERNALS__" in window;
const PREVIEW_DOCUMENT: MarkdownDocument = {
  path: "Browser preview · Native file access is available in the Windows app",
  fileName: "welcome.md",
  content: `# Markdown Reader

A focused desktop reader for local Markdown files.

> Open a document from Windows Explorer or use **Open File** in the installed app. This browser preview uses a built-in sample and does not receive local file access.

## The useful parts

- GitHub-Flavored Markdown, tables, task lists, and fenced code
- System, light, and dark themes
- Adjustable typeface, text size, and line height
- Persistent local preferences
- Native \`.md\` file association on Windows

| Boundary | Behavior |
| --- | --- |
| Files | Read locally after an explicit open action |
| Rendering | Raw HTML is not enabled |
| Network | No document content is uploaded by the app |

\`\`\`ts
const purpose = "read the file, then get out of the way";
\`\`\`

Use **Settings** to change the reading surface.`,
};

const FONT_FAMILY_MAP: Record<FontFamily, string> = {
  inter: "Inter, Segoe UI, sans-serif",
  segoe: "Segoe UI Variable, Segoe UI, sans-serif",
  georgia: "Georgia, Cambria, serif",
  jetbrains: "JetBrains Mono, Consolas, monospace",
};

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

function isFontFamily(value: unknown): value is FontFamily {
  return (
    value === "inter" ||
    value === "segoe" ||
    value === "georgia" ||
    value === "jetbrains"
  );
}

function resolveTheme(theme: ThemeMode): "light" | "dark" {
  if (theme !== "system") {
    return theme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function App() {
  const [store, setStore] = useState<Store | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBooting, setIsBooting] = useState(true);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [doc, setDoc] = useState<MarkdownDocument | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resolvedTheme = resolveTheme(settings.theme);
  useEffect(() => {
    void (async () => {
      if (!IS_TAURI) {
        setDoc(PREVIEW_DOCUMENT);
        setIsBooting(false);
        return;
      }

      const loadedStore = await load(SETTINGS_FILE, {
        defaults: DEFAULT_STORE_SETTINGS,
        autoSave: 150,
      });
      setStore(loadedStore);

      const [theme, fontSize, lineHeight, fontFamily] = await Promise.all([
        loadedStore.get<unknown>("theme"),
        loadedStore.get<unknown>("fontSize"),
        loadedStore.get<unknown>("lineHeight"),
        loadedStore.get<unknown>("fontFamily"),
      ]);

      setSettings({
        theme: isThemeMode(theme) ? theme : DEFAULT_SETTINGS.theme,
        fontSize:
          typeof fontSize === "number" ? fontSize : DEFAULT_SETTINGS.fontSize,
        lineHeight:
          typeof lineHeight === "number"
            ? lineHeight
            : DEFAULT_SETTINGS.lineHeight,
        fontFamily: isFontFamily(fontFamily)
          ? fontFamily
          : DEFAULT_SETTINGS.fontFamily,
      });

      try {
        const launchDoc = await invoke<MarkdownDocument | null>(
          "get_launch_markdown",
        );
        if (launchDoc) {
          setDoc(launchDoc);
        }
      } catch (error) {
        setErrorMessage(String(error));
      } finally {
        setIsBooting(false);
      }
    })();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--reader-font-family",
      FONT_FAMILY_MAP[settings.fontFamily],
    );
    document.documentElement.style.setProperty(
      "--reader-font-size",
      `${settings.fontSize}px`,
    );
    document.documentElement.style.setProperty(
      "--reader-line-height",
      String(settings.lineHeight),
    );
  }, [settings.fontFamily, settings.fontSize, settings.lineHeight]);

  useEffect(() => {
    if (settings.theme !== "system") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemThemeChange = () => {
      document.documentElement.setAttribute(
        "data-theme",
        mediaQuery.matches ? "dark" : "light",
      );
    };
    mediaQuery.addEventListener("change", onSystemThemeChange);

    return () => {
      mediaQuery.removeEventListener("change", onSystemThemeChange);
    };
  }, [settings.theme]);

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSettingsOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isSettingsOpen]);

  async function persistSettings(nextSettings: Settings) {
    setSettings(nextSettings);
    if (!store) {
      return;
    }

    await Promise.all([
      store.set("theme", nextSettings.theme),
      store.set("fontSize", nextSettings.fontSize),
      store.set("lineHeight", nextSettings.lineHeight),
      store.set("fontFamily", nextSettings.fontFamily),
    ]);
    await store.save();
  }

  async function loadMarkdownPath(path: string) {
    setIsLoadingFile(true);
    setErrorMessage(null);
    try {
      const nextDoc = await invoke<MarkdownDocument>("read_markdown_file", {
        path,
      });
      setDoc(nextDoc);
    } catch (error) {
      setErrorMessage(String(error));
    } finally {
      setIsLoadingFile(false);
    }
  }

  async function onOpenFile() {
    if (!IS_TAURI) {
      setErrorMessage("Local file access is available in the installed Windows app.");
      return;
    }

    const selected = await open({
      title: "Open Markdown File",
      multiple: false,
      filters: [
        {
          name: "Markdown",
          extensions: ["md", "markdown", "mdown", "mkd"],
        },
      ],
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }
    await loadMarkdownPath(selected);
  }

  async function openExternal(url: string) {
    if (IS_TAURI) {
      await openUrl(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <main className="app-shell min-h-screen">
      <header className="border-b border-slate-200/80 px-4 py-3 dark:border-slate-700/70">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              alt="Markdown Reader icon"
              className="h-8 w-8 rounded-md border border-slate-200 object-cover dark:border-slate-700"
              src="/icon.png"
            />
            <div>
              <h1 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Markdown Reader
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Clean preview for local `.md` files
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              aria-describedby={!IS_TAURI ? "browser-preview-note" : undefined}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              onClick={() => {
                void onOpenFile();
              }}
              type="button"
            >
              {IS_TAURI ? "Open File" : "Desktop app required"}
            </button>
            <button
              className={`rounded-md border px-3 py-1.5 text-sm shadow-sm transition ${
                isSettingsOpen
                  ? "border-slate-500 bg-slate-100 text-slate-800 dark:border-slate-400 dark:bg-slate-700 dark:text-slate-100"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              }`}
              onClick={() => setIsSettingsOpen((current) => !current)}
              type="button"
            >
              Settings
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 py-4">
        <section className="flex min-h-[70vh] flex-col rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-4 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {doc?.path ?? "No file loaded yet"}
          </div>

          {!IS_TAURI ? (
            <p className="browser-preview-note" id="browser-preview-note" role="note">
              Public preview. Local files never enter this browser surface.
            </p>
          ) : null}

          <div className="flex-1 overflow-auto p-6">
            {isBooting || isLoadingFile ? (
              <div className="text-sm text-slate-500 dark:text-slate-400">
                Loading markdown...
              </div>
            ) : errorMessage ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
                {errorMessage}
              </div>
            ) : doc ? (
              <article className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {doc.content}
                </ReactMarkdown>
              </article>
            ) : (
              <div className="space-y-2 text-sm text-slate-500 dark:text-slate-400">
                <p>No markdown file is open.</p>
                <p>
                  Double-click a `.md` file in Explorer or click{" "}
                  <span className="font-semibold">Open File</span>.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      {isSettingsOpen && (
        <>
          <button
            aria-label="Close settings panel"
            className="settings-backdrop"
            onClick={() => setIsSettingsOpen(false)}
            type="button"
          />
          <aside
            aria-label="Reader settings"
            aria-modal="true"
            className="settings-panel"
            role="dialog"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Reader Settings
              </h2>
              <button
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                onClick={() => setIsSettingsOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <label className="setting-row">
                <span>Theme</span>
                <select
                  value={settings.theme}
                  onChange={(event) => {
                    void persistSettings({
                      ...settings,
                      theme: event.target.value as ThemeMode,
                    });
                  }}
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>

              <label className="setting-row">
                <span>Font</span>
                <select
                  value={settings.fontFamily}
                  onChange={(event) => {
                    void persistSettings({
                      ...settings,
                      fontFamily: event.target.value as FontFamily,
                    });
                  }}
                >
                  <option value="inter">Inter</option>
                  <option value="segoe">Segoe UI</option>
                  <option value="georgia">Georgia</option>
                  <option value="jetbrains">JetBrains Mono</option>
                </select>
              </label>

              <label className="setting-row">
                <span>Font size</span>
                <input
                  max={28}
                  min={12}
                  step={1}
                  type="range"
                  value={settings.fontSize}
                  onChange={(event) => {
                    void persistSettings({
                      ...settings,
                      fontSize: Number(event.target.value),
                    });
                  }}
                />
              </label>

              <label className="setting-row">
                <span>Line height</span>
                <input
                  max={2.2}
                  min={1.2}
                  step={0.05}
                  type="range"
                  value={settings.lineHeight}
                  onChange={(event) => {
                    void persistSettings({
                      ...settings,
                      lineHeight: Number(event.target.value),
                    });
                  }}
                />
              </label>
            </div>

            <hr className="my-4 border-slate-200 dark:border-slate-700" />

            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Project
            </h3>
            <div className="mt-3 flex flex-col gap-2">
              <button
                className="manager-button"
                onClick={() => {
                  void openExternal(PROJECT_URL);
                }}
                type="button"
              >
                Open source repository
              </button>
              <button
                className="manager-button"
                onClick={() => {
                  void openExternal(`${PROJECT_URL}/issues`);
                }}
                type="button"
              >
                Report an issue
              </button>
              {IS_TAURI ? (
                <button
                  className="manager-button"
                  onClick={() => {
                    void openUrl("ms-settings:appsfeatures");
                  }}
                  type="button"
                >
                  Open Windows app settings
                </button>
              ) : null}
            </div>
          </aside>
        </>
      )}
    </main>
  );
}

export default App;
