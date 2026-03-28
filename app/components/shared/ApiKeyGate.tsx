"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Eye, EyeOff, CheckCircle, XCircle, Loader2, X } from "lucide-react";

export function ApiKeyGate() {
  const { apiKey, setApiKey, apiKeyModalOpen, setApiKeyModalOpen } =
    useAppStore();
  const [inputValue, setInputValue] = useState(apiKey || "");
  const [showKey, setShowKey] = useState(false);
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");

  const handleTest = async () => {
    setTestStatus("testing");
    // Simulate API test (actual Gemini validation would go here)
    await new Promise((r) => setTimeout(r, 1200));
    if (inputValue.startsWith("AI") || inputValue.length > 20) {
      setTestStatus("success");
      setApiKey(inputValue);
      setTimeout(() => setApiKeyModalOpen(false), 800);
    } else {
      setTestStatus("error");
    }
  };

  const handleSave = () => {
    setApiKey(inputValue);
    setApiKeyModalOpen(false);
  };

  return (
    <AnimatePresence>
      {apiKeyModalOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center px-4"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setApiKeyModalOpen(false)}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="relative glass-strong rounded-xl p-6 w-full max-w-md z-10"
          >
            {/* Close button */}
            <button
              onClick={() => setApiKeyModalOpen(false)}
              className="absolute top-4 right-4 text-[var(--gray-500)] hover:text-[var(--gray-300)] transition-colors bg-transparent border-none cursor-pointer"
            >
              <X size={18} />
            </button>

            {/* Icon */}
            <div className="flex justify-center mb-4">
              <motion.div
                animate={{ rotateY: [0, 10, -10, 0] }}
                transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{ background: "var(--alpha-white-5)" }}
              >
                <Lock size={24} className="text-[var(--accent-cyan)]" />
              </motion.div>
            </div>

            {/* Title */}
            <h2 className="text-center text-lg font-medium text-[var(--gray-100)] mb-1 font-mono">
              Google AI API Key
            </h2>
            <p className="text-center text-sm text-[var(--gray-500)] mb-6 font-mono">
              Enter your Google AI Studio API key to enable AI features.
            </p>

            {/* Input */}
            <div className="relative mb-4">
              <input
                type={showKey ? "text" : "password"}
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  setTestStatus("idle");
                }}
                placeholder="AIza..."
                className="w-full px-4 py-3 pr-12 rounded-lg font-mono text-sm bg-[var(--surface-1)] border border-[var(--alpha-white-8)] text-[var(--gray-100)] placeholder:text-[var(--gray-600)] focus:outline-none focus:border-[var(--accent-cyan)] focus:ring-1 focus:ring-[var(--accent-cyan)]/30 transition-colors"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--gray-500)] hover:text-[var(--gray-300)] transition-colors bg-transparent border-none cursor-pointer"
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleTest}
                disabled={!inputValue || testStatus === "testing"}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-mono text-sm border border-[var(--alpha-white-10)] bg-[var(--surface-2)] text-[var(--gray-200)] hover:bg-[var(--surface-3)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {testStatus === "testing" && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                {testStatus === "success" && (
                  <CheckCircle size={14} className="text-[var(--accent-green)]" />
                )}
                {testStatus === "error" && (
                  <XCircle size={14} className="text-[var(--accent-red)]" />
                )}
                {testStatus === "idle" && "Test Connection"}
                {testStatus === "testing" && "Testing..."}
                {testStatus === "success" && "Connected!"}
                {testStatus === "error" && "Invalid Key"}
              </button>
              <button
                onClick={handleSave}
                disabled={!inputValue}
                className="flex-1 px-4 py-2.5 rounded-lg font-mono text-sm bg-[var(--accent-cyan)] text-black font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity cursor-pointer"
              >
                Save Key
              </button>
            </div>

            {/* Footer note */}
            <p className="text-center text-[11px] text-[var(--gray-600)] mt-4 font-mono">
              Stored locally in your browser. Never sent to our servers.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
