"use client";

import { ReactNode } from "react";
import { IconRail } from "./IconRail";
import { TopBar } from "./TopBar";
import { ApiKeyGate } from "../shared/ApiKeyGate";
import { AddRepoModal } from "../dashboard/AddRepoModal";
import { useAiKeySync } from "@/hooks/use-ai-key-sync";

interface AppShellProps {
  children: ReactNode;
  hideRail?: boolean;
}

export function AppShell({ children, hideRail }: AppShellProps) {
  // Ensure the browser-stored API key is always synced to the server
  // so background processes (webhooks) can use it.
  useAiKeySync();

  return (
    <>
      <TopBar />
      {!hideRail && <IconRail />}
      <main className="pt-12 min-h-screen overflow-visible">
        <div className="p-6">
          {children}
        </div>
      </main>
      <ApiKeyGate />
      <AddRepoModal />
    </>
  );
}

