export interface BaseLinkMetrics {
  readonly peerId: string;
  readonly bytesSent: number;
  readonly bytesReceived: number;
  readonly inFlight: number;
  readonly reconnects: number;
  readonly lastLatencyMs: number | null;
  readonly avgLatencyMs: number | null;
  readonly maxLatencyMs: number | null;
  readonly samples: number;
  readonly updatedAt: string | null;
}

interface MutableLinkMetrics {
  bytesSent: number;
  bytesReceived: number;
  inFlight: number;
  reconnects: number;
  lastLatencyMs: number | null;
  totalLatencyMs: number;
  maxLatencyMs: number | null;
  samples: number;
  updatedAt: string | null;
}

/**
 * Per-peer link load counters (F-103-T02): tracks round-trip latency, bytes each way,
 * in-flight calls, and reconnects without storing any message content.
 */
export class LinkLoadTracker {
  private readonly peers = new Map<string, MutableLinkMetrics>();

  private entry(peerId: string): MutableLinkMetrics {
    let m = this.peers.get(peerId);
    if (!m) {
      m = {
        bytesSent: 0,
        bytesReceived: 0,
        inFlight: 0,
        reconnects: 0,
        lastLatencyMs: null,
        totalLatencyMs: 0,
        maxLatencyMs: null,
        samples: 0,
        updatedAt: null,
      };
      this.peers.set(peerId, m);
    }
    return m;
  }

  /** Marks an outbound call in flight and records sent bytes; returns an idempotent finish callback. */
  trackOutboundStart(peerId: string, bytesOut: number): (bytesIn?: number) => void {
    const m = this.entry(peerId);
    m.inFlight += 1;
    m.bytesSent += Math.max(0, bytesOut);
    m.updatedAt = new Date().toISOString();
    const startedAt = performance.now();
    let settled = false;
    return (bytesIn = 0) => {
      if (settled) return;
      settled = true;
      m.inFlight = Math.max(0, m.inFlight - 1);
      m.bytesReceived += Math.max(0, bytesIn);
      const latencyMs = Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
      m.lastLatencyMs = latencyMs;
      m.totalLatencyMs += latencyMs;
      m.samples += 1;
      m.maxLatencyMs = m.maxLatencyMs === null ? latencyMs : Math.max(m.maxLatencyMs, latencyMs);
      m.updatedAt = new Date().toISOString();
    };
  }

  /** Marks an in-flight RPC call without double-counting frame bytes; returns an idempotent finish callback. */
  incInFlight(peerId: string): () => void {
    return this.trackOutboundStart(peerId, 0);
  }

  /** Records inbound request and outbound reply bytes for a verified peer. */
  recordInbound(peerId: string, bytesIn: number, bytesOut: number): void {
    const m = this.entry(peerId);
    m.bytesReceived += Math.max(0, bytesIn);
    m.bytesSent += Math.max(0, bytesOut);
    m.updatedAt = new Date().toISOString();
  }

  /** Records raw transport frame bytes each way for a peer. */
  recordBytes(peerId: string, bytesOut: number, bytesIn: number): void {
    const m = this.entry(peerId);
    m.bytesSent += Math.max(0, bytesOut);
    m.bytesReceived += Math.max(0, bytesIn);
    m.updatedAt = new Date().toISOString();
  }

  /** Records a reconnect attempt/transition for a peer. */
  recordReconnect(peerId: string): void {
    const m = this.entry(peerId);
    m.reconnects += 1;
    m.updatedAt = new Date().toISOString();
  }

  get(peerId: string): BaseLinkMetrics | undefined {
    const m = this.peers.get(peerId);
    if (!m) return undefined;
    return {
      peerId,
      bytesSent: m.bytesSent,
      bytesReceived: m.bytesReceived,
      inFlight: m.inFlight,
      reconnects: m.reconnects,
      lastLatencyMs: m.lastLatencyMs,
      avgLatencyMs: m.samples > 0 ? Math.round((m.totalLatencyMs / m.samples) * 100) / 100 : null,
      maxLatencyMs: m.maxLatencyMs,
      samples: m.samples,
      updatedAt: m.updatedAt,
    };
  }

  snapshot(): BaseLinkMetrics[] {
    return [...this.peers.keys()]
      .sort()
      .map((id) => this.get(id)!)
      .filter(Boolean);
  }
}
