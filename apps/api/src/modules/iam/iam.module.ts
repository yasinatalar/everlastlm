import { Module } from '@nestjs/common';
import { ProfileService } from './application/profile.service';
import { ProfileController } from './presentation/profile.controller';

@Module({
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class IamModule {}
