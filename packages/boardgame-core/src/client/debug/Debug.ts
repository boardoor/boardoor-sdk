import type { _ClientImpl, ClientState, DebugOpt } from '../client';
import type { ClientManager } from '../manager';

type DebugOptions = {
  target: HTMLElement;
  props: { clientManager: ClientManager };
};

type DebugState = {
  client: _ClientImpl;
  debuggableClients: _ClientImpl[];
};

const panelStyle: Partial<CSSStyleDeclaration> = {
  background: '#18181b',
  border: '1px solid #52525b',
  borderRadius: '0.5rem',
  bottom: '0.75rem',
  boxShadow: '0 12px 30px rgb(0 0 0 / 45%)',
  color: '#fafafa',
  font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
  maxHeight: 'min(70vh, 40rem)',
  maxWidth: 'min(92vw, 36rem)',
  overflow: 'auto',
  padding: '0.75rem',
  // The toggle button is fixed to the same bottom-right corner, so reserve room
  // for it here. Without this it paints over the last line of the state output.
  paddingBottom: '3rem',
  position: 'fixed',
  right: '0.75rem',
  width: '24rem',
  zIndex: '2147483647',
};

const buttonStyle: Partial<CSSStyleDeclaration> = {
  background: '#27272a',
  border: '1px solid #71717a',
  borderRadius: '0.25rem',
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
  padding: '0.3rem 0.5rem',
};

let debugInstance = 0;

function applyStyle(element: HTMLElement, style: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, style);
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  applyStyle(element, buttonStyle);
  element.addEventListener('click', onClick);
  return element;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
  );
}

function debugOptions(client: _ClientImpl): DebugOpt {
  return client.debugOpt && client.debugOpt !== true ? client.debugOpt : {};
}

function readableState(state: ClientState): string {
  if (state === null) return 'Waiting for the initial game state…';
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      state,
      (_key, value: unknown) => {
        if (typeof value === 'bigint') return `${value}n`;
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]';
          seen.add(value);
        }
        return value;
      },
      2,
    );
  } catch {
    return 'The current game state could not be serialized.';
  }
}

/**
 * Dependency-free debug panel for local game development.
 *
 * The constructor and `$destroy` method intentionally preserve the custom Debug
 * implementation contract inherited from boardgame.io. The panel is a small,
 * Boardoor-owned diagnostic rather than a copy of boardgame.io's legacy Svelte
 * UI.
 */
export default class Debug {
  private readonly clientManager: ClientManager;
  private readonly root: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly clientSelect: HTMLSelectElement;
  private readonly stateOutput: HTMLElement;
  private managerUnsubscribe: (() => void) | undefined;
  private clientUnsubscribe: (() => void) | undefined;
  private activeClient: _ClientImpl | undefined;
  private clients: _ClientImpl[] = [];
  private expanded: boolean;

  constructor({ target, props }: DebugOptions) {
    this.clientManager = props.clientManager;
    this.root = document.createElement('aside');
    this.root.setAttribute('aria-label', 'Boardoor Debug Panel');

    this.panel = document.createElement('section');
    debugInstance += 1;
    this.panel.id = `boardoor-debug-${debugInstance}`;
    applyStyle(this.panel, panelStyle);

    const heading = document.createElement('strong');
    heading.textContent = 'Boardoor Debug';
    heading.style.display = 'block';
    heading.style.marginBottom = '0.5rem';
    this.panel.appendChild(heading);

    this.clientSelect = document.createElement('select');
    this.clientSelect.setAttribute('aria-label', 'Debug client');
    applyStyle(this.clientSelect, {
      ...buttonStyle,
      marginBottom: '0.5rem',
      width: '100%',
    });
    this.clientSelect.addEventListener('change', () => {
      const client = this.clients[Number(this.clientSelect.value)];
      if (client) this.clientManager.switchToClient(client);
    });
    this.panel.appendChild(this.clientSelect);

    const controls = document.createElement('div');
    controls.id = 'debug-controls';
    applyStyle(controls, {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '0.35rem',
      marginBottom: '0.5rem',
    });
    controls.append(
      button('Undo', () => this.activeClient?.undo()),
      button('Redo', () => this.activeClient?.redo()),
      button('Reset', () => this.activeClient?.reset()),
    );
    this.panel.appendChild(controls);

    this.stateOutput = document.createElement('pre');
    this.stateOutput.setAttribute('aria-label', 'Current game state');
    this.stateOutput.setAttribute('aria-live', 'polite');
    applyStyle(this.stateOutput, {
      background: '#09090b',
      borderRadius: '0.25rem',
      margin: '0',
      maxHeight: '24rem',
      overflow: 'auto',
      padding: '0.5rem',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    });
    this.panel.appendChild(this.stateOutput);

    this.toggle = button('Debug', () => this.setExpanded(!this.expanded));
    this.toggle.style.position = 'fixed';
    this.toggle.style.bottom = '0.75rem';
    this.toggle.style.right = '0.75rem';
    this.toggle.style.zIndex = '2147483647';
    this.toggle.setAttribute('aria-controls', this.panel.id);

    this.expanded = false;
    this.root.append(this.panel, this.toggle);
    target.appendChild(this.root);

    this.managerUnsubscribe = this.clientManager.subscribe((state) => this.updateClients(state));
    window.addEventListener('keydown', this.handleShortcut);
  }

  private readonly handleShortcut = (event: KeyboardEvent): void => {
    if (event.ctrlKey && event.key === '?' && !isEditableTarget(event.target)) {
      this.setExpanded(!this.expanded);
    }
  };

  private updateClients({ client, debuggableClients }: DebugState): void {
    this.clients = debuggableClients;
    this.clientSelect.replaceChildren(
      ...debuggableClients.map((candidate, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `Player ${candidate.playerID ?? 'unassigned'} · ${candidate.matchID}`;
        option.selected = candidate === client;
        return option;
      }),
    );
    this.clientSelect.hidden = debuggableClients.length < 2;

    if (client !== this.activeClient) {
      this.clientUnsubscribe?.();
      this.activeClient = client;
      this.clientUnsubscribe = client.subscribe((state) => {
        this.stateOutput.textContent = readableState(state);
      });

      const options = debugOptions(client);
      this.toggle.hidden = options.hideToggleButton === true;
      this.setExpanded(options.collapseOnLoad !== true);
    }
  }

  private setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.panel.hidden = !expanded;
    this.toggle.title = expanded ? 'Hide Debug Panel' : 'Show Debug Panel';
    this.toggle.setAttribute('aria-expanded', String(expanded));
  }

  $destroy(): void {
    window.removeEventListener('keydown', this.handleShortcut);
    this.clientUnsubscribe?.();
    this.managerUnsubscribe?.();
    this.root.remove();
  }
}
