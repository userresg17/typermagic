// core/agent/platform/types.ts
// Abstração por plataforma do CONTROLE DE DESKTOP (tela + mouse + teclado). O agente de
// desktop fala só com esta interface; macOS (sidecar pyobjc) e Linux (xdotool) implementam.
// Coordenadas são sempre na RESOLUÇÃO LÓGICA do screenshot (ver getScreenSize) — a
// implementação converte p/ pontos/pixels do SO.

export interface Screenshot {
  /** PNG base64 já na resolução lógica */
  png_base64: string;
  width: number;
  height: number;
  /** pixels por unidade lógica no display real (2 no Retina) — informativo */
  scale: number;
  backend?: string;
}

export interface ScreenSize {
  width: number;
  height: number;
  scale: number;
}

export interface Platform {
  readonly name: "macos" | "linux";
  screenshot(): Promise<Screenshot>;
  click(x: number, y: number, button?: "left" | "right"): Promise<void>;
  double_click(x: number, y: number): Promise<void>;
  type(text: string): Promise<void>;
  key(combo: string): Promise<void>;
  scroll(x: number, y: number, dy: number, dx?: number): Promise<void>;
  drag(x1: number, y1: number, x2: number, y2: number): Promise<void>;
  mouse_move(x: number, y: number): Promise<void>;
  mouse_location(): Promise<{ x: number; y: number }>;
  get_screen_size(): Promise<ScreenSize>;
  close(): Promise<void>;
}

/** Nó da árvore de acessibilidade (achatado), já em coordenadas LÓGICAS. */
export interface AxNode {
  id: number;
  depth: number;
  role: string;
  label: string;
  value: string;
  pos: [number, number] | null;
  size: [number, number] | null;
  actions: string[];
  enabled: boolean;
}

export interface AxTree {
  app: { name: string; localized?: string; pid: number; bundle: string };
  nodes: AxNode[];
  truncated: boolean;
}

/** Capacidades extras do macOS (acessibilidade + scripting). Opcionais na Platform. */
export interface DesktopExtras {
  frontmost_app(): Promise<{ name: string; localized?: string; pid: number; bundle: string }>;
  ax_tree(): Promise<AxTree>;
  ax_act(id: number, action?: string, value?: string): Promise<void>;
  ax_center(id: number): Promise<{ x: number; y: number } | null>;
  open_app(name: string): Promise<void>;
  focus_app(name: string): Promise<void>;
  quit_app(name: string): Promise<void>;
  run_jxa(source: string, args?: string[]): Promise<string>;
  tcc(): Promise<{ screen_recording: boolean; accessibility: boolean; binary: string; instructions: string[] }>;
}

export type DesktopSession = Platform &
  Partial<DesktopExtras> & {
    /** app que deve estar em foco p/ eventos de entrada (o agente define por passo) */
    expectApp?: string;
  };
