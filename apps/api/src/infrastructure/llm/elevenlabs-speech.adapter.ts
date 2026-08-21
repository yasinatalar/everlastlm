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

const API_ROOT = 'https://api.elevenlabs.io/v1/text-to-speech';
/** Words per minute for the duration estimate; ElevenLabs lands near this. */
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

/**
 * Drops a leading ID3v2 tag.
 *
 * Every clip comes back with one. Left in place they end up *inside* the
 * concatenated stream, where a decoder hits them mid-playback and reports
 * "Header missing" at each seam. Removing them from all but the first clip
 * leaves a file that decodes end to end without errors.
 */
const stripId3 = (clip: Buffer): Buffer => {
  if (clip.length < 10 || clip.toString('latin1', 0, 3) !== 'ID3') return clip;

  // A syncsafe 32-bit length: seven bits per byte, high bit always clear.
  const size =
    ((clip.readUInt8(6) & 0x7f) << 21) |
    ((clip.readUInt8(7) & 0x7f) << 14) |
    ((clip.readUInt8(8) & 0x7f) << 7) |
    (clip.readUInt8(9) & 0x7f);
  const footer = clip.readUInt8(5) & 0x10 ? 10 : 0;

  return clip.subarray(10 + size + footer);
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
   * appending buffers yields a file every player handles; a container format
   * like MP4 would need a real muxer.
   */
  async synthesiseDialogue(turns: SpeechTurn[]): Promise<SynthesisResult> {
    if (turns.length === 0) {
      throw new DependencyFailureError('elevenlabs', 'dialogue has no turns');
    }

    // ElevenLabs caps concurrent requests by plan — 2 on the free tier. A
    // dialogue is one request per turn, so exceeding the cap makes a 20-turn
    // overview fail on a limit rather than on anything to do with the content.
    const clips = await mapWithConcurrency(
      turns,
      this.config.ELEVENLABS_MAX_CONCURRENCY,
      (turn) => this.synthesiseTurn(turn),
    );

    const words = turns.reduce((total, turn) => total + turn.text.split(/\s+/).length, 0);

    return {
      audio: Buffer.concat(clips.map((clip, index) => (index === 0 ? clip : stripId3(clip)))),
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
