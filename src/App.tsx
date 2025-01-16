import React, { useState } from 'react';
import { Container, Box, Typography } from '@mui/material';
import LanguageSelector from './components/LanguageSelector';
import StudySession from './components/StudySession';
import { Language } from './types/types';

function App() {
  const [selectedLanguage, setSelectedLanguage] = useState<Language | null>(null);

  return (
    <Container maxWidth="md">
      <Box sx={{ my: 4 }}>
        <Typography variant="h3" component="h1" gutterBottom align="center">
          Language SRS
        </Typography>
        
        {!selectedLanguage ? (
          <LanguageSelector onSelectLanguage={setSelectedLanguage} />
        ) : (
          <StudySession 
            language={selectedLanguage} 
            onExit={() => setSelectedLanguage(null)}
          />
        )}
      </Box>
    </Container>
  );
}

export default App; 