"use client";

import { X, FileCode, ArrowRight, ExternalLink } from "lucide-react";
import { useGraphStore } from "@/lib/store/graph-store";
import {
  ARCH_TYPE_COLORS,
  ARCH_TYPE_LABELS,
  ARCH_CONNECTION_LABELS,
  findArchitectureComponent,
} from "@/types/architecture";

export function DetailPanel() {
  const { selectedElement, setSelectedElement, architectureData } = useGraphStore();

  if (!selectedElement || !architectureData) return null;

  const close = () => setSelectedElement(null);

  if (selectedElement.type === "node") {
    const component = findArchitectureComponent(architectureData, selectedElement.id);
    if (!component) return null;

    const color = ARCH_TYPE_COLORS[component.type] || "#8B949E";
    const incoming = architectureData.connections.filter((connection) => connection.target === component.id);
    const outgoing = architectureData.connections.filter((connection) => connection.source === component.id);

    return (
      <div className="detail-panel">
        <div className="detail-panel__header">
          <div className="detail-panel__title-row">
            <span
              className="detail-panel__type-badge"
              style={{ background: `${color}20`, color, borderColor: `${color}40` }}
            >
              {ARCH_TYPE_LABELS[component.type] || component.type}
            </span>
            <h3 className="detail-panel__title">{component.label}</h3>
          </div>
          <button onClick={close} className="detail-panel__close">
            <X size={16} />
          </button>
        </div>

        <div className="detail-panel__body">
          <p className="detail-panel__description">{component.description}</p>

          {(incoming.length > 0 || outgoing.length > 0) && (
            <div className="detail-panel__section">
              <h4 className="detail-panel__section-title">Connections</h4>
              {incoming.map((connection) => (
                <div key={connection.id} className="detail-panel__connection">
                  <span className="detail-panel__connection-label">← {connection.label}</span>
                  <span className="detail-panel__connection-from">
                    from {architectureData.components.find((entry) => entry.id === connection.source)?.label || connection.source}
                  </span>
                </div>
              ))}
              {outgoing.map((connection) => (
                <div key={connection.id} className="detail-panel__connection">
                  <span className="detail-panel__connection-label">→ {connection.label}</span>
                  <span className="detail-panel__connection-from">
                    to {architectureData.components.find((entry) => entry.id === connection.target)?.label || connection.target}
                  </span>
                </div>
              ))}
            </div>
          )}

          {component.files.length > 0 && (
            <div className="detail-panel__section">
              <h4 className="detail-panel__section-title">Files ({component.files.length})</h4>
              <div className="detail-panel__file-list">
                {component.files.map((file) => (
                  <div key={file} className="detail-panel__file">
                    <FileCode size={12} className="detail-panel__file-icon" />
                    <span className="detail-panel__file-path">{file}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {component.children && component.children.length > 0 && (
            <div className="detail-panel__section">
              <h4 className="detail-panel__section-title">
                Sub-components ({component.children.length})
              </h4>
              {component.children.map((child) => {
                const childColor = ARCH_TYPE_COLORS[child.type] || "#8B949E";
                return (
                  <button
                    key={child.id}
                    className="detail-panel__child"
                    onClick={() => setSelectedElement({ type: "node", id: child.id })}
                  >
                    <span
                      className="detail-panel__child-dot"
                      style={{ background: childColor }}
                    />
                    <span className="detail-panel__child-label">{child.label}</span>
                    <ArrowRight size={12} className="detail-panel__child-arrow" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (selectedElement.type === "edge") {
    const connection = architectureData.connections.find((entry) => entry.id === selectedElement.id);
    if (!connection) return null;

    const sourceComp = architectureData.components.find((entry) => entry.id === connection.source);
    const targetComp = architectureData.components.find((entry) => entry.id === connection.target);

    return (
      <div className="detail-panel">
        <div className="detail-panel__header">
          <div className="detail-panel__title-row">
            <span className="detail-panel__type-badge detail-panel__type-badge--edge">
              {ARCH_CONNECTION_LABELS[connection.type] || connection.type}
            </span>
            <h3 className="detail-panel__title">{connection.label}</h3>
          </div>
          <button onClick={close} className="detail-panel__close">
            <X size={16} />
          </button>
        </div>

        <div className="detail-panel__body">
          <div className="detail-panel__flow">
            <span className="detail-panel__flow-node">{sourceComp?.label || connection.source}</span>
            <ExternalLink size={14} className="detail-panel__flow-arrow" />
            <span className="detail-panel__flow-node">{targetComp?.label || connection.target}</span>
          </div>

          <p className="detail-panel__description">{connection.description}</p>
        </div>
      </div>
    );
  }

  return null;
}
