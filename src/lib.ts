const eva_webengine_multimedia_version = "0.1.0";

import { Eva, EvaErrorKind, EvaError } from "@eva-ics/webengine";

let eva: Eva | null = null;

export const get_engine = (): Eva | null => {
  return eva;
};

export const set_engine = (engine: Eva) => {
  eva = engine;
  (eva as any).we_multimedia_version = eva_webengine_multimedia_version;
};

export enum EvaLivePlayerAutoSize {
  None = "none",
  KeepWidth = "keep-width",
  KeepHeight = "keep-height",
  Resize = "resize"
}

export interface EvaLivePlayerParameters {
  canvas: HTMLCanvasElement;
  autoSize?: EvaLivePlayerAutoSize;
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
  autoSize: EvaLivePlayerAutoSize;
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
    this.autoSize = params.autoSize ?? EvaLivePlayerAutoSize.None;
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
        case EvaLivePlayerAutoSize.KeepWidth:
          this.canvas.height = (this.canvas.width * info.height) / info.width;
          break;
        case EvaLivePlayerAutoSize.KeepHeight:
          this.canvas.width = (this.canvas.height * info.width) / info.height;
          break;
        case EvaLivePlayerAutoSize.Resize:
          this.canvas.width = info.width;
          this.canvas.height = info.height;
          break;
        case EvaLivePlayerAutoSize.None:
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

export enum VideoCodec {
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
  decoder?: VideoDecoder;
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
  decode(data: ArrayBuffer): boolean {
    const frame = new EvaVideoFrame(data);
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
      timestamp: 0, // Timestamp is not used in this example
      data: frame.data
    });
    try {
      this.decoder?.decode(chunk);
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
  metadata: number;
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
    this.metadata = header[6];
    this.data = new Uint8Array(data, 10);
  }
  isKey() {
    return (this.metadata & 0x01) !== 0;
  }
}
