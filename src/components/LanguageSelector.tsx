import React from 'react';
import { Grid, Card, CardContent, Typography, Button } from '@mui/material';
import { languages } from '../config/languages';
import { Language } from '../types/types';

interface LanguageSelectorProps {
  onSelectLanguage: (language: Language) => void;
}

const LanguageSelector: React.FC<LanguageSelectorProps> = ({ onSelectLanguage }) => {
  return (
    <Grid container spacing={3}>
      {languages.map((language) => (
        <Grid item xs={12} sm={4} key={language.code}>
          <Card>
            <CardContent>
              <Typography variant="h5" component="h2">
                {language.name}
              </Typography>
              <Typography color="textSecondary">
                {language.examType}
              </Typography>
              <Button 
                variant="contained" 
                onClick={() => onSelectLanguage(language)}
                sx={{ mt: 2 }}
              >
                Start Studying
              </Button>
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
};

export default LanguageSelector; 