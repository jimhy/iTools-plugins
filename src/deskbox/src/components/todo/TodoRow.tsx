/** 单条待办：圆形勾选框 + 文本（双击内联编辑）+ 优先级标签（点击循环）+ 时间 + 删除；支持 HTML5 拖拽排序。 */
import { useState } from "react";
import type { DragEvent } from "react";
import type { Todo } from "../../types";
import { useTodosStore } from "../../state/todosStore";
import { openContextMenu } from "../../state/contextMenuStore";
import { PRIO_LABEL, hhmm } from "./todoMeta";
import styles from "./TodoRow.module.css";

const PRIO_CLASS: Record<Todo["priority"], string> = {
  high: styles.prioHigh,
  mid: styles.prioMid,
  low: styles.prioLow,
};

export function TodoRow({ todo }: { todo: Todo }) {
  const toggle = useTodosStore((s) => s.toggle);
  const remove = useTodosStore((s) => s.remove);
  const edit = useTodosStore((s) => s.edit);
  const cyclePriority = useTodosStore((s) => s.cyclePriority);
  const reorder = useTodosStore((s) => s.reorder);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(todo.text);
  const [dragging, setDragging] = useState(false);
  const [dropPos, setDropPos] = useState<"before" | "after" | null>(null);

  const startEdit = () => {
    setDraft(todo.text);
    setEditing(true);
  };
  const commit = () => {
    edit(todo.id, draft);
    setEditing(false);
  };

  const isAfter = (e: DragEvent): boolean => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  };

  const cls = [
    styles.item,
    todo.done ? styles.done : "",
    dragging ? styles.dragging : "",
    dropPos === "before" ? styles.dropBefore : "",
    dropPos === "after" ? styles.dropAfter : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cls}
      draggable={!editing}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openContextMenu(e.clientX, e.clientY, [
          { label: todo.done ? "标记未完成" : "标记完成", onSelect: () => toggle(todo.id) },
          { label: "编辑", onSelect: startEdit },
          { label: "切换优先级", onSelect: () => cyclePriority(todo.id) },
          { label: "删除", danger: true, onSelect: () => remove(todo.id) },
        ]);
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", todo.id);
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => {
        setDragging(false);
        setDropPos(null);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDropPos(isAfter(e) ? "after" : "before");
      }}
      onDragLeave={() => setDropPos(null)}
      onDrop={(e) => {
        e.preventDefault();
        const dragId = e.dataTransfer.getData("text/plain");
        const after = isAfter(e);
        setDropPos(null);
        if (dragId && dragId !== todo.id) reorder(dragId, todo.id, after);
      }}
    >
      <button
        type="button"
        className={`${styles.cbox}${todo.done ? " " + styles.on : ""}`}
        aria-label={todo.done ? "标记为未完成" : "标记为已完成"}
        aria-pressed={todo.done}
        onClick={() => toggle(todo.id)}
      >
        {todo.done ? "✓" : ""}
      </button>

      {editing ? (
        <input
          className={styles.edit}
          autoFocus
          value={draft}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation(); // 阻止冒泡到全局 Esc（否则会关闭整个面板）
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") setEditing(false);
          }}
          onBlur={commit}
        />
      ) : (
        <span className={styles.text} onDoubleClick={startEdit}>
          {todo.text}
        </span>
      )}

      <button
        type="button"
        className={`${styles.prio} ${PRIO_CLASS[todo.priority]}`}
        title="点击切换优先级"
        aria-label={`优先级：${PRIO_LABEL[todo.priority]}，点击切换`}
        onClick={(e) => {
          e.stopPropagation();
          cyclePriority(todo.id);
        }}
      >
        {PRIO_LABEL[todo.priority]}
      </button>

      <span className={styles.time}>{hhmm(todo.createdAt)}</span>

      <button type="button" className={styles.del} title="删除" aria-label={`删除待办：${todo.text}`} onClick={() => remove(todo.id)}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
        </svg>
      </button>
    </div>
  );
}
