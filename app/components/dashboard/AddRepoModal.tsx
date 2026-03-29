"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Search,
  Star,
  GitFork,
  Lock,
  Globe,
  Link2,
  Loader2,
  Plus,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  KeyRound,
  Settings2,
} from "lucide-react";
import {
  IngestionConfigPanel,
  DEFAULT_INGESTION_CONFIG,
} from "./IngestionConfigPanel";
import type { IngestionConfig } from "./IngestionConfigPanel";

// Language color map
const langColors: Record<string, string> = {
  TypeScript: "#3178C6",
  JavaScript: "#F7DF1E",
  Python: "#3572A5",
  Rust: "#DEA584",
  Go: "#00ADD8",
  Java: "#B07219",
  "C++": "#F34B7D",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Swift: "#FA7343",
  Kotlin: "#A97BFF",
  CSS: "#563D7C",
  HTML: "#E34C26",
};

interface GitHubRepoPreview {
  id: number;
  full_name: string;
  name: string;
  owner: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  updated_at: string;
  default_branch?: string;
  private?: boolean;
}

export function AddRepoModal() {
  const { addRepoModalOpen, setAddRepoModalOpen, addRepo, apiKey, setIngestionStatus, updateRepo, addRepoDefaultUrl, setAddRepoDefaultUrl } =
    useAppStore();
  const [tab, setTab] = useState<"browse" | "url">("browse");
  const [search, setSearch] = useState("");
  const [ghRepos, setGhRepos] = useState<GitHubRepoPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingRepo, setAddingRepo] = useState<string | null>(null);

  // URL tab state
  const [urlInput, setUrlInput] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<GitHubRepoPreview | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  // Use a ref instead of state to keep the raw PAT out of React DevTools / state snapshots
  const accessTokenRef = useRef("");
  const [accessTokenDisplay, setAccessTokenDisplay] = useState("");
  const [showTokenField, setShowTokenField] = useState(false);

  // Step 2: Configuration state
  const [step, setStep] = useState<"select" | "configure">("select");
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepoPreview | null>(null);
  const [config, setConfig] = useState<IngestionConfig>({ ...DEFAULT_INGESTION_CONFIG });
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);

  // Fetch GitHub repos when browse tab opens
  useEffect(() => {
    if (addRepoModalOpen && tab === "browse" && ghRepos.length === 0) {
      loadGitHubRepos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addRepoModalOpen, tab]);

  // If a default URL was set (e.g. from constellation click), pre-fill and auto-lookup
  useEffect(() => {
    if (addRepoModalOpen && addRepoDefaultUrl) {
      setTab("url");
      setUrlInput(addRepoDefaultUrl);
      setAddRepoDefaultUrl(null);

      // Auto-trigger lookup after a tick
      setTimeout(async () => {
        setLookupLoading(true);
        setLookupResult(null);
        setLookupError(null);
        try {
          const res = await fetch("/api/repos/lookup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: addRepoDefaultUrl }),
          });
          const data = await res.json();
          if (!res.ok) {
            setLookupError(data.error?.message || "Failed to look up repository");
          } else {
            setLookupResult(data.repo);
          }
        } catch {
          setLookupError("Failed to look up repository");
        } finally {
          setLookupLoading(false);
        }
      }, 100);
    }
  }, [addRepoModalOpen, addRepoDefaultUrl, setAddRepoDefaultUrl]);

  const loadGitHubRepos = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/repos?source=github");
      const data = await res.json();
      if (data.repos) setGhRepos(data.repos);
    } catch {
      // fail silently
    } finally {
      setLoading(false);
    }
  };

  const handleClose = useCallback(() => {
    setAddRepoModalOpen(false);
    setSearch("");
    setUrlInput("");
    setLookupResult(null);
    setLookupError(null);
    accessTokenRef.current = "";
    setAccessTokenDisplay("");
    setShowTokenField(false);
    setAddRepoDefaultUrl(null);
    // Reset step 2
    setStep("select");
    setSelectedRepo(null);
    setConfig({ ...DEFAULT_INGESTION_CONFIG });
  }, [setAddRepoModalOpen, setAddRepoDefaultUrl]);

  // Step 1 → Step 2 transition
  const handleSelectRepo = useCallback((repo: GitHubRepoPreview) => {
    setSelectedRepo(repo);
    // Pre-populate branch from the repo's default_branch
    setConfig((prev) => ({
      ...prev,
      watched_branch: repo.default_branch || "main",
    }));
    setStep("configure");

    // Fetch available branches
    setBranches([]);
    setBranchesLoading(true);
    fetch(`/api/repos/branches?repo=${encodeURIComponent(repo.full_name)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.branches) {
          setBranches(data.branches.map((b: { name: string }) => b.name));
        }
      })
      .catch(() => {
        // If fetch fails, just show the default branch
        setBranches([repo.default_branch || "main"]);
      })
      .finally(() => setBranchesLoading(false));
  }, []);

  // Step 2 back button
  const handleBackToSelect = useCallback(() => {
    setStep("select");
    // Don't clear selectedRepo so state is preserved if user goes back
  }, []);

  const handleAddRepo = useCallback(
    async (repo: GitHubRepoPreview) => {
      setAddingRepo(repo.full_name);

      try {
        // Step 1: Add to Supabase — pass config fields
        const addRes = await fetch("/api/repos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repo_full_name: repo.full_name,
            github_id: repo.id,
            description: repo.description,
            language: repo.language,
            stargazers_count: repo.stargazers_count,
            forks_count: repo.forks_count,
            default_branch: repo.default_branch || "main",
            custom_access_token: accessTokenRef.current.trim() || undefined,
            // ── New config fields ──
            auto_sync_enabled: config.auto_sync_enabled,
            watched_branch: config.watched_branch || repo.default_branch || "main",
          }),
        });

        if (!addRes.ok) throw new Error("Failed to add repository");

        // Add to local store immediately
        addRepo({
          id: repo.id,
          full_name: repo.full_name,
          name: repo.name,
          owner: repo.owner,
          description: repo.description,
          language: repo.language,
          stargazers_count: repo.stargazers_count,
          forks_count: repo.forks_count,
          updated_at: repo.updated_at,
          indexed: false,
          indexing: true,
          chunk_count: 0,
          sync_blocked_reason: null,
          pending_sync_head_sha: null,
          auto_sync_enabled: config.auto_sync_enabled,
        });

        // Remove from GitHub browse list
        setGhRepos((prev) => prev.filter((r) => r.full_name !== repo.full_name));

        // Close modal
        handleClose();


        // Webhook registration is now handled server-side in POST /api/repos


        // Step 2: Auto-trigger ingestion if API key is available
        if (apiKey) {
          setIngestionStatus(repo.full_name, {
            status: "fetching",
            progress: 0,
            filesTotal: 0,
            filesProcessed: 0,
            chunksCreated: 0,
            chunksTotal: 0,
            message: "Starting ingestion...",
          });

          try {
            const ingestRes = await fetch("/api/repos/ingest", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-google-api-key": apiKey,
              },
              body: JSON.stringify({
                repo_full_name: repo.full_name,
                // ── New config fields ──
                backfill_timeline: config.backfill_timeline,
                timeline_commit_depth: config.timeline_commit_depth,
              }),
            });

            if (!ingestRes.ok || !ingestRes.body) {
              throw new Error("Ingestion request failed");
            }

            // Read SSE stream
            const reader = ingestRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                const dataLine = line.replace(/^data: /, "").trim();
                if (!dataLine) continue;
                try {
                  const event = JSON.parse(dataLine);

                  if (event.status === "fetching") {
                    setIngestionStatus(repo.full_name, {
                      status: "fetching",
                      progress: 5,
                      filesTotal: 0,
                      filesProcessed: 0,
                      chunksCreated: 0,
                      chunksTotal: 0,
                      message: event.message || "Fetching repository tree...",
                    });
                  } else if (event.status === "chunking") {
                    const pct = event.filesTotal
                      ? Math.round((event.filesProcessed / event.filesTotal) * 50) + 10
                      : 10;
                    setIngestionStatus(repo.full_name, {
                      status: "chunking",
                      progress: pct,
                      filesTotal: event.filesTotal || 0,
                      filesProcessed: event.filesProcessed || 0,
                      chunksCreated: event.chunksCreated || 0,
                      chunksTotal: 0,
                      message: `Processing files (${event.filesProcessed}/${event.filesTotal})...`,
                    });
                  } else if (event.status === "embedding") {
                    const pct = event.chunksTotal
                      ? Math.round((event.chunksEmbedded / event.chunksTotal) * 30) + 60
                      : 60;
                    setIngestionStatus(repo.full_name, {
                      status: "embedding",
                      progress: pct,
                      filesTotal: event.filesTotal || 0,
                      filesProcessed: event.filesProcessed || 0,
                      chunksCreated: event.chunksEmbedded || 0,
                      chunksTotal: event.chunksTotal || 0,
                      message: `Embedding chunks (${event.chunksEmbedded || 0}/${event.chunksTotal || 0})...`,
                    });
                  } else if (event.status === "finalizing" || event.status === "timeline") {
                    setIngestionStatus(repo.full_name, {
                      status: event.status,
                      progress: event.status === "finalizing" ? 95 : 98,
                      filesTotal: event.filesTotal || 0,
                      filesProcessed: event.filesProcessed || 0,
                      chunksCreated: event.chunksCreated || 0,
                      chunksTotal: event.chunksTotal || 0,
                      message: event.message || "Finalizing index...",
                    });
                  } else if (
                    event.status === "blocked_quota" ||
                    event.status === "blocked_billing" ||
                    event.status === "blocked_model"
                  ) {
                    setIngestionStatus(repo.full_name, {
                      status: event.status,
                      progress: 0,
                      filesTotal: event.filesTotal || 0,
                      filesProcessed: event.filesProcessed || 0,
                      chunksCreated: event.chunksCreated || 0,
                      chunksTotal: event.chunksTotal || 0,
                      error: event.message,
                      message: event.message,
                    });
                    updateRepo(repo.full_name, { indexing: false });
                  } else if (event.status === "done") {
                    setIngestionStatus(repo.full_name, {
                      status: "done",
                      progress: 100,
                      filesTotal: event.filesTotal || 0,
                      filesProcessed: event.filesProcessed || 0,
                      chunksCreated: event.chunksCreated || 0,
                      chunksTotal: event.chunksCreated || 0,
                      message: "Ingestion complete!",
                    });
                    updateRepo(repo.full_name, {
                      indexed: true,
                      indexing: false,
                      chunk_count: event.chunksCreated || 0,
                      last_synced_sha: event.lastSyncedSha || null,
                      sync_blocked_reason: null,
                      pending_sync_head_sha: null,
                    });
                    // Auto-clear status after 5 seconds
                    setTimeout(() => {
                      useAppStore.getState().clearIngestionStatus(repo.full_name);
                    }, 5000);
                  } else if (event.status === "error") {
                    setIngestionStatus(repo.full_name, {
                      status: "error",
                      progress: 0,
                      filesTotal: 0,
                      filesProcessed: 0,
                      chunksCreated: 0,
                      chunksTotal: 0,
                      error: event.message,
                      message: event.message,
                    });
                    updateRepo(repo.full_name, { indexing: false });
                  }
                } catch {
                  // skip malformed JSON
                }
              }
            }
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : "Ingestion failed";
            setIngestionStatus(repo.full_name, {
              status: "error",
              progress: 0,
              filesTotal: 0,
              filesProcessed: 0,
              chunksCreated: 0,
              chunksTotal: 0,
              error: errMsg,
              message: errMsg,
            });
            updateRepo(repo.full_name, { indexing: false });
          }
        } else {
          // No API key — mark as added but not indexing
          updateRepo(repo.full_name, { indexing: false });
        }
      } catch {
        // Failed to add
      } finally {
        setAddingRepo(null);
      }
    },
    [apiKey, addRepo, setIngestionStatus, updateRepo, handleClose, config]
  );

  const handleLookup = async () => {
    if (!urlInput.trim()) return;
    setLookupLoading(true);
    setLookupResult(null);
    setLookupError(null);

    try {
      const res = await fetch("/api/repos/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: urlInput.trim(),
          access_token: accessTokenRef.current.trim() || null,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setLookupError(data.error?.message || "Failed to look up repository");
        return;
      }

      setLookupResult(data.repo);
    } catch {
      setLookupError("Failed to look up repository");
    } finally {
      setLookupLoading(false);
    }
  };

  const filteredRepos = ghRepos.filter((r) =>
    r.full_name.toLowerCase().includes(search.toLowerCase())
  );


  return (
    <AnimatePresence>
      {addRepoModalOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            onClick={handleClose}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="fixed inset-0 z-[61] flex items-center justify-center p-4"
            onClick={handleClose}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xl rounded-2xl overflow-hidden"
              style={{
                background: "rgba(10, 10, 15, 0.95)",
                backdropFilter: "blur(24px)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                boxShadow:
                  "0 0 80px rgba(63, 185, 80, 0.06), 0 25px 50px rgba(0, 0, 0, 0.6)",
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--alpha-white-5)]">
                <div className="flex items-center gap-2">
                  {step === "configure" ? (
                    <>
                      <button
                        onClick={handleBackToSelect}
                        className="p-1 rounded-lg hover:bg-[var(--alpha-white-8)] transition-colors bg-transparent border-none cursor-pointer text-[var(--gray-400)] hover:text-[var(--gray-200)]"
                      >
                        <ArrowLeft size={16} />
                      </button>
                      <Settings2
                        size={18}
                        className="text-[var(--accent-green)]"
                      />
                      <h2 className="font-mono text-base font-semibold text-[var(--gray-100)] m-0">
                        Configure Ingestion
                      </h2>
                    </>
                  ) : (
                    <>
                      <Plus
                        size={18}
                        className="text-[var(--accent-green)]"
                      />
                      <h2 className="font-mono text-base font-semibold text-[var(--gray-100)] m-0">
                        Add Repository
                      </h2>
                    </>
                  )}
                </div>
                <button
                  onClick={handleClose}
                  className="p-1.5 rounded-lg hover:bg-[var(--alpha-white-8)] transition-colors bg-transparent border-none cursor-pointer text-[var(--gray-400)] hover:text-[var(--gray-200)]"
                >
                  <X size={18} />
                </button>
              </div>

              {/* ── STEP 2: CONFIGURE ──────────────────────────────── */}
              {step === "configure" && selectedRepo ? (
                <div className="max-h-[60vh] flex flex-col overflow-hidden">
                  <IngestionConfigPanel
                    config={config}
                    onChange={setConfig}
                    repoName={selectedRepo.full_name}
                    defaultBranch={selectedRepo.default_branch || "main"}
                    branches={branches}
                    branchesLoading={branchesLoading}
                  />

                  {/* Action footer */}
                  <div className="px-6 py-4 border-t border-[var(--alpha-white-5)]">
                    <button
                      onClick={() => handleAddRepo(selectedRepo)}
                      disabled={addingRepo === selectedRepo.full_name}
                      className="w-full py-2.5 rounded-lg text-sm font-mono bg-[var(--accent-green)] text-black font-medium hover:opacity-90 transition-opacity cursor-pointer border-none disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {addingRepo === selectedRepo.full_name ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          Adding & Ingesting...
                        </>
                      ) : (
                        <>
                          <Plus size={14} />
                          Add & Ingest Repository
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* ── STEP 1: SELECT ──────────────────────────────── */}
                  {/* Tabs */}
                  <div className="flex border-b border-[var(--alpha-white-5)]">
                    <button
                      onClick={() => setTab("browse")}
                      className={`flex-1 px-4 py-3 text-sm font-mono transition-colors bg-transparent border-none cursor-pointer ${
                        tab === "browse"
                          ? "text-[var(--accent-green)] border-b-2 border-[var(--accent-green)]"
                          : "text-[var(--gray-400)] hover:text-[var(--gray-200)]"
                      }`}
                      style={{
                        borderBottom:
                          tab === "browse"
                            ? "2px solid var(--accent-green)"
                            : "2px solid transparent",
                      }}
                    >
                      My Repositories
                    </button>
                    <button
                      onClick={() => setTab("url")}
                      className={`flex-1 px-4 py-3 text-sm font-mono transition-colors bg-transparent border-none cursor-pointer ${
                        tab === "url"
                          ? "text-[var(--accent-green)]"
                          : "text-[var(--gray-400)] hover:text-[var(--gray-200)]"
                      }`}
                      style={{
                        borderBottom:
                          tab === "url"
                            ? "2px solid var(--accent-green)"
                            : "2px solid transparent",
                      }}
                    >
                      <span className="flex items-center justify-center gap-1.5">
                        <Link2 size={14} />
                        From URL
                      </span>
                    </button>
                  </div>

                  {/* Content */}
                  <div className="min-h-[400px] max-h-[60vh] flex flex-col">
                    {tab === "browse" ? (
                      <>
                        {/* Search */}
                        <div className="p-4 border-b border-[var(--alpha-white-5)]">
                          <div className="relative">
                            <Search
                              size={14}
                              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gray-500)]"
                            />
                            <input
                              value={search}
                              onChange={(e) => setSearch(e.target.value)}
                              placeholder="Search your repositories..."
                              className="w-full pl-9 pr-3 py-2.5 rounded-lg text-sm font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)] placeholder:text-[var(--gray-600)] focus:outline-none focus:border-[var(--accent-green)]/40 transition-colors"
                            />
                          </div>
                        </div>

                        {/* Repo list */}
                        <div className="flex-1 overflow-y-auto">
                          {loading ? (
                            <div className="flex flex-col items-center justify-center py-16 text-[var(--gray-500)]">
                              <Loader2
                                size={24}
                                className="animate-spin mb-3"
                              />
                              <span className="text-sm font-mono">
                                Loading your repos from GitHub...
                              </span>
                            </div>
                          ) : filteredRepos.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16 text-[var(--gray-500)]">
                              <span className="text-sm font-mono">
                                {search
                                  ? "No matching repositories"
                                  : "No more repositories to add"}
                              </span>
                            </div>
                          ) : (
                            <div className="divide-y divide-[var(--alpha-white-5)]">
                              {filteredRepos.map((repo) => (
                                <BrowseRepoItem
                                  key={repo.id}
                                  repo={repo}
                                  isAdding={addingRepo === repo.full_name}
                                  onAdd={() => handleSelectRepo(repo)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      /* URL Tab */
                      <div className="p-6 flex-1 flex flex-col">
                        <p className="font-mono text-xs text-[var(--gray-400)] mb-4 m-0">
                          Paste a GitHub repository URL or enter <code className="text-[var(--accent-green)]">owner/repo</code> format
                        </p>

                        <div className="flex gap-2 mb-4">
                          <div className="relative flex-1">
                            <Link2
                              size={14}
                              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gray-500)]"
                            />
                            <input
                              value={urlInput}
                              onChange={(e) => {
                                setUrlInput(e.target.value);
                                setLookupResult(null);
                                setLookupError(null);
                              }}
                              onKeyDown={(e) =>
                                e.key === "Enter" && handleLookup()
                              }
                              placeholder="https://github.com/owner/repo"
                              className="w-full pl-9 pr-3 py-2.5 rounded-lg text-sm font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)] placeholder:text-[var(--gray-600)] focus:outline-none focus:border-[var(--accent-green)]/40 transition-colors"
                            />
                          </div>
                          <button
                            onClick={handleLookup}
                            disabled={lookupLoading || !urlInput.trim()}
                            className="px-4 py-2.5 rounded-lg text-sm font-mono bg-[var(--accent-green)] text-black font-medium hover:opacity-90 transition-opacity cursor-pointer border-none disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                          >
                            {lookupLoading ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <ArrowRight size={14} />
                            )}
                            Lookup
                          </button>
                        </div>

                        {/* Access Token (collapsible) */}
                        <div className="mb-4">
                          <button
                            onClick={() => setShowTokenField(!showTokenField)}
                            className="flex items-center gap-1.5 text-xs font-mono text-[var(--gray-500)] hover:text-[var(--gray-300)] transition-colors bg-transparent border-none cursor-pointer p-0 mb-2"
                          >
                            <KeyRound size={12} />
                            {showTokenField ? "Hide" : "Add"} access token for private repos
                          </button>
                          {showTokenField && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                            >
                              <input
                                type="password"
                                value={accessTokenDisplay}
                                onChange={(e) => {
                                  accessTokenRef.current = e.target.value;
                                  setAccessTokenDisplay(e.target.value);
                                }}
                                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                                className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-[var(--surface-1)] border border-[var(--alpha-white-5)] text-[var(--gray-200)] placeholder:text-[var(--gray-600)] focus:outline-none focus:border-[var(--accent-green)]/40 transition-colors"
                              />
                              <p className="font-mono text-xs text-[var(--gray-600)] mt-1 m-0">
                                Personal Access Token with <code className="text-[var(--gray-400)]">repo</code> scope for private repos you have access to
                              </p>
                            </motion.div>
                          )}
                        </div>

                        {/* Lookup error */}
                        {lookupError && (
                          <motion.div
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-2 p-3 rounded-lg bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/20 mb-4"
                          >
                            <AlertCircle
                              size={14}
                              className="text-[var(--accent-red)] shrink-0"
                            />
                            <span className="font-mono text-xs text-[var(--accent-red)]">
                              {lookupError}
                            </span>
                          </motion.div>
                        )}

                        {/* Lookup result */}
                        {lookupResult && (
                          <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="p-4 rounded-xl border border-[var(--alpha-white-8)] bg-[var(--surface-1)]"
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-sm font-semibold text-[var(--gray-100)]">
                                    {lookupResult.full_name}
                                  </span>
                                  {lookupResult.private ? (
                                    <Lock
                                      size={12}
                                      className="text-[var(--gray-500)]"
                                    />
                                  ) : (
                                    <Globe
                                      size={12}
                                      className="text-[var(--gray-500)]"
                                    />
                                  )}
                                </div>
                                <p className="font-mono text-xs text-[var(--gray-400)] mt-1 m-0">
                                  {lookupResult.description || "No description"}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-4 mt-3 mb-4">
                              {lookupResult.language && (
                                <span className="flex items-center gap-1 text-xs font-mono text-[var(--gray-500)]">
                                  <span
                                    className="w-2 h-2 rounded-full"
                                    style={{
                                      backgroundColor:
                                        langColors[lookupResult.language] ||
                                        "var(--gray-500)",
                                    }}
                                  />
                                  {lookupResult.language}
                                </span>
                              )}
                              <span className="flex items-center gap-1 text-xs font-mono text-[var(--gray-500)]">
                                <Star size={10} className="text-yellow-400" />
                                {lookupResult.stargazers_count}
                              </span>
                              <span className="flex items-center gap-1 text-xs font-mono text-[var(--gray-500)]">
                                <GitFork size={10} />
                                {lookupResult.forks_count}
                              </span>
                            </div>

                            <button
                              onClick={() => handleSelectRepo(lookupResult)}
                              disabled={addingRepo === lookupResult.full_name}
                              className="w-full py-2.5 rounded-lg text-sm font-mono bg-[var(--accent-green)] text-black font-medium hover:opacity-90 transition-opacity cursor-pointer border-none disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                              <Settings2 size={14} />
                              Configure & Add
                            </button>
                          </motion.div>
                        )}

                        {/* Empty illustration */}
                        {!lookupResult && !lookupError && (
                          <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
                            <div className="w-16 h-16 rounded-2xl bg-[var(--surface-2)] border border-[var(--alpha-white-5)] flex items-center justify-center mb-4">
                              <Link2
                                size={24}
                                className="text-[var(--gray-600)]"
                              />
                            </div>
                            <p className="font-mono text-xs text-[var(--gray-500)] max-w-[280px]">
                              Enter a repository URL above to look it up and add it
                              to your workspace
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Footer hint (only on step 1) */}
              {step === "select" && !apiKey && (
                <div className="px-6 py-3 border-t border-[var(--alpha-white-5)] bg-[var(--accent-amber)]/5">
                  <p className="font-mono text-xs text-[var(--accent-amber)] m-0">
                    ⚠ Set your Google AI API key first to auto-ingest repos on
                    add
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function BrowseRepoItem({
  repo,
  isAdding,
  onAdd,
}: {
  repo: GitHubRepoPreview;
  isAdding: boolean;
  onAdd: () => void;
}) {
  const langColor = langColors[repo.language || ""] || "var(--gray-500)";

  return (
    <div className="flex items-center gap-3 px-4 py-3.5 hover:bg-[var(--alpha-white-5)] transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-[var(--gray-100)] truncate">
            {repo.full_name}
          </span>
          {repo.private ? (
            <Lock size={11} className="text-[var(--gray-600)] shrink-0" />
          ) : (
            <Globe size={11} className="text-[var(--gray-600)] shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-3 mt-1">
          {repo.language && (
            <span className="flex items-center gap-1 text-xs font-mono text-[var(--gray-500)]">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: langColor }}
              />
              {repo.language}
            </span>
          )}
          <span className="flex items-center gap-1 text-xs font-mono text-[var(--gray-500)]">
            <Star size={10} className="text-yellow-400" />
            {repo.stargazers_count}
          </span>
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onAdd();
        }}
        disabled={isAdding}
        className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-mono bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20 hover:bg-[var(--accent-green)]/20 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
      >
        {isAdding ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            Adding...
          </>
        ) : (
          <>
            <Plus size={12} />
            Add
          </>
        )}
      </button>
    </div>
  );
}
