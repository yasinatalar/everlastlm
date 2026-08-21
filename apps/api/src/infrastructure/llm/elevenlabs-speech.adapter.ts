import { Inject, Injectable, Logger } from '@nestjs/common';
import { request } from 'undici';
import { mapWithConcurrency } from '../../shared/kernel/concurrency';
import { APP_CONFIG } from '../../config/app-config.module';
import type { Env } from '../../config/env.schema';
import { DependencyFailureError } from '../../shared/kernel/domain-error';
import {
  SpeechSynthesisPort,
  type SpeechTurn,
  type SynthesisResult,
} from '../../shared/ports/speech.port';
import { concatAudioFrames, measureDurationSeconds } from './mp3';

const API_ROOT = 'https://api.elevenlabs.io/v1/text-to-speech';
/**
 * Asked for by name rather than left to the vendor default: constant bitrate is
 * what lets a player derive the duration from the byte length, and what `mp3.ts`
 * assumes when it measures the same duration here.
 */
const OUTPUT_FORMAT = 'mp3_44100_128';
/** Words per minute, for the estimate used when a file will not parse. */
const SPEAKING_RATE = 155;

/**
 * Pulls the human-readable half out of an ElevenLabs error body.
 *
 * The vendor sends `{"detail": {"message": "..."}}` for most refusals and a
 * bare `{"detail": "..."}` for a few. Both matter to whoever runs the server:
 * "Free users cannot use library voices via the API" is a five-minute config
 * fix, and collapsing it into "speech synthesis failed" turns it into an
 * afternoon of guessing.
 */
const explainFailure = (statusCode: number, body: string): string => {
  let detail: unknown;
  try {
    ({ detail } = JSON.parse(body) as { detail?: unknown });
  } catch {
    detail = undefined;
  }

  const message =
    typeof detail === 'string'
      ? detail
      : typeof (detail as { message?: unknown })?.message === 'string'
        ? (detail as { message: string }).message
        : body.slice(0, 200);

  return `ElevenLabs rejected the request (${statusCode}): ${message.slice(0, 200)}`;
};

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
   * appending them yields a file every player handles once the per-clip tags
   * and stream headers are out of the way; see `mp3.ts`. A container format
   * like MP4 would need a real muxer.
   */
  async synthesiseDialogue(turns: SpeechTurn[]): Promise<SynthesisResult> {
    if (turns.length === 0) {
      throw new DependencyFailureError('elevenlabs', 'dialogue has no turns');
    }

    // ElevenLabs caps concurrent requests by plan — 2 on the free tier. A
    // dialogue is one request per turn, so exceeding the cap makes a 20-turn
    // overview fail on a limit rather than on anything to do with the content.
    const clips = await mapWithConcurrency(turns, this.config.ELEVENLABS_MAX_CONCURRENCY, (turn) =>
      this.synthesiseTurn(turn),
    );

    const audio = concatAudioFrames(clips);
    const words = turns.reduce((total, turn) => total + turn.text.split(/\s+/).length, 0);

    return {
      audio,
      mimeType: 'audio/mpeg',
      // Measured from the frames that were actually produced. The estimate from
      // the script only stands in for a file we could not parse, and being off
      // by a minute is visible: this number is the running time the player and
      // the artifact list both show.
      durationSeconds: Math.max(
        1,
        Math.round(measureDurationSeconds(audio) ?? (words / SPEAKING_RATE) * 60),
      ),
    };
  }

  private async synthesiseTurn(turn: SpeechTurn): Promise<Buffer> {
    const voiceId =
      turn.speaker === 'host_a'
        ? this.config.ELEVENLABS_VOICE_HOST_A
        : this.config.ELEVENLABS_VOICE_HOST_B;

    const url = `${API_ROOT}/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMAT}`;

    const response = await request(url, {
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
      throw new DependencyFailureError('elevenlabs', explainFailure(response.statusCode, detail));
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
