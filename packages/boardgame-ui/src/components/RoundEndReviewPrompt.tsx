import { ActionButton } from './ActionButton';

export function RoundEndReviewPrompt({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <ActionButton
        onClick={onClick}
        className="pointer-events-auto bg-cyan-600 px-5 py-2 text-sm shadow-xl hover:bg-cyan-500"
      >
        {label}
      </ActionButton>
    </div>
  );
}
