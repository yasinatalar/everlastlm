import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  changeMemberRoleSchema,
  inviteMemberSchema,
  uuidSchema,
  type ChangeMemberRoleInput,
  type InviteMemberInput,
  type InviteMemberResult,
  type NotebookMember,
} from '@everlast/contracts';
import { zodPipe } from '../../../shared/http/zod-validation.pipe';
import { RequiresNotebookRole } from '../../../shared/security/auth.decorators';
import { AiRateLimited } from '../../../shared/security/throttling';
import { MembershipService } from '../application/membership.service';

@Controller('notebooks/:notebookId/members')
export class MembersController {
  constructor(private readonly members: MembershipService) {}

  /** Every member may see who else has access — needed to judge what to write. */
  @Get()
  @RequiresNotebookRole('viewer')
  async list(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
  ): Promise<NotebookMember[]> {
    return this.members.list(notebookId);
  }

  /**
   * Sharing can send mail to an address the owner typed, so it takes the strict
   * budget rather than the default one — an endpoint that puts your domain in a
   * stranger's inbox is worth as much restraint as one that spends model tokens.
   */
  @Post()
  @RequiresNotebookRole('owner')
  @AiRateLimited()
  async invite(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Body(zodPipe(inviteMemberSchema)) body: InviteMemberInput,
  ): Promise<InviteMemberResult> {
    return this.members.invite(notebookId, body);
  }

  @Patch(':userId')
  @RequiresNotebookRole('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changeRole(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Param('userId', zodPipe(uuidSchema)) userId: string,
    @Body(zodPipe(changeMemberRoleSchema)) body: ChangeMemberRoleInput,
  ): Promise<void> {
    await this.members.changeRole(notebookId, userId, body);
  }

  @Delete(':userId')
  @RequiresNotebookRole('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('notebookId', zodPipe(uuidSchema)) notebookId: string,
    @Param('userId', zodPipe(uuidSchema)) userId: string,
  ): Promise<void> {
    await this.members.remove(notebookId, userId);
  }
}
