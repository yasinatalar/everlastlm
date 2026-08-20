import { Injectable, Logger } from '@nestjs/common';
import type { Json } from '../../infrastructure/supabase/database.types';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { RequestContextService } from '../context/request-context';

export interface AuditEntry {
  action: string;
  notebookId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only trail of security-relevant actions. Written with the service-role
 * client because `audit_events` grants no insert to `authenticated` — a user
 * can read the trail for notebooks they own but can never forge or erase it.
 *
 * Recording never fails a request: an audit outage must not take down the
 * product, so failures are logged and swallowed.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly context: RequestContextService,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    const ctx = this.context.get();

    try {
      const { error } = await this.supabase.admin.from('audit_events').insert({
        action: entry.action,
        actor_id: ctx?.user?.id ?? null,
        notebook_id: entry.notebookId ?? null,
        target_type: entry.targetType ?? null,
        target_id: entry.targetId ?? null,
        // Serialised through JSON so an accidental `undefined`, Date or Buffer
        // in the metadata cannot break the insert.
        metadata: JSON.parse(
          JSON.stringify({ ...(entry.metadata ?? {}), requestId: ctx?.requestId ?? null }),
        ) as Json,
        ip: ctx?.ip ?? null,
        user_agent: ctx?.userAgent ?? null,
      });

      if (error) throw new Error(error.message);
    } catch (error) {
      this.logger.error({ err: error, action: entry.action }, 'failed to write audit event');
    }
  }
}
