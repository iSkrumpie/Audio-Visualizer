/// <reference types="vite/client" />

// EyeDropper API — available in Chrome 95+, not yet in TypeScript's DOM lib
interface EyeDropperResult {
  sRGBHex: string;
}
interface EyeDropper {
  open(options?: { signal?: AbortSignal }): Promise<EyeDropperResult>;
}
declare const EyeDropper: {
  new (): EyeDropper;
  prototype: EyeDropper;
};

declare module '*.vert' {
  const value: string;
  export default value;
}
declare module '*.frag' {
  const value: string;
  export default value;
}
declare module '*.glsl' {
  const value: string;
  export default value;
}
