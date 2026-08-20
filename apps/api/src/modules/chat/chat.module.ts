import { Module } from '@nestjs/common';
import { ChatService } from './application/chat.service';
import { ConversationRepository } from './domain/conversation.repository';
import { ChunkRetrievalPort } from './domain/retrieval.port';
import { SupabaseConversationRepository } from './infrastructure/supabase-conversation.repository';
import { SupabaseRetrievalAdapter } from './infrastructure/supabase-retrieval.adapter';
import { ChatController } from './presentation/chat.controller';

@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
    { provide: ConversationRepository, useClass: SupabaseConversationRepository },
    { provide: ChunkRetrievalPort, useClass: SupabaseRetrievalAdapter },
  ],
  exports: [ChunkRetrievalPort],
})
export class ChatModule {}
