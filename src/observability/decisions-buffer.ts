export interface DecisionRecord {
  timestamp: string;
  clientId: number | null;
  clientName: string | null;
  route: string;
  policyId: number | null;
  reason: string;
  allowed: boolean;
  latencyMs: number;
  algorithm: string | null;
  degraded: boolean;
  shadow: boolean;
  cost: number;
}

export class DecisionsBuffer {
  private buffer: DecisionRecord[];
  private head: number;
  private count: number;
  private readonly capacity: number;

  constructor(capacity: number = 200) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.head = 0;
    this.count = 0;
  }

  push(record: DecisionRecord): void {
    this.buffer[this.head] = record;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  getAll(): DecisionRecord[] {
    if (this.count === 0) return [];
    const result: DecisionRecord[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      result.push(this.buffer[idx]);
    }
    // Return newest first
    return result.reverse();
  }

  size(): number {
    return this.count;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
  }
}

// Singleton instance
let instance: DecisionsBuffer | null = null;

export function getDecisionsBuffer(): DecisionsBuffer {
  if (!instance) {
    instance = new DecisionsBuffer(200);
  }
  return instance;
}
