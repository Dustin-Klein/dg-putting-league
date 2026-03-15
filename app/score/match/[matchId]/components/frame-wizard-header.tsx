'use client';

import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { MatchInfo } from './wizard-types';

interface FrameWizardHeaderProps {
  match: MatchInfo;
  currentFrame: number;
  standardFrames: number;
  isOvertime: boolean;
  teamOneTotal: number;
  teamTwoTotal: number;
  onBack: () => void;
}

export function FrameWizardHeader({
  match,
  currentFrame,
  standardFrames,
  isOvertime,
  teamOneTotal,
  teamTwoTotal,
  onBack,
}: FrameWizardHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-2">
      <Button variant="ghost" size="sm" onClick={onBack} className="h-8 px-2">
        <ArrowLeft className="mr-1 h-4 w-4" />
        Setup
      </Button>
      <div className="flex items-center gap-3">
        {match.lane_label && (
          <Badge variant="secondary" className="text-sm">
            {match.lane_label}
          </Badge>
        )}
        <div className="flex items-center gap-2 font-mono">
          <div className="flex items-center gap-1">
            <span className="text-xs font-sans font-semibold text-blue-500 dark:text-blue-400" aria-hidden="true">
              T1
            </span>
            <span className="sr-only">Team 1:</span>
            <span className="text-2xl font-bold text-blue-600 dark:text-blue-300">{teamOneTotal}</span>
          </div>
          <span className="text-muted-foreground text-lg">-</span>
          <div className="flex items-center gap-1">
            <span className="sr-only">Team 2:</span>
            <span className="text-2xl font-bold text-red-600 dark:text-red-300">{teamTwoTotal}</span>
            <span className="text-xs font-sans font-semibold text-red-500 dark:text-red-400" aria-hidden="true">
              T2
            </span>
          </div>
        </div>
        <Badge variant={isOvertime ? 'destructive' : 'default'} className="text-sm">
          {isOvertime ? `OT${currentFrame - standardFrames}` : `F${currentFrame}`}
        </Badge>
      </div>
    </div>
  );
}
