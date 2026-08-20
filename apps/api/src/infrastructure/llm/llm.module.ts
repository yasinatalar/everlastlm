import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/app-config.module';
import type { Env } from '../../config/env.schema';
import { EmbeddingPort } from '../../shared/ports/embedding.port';
import { GroundedAnswerPort } from '../../shared/ports/grounded-answer.port';
import { SpeechSynthesisPort } from '../../shared/ports/speech.port';
import { TextGenerationPort } from '../../shared/ports/text-generation.port';
import { AnthropicClient } from './anthropic.client';
import { ClaudeGroundedAnswerAdapter } from './claude-grounded-answer.adapter';
import { ClaudeTextGenerationAdapter } from './claude-text-generation.adapter';
import { ElevenLabsSpeechAdapter, NullSpeechAdapter } from './elevenlabs-speech.adapter';
import { VoyageEmbeddingAdapter } from './voyage-embedding.adapter';

/**
 * The only module that names a vendor. Everything above it injects the abstract
 * port, so swapping Voyage for another embedding provider — or dropping in a
 * fake in tests — is a one-line change here.
 */
@Global()
@Module({
  providers: [
    AnthropicClient,
    { provide: EmbeddingPort, useClass: VoyageEmbeddingAdapter },
    { provide: TextGenerationPort, useClass: ClaudeTextGenerationAdapter },
    { provide: GroundedAnswerPort, useClass: ClaudeGroundedAnswerAdapter },
    {
      provide: SpeechSynthesisPort,
      inject: [APP_CONFIG],
      useFactory: (config: Env): SpeechSynthesisPort =>
        config.TTS_PROVIDER === 'elevenlabs'
          ? new ElevenLabsSpeechAdapter(config)
          : new NullSpeechAdapter(),
    },
  ],
  exports: [EmbeddingPort, TextGenerationPort, GroundedAnswerPort, SpeechSynthesisPort],
})
export class LlmModule {}
