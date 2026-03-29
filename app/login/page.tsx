"use client";

import { signInWithGitHub } from "./actions";
import { motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";

const ParticleField = dynamic(
  () =>
    import("../components/shared/ParticleField").then((m) => m.ParticleField),
  { ssr: false }
);

function GitHubIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  return (
    <main className="font-mono min-h-screen flex items-center justify-center px-6 relative">
      {/* 3D Particle Background */}
      <ParticleField />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="w-full max-w-sm relative z-10"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="inline-flex items-center justify-center mb-4"
          >
            <Image
              src="/icon.svg"
              alt="Kontext logo"
              width={48}
              height={48}
              className="rounded-xl"
              priority
              unoptimized
            />
          </motion.div>
          <h1 className="text-foreground font-mono font-medium text-lg tracking-tight my-0">
            Kontext
          </h1>
          <p className="text-muted-foreground font-mono text-sm mt-1.5 mb-0">
            GitHub Repository Analyzer
          </p>
        </div>

        {/* Login Card */}
        <div
          className="glass-strong rounded-lg p-6 space-y-5"
        >
          <div className="space-y-1.5">
            <h2 className="my-0 font-mono font-medium text-sm tracking-tight uppercase text-foreground">
              Sign in
            </h2>
            <p className="text-muted-foreground text-xs font-mono my-0 leading-relaxed">
              Authenticate with GitHub to analyze your repositories.
            </p>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="rounded px-3 py-2"
              style={{
                background: "rgba(255, 82, 82, 0.1)",
                border: "1px solid rgba(255, 82, 82, 0.2)",
              }}
            >
              <p className="text-[var(--accent-red)] text-xs font-mono my-0">
                {error === "auth"
                  ? "Authentication failed. Please try again."
                  : "Could not connect to GitHub. Please try again."}
              </p>
            </motion.div>
          )}

          <form action={signInWithGitHub}>
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2.5 font-mono text-sm font-medium py-2.5 px-4 rounded-md border-none cursor-pointer transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
              style={{
                background: "var(--foreground)",
                color: "var(--background)",
              }}
            >
              <GitHubIcon />
              Sign in with GitHub
            </button>
          </form>

          {/* Scopes info */}
          <div
            className="pt-4 space-y-2.5"
            style={{ borderTop: "1px solid var(--alpha-white-8)" }}
          >
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <LockIcon />
              <span className="text-xs font-mono uppercase">
                Permissions requested
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono text-muted-foreground"
                style={{
                  background: "var(--alpha-white-5)",
                  border: "1px solid var(--alpha-white-10)",
                }}
              >
                repo
              </span>
              <span
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono text-muted-foreground"
                style={{
                  background: "var(--alpha-white-5)",
                  border: "1px solid var(--alpha-white-10)",
                }}
              >
                read:user
              </span>
            </div>
            <p className="text-muted-foreground text-xs font-mono my-0 leading-relaxed opacity-70">
              Required to read repository contents and your profile.
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-muted-foreground text-xs font-mono mt-4 opacity-60">
          Your tokens are never stored on our servers.
        </p>
      </motion.div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="font-mono min-h-screen flex items-center justify-center">
          <div className="text-muted-foreground text-sm">Loading...</div>
        </main>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
