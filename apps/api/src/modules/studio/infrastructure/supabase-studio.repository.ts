import { Injectable } from '@nestjs/common';
import {
  studioContentSchema,
  type StudioArtifact,
  type StudioContent,
} from '@everlast/contracts';
import type { Json, StudioArtifactRow } from '../../../infrastructure/supabase/database.types';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';
import { RequestContextService } from '../../../shared/context/request-context';
import { DependencyFailureError } from '../../../shared/kernel/domain-error';
import {
  StudioAudioStoragePort,
  StudioRepository,
  type CreateArtifactData,
} from '../domain/studio.repository';

const BUCKET = 'studio-audio';

const toArtifact = (row: StudioArtifactRow, audioUrl: string | null = null): StudioArtifact => {
  const parsed = studioContentSchema.safeParse(row.content);

  return {
    id: row.id,
    notebookId: row.notebook_id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    content: parsed.success ? parsed.data : null,
    sourceIds: row.source_ids,
    audioUrl,
    durationSeconds: row.duration_seconds,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

@Injectable()
export class SupabaseStudioRepository extends StudioRepository {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly context: RequestContextService,
    private readonly audio: StudioAudioStoragePort,
  ) {
    super();
  }

  async listByNotebook(notebookId: string): Promise<StudioArtifact[]> {
    const { data, error } = await this.supabase
      .forUser()
      .from('studio_artifacts')
      .select('*')
      .eq('notebook_id', notebookId)
      .order('created_at', { ascending: false });

    if (error) this.supabase.fail('studio.list', error);
    return Promise.all((data ?? []).map((row) => this.withAudio(row)));
  }

  async findById(notebookId: string, artifactId: string): Promise<StudioArtifact | null> {
    const { data, error } = await this.supabase
      .forUser()
      .from('studio_artifacts')
      .select('*')
      .eq('id', artifactId)
      .eq('notebook_id', notebookId)
      .maybeSingle();

    if (error) this.supabase.fail('studio.findById', error);
    return data ? this.withAudio(data) : null;
  }

  async create(data: CreateArtifactData): Promise<StudioArtifact> {
    const user = this.context.requireUser();

    const { data: row, error } = await this.supabase
      .forUser()
      .from('studio_artifacts')
      .insert({
        notebook_id: data.notebookId,
        created_by: user.id,
        kind: data.kind,
        title: data.title,
        source_ids: data.sourceIds,
        status: 'pending',
      })
      .select('*')
      .single();

    if (error || !row) {
      throw new DependencyFailureError('supabase', 'could not create the studio artifact');
    }
    return toArtifact(row);
  }

  // The generation pipeline runs after the response, without a user token.
  async markGenerating(artifactId: string): Promise<void> {
    await this.updateAsAdmin(artifactId, { status: 'generating' });
  }

  async markReady(
    artifactId: string,
    content: StudioContent,
    audio?: { storagePath: string; durationSeconds: number },
  ): Promise<void> {
    await this.updateAsAdmin(artifactId, {
      status: 'ready',
      content: content as unknown as Json,
      failure_reason: null,
      ...(audio
        ? {
            audio_storage_path: audio.storagePath,
            duration_seconds: audio.durationSeconds,
          }
        : {}),
    });
  }

  async markFailed(artifactId: string, reason: string): Promise<void> {
    await this.updateAsAdmin(artifactId, {
      status: 'failed',
      failure_reason: reason.slice(0, 300),
    });
  }

  async delete(artifactId: string): Promise<void> {
    const { data } = await this.supabase
      .forUser()
      .from('studio_artifacts')
      .select('audio_storage_path')
      .eq('id', artifactId)
      .maybeSingle();

    const { error } = await this.supabase
      .forUser()
      .from('studio_artifacts')
      .delete()
      .eq('id', artifactId);

    if (error) this.supabase.fail('studio.delete', error);

    if (data?.audio_storage_path) {
      await this.audio.remove(data.audio_storage_path).catch(() => undefined);
    }
  }

  private async updateAsAdmin(
    artifactId: string,
    patch: Partial<StudioArtifactRow>,
  ): Promise<void> {
    const { error } = await this.supabase
      .admin
      .from('studio_artifacts')
      .update(patch)
      .eq('id', artifactId);

    if (error) this.supabase.fail('studio.update', error);
  }

  /** Audio is served through a short-lived signed URL, never a public object. */
  private async withAudio(row: StudioArtifactRow): Promise<StudioArtifact> {
    if (!row.audio_storage_path) return toArtifact(row);

    const url = await this.audio
      .signedUrl(row.audio_storage_path, 3600)
      .catch(() => null);
    return toArtifact(row, url);
  }
}

@Injectable()
export class SupabaseStudioAudioStorage extends StudioAudioStoragePort {
  constructor(private readonly supabase: SupabaseService) {
    super();
  }

  async upload(
    notebookId: string,
    artifactId: string,
    audio: Buffer,
    mimeType: string,
  ): Promise<string> {
    const path = `${notebookId}/${artifactId}/overview.mp3`;

    const { error } = await this.supabase.storage()
      .from(BUCKET)
      .upload(path, audio, { contentType: mimeType, upsert: true });

    if (error) throw new DependencyFailureError('storage', 'could not store the audio file');
    return path;
  }

  async signedUrl(storagePath: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.supabase.storage()
      .from(BUCKET)
      .createSignedUrl(storagePath, expiresInSeconds);

    if (error || !data) {
      throw new DependencyFailureError('storage', 'could not create an audio link');
    }
    return data.signedUrl;
  }

  async remove(storagePath: string): Promise<void> {
    await this.supabase.storage().from(BUCKET).remove([storagePath]);
  }
}
