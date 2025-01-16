import React, { useState, useEffect } from 'react';
import { Card, Button, Progress } from '@nextui-org/react';
import { VocabularyItem, Language } from '../types/types';
import { calculateNextReview } from '../utils/srsAlgorithm';
import { sampleVocabulary } from '../data/vocabulary';

interface StudySessionProps {
  language: Language;
  onExit: () => void;
}

const StudySession: React.FC<StudySessionProps> = ({ language, onExit }) => {
  const [currentCard, setCurrentCard] = useState<VocabularyItem | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [remainingCards, setRemainingCards] = useState<VocabularyItem[]>([]);
  const [studyStats, setStudyStats] = useState({
    totalReviewed: 0,
    correct: 0,
    streak: 0
  });
  const [startTime, setStartTime] = useState<Date>(new Date());

  useEffect(() => {
    const filteredCards = sampleVocabulary.filter(
      item => item.language === language.code && 
      new Date(item.nextReview) <= new Date()
    );
    setRemainingCards(filteredCards);
    if (filteredCards.length > 0) {
      setCurrentCard(filteredCards[0]);
    }
    setStartTime(new Date());
  }, [language]);

  const playAudio = () => {
    if (currentCard?.audioUrl) {
      new Audio(currentCard.audioUrl).play();
    }
  };

  const handleReveal = () => {
    setIsRevealed(true);
  };

  const handleGrade = (grade: 1 | 2 | 3) => {
    if (!currentCard) return;

    const timeTaken = new Date().getTime() - startTime.getTime();
    const srsResult = calculateNextReview(
      grade,
      currentCard.interval,
      currentCard.easeFactor
    );

    // Update stats
    setStudyStats(prev => ({
      totalReviewed: prev.totalReviewed + 1,
      correct: prev.correct + (grade > 1 ? 1 : 0),
      streak: grade > 1 ? prev.streak + 1 : 0
    }));

    // Update card with new SRS data and review history
    const updatedCard = {
      ...currentCard,
      ...srsResult,
      reviewHistory: [
        ...currentCard.reviewHistory,
        { date: new Date(), grade, timeTaken }
      ]
    };

    // Here you would typically save the updated card to your backend

    setIsRevealed(false);
    setRemainingCards(prev => prev.slice(1));
    setStartTime(new Date());
    
    if (remainingCards.length > 1) {
      setCurrentCard(remainingCards[1]);
    } else {
      setCurrentCard(null);
    }
  };

  if (!currentCard) {
    return (
      <Card className="w-full max-w-lg mx-auto bg-white p-8 text-center">
        <h3 className="text-2xl font-bold mb-6">Session Complete! 🎉</h3>
        <div className="space-y-4 mb-8">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-lg font-medium">Total Cards Reviewed</p>
            <p className="text-3xl font-bold text-primary">{studyStats.totalReviewed}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-lg font-medium">Accuracy</p>
            <p className="text-3xl font-bold text-primary">
              {((studyStats.correct / studyStats.totalReviewed) * 100).toFixed(1)}%
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-lg font-medium">Best Streak</p>
            <p className="text-3xl font-bold text-primary">{studyStats.streak}</p>
          </div>
        </div>
        <Button 
          color="primary" 
          size="lg"
          className="w-full"
          onClick={onExit}
        >
          Return to Language Selection
        </Button>
      </Card>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-bold text-gray-800">
          {language.name} - {currentCard.level}
        </h3>
        <div className="text-sm font-medium text-gray-600">
          {studyStats.totalReviewed + 1}/{remainingCards.length + studyStats.totalReviewed}
        </div>
      </div>

      <div className="w-full bg-gray-200 rounded-full h-2 mb-8">
        <div 
          className="bg-primary h-2 rounded-full transition-all duration-300"
          style={{ 
            width: `${((studyStats.totalReviewed) / (remainingCards.length + studyStats.totalReviewed)) * 100}%` 
          }}
        />
      </div>

      <Card className="w-full bg-white shadow-lg mb-6">
        <div className="p-8">
          <div className="flex justify-center items-center gap-4 mb-6">
            <h2 className="text-3xl font-bold">{currentCard.word}</h2>
            {currentCard.audioUrl && (
              <Button 
                isIconOnly
                color="primary" 
                variant="light"
                onClick={playAudio}
                className="text-lg"
              >
                🔊
              </Button>
            )}
          </div>

          {isRevealed && (
            <div className="space-y-4 mt-6">
              <div className="text-gray-600 text-lg">
                {currentCard.pronunciation}
              </div>
              <div className="text-xl font-medium">
                {currentCard.meaning}
              </div>
              <div className="space-y-2">
                {currentCard.examples.map((example, index) => (
                  <div key={index} className="bg-gray-50 p-3 rounded-lg text-gray-700">
                    {example}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {!isRevealed ? (
        <Button 
          size="lg"
          color="primary"
          className="w-full"
          onClick={handleReveal}
        >
          Reveal Answer
        </Button>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <Button 
            size="lg"
            color="danger" 
            className="w-full"
            onClick={() => handleGrade(1)}
          >
            Hard
          </Button>
          <Button 
            size="lg"
            color="warning"
            className="w-full"
            onClick={() => handleGrade(2)}
          >
            Good
          </Button>
          <Button 
            size="lg"
            color="success"
            className="w-full"
            onClick={() => handleGrade(3)}
          >
            Easy
          </Button>
        </div>
      )}
    </div>
  );
};

export default StudySession;