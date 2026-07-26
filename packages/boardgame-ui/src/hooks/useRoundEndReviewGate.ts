import { useEffect, useState } from 'react';

export function useRoundEndReviewGate(isPending: boolean) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isPending) setIsOpen(false);
  }, [isPending]);

  return {
    isRoundEndReviewOpen: isPending && isOpen,
    shouldShowRoundEndReviewPrompt: isPending && !isOpen,
    openRoundEndReview: () => setIsOpen(true),
  };
}
