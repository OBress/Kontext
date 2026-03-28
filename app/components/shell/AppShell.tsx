"use client";

import { ReactNode } from "react";
import { IconRail } from "./IconRail";
import { TopBar } from "./TopBar";
import { ApiKeyGate } from "../shared/ApiKeyGate";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <>
      <TopBar />
      <IconRail />
      <main className="pl-14 pt-12 min-h-screen">
        <div className="p-6">
          {children}
        </div>
      </main>
      <ApiKeyGate />
    </>
  );
}
