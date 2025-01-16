import React from 'react';
import { Card } from '@nextui-org/react';
import { UserProgress } from '../types/types';

interface StatisticsProps {
  progress: UserProgress;
}

const Statistics: React.FC<StatisticsProps> = ({ progress }) => {
  return (
    <Card className="w-full max-w-md bg-white shadow-xl">
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-6 text-gray-800">
          Progress - {progress.language}
        </h2>
        
        <div className="space-y-6">
          <div>
            <p className="text-gray-600 font-medium mb-2">
              Words Learned
            </p>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div 
                className="bg-primary h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${(progress.wordsLearned / 1000) * 100}%` }}
              />
            </div>
            <p className="mt-2 text-sm font-medium text-gray-600">
              {progress.wordsLearned}/1000
            </p>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-2xl font-bold text-primary">
                {progress.accuracy}%
              </h3>
              <p className="text-gray-600 font-medium">
                Accuracy
              </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-2xl font-bold text-primary">
                {progress.streakDays}
              </h3>
              <p className="text-gray-600 font-medium">
                Day Streak 🔥
              </p>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default Statistics;