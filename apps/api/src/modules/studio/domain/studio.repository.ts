import type { StudioArtifact, StudioContent, StudioKind } from '@everlast/contracts';

export interface CreateArtifactData {
  notebookId: string;
  kind: StudioKind;
  title: string;
  sourceIds: string[];
}

export abstract class StudioRepository {
  abstract listByNotebook(notebookId: string): Promise<StudioArtifact[]>;
  abstract findById(notebookId: string, artifactId: string): Promise<StudioArtifact | null>;
  abstract create(data: CreateArtifactData): Promise<StudioArtifact>;
  abstract markGenerating(artifactId: string): Promise<void>;
  /**
   * `audioNote` explains a *missing* audio track on an otherwise successful
   * artifact. It shares the `failure_reason` column with a failed generation —
   * unambiguous because `status` says which of the two this is — so that "no
   * TTS vendor configured" and "the vendor refused this voice" stop looking
   * identical to the reader.
   */
  abstract markReady(
    artifactId: string,
    content: StudioContent,
    audio?: { storagePath: string; durationSeconds: number },
    audioNote?: string,
  ): Promise<void>;
  abstract markFailed(artifactId: string, reason: string): Promise<void>;
  abstract delete(artifactId: string): Promise<void>;
}

/** Audio lives in its own private bucket, separate from source documents. */
export abstract class StudioAudioStoragePort {
  abstract upload(
    notebookId: string,
    artifactId: string,
    audio: Buffer,
    mimeType: string,
  ): Promise<string>;
  abstract signedUrl(storagePath: string, expiresInSeconds: number): Promise<string>;
  abstract remove(storagePath: string): Promise<void>;
}
