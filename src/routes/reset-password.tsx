import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — JARVIS" },
      { name: "description", content: "Choose a new password for your JARVIS account." },
      { property: "og:title", content: "Reset password — JARVIS" },
      { property: "og:description", content: "Choose a new password for your JARVIS account." },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return toast.error(error.message);
    toast.success("Password updated.");
    navigate({ to: "/", replace: true });
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="hud-panel w-full max-w-sm space-y-3 p-6">
        <h1 className="font-mono text-xl tracking-widest text-primary">New password</h1>
        <Input type="password" required minLength={8} placeholder="New password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        <Button type="submit" className="w-full">Save password</Button>
      </form>
    </main>
  );
}
