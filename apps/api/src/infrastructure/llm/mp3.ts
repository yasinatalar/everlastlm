/**
 * Just enough MP3 framing to join per-turn clips into one file players read
 * correctly.
 *
 * An MP3 is a sequence of self-contained frames, which is why concatenating
 * clips works at all. What does not survive concatenation is the metadata each
 * clip carries in front of its frames: an ID3v2 tag, and a Xing/Info header
 * frame stating the length of *that clip*. A player reads the first header it
 * finds and takes it for the whole file, so a six-minute conversation reports
 * the duration of its opening sentence and draws a seek bar to match — while
 * the later headers sit mid-stream where a decoder meets them as garbage.
 *
 * Dropping all of it leaves a bare constant-bitrate frame stream, whose
 * duration every player derives from the byte length, and which we can measure
 * here so the same number reaches the UI.
 */

/**
 * MPEG Version 1, Layer III — the only shape `mp3_44100_128` produces, and the
 * assumption behind the fixed 1152 samples per frame below.
 */
const BITRATES_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const SAMPLE_RATES = [44100, 48000, 32000, 0];
const SAMPLES_PER_FRAME = 1152;

/** Markers that mark a frame as a header describing the stream, not audio. */
const VBR_MARKERS = ['Xing', 'Info', 'VBRI'];

interface Frame {
  length: number;
  sampleRate: number;
}

/** Reads the frame header at `offset`, or null if no frame starts there. */
const readFrame = (buffer: Buffer, offset: number): Frame | null => {
  if (offset + 4 > buffer.length) return null;

  // Eleven sync bits, then version 01 (MPEG-1) and layer 01 (Layer III); the
  // remaining bit says whether a CRC follows, which does not concern us.
  if (buffer[offset] !== 0xff || (buffer[offset + 1]! & 0xfe) !== 0xfa) return null;

  const bitrate = BITRATES_KBPS[(buffer[offset + 2]! >> 4) & 0x0f]!;
  const sampleRate = SAMPLE_RATES[(buffer[offset + 2]! >> 2) & 0x03]!;
  if (!bitrate || !sampleRate) return null;

  const padding = (buffer[offset + 2]! >> 1) & 0x01;
  return { length: Math.floor((144000 * bitrate) / sampleRate) + padding, sampleRate };
};

/** Byte offset of the first frame, past any leading ID3v2 tag. */
const afterId3 = (clip: Buffer): number => {
  if (clip.length < 10 || clip.toString('latin1', 0, 3) !== 'ID3') return 0;

  // A syncsafe 32-bit length: seven bits per byte, high bit always clear.
  const size =
    ((clip[6]! & 0x7f) << 21) |
    ((clip[7]! & 0x7f) << 14) |
    ((clip[8]! & 0x7f) << 7) |
    (clip[9]! & 0x7f);
  const footer = clip[5]! & 0x10 ? 10 : 0;

  return 10 + size + footer;
};

/** One clip stripped down to its audio frames. */
const audioFramesOf = (clip: Buffer): Buffer => {
  const start = afterId3(clip);
  const frame = readFrame(clip, start);
  if (!frame) return clip.subarray(start);

  const head = clip.toString('latin1', start, start + frame.length);
  const isHeaderFrame = VBR_MARKERS.some((marker) => head.includes(marker));

  return clip.subarray(isHeaderFrame ? start + frame.length : start);
};

/** Joins clips into a single stream carrying nothing but audio frames. */
export const concatAudioFrames = (clips: Buffer[]): Buffer =>
  Buffer.concat(clips.map(audioFramesOf));

/**
 * Playing time summed frame by frame — exact, unlike an estimate from the
 * script. Null when nothing in the buffer parses as a frame.
 */
export const measureDurationSeconds = (audio: Buffer): number | null => {
  let offset = 0;
  let seconds = 0;

  while (offset < audio.length) {
    const frame = readFrame(audio, offset);
    if (!frame) {
      offset += 1;
      continue;
    }
    seconds += SAMPLES_PER_FRAME / frame.sampleRate;
    offset += frame.length;
  }

  return seconds > 0 ? seconds : null;
};
