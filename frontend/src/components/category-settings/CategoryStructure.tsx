import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createSystemCategory,
  deleteSystemCategory,
  listSystemCategories,
  updateSystemCategory,
} from "../../api/system-categories";
import { toastError, toastSuccess } from "../../utils/toast";
import type { SystemCategoryTreeItem } from "../../types";
import "./CategoryStructure.css";

/** 删除仍被引用的分类时，默认把引用迁移到这里 */
const REMAP_TARGET = "其他资源";

interface Props {
  /** 分类结构变化后通知父组件（别名列表需要重新拉取系统分类下拉） */
  onChanged?: () => void;
}

/**
 * 分类结构管理：新增大类/小类、改名、启停、删除。
 *
 * 后端已经把「改名/删除」做成级联：改名会同步更新别名表和视频级分类，
 * 删除时若仍被引用会返回 409，这里引导用户把引用迁移到「其他资源」再删。
 */
export default function CategoryStructure({ onChanged }: Props) {
  const [tree, setTree] = useState<SystemCategoryTreeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [parentId, setParentId] = useState("");
  const [name, setName] = useState("");

  const reload = useCallback(async () => {
    try {
      setTree(await listSystemCategories());
    } catch {
      // client 已统一 toast
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const run = useCallback(
    async (task: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await task();
      } catch {
        // client 已统一 toast
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  const childCount = useMemo(
    () => tree.reduce((sum, parent) => sum + parent.children.length, 0),
    [tree]
  );

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toastError("先填分类名");
      return;
    }
    run(async () => {
      await createSystemCategory({
        name: trimmed,
        parent_id: parentId ? Number(parentId) : null,
        sort: 999,
      });
      toastSuccess(
        `已新增分类「${trimmed}」${
          parentId
            ? `（挂在「${tree.find((p) => String(p.id) === parentId)?.name ?? ""}」下）`
            : "（作为大类）"
        }`
      );
      setName("");
      await reload();
      onChanged?.();
    });
  };

  const rename = (item: SystemCategoryTreeItem) => {
    const next = window.prompt(
      `把「${item.name}」改成（别名与视频分类会一起改指）：`,
      item.name
    );
    const trimmed = next?.trim();
    if (!trimmed || trimmed === item.name) return;
    run(async () => {
      await updateSystemCategory(item.id, { name: trimmed });
      toastSuccess(`已改名为「${trimmed}」`);
      await reload();
      onChanged?.();
    });
  };

  const toggle = (item: SystemCategoryTreeItem) => {
    run(async () => {
      await updateSystemCategory(item.id, { enabled: item.enabled === false });
      await reload();
      onChanged?.();
    });
  };

  const remove = (item: SystemCategoryTreeItem) => {
    if (!window.confirm(`删除分类「${item.name}」？它的子分类会一起删除。`)) return;
    run(async () => {
      try {
        await deleteSystemCategory(item.id);
        toastSuccess("已删除");
      } catch {
        // 409：仍有别名或视频引用，引导迁移后再删
        const proceed = window.confirm(
          `「${item.name}」还有内容在使用，不能直接删。\n\n要先把这些引用迁移到「${REMAP_TARGET}」再删除吗？`
        );
        if (!proceed) return;
        await deleteSystemCategory(item.id, REMAP_TARGET);
        toastSuccess(`已把引用迁移到「${REMAP_TARGET}」并删除`);
      }
      await reload();
      onChanged?.();
    });
  };

  const renderRow = (item: SystemCategoryTreeItem, isChild: boolean) => (
    <div className={`cat-row${isChild ? " cat-row--child" : ""}`} key={item.id}>
      <span className="cat-name">{item.name}</span>
      {item.enabled === false && <span className="cat-badge">已停用</span>}
      <button
        type="button"
        className="btn alias-btn"
        onClick={() => rename(item)}
        disabled={busy}
      >
        改名
      </button>
      <button
        type="button"
        className="btn alias-btn"
        onClick={() => toggle(item)}
        disabled={busy}
      >
        {item.enabled === false ? "启用" : "停用"}
      </button>
      <button
        type="button"
        className="btn alias-btn alias-btn--danger"
        onClick={() => remove(item)}
        disabled={busy}
      >
        删除
      </button>
    </div>
  );

  return (
    <details className="cat-structure">
      <summary>
        分类结构（{tree.length} 大类 · {childCount} 小类）
      </summary>

      <div className="cat-add">
        <select
          className="alias-select"
          value={parentId}
          onChange={(event) => setParentId(event.target.value)}
          aria-label="新分类挂到哪个大类下"
        >
          <option value="">作为大类</option>
          {tree.map((parent) => (
            <option key={parent.id} value={parent.id}>
              挂到「{parent.name}」下
            </option>
          ))}
        </select>
        <input
          className="alias-search"
          type="text"
          placeholder="新分类名，如：福利"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
          }}
          aria-label="新分类名"
        />
        <button
          type="button"
          className="btn btn-primary alias-btn"
          onClick={add}
          disabled={busy || !name.trim()}
        >
          新增
        </button>
      </div>

      {loading ? (
        <div className="alias-empty">加载中…</div>
      ) : (
        <div className="cat-tree">
          {tree.map((parent) => (
            <div className="cat-group" key={parent.id}>
              {renderRow(parent, false)}
              {parent.children.map((child) => renderRow(child, true))}
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
