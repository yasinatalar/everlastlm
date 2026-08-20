import { Inject, Injectable, Logger } from '@nestjs/common';
import pLimit from 'p-limit';
import { request } from 'undici';
import { APP_CONFIG } from '../../config/app-config.module';
import type { Env } from '../../config/env.schema';
import { DependencyFailureError } from '../../shared/kernel/domain-error';
import {
  SpeechSynthesisPort,
  type SpeechTurn,
  type SynthesisResult,
} from '../../shared/ports/speech.port';

const API_ROOT = 'https://api.elevenlabs.io/v1/text-to-speech';
/** Words per minute for the duration estimate; ElevenLabs lands near this. */
const SPEAKING_RATE = 155;

@Injectable()
export class ElevenLabsSpeechAdapter extends SpeechSynthesisPort {
  private readonly logger = new Logger(ElevenLabsSpeechAdapter.name);
  readonly available = true;

  constructor(@Inject(APP_CONFIG) private readonly config: Env) {
    super();
  }

  /**
   * Each turn is synthesised independently — one voice per host — and the MP3
   * payloads are concatenated. MP3 is a sequence of self-contained frames, so
   * appending buffers yields a file every player handles; a container format
   * like MP4 would need a real muxer.
   */
  async synthesiseDialogue(turns: SpeechTurn[]): Promise<SynthesisResult> {
    if (turns.length === 0) {
      throw new DependencyFailureError('elevenlabs', 'dialogue has no turns');
    }

    const limit = pLimit(3);
    const clips = await Promise.all(
      turns.map((turn) => limit(() => this.synthesiseTurn(turn))),
    );

    const words = turns.reduce((total, turn) => total + turn.text.split(/\s+/).length, 0);

    return {
      audio: Buffer.concat(clips),
      mimeType: 'audio/mpeg',
      durationSeconds: Math.max(1, Math.round((words / SPEAKING_RATE) * 60)),
    };
  }

  private async synthesiseTurn(turn: SpeechTurn): Promise<Buffer> {
    const voiceId =
      turn.speaker === 'host_a'
        ? this.config.ELEVENLABS_VOICE_HOST_A
        : this.config.ELEVENLABS_VOICE_HOST_B;

    const response = await request(`${API_ROOT}/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.config.ELEVENLABS_API_KEY ?? '',
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: turn.text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.3 },
      }),
      headersTimeout: 30_000,
      bodyTimeout: 120_000,
    });

    if (response.statusCode >= 400) {
      const detail = await response.body.text();
      this.logger.error(`elevenlabs responded ${response.statusCode}: ${detail.slice(0, 300)}`);
      throw new DependencyFailureError('elevenlabs', 'speech synthesis failed');
    }

    return Buffer.from(await response.body.arrayBuffer());
  }
}

/** Used when `TTS_PROVIDER=none`; studio then stores the script without audio. */
@Injectable()
export class NullSpeechAdapter extends SpeechSynthesisPort {
  readonly available = false;

  async synthesiseDialogue(): Promise<SynthesisResult> {
    throw new DependencyFailureError('tts', 'no speech provider is configured');
  }
}
