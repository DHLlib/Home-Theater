declare module "ckplayer" {
  interface CKPlayerConfig {
    container: HTMLElement | string;
    video: string;
    autoplay?: boolean;
    html5m3u8?: boolean;
  }

  class CKPlayer {
    constructor(config: CKPlayerConfig);
    video: HTMLVideoElement;
    remove(): void;
  }

  export default CKPlayer;
}
