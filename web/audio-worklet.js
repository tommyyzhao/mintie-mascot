// Pure helpers also run under node --test. The filter is causal (31 input samples of delay).
export function pcm16(samples) {
  return Int16Array.from(samples, value => {
    const sample = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    return Math.round(sample * (sample < 0 ? 32768 : 32767));
  });
}

export function createDownsampler(inputRate, outputRate = 16000) {
  if (!(inputRate >= outputRate && outputRate > 0)) throw new RangeError('invalid_sample_rate');
  const taps = 63, phases = 128, delay = (taps - 1) / 2;
  const cutoff = 0.45 * outputRate / inputRate;
  const kernels = Array.from({ length: phases }, (_, phase) => {
    const kernel = Float64Array.from({ length: taps }, (_, k) => {
      const x = k - delay - phase / phases;
      const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
      return sinc * (0.5 - 0.5 * Math.cos(2 * Math.PI * k / (taps - 1)));
    });
    const sum = kernel.reduce((a, b) => a + b, 0);
    return kernel.map(value => value / sum);
  });
  const history = new Float32Array(taps);
  let index = 0, nextOutput = 0;
  return samples => {
    const result = [];
    for (const sample of samples) {
      history[index % taps] = sample;
      if (index + 1e-7 >= nextOutput) {
        const fraction = Math.max(0, Math.min(phases - 1, Math.round((index - nextOutput) * phases)));
        const kernel = kernels[fraction];
        let value = 0;
        for (let k = 0; k < taps; k++) value += kernel[k] * history[(index - k + taps) % taps];
        result.push(value);
        nextOutput += inputRate / outputRate;
      }
      index++;
    }
    return Float32Array.from(result);
  };
}

export function downsample(samples, inputRate, outputRate = 16000) {
  return createDownsampler(inputRate, outputRate)(samples);
}

if (typeof AudioWorkletProcessor !== 'undefined') {
  class MicPCMProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.resample = createDownsampler(sampleRate);
      this.frame = new Float32Array(640); // 40 ms at 16 kHz; VAD still requires ≥250 ms silence.
      this.used = 0;
    }
    process(inputs) {
      const channels = inputs[0];
      if (!channels?.length) return true;
      const mono = new Float32Array(channels[0].length);
      for (const channel of channels) {
        for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
      }
      for (const value of this.resample(mono)) {
        this.frame[this.used++] = value;
        if (this.used === this.frame.length) {
          const samples = pcm16(this.frame);
          const bytes = new ArrayBuffer(samples.length * 2);
          const view = new DataView(bytes);
          for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true);
          this.port.postMessage(bytes, [bytes]);
          this.used = 0;
        }
      }
      // No microphone samples are written to the output. Connection only keeps processing alive.
      return true;
    }
  }
  registerProcessor('mintie-mic-pcm', MicPCMProcessor);
}
