import { Body, Controller, Get, Patch } from '@nestjs/common';
import { updateProfileSchema, type Profile, type UpdateProfileInput } from '@everlast/contracts';
import { zodPipe } from '../../../shared/http/zod-validation.pipe';
import { ProfileService } from '../application/profile.service';

@Controller('me')
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get()
  async me(): Promise<Profile> {
    return this.profiles.me();
  }

  @Patch()
  async update(
    @Body(zodPipe(updateProfileSchema)) body: UpdateProfileInput,
  ): Promise<Profile> {
    return this.profiles.update(body);
  }
}
