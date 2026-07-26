import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { ActionButton } from '../components/ActionButton';
import { BetActionButton, StepperButton, PresetButton } from '../components/BettingButtons';
import { GameOverOverlay } from '../components/GameOverOverlay';
import { LoadingScreen } from '../components/LoadingScreen';
import { ReconnectBanner } from '../components/ReconnectBanner';
import { ScoreBadge } from '../components/ScoreBadge';
import { SortButtons } from '../components/SortButtons';

function renderToDiv(element: React.ReactElement): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return container;
}

describe('ReconnectBanner', () => {
  it('renders nothing when show=false', () => {
    const el = renderToDiv(<ReconnectBanner show={false} />);
    expect(el.innerHTML).toBe('');
  });

  it('renders banner when show=true (English fallback without i18n)', () => {
    const el = renderToDiv(<ReconnectBanner show={true} />);
    expect(el.textContent).toBe('Reconnecting...');
    expect(el.querySelector('.animate-reconnect-pulse')).toBeTruthy();
    expect(el.querySelector('output')?.getAttribute('aria-live')).toBe('polite');
  });
});

describe('LoadingScreen', () => {
  it('renders loading text (English fallback without i18n)', () => {
    const el = renderToDiv(<LoadingScreen />);
    expect(el.textContent).toBe('Loading...');
    expect(el.querySelector('output')?.getAttribute('aria-live')).toBe('polite');
    expect(el.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
});

describe('ActionButton', () => {
  it('renders with green button classes', () => {
    const el = renderToDiv(<ActionButton>Click</ActionButton>);
    const btn = el.querySelector('button')!;
    expect(btn.textContent).toBe('Click');
    expect(btn.className).toContain('bg-[#22c55e]');
    expect(btn.type).toBe('button');
  });

  it('passes disabled prop', () => {
    const el = renderToDiv(<ActionButton disabled>Nope</ActionButton>);
    expect(el.querySelector('button')!.disabled).toBe(true);
  });
});

describe('BetActionButton', () => {
  it.each([
    ['red', 'bg-red-700'],
    ['blue', 'bg-blue-700'],
    ['purple', 'bg-purple-700'],
    ['emerald', 'bg-emerald-700'],
  ] as const)('maps tone=%s to %s', (tone, expected) => {
    const el = renderToDiv(<BetActionButton tone={tone}>Bet</BetActionButton>);
    const btn = el.querySelector('button')!;
    expect(btn.className).toContain(expected);
    expect(btn.className).toContain('rounded-md');
    expect(btn.type).toBe('button');
  });

  it('uses visible text as the accessible name (no baked aria-label)', () => {
    const el = renderToDiv(<BetActionButton tone="red">Fold</BetActionButton>);
    const btn = el.querySelector('button')!;
    expect(btn.textContent).toBe('Fold');
    expect(btn.getAttribute('aria-label')).toBeNull();
  });
});

describe('StepperButton', () => {
  it('renders structural classes and passes disabled + aria-label', () => {
    const el = renderToDiv(
      <StepperButton aria-label="Increase" disabled>
        +
      </StepperButton>,
    );
    const btn = el.querySelector('button')!;
    expect(btn.className).toContain('disabled:opacity-30');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('Increase');
    expect(btn.type).toBe('button');
  });
});

describe('PresetButton', () => {
  it('renders its label as the accessible name and fires onClick with the value', () => {
    let received = -1;
    const el = renderToDiv(
      <PresetButton
        label="Min"
        value={42}
        onClick={(v) => {
          received = v;
        }}
      />,
    );
    const btn = el.querySelector('button')!;
    expect(btn.textContent).toBe('Min');
    expect(btn.getAttribute('aria-label')).toBeNull();
    expect(btn.type).toBe('button');
    act(() => {
      btn.click();
    });
    expect(received).toBe(42);
  });
});

describe('GameOverOverlay', () => {
  it('renders winner text in a uniquely labelled alert dialog and moves focus', async () => {
    const el = renderToDiv(<GameOverOverlay winnerText="Alice wins!" />);
    expect(el.textContent).toContain('Game Over!');
    expect(el.textContent).toContain('Alice wins!');
    const dialog = el.querySelector('[role="alertdialog"]')!;
    const panel = dialog.firstElementChild as HTMLElement;
    const titleId = dialog.getAttribute('aria-labelledby')!;
    const winnerId = dialog.getAttribute('aria-describedby')!;
    expect(document.getElementById(titleId)?.textContent).toContain('Game Over!');
    expect(document.getElementById(winnerId)?.textContent).toContain('Alice wins!');
    await vi.waitFor(() => expect(document.activeElement).toBe(panel));
  });

  it('accepts custom className props', () => {
    const el = renderToDiv(
      <GameOverOverlay
        winnerText="Bob"
        titleClassName="text-red-500"
        panelClassName="border-2 border-red-500"
      />,
    );
    const h2 = el.querySelector('h2')!;
    expect(h2.className).toContain('text-red-500');
  });

  it('uses distinct labels when multiple overlays are rendered', () => {
    const el = renderToDiv(
      <>
        <GameOverOverlay winnerText="Alice" />
        <GameOverOverlay winnerText="Bob" />
      </>,
    );
    const dialogs = el.querySelectorAll('[role="alertdialog"]');
    expect(dialogs[0].getAttribute('aria-labelledby')).not.toBe(
      dialogs[1].getAttribute('aria-labelledby'),
    );
    expect(dialogs[0].getAttribute('aria-describedby')).not.toBe(
      dialogs[1].getAttribute('aria-describedby'),
    );
  });

  it('confirmFirst shows only Show Results button initially', () => {
    const el = renderToDiv(<GameOverOverlay confirmFirst winnerText="Alice wins!" />);
    expect(el.textContent).toContain('Show Results');
    expect(el.textContent).not.toContain('Game Over!');
    expect(el.textContent).not.toContain('Alice wins!');
  });

  it('confirmFirst reveals overlay after clicking Show Results', () => {
    let confirmed = false;
    const el = renderToDiv(
      <GameOverOverlay
        confirmFirst
        winnerText="Alice wins!"
        onConfirm={() => {
          confirmed = true;
        }}
      />,
    );
    const btn = el.querySelector('button')!;
    expect(btn.textContent).toBe('Show Results');
    expect(btn.type).toBe('button');
    expect(confirmed).toBe(false);
    act(() => {
      btn.click();
    });
    expect(el.textContent).toContain('Game Over!');
    expect(el.textContent).toContain('Alice wins!');
    expect(confirmed).toBe(true);
  });
});

describe('ScoreBadge', () => {
  it('renders active style', () => {
    const el = renderToDiv(<ScoreBadge isActive={true}>P1: 10</ScoreBadge>);
    const badge = el.querySelector('span')!;
    expect(badge.className).toContain('border-gold');
    expect(badge.textContent).toBe('P1: 10');
    expect(badge.getAttribute('aria-current')).toBe('true');
  });

  it('renders inactive style', () => {
    const el = renderToDiv(<ScoreBadge isActive={false}>P2: 5</ScoreBadge>);
    const badge = el.querySelector('span')!;
    expect(badge.className).toContain('border-transparent');
  });

  it('uses a non-submitting button only when interactive', () => {
    const el = renderToDiv(
      <ScoreBadge isActive={false} onClick={() => {}}>
        P2: 5
      </ScoreBadge>,
    );
    expect(el.querySelector('button')?.type).toBe('button');
  });
});

describe('SortButtons', () => {
  it('renders Suit and Rank buttons (English fallback)', () => {
    const el = renderToDiv(<SortButtons mode="suit" setMode={() => {}} />);
    const buttons = el.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe('Suit');
    expect(buttons[1].textContent).toBe('Rank');
    expect(buttons[0].type).toBe('button');
    expect(el.querySelector('[role="toolbar"]')?.getAttribute('aria-label')).toBe('Sort');
  });

  it('highlights active mode', () => {
    const el = renderToDiv(<SortButtons mode="rank" setMode={() => {}} />);
    const buttons = el.querySelectorAll('button');
    expect(buttons[1].className).toContain('text-green-400');
    expect(buttons[0].className).not.toContain('text-green-400');
  });
});
