import { describe, expect, it } from 'vitest';
import { concatAudioFrames, measureDurationSeconds } from './mp3';

/** MPEG-1 Layer III, 128 kbps, 44.1 kHz, stereo — one 26 ms frame. */
const FRAME_LENGTH = 417;

const frame = (marker?: string): Buffer => {
  const buffer = Buffer.alloc(FRAME_LENGTH);
  buffer.set([0xff, 0xfb, 0x90, 0x00]);
  if (marker) buffer.write(marker, 36, 'latin1');
  return buffer;
};

const id3 = (size: number): Buffer => {
  const tag = Buffer.alloc(10 + size);
  tag.write('ID3', 0, 'latin1');
  tag.set([0x04, 0x00, 0x00], 3);
  // Syncsafe length: seven bits per byte, so anything under 128 fits the last.
  tag.writeUInt8(size, 9);
  return tag;
};

const clip = (audioFrames: number, { tag = true, header = true } = {}): Buffer =>
  Buffer.concat([
    tag ? id3(25) : Buffer.alloc(0),
    header ? frame('Info') : Buffer.alloc(0),
    ...Array.from({ length: audioFrames }, () => frame()),
  ]);

describe('concatAudioFrames', () => {
  it('drops the tag and stream header each clip carries', () => {
    const joined = concatAudioFrames([clip(3), clip(2)]);

    expect(joined.length).toBe(5 * FRAME_LENGTH);
    expect(joined.toString('latin1')).not.toContain('ID3');
    expect(joined.toString('latin1')).not.toContain('Info');
  });

  it('leaves a clip that is already bare audio alone', () => {
    const bare = clip(4, { tag: false, header: false });

    expect(concatAudioFrames([bare])).toEqual(bare);
  });

  it('keeps audio frames that merely contain header-like bytes', () => {
    // The marker only means a stream header in the *first* frame of a clip.
    const joined = concatAudioFrames([
      Buffer.concat([id3(25), frame('Info'), frame('Xing'), frame()]),
    ]);

    expect(joined.length).toBe(2 * FRAME_LENGTH);
  });

  it('handles an empty list', () => {
    expect(concatAudioFrames([]).length).toBe(0);
  });
});

describe('measureDurationSeconds', () => {
  it('sums the frames rather than trusting a stream header', () => {
    // 40 frames of 1152 samples at 44.1 kHz — the header claims one frame.
    const seconds = measureDurationSeconds(concatAudioFrames([clip(40)]));

    expect(seconds).toBeCloseTo((40 * 1152) / 44100, 5);
  });

  it('returns null when nothing parses as a frame', () => {
    expect(measureDurationSeconds(Buffer.alloc(64))).toBeNull();
  });
});
