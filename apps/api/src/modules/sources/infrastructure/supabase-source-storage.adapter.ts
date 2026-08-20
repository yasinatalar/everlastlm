import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';
import { DependencyFailureError } from '../../../shared/kernel/domain-error';
import { SourceStoragePort } from '../domain/source.repository';

const BUCKET = 'sources';

/**
 * Filenames arrive from the browser and end up in an object key. Anything that
 * could traverse a path, confuse a signer, or smuggle a second extension past a
 * viewer is removed rather than escaped.
 */
export const sanitiseFilename = (filename: string): string => {
  const base = filename.split(/[\\/]/).pop() ?? 'document';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return cleaned || 'document';
};

@Injectable()
export class SupabaseSourceStorageAdapter extends SourceStoragePort {
  constructor(private readonly supabase: SupabaseService) {
    super();
  }

  /** Key layout `{notebookId}/{sourceId}/{filename}` — see storage policies. */
  async upload(
    notebookId: string,
    sourceId: string,
    filename: string,
    contentType: string,
    bytes: Buffer,
  ): Promise<string> {
    const path = `${notebookId}/${sourceId}/${sanitiseFilename(filename)}`;

    const { error } = await this.supabase.storage()
      .from(BUCKET)
      .upload(path, bytes, {
        contentType,
        upsert: false,
        // Never let the browser decide; a stored text/html would otherwise be
        // renderable same-origin from a signed URL.
        cacheControl: '3600',
      });

    if (error) {
      throw new DependencyFailureError('storage', `upload failed: ${error.message}`);
    }
    return path;
  }

  async download(storagePath: string): Promise<Buffer> {
    const { data, error } = await this.supabase.storage().from(BUCKET).download(storagePath);
    if (error || !data) {
      throw new DependencyFailureError('storage', 'could not read the stored document');
    }
    return Buffer.from(await data.arrayBuffer());
  }

  async remove(storagePath: string): Promise<void> {
    const { error } = await this.supabase.storage().from(BUCKET).remove([storagePath]);
    if (error) throw new DependencyFailureError('storage', 'could not delete the document');
  }

  async signedUrl(storagePath: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.supabase.storage()
      .from(BUCKET)
      .createSignedUrl(storagePath, expiresInSeconds);

    if (error || !data) {
      throw new DependencyFailureError('storage', 'could not create a download link');
    }
    return data.signedUrl;
  }
}
