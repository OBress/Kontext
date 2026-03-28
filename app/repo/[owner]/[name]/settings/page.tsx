"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store/app-store";
import { GlowCard } from "@/app/components/shared/GlowCard";
import {
  Trash2,
  AlertTriangle,
  Loader2,
  Shield,
  X,
  Database,
  MessageSquare,
  Wand2,
  Users,
  Key,
  Server,
  FileCode,
  History,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function RepoSettingsPage() {
  const params = useParams<{ owner: string; name: string }>();
  const router = useRouter();
  const fullName = `${params.owner}/${params.name}`;

  const { removeRepo, clearIngestionStatus } = useAppStore();

  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Check ownership on mount ───────────────────────────────────────
  const checkOwnership = useCallback(async () => {
    try {
      // The repos API returns only repos owned by the current user (filtered by user_id).
      // If the repo appears in the list, the current user is the owner.
      const res = await fetch("/api/repos");
      if (!res.ok) {
        setIsOwner(false);
        return;
      }
      const data = await res.json();
      const found = (data.repos || []).find(
        (r: { full_name: string }) => r.full_name === fullName
      );
      setIsOwner(!!found);
    } catch {
      // If we can't determine, allow click — the API route enforces ownership anyway
      setIsOwner(true);
    }
  }, [fullName]);

  useEffect(() => {
    checkOwnership();
  }, [checkOwnership]);

  // ── Handle delete ──────────────────────────────────────────────────
  const handleDelete = async () => {
    if (confirmText !== fullName) return;

    setDeleting(true);
    setError(null);

    try {
      const res = await fetch("/api/repos/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_full_name: fullName }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(
          data.error?.message || "Failed to delete repository"
        );
      }

      // Clean up client state
      removeRepo(fullName);
      clearIngestionStatus(fullName);

      // Redirect to dashboard
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete repository");
      setDeleting(false);
    }
  };

  // Data categories that will be deleted
  const deletionItems = [
    {
      icon: Database,
      label: "Embeddings & vector data",
      description: "All repo_chunks with 1536-dim Gemini embeddings",
    },
    {
      icon: FileCode,
      label: "File metadata",
      description: "Parsed file records and import graphs",
    },
    {
      icon: MessageSquare,
      label: "Chat sessions",
      description: "All conversation history for this repo",
    },
    {
      icon: Wand2,
      label: "Generated prompts",
      description: "Saved .cursorrules and system prompts",
    },
    {
      icon: Key,
      label: "MCP API keys",
      description: "Keys scoped to this repository",
    },
    {
      icon: Users,
      label: "Team memberships",
      description: "All members and pending invites",
    },
    {
      icon: History,
      label: "Ingestion history",
      description: "Job logs and activity events",
    },
    {
      icon: Server,
      label: "Webhooks",
      description: "GitHub webhook registrations",
    },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Page header */}
      <div>
        <h2 className="font-mono text-lg font-semibold text-[var(--gray-100)] m-0 mb-1">
          Repository Settings
        </h2>
        <p className="font-mono text-sm text-[var(--gray-500)] m-0">
          Manage configuration for{" "}
          <span className="text-[var(--gray-300)]">{fullName}</span>
        </p>
      </div>

      {/* Danger Zone */}
      <GlowCard glowColor="none" className="p-0 overflow-hidden border-red-500/20">
        {/* Red header bar */}
        <div className="px-5 py-3 border-b border-red-500/20 bg-red-500/5">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-400" />
            <h3 className="font-mono text-sm font-semibold text-red-400 m-0">
              Danger Zone
            </h3>
          </div>
        </div>

        <div className="p-5">
          {/* Delete section */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h4 className="font-mono text-sm font-medium text-[var(--gray-200)] m-0 mb-1">
                Delete this repository
              </h4>
              <p className="font-mono text-xs text-[var(--gray-500)] m-0 leading-relaxed">
                Permanently remove this repository and all associated data
                including embeddings, chat history, generated prompts, team
                memberships, and MCP keys. This action is{" "}
                <span className="text-red-400 font-medium">irreversible</span>.
              </p>
            </div>
            <button
              onClick={() => setShowConfirmDialog(true)}
              disabled={isOwner === false || deleting}
              className={`
                shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono
                border cursor-pointer transition-all
                ${
                  isOwner === false
                    ? "bg-transparent border-[var(--alpha-white-8)] text-[var(--gray-600)] cursor-not-allowed"
                    : "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 hover:border-red-500/50"
                }
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
              title={
                isOwner === false
                  ? "Only the repository owner can delete"
                  : undefined
              }
            >
              <Trash2 size={14} />
              Delete repository
            </button>
          </div>

          {isOwner === false && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--alpha-white-3)] border border-[var(--alpha-white-5)]">
              <Shield size={14} className="text-[var(--gray-500)] shrink-0" />
              <p className="font-mono text-[11px] text-[var(--gray-500)] m-0">
                Only the repository owner can delete this repository.
              </p>
            </div>
          )}
        </div>
      </GlowCard>

      {/* ── Confirmation Dialog ─────────────────────────────────────── */}
      <AnimatePresence>
        {showConfirmDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => !deleting && setShowConfirmDialog(false)}
            />

            {/* Dialog */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="relative w-full max-w-lg rounded-xl bg-[#0D1117] border border-red-500/20 shadow-2xl shadow-red-500/5"
            >
              {/* Dialog header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--alpha-white-5)]">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={18} className="text-red-400" />
                  <h3 className="font-mono text-sm font-semibold text-[var(--gray-100)] m-0">
                    Delete {fullName}?
                  </h3>
                </div>
                <button
                  onClick={() => !deleting && setShowConfirmDialog(false)}
                  className="p-1 rounded text-[var(--gray-500)] hover:text-[var(--gray-300)] bg-transparent border-none cursor-pointer"
                  disabled={deleting}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Dialog body */}
              <div className="px-5 py-4 space-y-4">
                {/* Warning banner */}
                <div className="p-3 rounded-lg bg-red-500/8 border border-red-500/15">
                  <p className="font-mono text-xs text-red-300 m-0 leading-relaxed">
                    This will <strong>permanently delete</strong> the following
                    data. This action cannot be undone.
                  </p>
                </div>

                {/* Deletion items grid */}
                <div className="grid grid-cols-2 gap-2">
                  {deletionItems.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-start gap-2 p-2.5 rounded-lg bg-[var(--alpha-white-3)] border border-[var(--alpha-white-5)]"
                    >
                      <item.icon
                        size={14}
                        className="text-red-400/60 mt-0.5 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] font-medium text-[var(--gray-300)] m-0">
                          {item.label}
                        </p>
                        <p className="font-mono text-[10px] text-[var(--gray-600)] m-0 mt-0.5">
                          {item.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Type to confirm */}
                <div>
                  <label className="block font-mono text-xs text-[var(--gray-400)] mb-2">
                    Type{" "}
                    <span className="font-semibold text-[var(--gray-200)] select-all">
                      {fullName}
                    </span>{" "}
                    to confirm:
                  </label>
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => {
                      setConfirmText(e.target.value);
                      setError(null);
                    }}
                    placeholder={fullName}
                    autoFocus
                    disabled={deleting}
                    className="w-full px-3 py-2.5 rounded-lg font-mono text-sm
                      bg-[var(--surface-1)] border border-[var(--alpha-white-8)]
                      text-[var(--gray-200)] placeholder:text-[var(--gray-700)]
                      focus:outline-none focus:border-red-500/40
                      disabled:opacity-50"
                  />
                </div>

                {/* Error */}
                {error && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <p className="font-mono text-xs text-red-400 m-0">
                      {error}
                    </p>
                  </div>
                )}
              </div>

              {/* Dialog footer */}
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--alpha-white-5)]">
                <button
                  onClick={() => {
                    setShowConfirmDialog(false);
                    setConfirmText("");
                    setError(null);
                  }}
                  disabled={deleting}
                  className="px-4 py-2 rounded-lg text-sm font-mono
                    bg-[var(--alpha-white-5)] text-[var(--gray-400)]
                    border border-[var(--alpha-white-8)]
                    hover:text-[var(--gray-200)] cursor-pointer
                    disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={confirmText !== fullName || deleting}
                  className={`
                    flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono font-medium
                    border-none cursor-pointer transition-all
                    ${
                      confirmText === fullName && !deleting
                        ? "bg-red-600 text-white hover:bg-red-500"
                        : "bg-red-600/30 text-red-300/50 cursor-not-allowed"
                    }
                    disabled:cursor-not-allowed
                  `}
                >
                  {deleting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} />
                      I understand, permanently delete
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
