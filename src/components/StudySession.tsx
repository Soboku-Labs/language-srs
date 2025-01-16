import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Card, 
  CardContent, 
  Typography, 
  Button, 
  Stack,
  LinearProgress,
  IconButton,
  Chip
} from '@mui/material';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
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
      <Box textAlign="center">
        <Typography variant="h5" gutterBottom>
          Session Complete!
        </Typography>
        <Typography variant="body1" gutterBottom>
          Total Cards Reviewed: {studyStats.totalReviewed}
          <br />
          Accuracy: {((studyStats.correct / studyStats.totalReviewed) * 100).toFixed(1)}%
          <br />
          Best Streak: {studyStats.streak}
        </Typography>
        <Button variant="contained" onClick={onExit}>
          Return to Language Selection
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          {language.name} - {currentCard.level}
        </Typography>
        <LinearProgress 
          variant="determinate" 
          value={((studyStats.totalReviewed) / (remainingCards.length + studyStats.totalReviewed)) * 100} 
        />
      </Box>

      <Card sx={{ minHeight: 200, mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={2} justifyContent="center" alignItems="center">
            <Typography variant="h3" align="center">
              {currentCard.word}
            </Typography>
            {currentCard.audioUrl && (
              <IconButton onClick={playAudio}>
                <VolumeUpIcon />
              </IconButton>
            )}
          </Stack>

          {isRevealed && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h5" align="center" color="textSecondary" gutterBottom>
                {currentCard.pronunciation}
              </Typography>
              <Typography variant="h5" align="center" gutterBottom>
                {currentCard.meaning}
              </Typography>
              {currentCard.examples.map((example, index) => (
                <Typography key={index} variant="body1" align="center" gutterBottom>
                  {example}
                </Typography>
              ))}
              {currentCard.tags.map((tag, index) => (
                <Chip key={index} label={tag} sx={{ m: 0.5 }} />
              ))}
            </Box>
          )}
        </CardContent>
      </Card>

      {!isRevealed ? (
        <Button 
          variant="contained" 
          fullWidth 
          onClick={handleReveal}
        >
          Reveal Answer
        </Button>
      ) : (
        <Stack direction="row" spacing={2}>
          <Button 
            variant="contained" 
            color="error" 
            onClick={() => handleGrade(1)}
            fullWidth
          >
            Hard
          </Button>
          <Button 
            variant="contained" 
            color="warning" 
            onClick={() => handleGrade(2)}
            fullWidth
          >
            Good
          </Button>
          <Button 
            variant="contained" 
            color="success" 
            onClick={() => handleGrade(3)}
            fullWidth
          >
            Easy
          </Button>
        </Stack>
      )}
    </Box>
  );
};

export default StudySession;