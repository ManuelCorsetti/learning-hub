import { useMemo } from 'react'
import { Graph, layout } from '@dagrejs/dagre'
import { Background, Controls, MarkerType, Position, ReactFlow, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { GraphData, GraphEdge, GraphNode } from '../../../shared/api'
import { useApi } from '../api'

const NODE_W = 190
const NODE_H = 56
const GRID_COLUMNS = 4
const GAP = 28

const STATUS_STYLE = {
  solid: { background: '#25463d', color: '#fbfaf7', borderColor: '#25463d' },
  learning: { background: '#d47748', color: '#ffffff', borderColor: '#d47748' },
  backlog: { background: '#ffffff', color: '#1c2523', borderColor: '#cbc6ba' },
} as const

function nodeStyle(n: GraphNode): React.CSSProperties {
  const base: React.CSSProperties = {
    width: NODE_W,
    borderRadius: 4,
    borderWidth: 1,
    borderStyle: 'solid',
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 13,
    padding: '8px 10px',
  }
  if (n.kind === 'goal') {
    return { ...base, borderRadius: 999, borderStyle: 'dashed', borderColor: '#d47748', background: '#fbf1ea', color: '#a9542b' }
  }
  return { ...base, ...STATUS_STYLE[n.status ?? 'backlog'], ...(n.external ? { opacity: 0.55, borderStyle: 'dashed' } : {}) }
}

function edgeStyle(e: GraphEdge): Partial<Edge> {
  switch (e.kind) {
    case 'prerequisite_of':
      return { style: { stroke: '#1c2523', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#1c2523' } }
    case 'related_to':
      return { type: 'straight', style: { stroke: '#5a8d9f', strokeDasharray: '6 4' } }
    case 'part_of':
      return { style: { stroke: '#8582a6', strokeDasharray: '2 3' }, markerEnd: { type: MarkerType.Arrow, color: '#8582a6' } }
    case 'serves_goal':
      return { style: { stroke: '#d47748' }, markerEnd: { type: MarkerType.Arrow, color: '#d47748' } }
  }
}

/**
 * Lays out prerequisite, part-of and goal links left to right with dagre.
 * Topics without such links go in a grid underneath, so they don't form one tall column.
 */
function toFlow(data: GraphData): { nodes: Node[]; edges: Edge[] } {
  const layoutEdges = data.edges.filter((e) => e.kind !== 'related_to')
  const linked = new Set(layoutEdges.flatMap((e) => [e.source, e.target]))
  const positions = new Map<string, { x: number; y: number }>()
  let height = 0

  if (linked.size) {
    const g = new Graph()
    g.setGraph({ rankdir: 'LR', nodesep: GAP, ranksep: 80, marginx: 0, marginy: 0 })
    g.setDefaultEdgeLabel(() => ({}))
    for (const id of linked) g.setNode(id, { width: NODE_W, height: NODE_H })
    for (const e of layoutEdges) g.setEdge(e.source, e.target)
    layout(g)
    for (const id of linked) {
      const { x, y } = g.node(id)
      positions.set(id, { x: x - NODE_W / 2, y: y - NODE_H / 2 })
      height = Math.max(height, y + NODE_H / 2)
    }
  }
  const top = linked.size ? height + GAP * 2 : 0
  data.nodes
    .filter((n) => !linked.has(n.id))
    .forEach((n, i) => {
      positions.set(n.id, {
        x: (i % GRID_COLUMNS) * (NODE_W + GAP),
        y: top + Math.floor(i / GRID_COLUMNS) * (NODE_H + GAP),
      })
    })

  const nodes: Node[] = data.nodes.map((n) => {
    return {
      id: n.id,
      position: positions.get(n.id)!,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: { label: n.external && n.areaName ? `${n.label} · ${n.areaName}` : n.label },
      style: nodeStyle(n),
      draggable: true,
      connectable: false,
    }
  })
  const edges: Edge[] = data.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...edgeStyle(e) }))
  return { nodes, edges }
}

export function TopicGraph({ areaId, onOpen }: { areaId: string; onOpen: (topicId: string) => void }) {
  const { data, error } = useApi<GraphData>(`/areas/${areaId}/graph`)
  const flow = useMemo(() => (data ? toFlow(data) : null), [data])

  if (error) return <p className="error">{error}</p>
  if (!flow) return <p className="muted">Loading graph…</p>
  if (!flow.nodes.length) return <p className="empty">No topics to draw yet.</p>

  const kindOf = new Map(data!.nodes.map((n) => [n.id, n.kind]))
  return (
    <>
      <div className="graph-wrap">
        <ReactFlow
          nodes={flow.nodes}
          edges={flow.edges}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => kindOf.get(node.id) === 'topic' && onOpen(node.id)}
        >
          <Background gap={24} color="#e9e6df" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="graph-legend">
        <span>
          <i /> prerequisite of
        </span>
        <span>
          <i className="lg-related" /> related to
        </span>
        <span>
          <i className="lg-part" /> part of
        </span>
        <span>
          <i className="lg-goal" /> serves goal
        </span>
        <span>Fill: dark = solid, orange = learning, white = backlog. Dashed = another area.</span>
      </div>
    </>
  )
}
