// Browser client for the local JARVIS Windows Helper (127.0.0.1 only).
import { useCallback, useEffect, useState } from "react";

const URL_BASE = "http://127.0.0.1:8765";
const KEY = "jarvis.helperToken";

export type HelperResult = { ok: boolean; reason?: string; [k: string]: unknown };

export async function callHelper(path: string, body: Record<string, unknown> = {}, timeoutMs = 15000): Promise<HelperResult> {
  const token = localStorage.getItem(KEY) ?? "";
  if (!token) return { ok: false, reason: "PC helper is not paired. Open the PC tab to connect it." };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${URL_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Jarvis-Token": token },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const j = (await r.json().catch(() => ({ ok: false, reason: `Helper replied ${r.status}` }))) as HelperResult;
    return j;
  } catch {
    return { ok: false, reason: "PC helper is not reachable. Is jarvis_helper.py running?" };
  } finally {
    clearTimeout(t);
  }
}

export function useHelper() {
  const [token, setTokenState] = useState("");
  const [status, setStatus] = useState<"unpaired" | "checking" | "online" | "offline">("unpaired");
  const [info, setInfo] = useState<HelperResult | null>(null);

  const check = useCallback(async () => {
    if (!localStorage.getItem(KEY)) return setStatus("unpaired");
    setStatus("checking");
    const r = await callHelper("/status", {}, 4000);
    setInfo(r);
    setStatus(r.ok ? "online" : "offline");
  }, []);

  useEffect(() => {
    setTokenState(localStorage.getItem(KEY) ?? "");
    check();
    const id = setInterval(check, 20000);
    return () => clearInterval(id);
  }, [check]);

  const pair = (t: string) => {
    localStorage.setItem(KEY, t.trim());
    setTokenState(t.trim());
    check();
  };
  const unpair = () => {
    localStorage.removeItem(KEY);
    setTokenState("");
    setStatus("unpaired");
  };
  return { token, status, info, check, pair, unpair };
}
