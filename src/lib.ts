const eva_webengine_multimedia_version = "0.1.6";

import {
  Eva,
  EvaErrorKind,
  EvaError,
  SerializationKind
} from "@eva-ics/webengine";

let eva: Eva | null = null;

export const get_engine = (): Eva | null => {
  return eva;
};

/**
 * Sets the default WebEngine for multimedia operations.
 */
export const set_engine = (engine: Eva) => {
  eva = engine;
  (eva as any).we_multimedia_version = eva_webengine_multimedia_version;
};

export enum EvaPlayerAutoSize {
  None = "none",
  KeepWidth = "keep-width",
  KeepHeight = "keep-height",
  Resize = "resize"
}

export interface EvaRecPlayerParameters {
  canvas: HTMLCanvasElement;
  oid: string;
  t_start: number;
  svc?: string;
  engine?: Eva;
  onError?: (error: EvaError) => void;
  onActiveChange?: (active: boolean) => void;
  onEOS?: () => void;
  onNextFrame?: (t: number) => void;
  onChange?: (info: EvaVideoStreamInfo) => void;
  decoderHardwareAcceleration?: boolean;
  decoderFallbackToSoftware?: boolean;
  fetchSecInitial?: number;
  fetchSecNext?: number;
  fps?: number;
  playbackSpeed?: number; // Playback speed multiplier
  autoSize?: EvaPlayerAutoSize; // Optional auto-size configuration
}

export interface EvaLivePlayerParameters {
  canvas: HTMLCanvasElement;
  autoSize?: EvaPlayerAutoSize;
  name: string;
  engine?: Eva;
  onError?: (error: EvaError) => void;
  onFrame?: () => void;
  onEOS?: () => void;
  onChange?: (info: EvaVideoStreamInfo) => void;
  decoderHardwareAcceleration?: boolean;
  decoderFallbackToSoftware?: boolean;
}

enum DrawNext {
  EOS = "eos",
  Start = "start",
  Error = "error",
  None = "none"
}

export class EvaLivePlayer {
  name: string;
  decoder: EvaVideoDecoder;
  engine: Eva;
  autoSize: EvaPlayerAutoSize;
  canvas: HTMLCanvasElement;
  onFrame?: () => void;
  onError?: (error: EvaError) => void;
  onEOS?: () => void;
  private paused: boolean;
  private drawNext: DrawNext = DrawNext.None;
  private drawNextError?: EvaError;
  private frameCounter: number;
  constructor(params: EvaLivePlayerParameters) {
    this.name = params.name;
    this.canvas = params.canvas;
    const eva_engine: Eva = params.engine || (eva as Eva);
    if (!eva_engine) {
      throw new Error("EVA ICS WebEngine not set");
    }
    this.engine = eva_engine;
    this.autoSize = params.autoSize ?? EvaPlayerAutoSize.None;
    this.onFrame = params.onFrame;
    this.onError = params.onError;
    this.onEOS = params.onEOS;
    this.paused = false;
    this.frameCounter = 0;
    this.decoder = new EvaVideoDecoder();
    this.decoder.setPreferredHardwareAcceleration(
      params.decoderHardwareAcceleration ?? true
    );
    this.decoder.fallbackToSoftware = params.decoderFallbackToSoftware ?? true;
    this.decoder.onError = (error: EvaError) => {
      console.error(`Error in decoder: ${error.message} (${error.code})`);
      if (params.onError) {
        params.onError(error);
      }
      this.messageError(error);
      this.close();
    };
    const autoSize = this.autoSize;
    this.decoder.onChange = (info) => {
      switch (autoSize) {
        case EvaPlayerAutoSize.KeepWidth:
          this.canvas.height = (this.canvas.width * info.height) / info.width;
          break;
        case EvaPlayerAutoSize.KeepHeight:
          this.canvas.width = (this.canvas.height * info.width) / info.height;
          break;
        case EvaPlayerAutoSize.Resize:
          this.canvas.width = info.width;
          this.canvas.height = info.height;
          break;
        case EvaPlayerAutoSize.None:
          // Do nothing
          break;
      }
      this.messageStart();
      if (params.onChange) {
        params.onChange(info);
      }
    };
    this.decoder.onOutput = (videoFrame) => {
      this.frameCounter++;
      // TODO: empirically, fix this
      if (this.frameCounter > 10) {
        this.drawNext = DrawNext.None;
        this.drawNextError = undefined;
      }
      if (!this.paused) {
        const ctx = params.canvas.getContext("2d");
        ctx?.drawImage(
          videoFrame,
          0,
          0,
          params.canvas.width,
          params.canvas.height
        );
      }
      if (this.onFrame) {
        this.onFrame();
      }
    };
  }
  private message(text: string, width: number, color: string = "white") {
    const ctx = this.canvas.getContext("2d")!;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = color;
    ctx.font = `bold ${width}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, this.canvas.width / 2, this.canvas.height / 2);
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
    switch (this.drawNext) {
      case DrawNext.EOS:
        this.messageEOS();
        break;
      case DrawNext.Start:
        this.messageStart();
        break;
      case DrawNext.Error:
        if (this.drawNextError) {
          this.messageError(this.drawNextError);
        }
        break;
      case DrawNext.None:
        // Do nothing
        break;
    }
  }
  togglePause() {
    if (this.isPlaying()) {
      this.pause();
    } else {
      this.resume();
    }
  }
  isPlaying() {
    return !this.paused;
  }
  private messageStart() {
    if (this.paused) {
      this.drawNext = DrawNext.Start;
    } else {
      this.message("...", 50);
    }
  }
  private messageEOS() {
    if (this.paused) {
      this.drawNext = DrawNext.EOS;
    } else {
      this.message("EOS", 50);
    }
  }
  private messageError(error: EvaError) {
    if (this.paused) {
      this.drawNext = DrawNext.Error;
      this.drawNextError = error;
    } else {
      this.message(`Error: ${error.message} (${error.code})`, 12, "red");
    }
  }
  start(oid: string) {
    this.engine.start_stream({
      oid,
      name: this.name,
      onError: (error: EvaError) => {
        this.messageError(error);
        if (this.onError) {
          this.onError(error);
        }
        this.close();
      },
      onData: (data: ArrayBuffer) => {
        this.decoder.decode(data);
      },
      onStart: () => {
        this.messageStart();
        this.frameCounter = 0; // Reset frame counter on start
      },
      onEOS: () => {
        this.messageEOS();
        this.frameCounter = 0; // Reset frame counter on EOS
      }
    });
  }
  close() {
    this.engine.stop_stream(this.name);
    this.decoder.close();
  }
}

interface RecVideoFrame {
  t: number; // Timestamp in seconds
  data: ArrayBuffer; // Video frame data
  key_unit?: boolean; // Optional flag for key frames
}

const REC_DEFAULT_FPS = 30; // Default frames per second if not provided

export class EvaRecPlayer {
  decoder?: EvaVideoDecoder;
  engine: Eva;
  svc: string;
  frame_duration_ms?: number;
  canvas: HTMLCanvasElement;
  onError?: (error: EvaError) => void;
  onEOS?: () => void;
  onNextFrame?: (t: number) => void;
  onActiveChange?: (active: boolean) => void;
  onChange?: (info: EvaVideoStreamInfo) => void;
  fps?: number;
  private playbackSpeed: number = 1; // Playback speed multiplier
  private paused: boolean;
  private frames: Array<RecVideoFrame> = [];
  private prev_frames_t: Array<number> = [];
  private tNext: number;
  private t_start: number;
  private oid: string;
  private displayFrameWorker: any = null;
  private fetchActive: boolean = false;
  private fetchSecInitial: number;
  private fetchSecNext: number;
  private decoderHardwareAcceleration: boolean;
  private decoderFallbackToSoftware: boolean;
  private autoSize: EvaPlayerAutoSize;
  constructor(params: EvaRecPlayerParameters) {
    this.svc = params.svc || "eva.videosrv.default";
    this.canvas = params.canvas;
    const eva_engine: Eva = params.engine || (eva as Eva);
    if (!eva_engine) {
      throw new Error("EVA ICS WebEngine not set");
    }
    this.fetchSecInitial = params.fetchSecInitial || 5;
    this.fetchSecNext = params.fetchSecNext || 2;
    this.engine = eva_engine;
    this.onError = params.onError;
    this.onEOS = params.onEOS;
    this.onChange = params.onChange;
    this.onNextFrame = params.onNextFrame;
    this.onActiveChange = params.onActiveChange;
    this.t_start = params.t_start;
    this.tNext = params.t_start;
    this.oid = params.oid;
    this.fps = params.fps;
    this.autoSize = params.autoSize || EvaPlayerAutoSize.None;
    this.playbackSpeed = params.playbackSpeed || 1; // Default playback speed is 1x
    this.decoderHardwareAcceleration =
      params.decoderHardwareAcceleration ?? true;
    this.decoderFallbackToSoftware = params.decoderFallbackToSoftware ?? true;

    this.paused = false;
    this.init();
  }
  init(keep_prev_frames: boolean = false) {
    this.frames = [];
    if (!keep_prev_frames) {
      this.prev_frames_t = [];
    }
    if (this.displayFrameWorker) {
      clearInterval(this.displayFrameWorker);
    }
    this.displayFrameWorker = null;
    this.decoder = new EvaVideoDecoder();
    this.decoder.setPreferredHardwareAcceleration(
      this.decoderHardwareAcceleration ?? true
    );
    this.decoder.fallbackToSoftware = this.decoderFallbackToSoftware;
    this.decoder.onChange = (info: EvaVideoStreamInfo) => {
      switch (this.autoSize) {
        case EvaPlayerAutoSize.KeepWidth:
          this.canvas.height = (this.canvas.width * info.height) / info.width;
          break;
        case EvaPlayerAutoSize.KeepHeight:
          this.canvas.width = (this.canvas.height * info.width) / info.height;
          break;
        case EvaPlayerAutoSize.Resize:
          this.canvas.width = info.width;
          this.canvas.height = info.height;
          break;
        case EvaPlayerAutoSize.None:
          // Do nothing
          break;
      }
      if (this.onChange) {
        this.onChange(info);
      }
    };

    this.decoder.onError = (error: EvaError) => {
      console.error(error);
      console.error(`Error in decoder: ${error.message} (${error.code})`);
      if (this.onError) {
        this.onError(error);
      }
      this.messageError(error);
      this.close();
    };
    this.decoder.onOutput = (frame: VideoFrame) => {
      console.log("decoded");
      let t = frame.timestamp;
      if (t < 0) {
        t *= -1; // negative timestamps are used to skip frame display
      }
      this.prev_frames_t.push(t / 1000);
      if (this.prev_frames_t.length > 10000) {
        this.prev_frames_t.shift(); // Keep memory usage in check
      }
      if (frame.timestamp > 0) {
        const ctx = this.canvas.getContext("2d");
        ctx?.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
        if (this.onNextFrame) {
          this.onNextFrame(frame.timestamp / 1000);
        }
      }
    };
  }
  goto(t: number, keep_prev_frames: boolean = false) {
    console.log("requested to go to", t);
    this.close();
    this.t_start = t;
    this.tNext = t;
    this.init(keep_prev_frames);
    this.start();
  }
  private message(text: string, width: number, color: string = "white") {
    const ctx = this.canvas.getContext("2d")!;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = color;
    ctx.font = `bold ${width}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, this.canvas.width / 2, this.canvas.height / 2);
  }
  pause() {
    this.paused = true;
    if (this.onActiveChange) {
      this.onActiveChange(false);
    }
  }
  resume() {
    this.paused = false;
    if (this.onActiveChange) {
      this.onActiveChange(true);
    }
  }
  togglePause() {
    if (this.isPlaying()) {
      this.pause();
    } else {
      this.resume();
    }
  }
  isPlaying() {
    return !this.paused;
  }
  private messageEOS() {
    this.message("EOS", 50);
  }
  private messageError(error: EvaError) {
    if (!this.paused) {
      this.message(`Error: ${error.message} (${error.code})`, 12, "red");
    }
  }
  stepFrameBackward() {
    this.pause();
    this.prev_frames_t.pop(); // current frame is not needed
    const t = this.prev_frames_t.pop();
    if (!t) {
      return;
    }
    console.log(t);
    this.goto(t, true);
  }
  stepFrameForward() {
    this.pause();
    this.displayNextFrame();
  }
  private displayNextFrame() {
    const frame = this.frames.shift();
    if (this.frames.length < (this.fps || REC_DEFAULT_FPS) * 3) {
      this.fetchNext(false);
    }
    if (!frame) {
      this.messageEOS();
      return;
    }
    console.log("frame_t=", frame?.t, "t_start=", this.t_start);
    let m = 1;
    if (frame.t < this.t_start) {
      m = -1;
    }
    this.decoder!.decode(frame.data, frame.t * 1000 * m);
    if (frame.t < this.t_start) {
      this.displayNextFrame();
      return;
    }
  }
  private fetchNext(initial: boolean) {
    if (this.fetchActive) {
      return; // Avoid fetching if already fetching
    }
    this.fetchActive = true;
    this.engine
      .api_call({
        method: `x::${this.svc}::rec.segmented`,
        params: {
          i: this.oid,
          t: this.tNext,
          limit_min:
            (this.fps || REC_DEFAULT_FPS) *
            (initial ? this.fetchSecInitial : this.fetchSecNext)
        },
        serialization_kind: SerializationKind.MsgPack
      })
      .then((response) => {
        if (response.length === 0) {
          if (initial) {
            this.fetchActive = false;
            this.messageEOS();
            return;
          }
        }
        console.log("t=", response[0].t);
        const frames = response.map((item: any) => {
          return {
            t: item.t,
            data: new Uint8Array(item.data).buffer,
            key_unit: item.key_unit || false
          };
        });
        if (response.length > 0) {
          const last_t = response[response.length - 1].t;
          if (last_t < this.tNext) {
            this.fetchActive = false;
            this.messageEOS();
            this.pause();
            return;
          }
          this.tNext = last_t + 1;
        }
        this.frames.push(...frames);
        this.fetchActive = false;
        if (initial) {
          this.displayNextFrame();
          this.startDisplayFrameWorker();
        }
      })
      .catch((error) => {
        this.fetchActive = false;
        if (this.onError) {
          this.onError(error);
        }
        this.pause();
      });
  }
  private startDisplayFrameWorker() {
    clearInterval(this.displayFrameWorker);
    this.displayFrameWorker = setInterval(
      () => {
        if (!this.paused) {
          console.log("tick");
          this.displayNextFrame();
        }
      },
      (this.frame_duration_ms || 1000 / 30) / this.playbackSpeed
    ); // Default to 30 FPS if not set
  }
  setPlaybackSpeed(speed: number) {
    if (speed <= 0) {
      throw new Error("Playback speed must be greater than 0");
    }
    if (this.playbackSpeed === speed) {
      return; // No change in playback speed
    }
    this.playbackSpeed = speed;
    this.startDisplayFrameWorker();
  }
  start() {
    this.tNext = this.t_start;
    if (this.fps) {
      this.frame_duration_ms = (1 / this.fps) * 1000; // Convert FPS to milliseconds
      this.fetchNext(true);
      return;
    }
    this.start_player();
  }
  private async start_player() {
    let fps;
    try {
      const res_item = await (this.engine.api_call({
        method: "item.state",
        params: { i: this.oid, full: true }
      }) as any);
      fps = res_item[0]?.meta?.fps;
      const res_info = await (this.engine.api_call({
        method: `x::${this.svc}::rec.info`,
        params: { i: this.oid, t: this.t_start, limit: 100 }
      }) as any);
      if (!fps) {
        fps = res_info?.fps;
      }
    } catch (e: any) {
      if (this.onError) {
        this.onError(new EvaError(e.message, e.code || 500));
      }
      return;
    }
    console.log("fps=", fps);
    if (!fps) {
      this.messageEOS();
      return;
    }
    console.log("fps=", fps);
    this.fps = fps;
    this.frame_duration_ms = (1 / fps) * 1000; // Convert FPS to milliseconds
    this.fetchNext(true);
  }
  close() {
    this.decoder!.close();
    clearInterval(this.displayFrameWorker);
    this.displayFrameWorker = null;
    this.frames = [];
  }
}

export enum VideoCodec {
  Raw = "raw",
  H264 = "avc1.42E01E",
  H265 = "hvc1.1.6.L93.00",
  VP8 = "vp8",
  VP9 = "vp09.00.10.08",
  AV1 = "av01.0.05M.08"
}

export interface EvaVideoStreamInfo {
  width: number;
  height: number;
  codec: VideoCodec;
  hardwareAcceleration: boolean;
}

export class EvaVideoDecoder {
  first_key_received: boolean;
  decoder?: VideoDecoder | RawDummyDecoder;
  codec?: VideoCodec;
  width?: number;
  height?: number;
  private hardwareAcceleration: boolean;
  private actualHardwareAcceleration: boolean;
  private fallback: boolean;
  fallbackToSoftware: boolean;
  onOutput: (videoFrame: VideoFrame) => void;
  onChange: (info: EvaVideoStreamInfo) => void;
  onError: (error: EvaError) => void;
  constructor() {
    this.onOutput = () => {};
    this.onChange = () => {};
    this.onError = (error) => {
      console.error("VideoDecoder error:", error);
    };
    this.hardwareAcceleration = true;
    this.actualHardwareAcceleration = true;
    this.fallbackToSoftware = true;
    this.first_key_received = false;
    this.fallback = false;
  }
  setPreferredHardwareAcceleration(enabled: boolean) {
    this.hardwareAcceleration = enabled;
  }
  isHardwareAccelerationEnabled() {
    return this.actualHardwareAcceleration;
  }
  close() {
    try {
      this.decoder?.close();
    } catch (e) {}
    this.decoder = undefined;
    this.codec = undefined;
    this.width = undefined;
    this.height = undefined;
    this.first_key_received = false;
    this.fallback = false;
  }
  decode(data: ArrayBuffer, timestamp = 0): boolean {
    let frame;
    try {
      frame = new EvaVideoFrame(data);
    } catch (error: any) {
      this.onError(error);
      return false;
    }
    if (!frame.format) {
      throw new EvaError(
        EvaErrorKind.INVALID_DATA,
        "Unsupported video format in frame"
      );
    }
    if (
      !this.decoder ||
      this.decoder.state === "closed" ||
      this.codec !== frame.format ||
      this.width !== frame.width ||
      this.height !== frame.height
    ) {
      this._createDecoder(frame);
      this.first_key_received = false; // Reset on new decoder creation
      if (this.fallback) {
        this.fallback = false;
      } else {
        this.actualHardwareAcceleration = this.hardwareAcceleration;
      }
      this.onChange({
        width: frame.width,
        height: frame.height,
        codec: frame.format,
        hardwareAcceleration: this.actualHardwareAcceleration
      });
    }
    if (!this.first_key_received) {
      if (frame.isKey()) {
        this.first_key_received = true;
      } else {
        return false; // Wait for the first key frame
      }
    }
    const chunk = new EncodedVideoChunk({
      type: frame.isKey() ? "key" : "delta",
      timestamp,
      data: frame.data
    });
    try {
      if (this.codec === VideoCodec.Raw) {
        (this.decoder as RawDummyDecoder).push_raw(frame, timestamp);
      } else {
        (this.decoder as VideoDecoder).decode(chunk);
      }
    } catch (error) {
      try {
        this.decoder?.close();
      } catch (e) {}
      this.decoder = undefined; // Reset decoder on error
      if (this.fallbackToSoftware && this.actualHardwareAcceleration) {
        // try software decoding
        this.actualHardwareAcceleration = false;
        this.fallback = true;
        return false;
      }
      this.onError(new EvaError(EvaErrorKind.FUNC_FAILED, error as string));
      return false;
    }
    return true;
  }
  _createDecoder(frame: EvaVideoFrame) {
    this.codec = frame.format;
    this.width = frame.width;
    this.height = frame.height;
    if (!this.codec) {
      throw new EvaError(
        EvaErrorKind.INVALID_DATA,
        "Unsupported video format in frame"
      );
    }
    try {
      this.decoder?.close();
    } catch (e) {}
    if (this.codec == VideoCodec.Raw) {
      this.decoder = new RawDummyDecoder({
        output: (videoFrame) => {
          this.onOutput(videoFrame);
          try {
            videoFrame.close(); // Close the video frame after processing
          } catch (e) {}
        },
        error: (error) => {
          this.onError(error);
        }
      });
    } else {
      this.decoder = new VideoDecoder({
        output: (videoFrame) => {
          this.onOutput(videoFrame);
          try {
            videoFrame.close(); // Close the video frame after processing
          } catch (e) {}
        },
        error: (error) => {
          this.onError(error);
        }
      });
    }
    const config: VideoDecoderConfig = {
      codec: this.codec
    };
    switch (this.codec) {
      case VideoCodec.H264:
        config.optimizeForLatency = true;
        config.hardwareAcceleration = this.isHardwareAccelerationEnabled()
          ? "prefer-hardware"
          : "prefer-software";
        break;
      case VideoCodec.H265:
        config.optimizeForLatency = true;
        config.hardwareAcceleration = this.isHardwareAccelerationEnabled()
          ? "prefer-hardware"
          : "prefer-software";
        break;
      case VideoCodec.VP8:
        config.optimizeForLatency = true;
        break;
      case VideoCodec.VP9:
        config.optimizeForLatency = true;
        config.hardwareAcceleration = this.isHardwareAccelerationEnabled()
          ? "prefer-hardware"
          : "prefer-software";
        break;
      case VideoCodec.AV1:
        config.optimizeForLatency = true;
        config.hardwareAcceleration = this.isHardwareAccelerationEnabled()
          ? "prefer-hardware"
          : "prefer-software";
        break;
    }
    this.decoder.configure(config);
  }
}

export class EvaVideoFrame {
  version: number;
  format?: VideoCodec;
  width: number;
  height: number;
  flags: number;
  data: Uint8Array;
  constructor(data: ArrayBuffer) {
    const magic = new Uint8Array(data, 0, 3);
    // Check for magic (EVS)
    if (magic[0] !== 69 || magic[1] !== 86 || magic[2] !== 83) {
      throw new EvaError(
        EvaErrorKind.INVALID_DATA,
        "Invalid magic number in video frame data"
      );
    }
    const header = new Uint8Array(data, 3, 10);
    const version = header[0];
    if (version !== 1) {
      throw new EvaError(
        EvaErrorKind.INVALID_DATA,
        `Unsupported video frame version: ${version}`
      );
    }
    this.version = version;
    switch (header[1]) {
      case 0:
        this.format = VideoCodec.Raw;
        break;
      case 10:
        this.format = VideoCodec.H264;
        break;
      case 11:
        this.format = VideoCodec.H265;
        break;
      case 12:
        this.format = VideoCodec.VP8;
        break;
      case 13:
        this.format = VideoCodec.VP9;
        break;
      case 14:
        this.format = VideoCodec.AV1;
        break;
    }
    this.width = (header[3] << 8) | header[2];
    this.height = (header[5] << 8) | header[4];
    this.flags = header[6];
    this.data = new Uint8Array(data, 10);
  }
  isKey() {
    return (this.flags & 0x01) !== 0;
  }
}

class RawDummyDecoder {
  private outputCallback: (videoFrame: VideoFrame) => void;
  private errorCallback: (error: EvaError) => void;
  constructor(options: {
    output: (videoFrame: VideoFrame) => void;
    error: (error: EvaError) => void;
  }) {
    this.outputCallback = options.output;
    this.errorCallback = options.error;
  }
  state() {
    return "configured";
  }
  push_raw(frame: EvaVideoFrame, timestamp: number) {
    try {
      const videoFrame = new VideoFrame(rgbToRgba(frame.data), {
        format: "RGBA",
        codedWidth: frame.width,
        codedHeight: frame.height,
        timestamp: timestamp
      });
      this.outputCallback(videoFrame);
    } catch (error) {
      this.errorCallback(
        new EvaError(EvaErrorKind.FUNC_FAILED, (error as Error).message)
      );
    }
  }
  configure(_config: VideoDecoderConfig) {
    // No-op for raw decoder
  }
  close() {
    // No-op for raw decoder
  }
}

const rgbToRgba = (rgb: Uint8Array): Uint8Array => {
  const len = rgb.length / 3;
  const rgba = new Uint8Array(len * 4);
  const view32 = new Uint32Array(rgba.buffer);
  for (let i = 0, j = 0; i < len; i++, j += 3) {
    view32[i] = rgb[j] | (rgb[j + 1] << 8) | (rgb[j + 2] << 16) | (255 << 24);
  }
  return rgba;
};
