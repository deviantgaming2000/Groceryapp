declare module "three";

declare module "vanta/dist/vanta.fog.min" {
  interface VantaEffect {
    destroy: () => void;
    resize?: () => void;
    setOptions?: (options: Record<string, unknown>) => void;
  }
  const FOG: (options: Record<string, unknown>) => VantaEffect;
  export default FOG;
}
