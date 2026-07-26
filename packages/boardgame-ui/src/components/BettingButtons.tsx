import type { ButtonHTMLAttributes } from 'react';

type BetTone = 'red' | 'blue' | 'purple' | 'emerald';

const BET_TONE: Record<BetTone, string> = {
  red: 'bg-red-700 hover:bg-red-600 active:bg-red-800',
  blue: 'bg-blue-700 hover:bg-blue-600 active:bg-blue-800',
  purple: 'bg-purple-700 hover:bg-purple-600 active:bg-purple-800',
  emerald: 'bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800',
};

export function BetActionButton({
  tone,
  className = '',
  ...rest
}: { tone: BetTone } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const { type = 'button', ...buttonProps } = rest;
  return (
    <button
      className={`short:px-2 short:py-1 short:text-xs rounded-md px-3 py-1.5 text-sm text-white ${BET_TONE[tone]} ${className}`}
      type={type}
      {...buttonProps}
    />
  );
}

export function StepperButton({
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { type = 'button', ...buttonProps } = rest;
  return (
    <button
      className={`short:w-6 short:h-6 h-7 w-7 rounded bg-white/10 text-sm font-bold text-neutral-300 hover:bg-white/20 active:bg-white/30 disabled:opacity-30 ${className}`}
      type={type}
      {...buttonProps}
    />
  );
}

export function PresetButton({
  label,
  value,
  onClick,
}: {
  label: string;
  value: number;
  onClick: (v: number) => void;
}) {
  return (
    <button
      className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-neutral-300 hover:bg-white/20 active:bg-white/30"
      onClick={() => onClick(value)}
      type="button"
    >
      {label}
    </button>
  );
}
