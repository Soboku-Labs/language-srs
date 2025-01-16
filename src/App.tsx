import React, { useState } from 'react';
import { Card, Button } from '@nextui-org/react';
import { languages } from './config/languages';
import { Language } from './types/types';
import StudySession from './components/StudySession';
import './App.css';

const App: React.FC = () => {
  const [selectedLanguage, setSelectedLanguage] = useState<Language | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);

  const handleLanguageSelect = (language: Language) => {
    setSelectedLanguage(language);
    setSelectedLevel(null);
  };

  const handleLevelSelect = (level: string) => {
    setSelectedLevel(level);
  };

  const handleBack = () => {
    if (selectedLevel) {
      setSelectedLevel(null);
    } else {
      setSelectedLanguage(null);
    }
  };

  if (selectedLanguage && selectedLevel) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Button 
          color="primary"
          variant="light"
          onClick={handleBack}
          className="mb-6"
          startContent={<span>←</span>}
        >
          Back
        </Button>
        <StudySession 
          language={selectedLanguage} 
          onExit={() => setSelectedLevel(null)}
        />
      </div>
    );
  }

  if (selectedLanguage) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Button 
          color="primary"
          variant="light"
          onClick={handleBack}
          className="mb-6"
          startContent={<span>←</span>}
        >
          Back
        </Button>
        <h2 className="text-3xl font-bold mb-8 text-gray-800">
          {selectedLanguage.name} - Select Level
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {selectedLanguage.levels.map((level) => (
            <Card 
              key={level}
              isPressable 
              isHoverable
              className="bg-white"
              onClick={() => handleLevelSelect(level)}
            >
              <div className="p-6">
                <h4 className="text-xl font-bold mb-2">{level}</h4>
                <p className="text-gray-600">
                  Start studying {selectedLanguage.name} vocabulary for {level}
                </p>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold text-center mb-12 text-gray-800">
        Language Learning with SRS
      </h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {languages.map((language) => (
          <Card 
            key={language.code}
            isPressable 
            isHoverable
            className="bg-white"
            onClick={() => handleLanguageSelect(language)}
          >
            <div className="p-6">
              <h3 className="text-2xl font-bold mb-2">{language.name}</h3>
              <p className="text-sm font-medium text-primary mb-3">
                {language.examType}
              </p>
              <p className="text-gray-600 mb-4">
                {language.description}
              </p>
              <p className="text-sm font-medium text-gray-500">
                {language.totalWords.toLocaleString()} words available
              </p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default App;