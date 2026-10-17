// Browser-local persistence for memories, audit log and settings.
import { useCallback, useEffect, useState } from "react";
import type { PermissionLevel } from "./policy";

export type Memory = { id: string; content: string; category: string; createdAt: number };
export type AuditEntry = {
  id: string;
  at: number;
  tool: string;
  input: unknown;
  status: "executed" | "denied" | "rejected" | "failed";
  detail: string;
};

function useLocal<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setValue(JSON.parse(raw));
    } catch {
      /* corrupted storage: keep default */
    }
  }, [key]);
  const set = useCallback(
    (fn: (prev: T) => T) =>
      setValue((prev) => {
        const next = fn(prev);
        localStorage.setItem(key, JSON.stringify(next));
        return next;
      }),
    [key],
  );
  return [value, set] as const;
}

const uid = () => Math.random().toString(36).slice(2, 10);

export function useJarvisStore() {
  const [memories, setMemories] = useLocal<Memory[]>("jarvis.memories", []);
  const [audit, setAudit] = useLocal<AuditEntry[]>("jarvis.audit", []);
  const [level, setLevelState] = useLocal<PermissionLevel>("jarvis.level", 4);
  const [summary, setSummary] = useLocal<string>("jarvis.summary", "");

  return {
    memories,
    audit,
    level,
    summary,
    setLevel: (l: PermissionLevel) => setLevelState(() => l),
    setSummary: (s: string) => setSummary(() => s),
    addMemory: (content: string, category: string) => {
      const m = { id: `m_${uid()}`, content, category, createdAt: Date.now() };
      setMemories((p) => [m, ...p].slice(0, 100));
      return m;
    },
    deleteMemory: (id: string) => {
      let existed = false;
      setMemories((p) => {
        existed = p.some((m) => m.id === id);
        return p.filter((m) => m.id !== id);
      });
      return existed;
    },
    log: (e: Omit<AuditEntry, "id" | "at">) =>
      setAudit((p) => [{ ...e, id: uid(), at: Date.now() }, ...p].slice(0, 500)),
    clearAudit: () => setAudit(() => []),
  };
}
