"use client";

import { ReactNode } from "react";
import { IconRail } from "./IconRail";
import { TopBar } from "./TopBar";
import { ApiKeyGate } from "../shared/ApiKeyGate";
import { AddRepoModal } from "../dashboard/AddRepoModal";

interface AppShellProps {
  children: ReactNode;
  hideRail?: boolean;
}

export function AppShell({ children, hideRail }: AppShellProps) {
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
