declare module "ckplayer" {
  interface CKPlayerConfig {
    container: HTMLElement | string;
    video: string;
    autoplay?: boolean;
    plug?: string;
  }

  interface CKPlayerInstance {
    seek(seconds: number): void;
    time(): number;
    duration(): number;
    remove(): void;
    error(callback: () => void): void;
    ended(callback: () => void): void;
    loadstart(callback: () => void): void;
    vars(key: string, value: unknown): void;
  }

  interface CKPlayerConstructor {
    new (config: CKPlayerConfig): CKPlayerInstance;
  }

  const CKPlayer: CKPlayerConstructor;
  export default CKPlayer;
}
