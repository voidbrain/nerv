/** Versioned contracts only. Remote execution is not implemented in 0.1. */
export type Capability = 'model.infer' | 'code.run' | 'device.print' | 'voice.transcribe' | 'voice.speak';
export interface NodeAdvertisement {
  protocol: 1; id: string; name: string; capabilities: Capability[];
  models: {id:string; contextTokens:number; tools:boolean; structuredOutput:boolean}[];
  resources: {maxConcurrency:number; availableMemoryBytes:number};
}
export interface Job {
  id:string; idempotencyKey:string; capability:Capability; input:unknown;
  privacy:'local-only'|'cloud-allowed'; deadline:string; resourceLocks:string[];
}
export interface Lease {jobId:string; nodeId:string; token:string; expiresAt:string; fencingToken:number}
export interface AgentTask {id:string; parentId?:string; modelEndpoint:string; executionNode:string; allowedTools:string[]; maxSteps:number; maxCost:number}
export type Surface = {version:1; component:'reminder-list'|'doctor-report'|'node-list'; data:unknown};
