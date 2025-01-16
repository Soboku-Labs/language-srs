interface SRSReviewResult {
  nextReview: Date;
  interval: number;
  easeFactor: number;
}

export const calculateNextReview = (
  grade: 1 | 2 | 3,
  currentInterval: number,
  currentEaseFactor: number
): SRSReviewResult => {
  let newEaseFactor = currentEaseFactor;
  let newInterval: number;

  // Adjust ease factor based on performance
  if (grade === 1) { // Hard
    newEaseFactor = Math.max(1.3, currentEaseFactor - 0.2);
    newInterval = Math.max(1, Math.floor(currentInterval * 1.2));
  } else if (grade === 2) { // Good
    newEaseFactor = currentEaseFactor;
    newInterval = Math.ceil(currentInterval * currentEaseFactor);
  } else { // Easy
    newEaseFactor = currentEaseFactor + 0.1;
    newInterval = Math.ceil(currentInterval * currentEaseFactor * 1.3);
  }

  // Calculate next review date
  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + newInterval);

  return {
    nextReview,
    interval: newInterval,
    easeFactor: newEaseFactor
  };
}; 