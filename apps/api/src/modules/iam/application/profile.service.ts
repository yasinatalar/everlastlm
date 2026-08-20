import { Injectable } from '@nestjs/common';
import {
  localeSchema,
  themeSchema,
  type Profile,
  type UpdateProfileInput,
} from '@everlast/contracts';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';
import { RequestContextService } from '../../../shared/context/request-context';
import { NotFoundError } from '../../../shared/kernel/domain-error';

@Injectable()
export class ProfileService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly context: RequestContextService,
  ) {}

  async me(): Promise<Profile> {
    const user = this.context.requireUser();

    const { data, error } = await this.supabase
      .forUser()
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (error) this.supabase.fail('profiles.me', error);
    if (!data) throw new NotFoundError('profile', user.id);

    return {
      id: data.id,
      email: data.email,
      displayName: data.display_name,
      avatarUrl: data.avatar_url,
      // The columns are plain text with a CHECK constraint; parse defensively
      // so a value added to the DB but not to the contract cannot break the UI.
      locale: localeSchema.safeParse(data.locale).data ?? 'en',
      theme: themeSchema.safeParse(data.theme).data ?? 'system',
      createdAt: data.created_at,
    };
  }

  async update(input: UpdateProfileInput): Promise<Profile> {
    const user = this.context.requireUser();

    const { error } = await this.supabase
      .forUser()
      .from('profiles')
      .update({
        ...(input.displayName !== undefined ? { display_name: input.displayName } : {}),
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
        ...(input.theme !== undefined ? { theme: input.theme } : {}),
      })
      .eq('id', user.id);

    if (error) this.supabase.fail('profiles.update', error);
    return this.me();
  }
}
