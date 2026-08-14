/** 笔记搜索结果：侧栏每篇文档只展示一次，文档内命中由编辑区导航。 */
import { useEffect, useState } from "react";
import { useNotesStore, type NoteHit } from "../../state/notesStore";
import { useCryptoStore } from "../../state/cryptoStore";
import { highlight } from "./util";
import { IconLock } from "./icons";
import styles from "./TreePane.module.css";

export function SearchResults({ query }: { query: string }) {
  const tree = useNotesStore((s) => s.tree);
  const searchNotes = useNotesStore((s) => s.searchNotes);
  const openSearchDocument = useNotesStore((s) => s.openSearchDocument);
  const curNote = useNotesStore((s) => s.curNote);
  const searchTarget = useNotesStore((s) => s.searchTarget);
  // 解锁状态变化时重搜（加密正文变为可搜）。
  const masterKey = useCryptoStore((s) => s.masterKey);
  const [hits, setHits] = useState<NoteHit[] | null>(null);

  useEffect(() => {
    let alive = true;
    void searchNotes(query).then((h) => {
      if (alive) setHits(h);
    });
    return () => {
      alive = false;
    };
  }, [query, tree, masterKey, searchNotes]);

  // 输入新关键词时撤销旧定位反馈；新结果点击后再建立对应 target。
  useEffect(() => {
    useNotesStore.setState({ searchTarget: null });
    return () => {
      useNotesStore.setState({ searchTarget: null });
    };
  }, [query]);

  if (hits === null) return <div className={styles.list} />;
  if (hits.length === 0) return <div className={styles.hint}>未找到匹配的笔记</div>;

  const documentHits = Array.from(
    hits.reduce((groups, hit) => {
      const group = groups.get(hit.node.id);
      if (group) group.push(hit);
      else groups.set(hit.node.id, [hit]);
      return groups;
    }, new Map<string, NoteHit[]>()),
    ([, groupedHits]) => groupedHits,
  );

  return (
    <div className={styles.list}>
      {documentHits.map((groupedHits) => {
        const firstHit = groupedHits[0];
        const previewHit = groupedHits.find((hit) => hit.field === "body") ?? firstHit;
        const { node } = firstHit;
        const exactActive = searchTarget?.noteId === node.id && searchTarget.query === firstHit.query;
        return (
          <button
            type="button"
            key={node.id}
            className={`${styles.card} ${exactActive || (!searchTarget && curNote === node.id) ? styles.cardActive : ""}`}
            aria-label={`打开${node.title || "未命名笔记"}，共 ${groupedHits.length} 处匹配`}
            onClick={() => void openSearchDocument(groupedHits)}
          >
            <span className={styles.accentBar} />
            <div className={styles.cardBody}>
              <div className={`${styles.cardTitle} ${styles.searchTitle}`}>
                {node.locked && (
                  <span className={styles.cardLock} aria-label="已加密" title="已加密">
                    <IconLock size={11} />
                  </span>
                )}
                <span
                  className={styles.searchTitleText}
                  dangerouslySetInnerHTML={{ __html: highlight(node.title || "未命名笔记", firstHit.query) }}
                />
              </div>
              <div
                className={styles.searchPreview}
                dangerouslySetInnerHTML={{
                  __html: previewHit.field === "title" ? "标题命中" : highlight(previewHit.snippet, previewHit.query),
                }}
              />
              <span className={styles.searchCount}>{groupedHits.length} 处</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
