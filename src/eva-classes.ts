import { WORKER_RESULT_BYTES } from './worker-jobs.ts';
import { pilotExecutor, stageExecutor, type EvaClass, type Stage } from './pilots.ts';
import { stricter, type Effect, type Trust } from './policy.ts';

export interface EvaFilesystemSpec {
  readonly mode: 'ephemeral-ro-inputs' | 'ephemeral-workspace' | 'scoped-workspace' | 'granted-workspace';
  readonly allowNervState: false;
  readonly allowHostHome: false;
  readonly allowGraderWrite: false;
}

export interface EvaNetworkSpec {
  readonly mode: 'deny' | 'grant-allowlist' | 'grant';
  readonly allowLoopbackAdmin: false;
  readonly allowMetadata: false;
}

export interface EvaCredentialSpec {
  readonly mode: 'none' | 'scoped-proxy' | 'grant';
  readonly ambientEnv: false;
  readonly keychainAccess: false;
}

export interface EvaResourceSpec {
  readonly maxCpuSeconds: number;
  readonly maxMemoryMb: number;
  readonly maxProcesses: number;
  readonly maxOutputBytes: number;
  readonly maxWallMs: number;
}

export interface EvaClassSpec {
  readonly id: EvaClass;
  readonly rank: 0 | 1 | 2 | 3;
  readonly label: string;
  readonly quarantine: boolean;
  readonly allowsExternalEffects: boolean;
  readonly filesystem: EvaFilesystemSpec;
  readonly network: EvaNetworkSpec;
  readonly credentials: EvaCredentialSpec;
  readonly resources: EvaResourceSpec;
}

export const EVA_CLASS_SPECS: Readonly<Record<EvaClass, EvaClassSpec>> = {
  'eva-03': {
    id: 'eva-03',
    rank: 0,
    label: 'Quarantine (untrusted input)',
    quarantine: true,
    allowsExternalEffects: false,
    filesystem: {
      mode: 'ephemeral-ro-inputs',
      allowNervState: false,
      allowHostHome: false,
      allowGraderWrite: false,
    },
    network: {
      mode: 'deny',
      allowLoopbackAdmin: false,
      allowMetadata: false,
    },
    credentials: {
      mode: 'none',
      ambientEnv: false,
      keychainAccess: false,
    },
    resources: {
      maxCpuSeconds: 30,
      maxMemoryMb: 256,
      maxProcesses: 8,
      maxOutputBytes: WORKER_RESULT_BYTES,
      maxWallMs: 30_000,
    },
  },
  'eva-00': {
    id: 'eva-00',
    rank: 1,
    label: 'Shadow (no external effects)',
    quarantine: false,
    allowsExternalEffects: false,
    filesystem: {
      mode: 'ephemeral-workspace',
      allowNervState: false,
      allowHostHome: false,
      allowGraderWrite: false,
    },
    network: {
      mode: 'deny',
      allowLoopbackAdmin: false,
      allowMetadata: false,
    },
    credentials: {
      mode: 'none',
      ambientEnv: false,
      keychainAccess: false,
    },
    resources: {
      maxCpuSeconds: 60,
      maxMemoryMb: 512,
      maxProcesses: 16,
      maxOutputBytes: WORKER_RESULT_BYTES,
      maxWallMs: 60_000,
    },
  },
  'eva-01': {
    id: 'eva-01',
    rank: 2,
    label: 'Bounded',
    quarantine: false,
    allowsExternalEffects: true,
    filesystem: {
      mode: 'scoped-workspace',
      allowNervState: false,
      allowHostHome: false,
      allowGraderWrite: false,
    },
    network: {
      mode: 'grant-allowlist',
      allowLoopbackAdmin: false,
      allowMetadata: false,
    },
    credentials: {
      mode: 'scoped-proxy',
      ambientEnv: false,
      keychainAccess: false,
    },
    resources: {
      maxCpuSeconds: 180,
      maxMemoryMb: 1024,
      maxProcesses: 32,
      maxOutputBytes: WORKER_RESULT_BYTES,
      maxWallMs: 180_000,
    },
  },
  'eva-02': {
    id: 'eva-02',
    rank: 3,
    label: 'Full grant',
    quarantine: false,
    allowsExternalEffects: true,
    filesystem: {
      mode: 'granted-workspace',
      allowNervState: false,
      allowHostHome: false,
      allowGraderWrite: false,
    },
    network: {
      mode: 'grant',
      allowLoopbackAdmin: false,
      allowMetadata: false,
    },
    credentials: {
      mode: 'grant',
      ambientEnv: false,
      keychainAccess: false,
    },
    resources: {
      maxCpuSeconds: 300,
      maxMemoryMb: 2048,
      maxProcesses: 64,
      maxOutputBytes: WORKER_RESULT_BYTES,
      maxWallMs: 300_000,
    },
  },
};

export interface EvaAdmissionRequest {
  readonly grantId: string;
  readonly grantExpiresMs: number;
  readonly grantTool: string;
  readonly tool: string;
  readonly effect: Effect;
  readonly trust: Trust;
  readonly pilotStage: Stage;
  readonly pilotEvaClass?: EvaClass;
  readonly toolEvaClass?: EvaClass;
  readonly requestedClass?: EvaClass;
  readonly hostEnforced?: boolean;
  readonly nowMs?: number;
}

export type EvaAdmissionDecision =
  | {
      readonly admitted: true;
      readonly evaClass: EvaClass;
      readonly spec: EvaClassSpec;
      readonly ceiling: EvaClass;
      readonly grantId: string;
    }
  | {
      readonly admitted: false;
      readonly blocked: 'grant' | 'isolation';
      readonly reason: string;
    };

function minimumClassForJob(effect: Effect, trust: Trust): EvaClass {
  if (trust === 'tainted' && (effect === 'read' || effect === 'write-local')) return 'eva-03';
  if (effect === 'read' || effect === 'write-local') return 'eva-00';
  if (effect === 'write-external') return 'eva-01';
  return 'eva-02';
}

/**
 * Deterministic least-class admission using existing NERV grants and the F-049-T01 contract.
 * Never acts as an approval authority and fails closed when a job asks above its grant or pilot stage.
 */
export function admitEvaJob(request: EvaAdmissionRequest): EvaAdmissionDecision {
  const now = request.nowMs ?? Date.now();
  if (!request.grantId.trim()) {
    return { admitted: false, blocked: 'grant', reason: 'Missing NERV grant.' };
  }
  if (!Number.isFinite(request.grantExpiresMs) || request.grantExpiresMs <= now) {
    return { admitted: false, blocked: 'grant', reason: 'NERV grant has expired.' };
  }
  if (request.grantTool !== request.tool) {
    return {
      admitted: false,
      blocked: 'grant',
      reason: `Grant tool "${request.grantTool}" does not match requested tool "${request.tool}".`,
    };
  }

  const pilotCap = pilotExecutor({
    stage: request.pilotStage,
    ...(request.pilotEvaClass ? { evaClass: request.pilotEvaClass } : {}),
  });
  let ceiling = stricter(stageExecutor(request.pilotStage), pilotCap);
  if (request.toolEvaClass) ceiling = stricter(ceiling, request.toolEvaClass);
  if (request.trust === 'tainted' && (request.effect === 'read' || request.effect === 'write-local')) {
    ceiling = 'eva-03';
  }

  const needed = minimumClassForJob(request.effect, request.trust);
  const ceilingRank = EVA_CLASS_SPECS[ceiling].rank;
  const neededRank = EVA_CLASS_SPECS[needed].rank;

  if (request.requestedClass) {
    const requestedRank = EVA_CLASS_SPECS[request.requestedClass].rank;
    if (requestedRank > ceilingRank) {
      return {
        admitted: false,
        blocked: 'isolation',
        reason: `Requested class ${request.requestedClass} exceeds allowed ceiling ${ceiling}.`,
      };
    }
    if (requestedRank < neededRank) {
      return {
        admitted: false,
        blocked: 'isolation',
        reason: `Requested class ${request.requestedClass} cannot satisfy effect ${request.effect} (${needed} minimum).`,
      };
    }
  }

  if (neededRank > ceilingRank) {
    return {
      admitted: false,
      blocked: 'isolation',
      reason: `Job requires ${needed} for effect ${request.effect}, exceeding ceiling ${ceiling}.`,
    };
  }

  const chosen: EvaClass = request.requestedClass
    ? EVA_CLASS_SPECS[request.requestedClass].rank >= neededRank
      ? request.requestedClass
      : needed
    : needed;

  if (chosen === 'eva-03' && request.hostEnforced !== true) {
    return {
      admitted: false,
      blocked: 'isolation',
      reason: 'eva-03 execution requires verified host OS confinement.',
    };
  }

  return {
    admitted: true,
    evaClass: chosen,
    spec: EVA_CLASS_SPECS[chosen],
    ceiling,
    grantId: request.grantId,
  };
}
