export interface SpeechTurn {
  speaker: 'host_a' | 'host_b';
  text: string;
}

export interface SynthesisResult {
  audio: Buffer;
  mimeType: string;
  durationSeconds: number;
}

export abstract class SpeechSynthesisPort {
  /** False when no TTS vendor is configured; studio then stores script only. */
  abstract readonly available: boolean;

  abstract synthesiseDialogue(turns: SpeechTurn[]): Promise<SynthesisResult>;
}
