import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { Public } from '../security/auth.decorators';

@Controller('health')
@Public()
@SkipThrottle()
export class HealthController {
  constructor(private readonly supabase: SupabaseService) {}

  /** Liveness: the process is up. Deliberately does no I/O. */
  @Get()
  live(): { status: string } {
    return { status: 'ok' };
  }

  /**
   * Readiness: dependencies are reachable. Reports only a boolean per
   * dependency — an error string here would leak connection details to anyone
   * who can reach the endpoint.
   */
  @Get('ready')
  async ready(): Promise<{ status: string; database: boolean }> {
    let database = false;
    try {
      const { error } = await this.supabase.admin
        .from('notebooks')
        .select('id', { head: true, count: 'exact' })
        .limit(1);
      database = !error;
    } catch {
      database = false;
    }

    return { status: database ? 'ok' : 'degraded', database };
  }
}
