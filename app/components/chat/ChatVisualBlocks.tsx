"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  GitCommit,
  Network,
  Route,
  Sparkles,
} from "lucide-react";
import {
  parseChatVisualPayload,
  type ChatArchitectureVisualPayload,
  type ChatMermaidVisualPayload,
  type ChatTimelineVisualPayload,
  type ChatVisualKind,
} from "@/types/chat-visuals";
import {
  ARCH_CONNECTION_LABELS,
  ARCH_TYPE_COLORS,
  ARCH_TYPE_LABELS,
} from "@/types/architecture";

function VisualFallback({
  title,
  message,
  raw,
}: {
  title: string;
  message: string;
  raw: string;
}) {
  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-[var(--alpha-white-8)] bg-[var(--surface-0)]">
      <div className="border-b border-[var(--alpha-white-8)] bg-[var(--alpha-white-5)] px-4 py-3">
        <div className="font-mono text-xs uppercase tracking-[0.14em] text-[var(--gray-500)]">
          {title}
        </div>
        <p className="mb-0 mt-2 font-mono text-xs leading-relaxed text-[var(--accent-red)]">
          {message}
        </p>
      </div>
      <pre className="m-0 overflow-x-auto px-4 py-4 font-mono text-xs text-[var(--gray-300)]">
        <code>{raw}</code>
      </pre>
    </div>
  );
}

function TimelineBlock({
  payload,
}: {
  payload: ChatTimelineVisualPayload;
}) {
  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-[var(--alpha-white-8)] bg-[linear-gradient(180deg,rgba(63,185,80,0.08),rgba(10,14,18,0.95))]">
      <div className="border-b border-[var(--alpha-white-8)] px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--accent-green)]/25 bg-[var(--accent-green)]/10">
            <CalendarDays size={15} className="text-[var(--accent-green)]" />
          </div>
          <div>
            <div className="font-mono text-sm text-[var(--gray-100)]">
              {payload.title}
            </div>
            <p className="mb-0 mt-1 font-mono text-xs leading-relaxed text-[var(--gray-400)]">
              {payload.summary}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        {payload.events.map((event, index) => (
          <div key={event.sha} className="relative pl-8">
            {index < payload.events.length - 1 && (
              <div className="absolute left-[11px] top-6 h-[calc(100%+0.5rem)] w-px bg-[var(--alpha-white-8)]" />
            )}
            <div
              className={`absolute left-0 top-1 h-[22px] w-[22px] rounded-full border ${
                event.matched
                  ? "border-[var(--accent-green)]/45 bg-[var(--accent-green)]/12"
                  : "border-[var(--alpha-white-10)] bg-[var(--surface-2)]"
              }`}
            />
            <div className="rounded-xl border border-[var(--alpha-white-8)] bg-[var(--surface-1)] px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--gray-500)]">
                <span className="inline-flex items-center gap-1 rounded bg-[var(--alpha-white-5)] px-2 py-1">
                  <GitCommit size={10} />
                  {event.sha.slice(0, 7)}
                </span>
                <span>{event.date}</span>
                <span>{event.author}</span>
                {event.similarity !== null && (
                  <span className="text-[var(--accent-green)]">
                    {Math.round(event.similarity * 100)}% match
                  </span>
                )}
              </div>
              <div className="mt-2 font-mono text-sm text-[var(--gray-100)]">
                {event.summary}
              </div>
              <p className="mb-0 mt-2 font-mono text-xs leading-relaxed text-[var(--gray-400)]">
                {event.message}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ArchitectureBlock({
  payload,
}: {
  payload: ChatArchitectureVisualPayload;
}) {
  const nodeMap = new Map(payload.nodes.map((node) => [node.id, node]));
  const pathNodes = payload.pathNodeIds
    .map((nodeId) => nodeMap.get(nodeId))
    .filter((node): node is NonNullable<typeof node> => !!node);
  const hasPath = pathNodes.length > 1;

  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-[var(--alpha-white-8)] bg-[linear-gradient(180deg,rgba(88,166,255,0.10),rgba(8,12,18,0.96))]">
      <div className="border-b border-[var(--alpha-white-8)] px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-sky-400/25 bg-sky-400/10">
            <Network size={15} className="text-sky-300" />
          </div>
          <div>
            <div className="font-mono text-sm text-[var(--gray-100)]">
              {payload.title}
            </div>
            <p className="mb-0 mt-1 font-mono text-xs leading-relaxed text-[var(--gray-400)]">
              {payload.summary}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--gray-500)]">
          <span className="rounded bg-[var(--alpha-white-5)] px-2 py-1">
            {payload.layerId} layer
          </span>
          {payload.traceLabel && (
            <span className="inline-flex items-center gap-1 rounded bg-sky-400/10 px-2 py-1 text-sky-300">
              <Route size={10} />
              {payload.traceLabel}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        {hasPath ? (
          <div className="overflow-x-auto">
            <div className="flex min-w-max items-stretch gap-3 pb-1">
              {pathNodes.map((node, index) => {
                const color = ARCH_TYPE_COLORS[node.type];
                return (
                  <div key={node.id} className="flex items-center gap-3">
                    <div
                      className="w-56 rounded-xl border px-4 py-3"
                      style={{
                        borderColor: `${color}45`,
                        background: "rgba(10, 14, 18, 0.92)",
                        boxShadow: `0 0 0 1px ${color}20 inset`,
                      }}
                    >
                      <div className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--gray-500)]">
                        {ARCH_TYPE_LABELS[node.type]}
                      </div>
                      <div className="mt-2 font-mono text-sm text-[var(--gray-100)]">
                        {node.label}
                      </div>
                      <p className="mb-0 mt-2 font-mono text-xs leading-relaxed text-[var(--gray-400)]">
                        {node.description}
                      </p>
                    </div>
                    {index < pathNodes.length - 1 && (
                      <ArrowRight size={16} className="shrink-0 text-sky-300" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {payload.nodes.map((node) => {
              const color = ARCH_TYPE_COLORS[node.type];
              return (
                <div
                  key={node.id}
                  className="rounded-xl border px-4 py-3"
                  style={{
                    borderColor: `${color}45`,
                    background: "rgba(10, 14, 18, 0.92)",
                    boxShadow: `0 0 0 1px ${color}20 inset`,
                  }}
                >
                  <div className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--gray-500)]">
                    {ARCH_TYPE_LABELS[node.type]}
                  </div>
                  <div className="mt-2 font-mono text-sm text-[var(--gray-100)]">
                    {node.label}
                  </div>
                  <p className="mb-0 mt-2 font-mono text-xs leading-relaxed text-[var(--gray-400)]">
                    {node.description}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {payload.edges.length > 0 && (
          <div className="space-y-2">
            <div className="font-mono text-xs uppercase tracking-[0.14em] text-[var(--gray-500)]">
              Connections
            </div>
            {payload.edges.map((edge) => {
              const source = nodeMap.get(edge.source)?.label || edge.source;
              const target = nodeMap.get(edge.target)?.label || edge.target;

              return (
                <div
                  key={edge.id}
                  className="rounded-xl border border-[var(--alpha-white-8)] bg-[var(--surface-1)] px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-[var(--gray-300)]">
                    <span>{source}</span>
                    <ArrowRight size={12} className="text-sky-300" />
                    <span>{target}</span>
                    <span className="rounded bg-[var(--alpha-white-5)] px-2 py-0.5 text-[11px] uppercase tracking-[0.1em] text-[var(--gray-500)]">
                      {ARCH_CONNECTION_LABELS[edge.type]}
                    </span>
                  </div>
                  <p className="mb-0 mt-2 font-mono text-xs leading-relaxed text-[var(--gray-400)]">
                    {edge.description || edge.label}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MermaidBlock({
  payload,
}: {
  payload: ChatMermaidVisualPayload;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      setIsLoading(true);
      setError(null);

      try {
        const mermaidModule = await import("mermaid");
        const mermaid = mermaidModule.default;

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            primaryColor: "#10261a",
            primaryBorderColor: "#3fb950",
            primaryTextColor: "#e6edf3",
            lineColor: "#58a6ff",
            secondaryColor: "#0f1722",
            tertiaryColor: "#081018",
            fontFamily: "var(--font-mono), ui-monospace, monospace",
          },
        });

        await mermaid.parse(payload.diagram);
        const renderId = `kontext-mermaid-${Math.random().toString(36).slice(2, 10)}`;
        const { svg, bindFunctions } = await mermaid.render(
          renderId,
          payload.diagram
        );

        if (cancelled) return;

        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          bindFunctions?.(containerRef.current);
        }

        setIsLoading(false);
      } catch (cause) {
        if (cancelled) return;

        const message =
          cause instanceof Error ? cause.message : "Unable to render Mermaid diagram.";
        setError(message);
        setIsLoading(false);
      }
    }

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [payload.diagram]);

  if (error) {
    return (
      <VisualFallback
        title={payload.title}
        message={`Mermaid validation failed: ${error}`}
        raw={payload.diagram}
      />
    );
  }

  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-[var(--alpha-white-8)] bg-[linear-gradient(180deg,rgba(188,140,255,0.10),rgba(8,10,18,0.96))]">
      <div className="border-b border-[var(--alpha-white-8)] px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-400/10">
            <Sparkles size={15} className="text-violet-300" />
          </div>
          <div>
            <div className="font-mono text-sm text-[var(--gray-100)]">
              {payload.title}
            </div>
            <p className="mb-0 mt-1 font-mono text-xs leading-relaxed text-[var(--gray-400)]">
              {payload.description}
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 py-4">
        {isLoading && (
          <div className="rounded-xl border border-[var(--alpha-white-8)] bg-[var(--surface-1)] px-4 py-6 text-center font-mono text-xs text-[var(--gray-400)]">
            Rendering Mermaid diagram...
          </div>
        )}
        <div
          ref={containerRef}
          className={`overflow-x-auto rounded-xl bg-white/95 p-4 ${
            isLoading ? "hidden" : "block"
          }`}
        />
      </div>
    </div>
  );
}

export function ChatVisualBlock({
  language,
  codeString,
}: {
  language: ChatVisualKind;
  codeString: string;
}) {
  const payload = parseChatVisualPayload(codeString, language);

  if (!payload) {
    return (
      <VisualFallback
        title="Inline visual"
        message={`Unable to parse the ${language} payload, so the raw block is shown instead.`}
        raw={codeString}
      />
    );
  }

  if (payload.kind === "kontext-timeline") {
    return <TimelineBlock payload={payload} />;
  }

  if (payload.kind === "kontext-architecture") {
    return <ArchitectureBlock payload={payload} />;
  }

  return <MermaidBlock payload={payload} />;
}
