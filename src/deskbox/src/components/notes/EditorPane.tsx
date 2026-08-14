/**
 * 右侧编辑区：头部（面包屑 / 标题 / 元信息 / 操作）+ 富文本工具栏 + TipTap「编辑即预览」正文。
 *
 * 编辑即预览：正文即所见即所得，正文存 HTML。图片本地化（粘贴 / 路径 / 拖入 → 复制到项目沙盒，
 * 只引用 itasset://id）；双击预览、右键菜单另存为/删除；链接 Ctrl+点击用系统浏览器打开。
 * 诚信约定：工具栏每个按钮都真实驱动编辑器命令，无假控件。
 */
import { useEffect, useReducer, useRef, type ChangeEvent, type JSX, type MouseEvent } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { AssetImage } from "./imageExtension";
import { useNotesStore } from "../../state/notesStore";
import { itools } from "../../services/itools";
import { toast } from "../../state/toastStore";
import { openContextMenu } from "../../state/contextMenuStore";
import { confirmDialog } from "./dialogs/ConfirmDialog";
import { promptDialog } from "./dialogs/PromptDialog";
import { putImage, idToSrc, mimeFromName } from "../../services/assets";
import { fmtShort, wordCount, extractTags, errMsg, plainText } from "./util";
import {
  IconNoteBig, IconStar, IconShare, IconEllipsis, IconChevron, IconFolder, IconFileText, IconHistory, IconHash,
  IconBold, IconItalic, IconUnderline, IconStrike, IconHeading, IconList, IconListOrdered, IconListChecks,
  IconCode, IconQuote, IconLink, IconImage, IconUndo, IconRedo,
} from "./icons";
import styles from "./EditorPane.module.css";

const IMG_EXT = /\.(png|jpe?g|gif|bmp|webp|svg|ico|tiff?)$/i;

interface SearchDecorationMeta {
  from?: number;
  to?: number;
  requestId: number;
}

const searchHighlightPluginKey = new PluginKey<DecorationSet>("noteSearchHighlight");

/** 搜索高亮仅存在于 ProseMirror decoration，不会写入正文 HTML 或触发保存。 */
function createSearchHighlightPlugin() {
  return new Plugin<DecorationSet>({
    key: searchHighlightPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (transaction, current) => {
        const meta = transaction.getMeta(searchHighlightPluginKey) as SearchDecorationMeta | undefined;
        if (meta) {
          if (meta.from == null || meta.to == null) return DecorationSet.empty;
          return DecorationSet.create(transaction.doc, [
            Decoration.inline(meta.from, meta.to, {
              class: styles.searchHit,
              "data-note-search-hit": String(meta.requestId),
            }),
          ]);
        }
        return current.map(transaction.mapping, transaction.doc);
      },
    },
    props: {
      decorations: (state) => searchHighlightPluginKey.getState(state) ?? null,
    },
  });
}

/**
 * 构造与 notesStore.searchableText 一致的可见文本，同时保留每个字符对应的 ProseMirror 位置。
 * 相邻行内 mark 不插空格，块节点/换行间只插一个空格。
 */
function editorSearchText(editor: Editor): { text: string; positions: number[] } {
  let text = "";
  const positions: number[] = [];
  let lastTextEnd: number | null = null;

  const append = (char: string, position: number) => {
    if (/\s/.test(char)) {
      if (!text || text.endsWith(" ")) return;
      text += " ";
      positions.push(position);
      return;
    }
    text += char;
    positions.push(position);
  };

  editor.state.doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    if (lastTextEnd != null && position > lastTextEnd) append(" ", lastTextEnd);
    for (let i = 0; i < node.text.length; i += 1) append(node.text[i], position + i);
    lastTextEnd = position + node.nodeSize;
  });

  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    positions.pop();
  }
  return { text, positions };
}

function findSearchRange(editor: Editor, query: string, occurrence: number): { from: number; to: number } | null {
  if (!query) return null;
  const { text, positions } = editorSearchText(editor);
  const matcher = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  let match: RegExpExecArray | null = null;
  for (let i = 0; i <= occurrence; i += 1) {
    match = matcher.exec(text);
    if (!match) return null;
  }
  if (!match) return null;
  const index = match.index;
  const start = positions[index];
  const end = positions[index + match[0].length - 1];
  return start == null || end == null ? null : { from: start, to: end + 1 };
}

/** 文本是否是一个本地图片文件路径（Windows 盘符 / UNC / 类 Unix 根 + 图片扩展名）。 */
function isLocalImagePath(text: string): boolean {
  const t = text.replace(/^["']|["']$/g, "").trim();
  if (!t || t.includes("\n") || t.length > 1000) return false;
  const looksPath = /^[a-zA-Z]:[\\/]/.test(t) || t.startsWith("\\\\") || t.startsWith("/");
  return looksPath && IMG_EXT.test(t);
}

export function EditorPane() {
  const curNote = useNotesStore((s) => s.curNote);
  const node = useNotesStore((s) => s.tree.find((n) => n.id === s.curNote) ?? null);
  const folder = useNotesStore((s) => (node?.parentId ? s.tree.find((n) => n.id === node.parentId) ?? null : null));
  const draftTitle = useNotesStore((s) => s.draftTitle);
  const draftBody = useNotesStore((s) => s.draftBody);
  const titleFocusTick = useNotesStore((s) => s.titleFocusTick);
  const searchTarget = useNotesStore((s) => s.searchTarget);
  const stepSearchTarget = useNotesStore((s) => s.stepSearchTarget);
  const setDraftTitle = useNotesStore((s) => s.setDraftTitle);
  const toggleLock = useNotesStore((s) => s.toggleLock);
  const toggleStar = useNotesStore((s) => s.toggleStar);
  const subtreeCount = useNotesStore((s) => s.subtreeCount);
  const deleteCurrentNote = useNotesStore((s) => s.deleteCurrentNote);

  const titleRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const activeSearchMatch = searchTarget?.matches[searchTarget.activeIndex] ?? null;

  // ---- 图片本地化插入（粘贴 / 拖入 / 路径 / 文件选择共用）----
  const insertImageBytes = async (ed: Editor, bytes: ArrayBuffer, mime: string, at?: number) => {
    try {
      const id = await putImage(bytes, mime);
      const attrs = { src: idToSrc(id) };
      if (at != null) ed.chain().focus().insertContentAt(at, { type: "image", attrs }).run();
      else ed.chain().focus().setImage(attrs).run();
    } catch (e) {
      toast("插入图片失败：" + errMsg(e));
    }
  };
  const insertFile = async (ed: Editor, file: File, at?: number) => {
    const buf = await file.arrayBuffer();
    await insertImageBytes(ed, buf, file.type || mimeFromName(file.name), at);
  };
  const insertPath = async (ed: Editor, path: string, at?: number) => {
    try {
      const buf = await itools.readLocalImage(path.replace(/^["']|["']$/g, "").trim());
      await insertImageBytes(ed, buf, mimeFromName(path), at);
    } catch (e) {
      toast("读取本地图片失败：" + errMsg(e));
    }
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      Placeholder.configure({ placeholder: "开始记录…支持富文本、图片、任务清单（粘贴/拖入图片即插入）" }),
      TaskList,
      TaskItem.configure({ nested: false }),
      AssetImage,
    ],
    content: "",
    editorProps: {
      attributes: { class: styles.prose },
      handlePaste: (_view, event) => {
        const ed = editorRef.current;
        const dt = (event as ClipboardEvent).clipboardData;
        if (!ed || !dt) return false;
        const item = Array.from(dt.items).find((it) => it.kind === "file" && it.type.startsWith("image/"));
        if (item) {
          const f = item.getAsFile();
          if (f) {
            void insertFile(ed, f);
            return true;
          }
        }
        const text = dt.getData("text/plain");
        if (text && isLocalImagePath(text)) {
          void insertPath(ed, text);
          return true;
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        const ed = editorRef.current;
        const dt = (event as DragEvent).dataTransfer;
        if (!ed || moved || !dt) return false;
        const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos;
        const files = Array.from(dt.files || []).filter((f) => f.type.startsWith("image/") || IMG_EXT.test(f.name));
        if (files.length) {
          files.forEach((f) => void insertFile(ed, f, at));
          return true;
        }
        const text = dt.getData("text/plain");
        if (text && isLocalImagePath(text)) {
          void insertPath(ed, text, at);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      useNotesStore.getState().setDraftBody(ed.getHTML());
    },
  });

  // editorRef 供 paste/drop 回调取用（回调创建于 editor 就绪前）。
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // 注册搜索装饰插件；插件随编辑器销毁，不污染其他编辑器实例。
  useEffect(() => {
    if (!editor) return;
    editor.registerPlugin(createSearchHighlightPlugin());
    return () => {
      editor.unregisterPlugin(searchHighlightPluginKey);
    };
  }, [editor]);

  // 编辑器 transaction 时刷新工具栏激活态。
  useEffect(() => {
    if (!editor) return;
    editor.on("transaction", force);
    return () => {
      editor.off("transaction", force);
    };
  }, [editor]);

  // 切换笔记时把正文灌入编辑器（不触发 update，避免回写抖动）。
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    if (curNote && curNote !== loadedFor.current) {
      loadedFor.current = curNote;
      editor.commands.setContent(draftBody || "", { emitUpdate: false });
    } else if (!curNote) {
      loadedFor.current = null;
    }
  }, [editor, curNote, draftBody]);

  // 搜索结果导航：等待目标笔记内容灌入后精确定位；只滚动并装饰，不改变焦点或选区。
  useEffect(() => {
    if (!editor) return;
    if (!searchTarget || !activeSearchMatch || searchTarget.noteId !== curNote) {
      editor.view.dispatch(
        editor.state.tr.setMeta(searchHighlightPluginKey, { requestId: 0 } satisfies SearchDecorationMeta),
      );
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearBodyHighlight = () => {
      editor.view.dispatch(
        editor.state.tr.setMeta(searchHighlightPluginKey, { requestId: searchTarget.requestId } satisfies SearchDecorationMeta),
      );
    };

    if (activeSearchMatch.field === "title") {
      clearBodyHighlight();
      requestAnimationFrame(() => {
        if (!cancelled) titleRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      return () => {
        cancelled = true;
      };
    }

    let attempts = 0;
    const locate = () => {
      if (cancelled) return;
      const range = findSearchRange(editor, searchTarget.query, activeSearchMatch.occurrence);
      if (!range) {
        // TipTap 初始化 / 异步 setContent 可能晚一帧；短时间重试，且新点击会立即取消旧任务。
        attempts += 1;
        if (attempts < 12) retryTimer = setTimeout(locate, attempts < 4 ? 16 : 50);
        return;
      }
      editor.view.dispatch(
        editor.state.tr.setMeta(searchHighlightPluginKey, {
          ...range,
          requestId: searchTarget.requestId,
        } satisfies SearchDecorationMeta),
      );
      requestAnimationFrame(() => {
        if (cancelled) return;
        const hit = editor.view.dom.querySelector<HTMLElement>(
          `[data-note-search-hit="${searchTarget.requestId}"]`,
        );
        const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        hit?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center", inline: "nearest" });
      });
    };
    locate();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [editor, curNote, searchTarget, activeSearchMatch]);

  // 新建笔记后聚焦标题。
  const lastTick = useRef(titleFocusTick);
  useEffect(() => {
    if (titleFocusTick !== lastTick.current) {
      lastTick.current = titleFocusTick;
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, [titleFocusTick]);

  if (!curNote || !node) {
    return (
      <div className={styles.pane}>
        <div className={styles.empty}>
          <div className={styles.big}>
            <IconNoteBig />
          </div>
          <div>选择或新建一条笔记</div>
        </div>
      </div>
    );
  }

  // ---- 工具栏动作 ----
  const run = (fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => {
    if (editor) fn(editor.chain().focus()).run();
  };
  const active = (name: string, attrs?: Record<string, unknown>) => !!editor?.isActive(name, attrs);

  const onLink = async () => {
    if (!editor) return;
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = await promptDialog("插入链接", { placeholder: "https://", confirmText: "插入" });
    if (!url) return;
    const href = /^[a-z]+:\/\//i.test(url) ? url : "https://" + url;
    if (editor.state.selection.empty) {
      editor.chain().focus().insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href } }] }).run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
  };

  const onPickImage = () => fileRef.current?.click();
  const onFilesPicked = (e: ChangeEvent<HTMLInputElement>) => {
    const ed = editorRef.current;
    const files = e.target.files;
    if (ed && files) Array.from(files).forEach((f) => void insertFile(ed, f));
    e.target.value = "";
  };

  // 链接：Ctrl/⌘ + 点击用系统浏览器打开。
  const onEditorClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest("a[href]");
    if (a && (e.ctrlKey || e.metaKey)) {
      const href = a.getAttribute("href");
      if (href && /^https?:\/\//i.test(href)) {
        e.preventDefault();
        void itools.openExternal(href);
      }
    }
  };

  const groups: { key: string; icon: JSX.Element; title: string; run: () => void; on?: boolean; disabled?: boolean }[][] = [
    [
      { key: "b", icon: <IconBold />, title: "加粗", run: () => run((c) => c.toggleBold()), on: active("bold") },
      { key: "i", icon: <IconItalic />, title: "斜体", run: () => run((c) => c.toggleItalic()), on: active("italic") },
      { key: "u", icon: <IconUnderline />, title: "下划线", run: () => run((c) => c.toggleUnderline()), on: active("underline") },
      { key: "s", icon: <IconStrike />, title: "删除线", run: () => run((c) => c.toggleStrike()), on: active("strike") },
    ],
    [
      { key: "h", icon: <IconHeading />, title: "标题", run: () => run((c) => c.toggleHeading({ level: 2 })), on: active("heading", { level: 2 }) },
      { key: "ul", icon: <IconList />, title: "无序列表", run: () => run((c) => c.toggleBulletList()), on: active("bulletList") },
      { key: "ol", icon: <IconListOrdered />, title: "有序列表", run: () => run((c) => c.toggleOrderedList()), on: active("orderedList") },
      { key: "ck", icon: <IconListChecks />, title: "任务清单", run: () => run((c) => c.toggleTaskList()), on: active("taskList") },
    ],
    [
      { key: "code", icon: <IconCode />, title: "代码块", run: () => run((c) => c.toggleCodeBlock()), on: active("codeBlock") },
      { key: "q", icon: <IconQuote />, title: "引用", run: () => run((c) => c.toggleBlockquote()), on: active("blockquote") },
      { key: "link", icon: <IconLink />, title: "链接（选中文字后点击）", run: () => void onLink(), on: active("link") },
      { key: "img", icon: <IconImage />, title: "插入图片", run: onPickImage },
    ],
    [
      { key: "undo", icon: <IconUndo />, title: "撤销", run: () => run((c) => c.undo()), disabled: !editor?.can().undo() },
      { key: "redo", icon: <IconRedo />, title: "重做", run: () => run((c) => c.redo()), disabled: !editor?.can().redo() },
    ],
  ];

  // ---- 头部操作 ----
  const shareNote = () => {
    const text = (draftTitle ? draftTitle + "\n\n" : "") + plainText(draftBody);
    void itools.copyText(text).then(() => toast("已复制正文文本"));
  };
  const onDelete = async () => {
    const cnt = subtreeCount(node.id);
    const ok = await confirmDialog(
      "删除笔记",
      cnt > 0 ? `将同时删除其下 ${cnt} 项内容，无法恢复。确定吗？` : "删除后无法恢复，确定吗？",
    );
    if (ok) void deleteCurrentNote();
  };
  const onMore = (e: MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    openContextMenu(r.right - 132, r.bottom + 4, [
      { label: "重命名", onSelect: () => { titleRef.current?.focus(); titleRef.current?.select(); } },
      { label: node.locked ? "取消加密" : "加密上锁", onSelect: () => void toggleLock() },
      { label: "复制全文", onSelect: shareNote },
      { label: "删除笔记", danger: true, onSelect: () => void onDelete() },
    ]);
  };

  const tags = extractTags(draftBody);

  return (
    <div className={styles.pane}>
      <header className={styles.head}>
        <div className={styles.headMain}>
          <div className={styles.headInfo}>
            {folder && (
              <div className={styles.breadcrumb} title={folder.title || "未命名文件夹"}>
                <span className={styles.crumbIco}><IconFolder size={13} /></span>
                <span className={styles.crumbFolder}>{folder.title || "未命名文件夹"}</span>
                <span className={styles.crumbSep}><IconChevron size={12} /></span>
              </div>
            )}

            <input
              ref={titleRef}
              className={`${styles.title} ${searchTarget?.noteId === curNote && activeSearchMatch?.field === "title" ? styles.titleSearchHit : ""}`}
              aria-label="笔记标题"
              placeholder="无标题"
              spellCheck={false}
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
            />

            <div className={styles.metaRow}>
              <span className={styles.metaItem}><IconHistory /> 编辑于 {fmtShort(node.updatedAt)}</span>
              <span className={styles.metaItem}><IconFileText /> {wordCount(draftBody)} 字</span>
              {node.locked && <span className={`${styles.metaItem} ${styles.lockedMeta}`}>已加密</span>}
              {tags.length > 0 && <span className={styles.metaItem}><IconHash /> {tags.length} 标签</span>}
              {tags.length > 0 && (
                <span className={styles.tags} aria-label={`标签：${tags.join("、")}`}>
                  {tags.map((t) => (
                    <span key={t} className={styles.tag}>#{t}</span>
                  ))}
                </span>
              )}
            </div>
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.actBtn} ${node.starred ? styles.actStar : ""}`}
              aria-label={node.starred ? "取消收藏" : "收藏"}
              aria-pressed={!!node.starred}
              title={node.starred ? "取消收藏" : "收藏"}
              onClick={() => toggleStar(node.id)}
            >
              <IconStar filled={!!node.starred} />
            </button>
            <button type="button" className={styles.actBtn} aria-label="复制全文" title="复制全文" onClick={shareNote}>
              <IconShare />
            </button>
            <button
              type="button"
              className={styles.actBtn}
              aria-label="更多笔记操作"
              aria-haspopup="menu"
              title="更多"
              onClick={onMore}
            >
              <IconEllipsis />
            </button>
          </div>
        </div>
      </header>

      <div className={styles.formatBar}>
        <div className={styles.fmtGroups}>
          {groups.map((g, gi) => (
            <div key={gi} className={styles.fmtGroup}>
              {gi > 0 && <span className={styles.fmtDiv} />}
              {g.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  className={`${styles.fmtBtn} ${b.on ? styles.fmtOn : ""}`}
                  aria-label={b.title}
                  aria-pressed={b.on === undefined ? undefined : b.on}
                  title={b.title}
                  disabled={b.disabled}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={b.run}
                >
                  {b.icon}
                </button>
              ))}
            </div>
          ))}
        </div>
        <span className={styles.wysiwygTag}>编辑即预览</span>
      </div>

      <div className={styles.editorArea}>
        <div className={styles.bodyWrap} onClickCapture={onEditorClick}>
          <EditorContent editor={editor} className={styles.editorHost} />
        </div>
        {searchTarget?.noteId === curNote && activeSearchMatch && (
          <div className={styles.searchNavigator} role="group" aria-label="当前文档搜索命中导航">
            <span
              className={styles.searchPosition}
              aria-live="polite"
              title={`第 ${searchTarget.activeIndex + 1} 处，共 ${searchTarget.matches.length} 处`}
            >
              {searchTarget.activeIndex + 1}/{searchTarget.matches.length}
            </span>
            <button
              type="button"
              className={`${styles.searchNavButton} ${styles.searchNavPrev}`}
              disabled={searchTarget.matches.length <= 1}
              aria-label="跳转到本文档上一个匹配位置"
              onClick={() => stepSearchTarget(-1)}
            >
              <IconChevron size={12} />
              <span>上一个</span>
            </button>
            <button
              type="button"
              className={styles.searchNavButton}
              disabled={searchTarget.matches.length <= 1}
              aria-label="跳转到本文档下一个匹配位置"
              onClick={() => stepSearchTarget(1)}
            >
              <span>下一个</span>
              <IconChevron size={12} />
            </button>
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFilesPicked} />
    </div>
  );
}
