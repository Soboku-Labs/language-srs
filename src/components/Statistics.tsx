import React from 'react';
import { 
  Box, 
  Card, 
  CardContent, 
  Typography, 
  Grid,
  LinearProgress 
} from '@mui/material';
import { UserProgress } from '../../../src/types/types';

interface StatisticsProps {
  progress: UserProgress;
}

const Statistics: React.FC<StatisticsProps> = ({ progress }) => {
  return (
    <Card>
      <CardContent>
        <Typography variant="h5" gutterBottom>
          Progress - {progress.language}
        </Typography>
        
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Typography variant="body2" color="textSecondary">
              Words Learned
            </Typography>
            <LinearProgress 
              variant="determinate" 
              value={(progress.wordsLearned / 1000) * 100} 
            />
            <Typography variant="body2">
              {progress.wordsLearned}/1000
            </Typography>
          </Grid>

          <Grid item xs={6}>
            <Typography variant="h6">
              {progress.accuracy}%
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Accuracy
            </Typography>
          </Grid>

          <Grid item xs={6}>
            <Typography variant="h6">
              {progress.streakDays} days
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Current Streak
            </Typography>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
};

export default Statistics; 