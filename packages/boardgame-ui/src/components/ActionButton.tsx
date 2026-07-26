import type { ButtonHTMLAttributes } from 'react';

export function ActionButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = '', type = 'button', ...rest } = props;
  return (
    <button
      className={`short:px-4 short:py-1 short:text-xs cursor-pointer rounded-md border-none bg-[#22c55e] px-6 py-2 text-sm font-semibold text-white hover:bg-[#4ade80] disabled:cursor-not-allowed disabled:bg-[#525252] disabled:opacity-60 ${className}`}
      type={type}
      {...rest}
    />
  );
}
