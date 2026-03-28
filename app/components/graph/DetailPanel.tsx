"use client";

import { X, FileCode, ArrowRight, ExternalLink } from "lucide-react";
import { useGraphStore } from "@/lib/store/graph-store";
import {
  ARCH_TYPE_COLORS,
  ARCH_TYPE_LABELS,
  ARCH_CONNECTION_LABELS,
  type ArchComponent,
  type ArchConnection,
} from "@/types/architecture";

export function DetailPanel() {
  const { selectedElement, setSelectedElement, architectureData } = useGraphStore();

  if (!selectedElement || !architectureData) return null;

  const close = () => setSelectedElement(null);

  if (selectedElement.type === "node") {
    // Find the component (check top-level and children)
    let component: ArchComponent | null = null;
    for (const comp of architectureData.components) {
      if (comp.id === selectedElement.id) {
        component = comp;
        break;
      }
      if (comp.children) {
        const child = comp.children.find((c) => c.id === selectedElement.id);
        if (child) {
          component = child;
          break;
        }
      }
    }

    if (!component) return null;

    const color = ARCH_TYPE_COLORS[component.type] || "#8B949E";

    // Find connections involving this component
    const incoming = architectureData.connections.filter((c) => c.target === component!.id);
    const outgoing = architectureData.connections.filter((c) => c.source === component!.id);

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

          {/* Connections */}
          {(incoming.length > 0 || outgoing.length > 0) && (
            <div className="detail-panel__section">
              <h4 className="detail-panel__section-title">Connections</h4>
              {incoming.map((conn) => (
                <div key={conn.id} className="detail-panel__connection">
                  <span className="detail-panel__connection-label">
                    ← {conn.label}
                  </span>
                  <span className="detail-panel__connection-from">
                    from {architectureData.components.find((c) => c.id === conn.source)?.label || conn.source}
                  </span>
                </div>
              ))}
              {outgoing.map((conn) => (
                <div key={conn.id} className="detail-panel__connection">
                  <span className="detail-panel__connection-label">
                    → {conn.label}
                  </span>
                  <span className="detail-panel__connection-from">
                    to {architectureData.components.find((c) => c.id === conn.target)?.label || conn.target}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Files */}
          {component.files.length > 0 && (
            <div className="detail-panel__section">
              <h4 className="detail-panel__section-title">
                Files ({component.files.length})
              </h4>
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

          {/* Children */}
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

  // Edge selected
  if (selectedElement.type === "edge") {
    const connection = architectureData.connections.find((c) => c.id === selectedElement.id);
    if (!connection) return null;

    const sourceComp = architectureData.components.find((c) => c.id === connection.source);
    const targetComp = architectureData.components.find((c) => c.id === connection.target);

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
