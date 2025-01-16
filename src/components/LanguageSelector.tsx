import React from 'react';
import { Card } from '@nextui-org/react';
import { languages } from '../config/languages';
import { Language } from '../types/types';

interface LanguageSelectorProps {
  onSelectLanguage: (language: Language) => void;
}

const LanguageSelector: React.FC<LanguageSelectorProps> = ({ onSelectLanguage }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {languages.map((language) => (
        <Card
          key={language.code}
          isPressable
          isHoverable
          onClick={() => onSelectLanguage(language)}
        >
          <div className="p-4">
            <h2 className="text-xl mb-2">
              {language.name}
            </h2>
            <p className="text-gray-500">
              {language.examType}
            </p>
          </div>
        </Card>
      ))}
    </div>
  );
};

export default LanguageSelector;