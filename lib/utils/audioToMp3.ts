/**
 * Converte um blob de áudio do MediaRecorder (webm/opus no Chrome/Edge,
 * mp4/AAC no Safari) para MP3 via AudioContext (decode PCM) + lamejs.
 *
 * Por que existe: o Gemini aceita mp3/ogg sem ambiguidade, mas a docs do
 * audio/webm é contraditória (a página nativa omite; a do Firebase lista).
 * Converter pra mp3 elimina o risco. Extraído do caminho comprovado de
 * features/messaging/components/MessageInput.tsx (WhatsApp usa o mesmo
 * problema/solução); o MessageInput mantém a cópia dele por ora — não mexer
 * no fluxo vivo de mensageria. lamejs é carregado como script global
 * (/lame.min.js) no app/(protected)/layout.tsx.
 */

declare global {
  var lamejs: { Mp3Encoder: new (channels: number, sampleRate: number, bitRate: number) => {
    encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
    flush(): Int8Array;
  }};
}

export async function convertAudioToMp3(blob: Blob): Promise<File> {
  const Mp3Encoder = window.lamejs?.Mp3Encoder;
  if (!Mp3Encoder) throw new Error('lamejs not loaded — /lame.min.js missing');

  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();

  // decodeAudioData pode travar no Chrome com WebM malformado —
  // timeout de 15s garante resolução.
  const audioBuffer = await Promise.race([
    new Promise<AudioBuffer>((resolve, reject) =>
      audioContext.decodeAudioData(arrayBuffer, resolve, reject)
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('decodeAudioData timeout')), 15_000)
    ),
  ]);

  await audioContext.close();

  const channels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  // 96 kbps — bom custo/qualidade pra voz
  const encoder = new Mp3Encoder(channels >= 2 ? 2 : 1, sampleRate, 96);

  const BLOCK_SIZE = 1152; // block size exigido pelo lamejs

  const leftPCM = floatToInt16(audioBuffer.getChannelData(0));
  const rightPCM = channels >= 2 ? floatToInt16(audioBuffer.getChannelData(1)) : null;

  const mp3Chunks: Int8Array[] = [];

  for (let i = 0; i < leftPCM.length; i += BLOCK_SIZE) {
    const leftChunk = leftPCM.subarray(i, i + BLOCK_SIZE);
    const encoded = rightPCM
      ? encoder.encodeBuffer(leftChunk, rightPCM.subarray(i, i + BLOCK_SIZE))
      : encoder.encodeBuffer(leftChunk);
    if (encoded.length > 0) mp3Chunks.push(encoded);
  }

  const finalBlock = encoder.flush();
  if (finalBlock.length > 0) mp3Chunks.push(finalBlock);

  const mp3Blob = new Blob(mp3Chunks as BlobPart[], { type: 'audio/mpeg' });
  return new File([mp3Blob], `audio-${Date.now()}.mp3`, { type: 'audio/mpeg' });
}

function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
