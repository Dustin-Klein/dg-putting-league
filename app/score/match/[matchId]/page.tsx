'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { MatchSetup } from './components/match-setup';
import { FrameWizard } from './components/frame-wizard';
import { ReviewSubmit } from './components/review-submit';
import type { WizardStage, MatchInfo, ScoreState } from './components/wizard-types';
import { STANDARD_FRAMES, getFrameNumbers, getScoreKey } from './components/wizard-types';

export default function MatchScoringPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const router = useRouter();
  const [matchId, setMatchId] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [bonusPointEnabled, setBonusPointEnabled] = useState(true);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCompleting, setIsCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wizard state
  const [wizardStage, setWizardStage] = useState<WizardStage>('setup');
  const [currentFrame, setCurrentFrame] = useState(1);

  // Optimistic local scores for immediate UI feedback
  const [localScores, setLocalScores] = useState<ScoreState>(new Map());

  // Track if we're currently saving to avoid refetch during our own updates
  const isSavingRef = useRef(false);

  // Resolve params
  useEffect(() => {
    params.then((p) => setMatchId(p.matchId));
  }, [params]);

  const fetchMatch = useCallback(async (code: string, id: string, showLoading = true) => {
    try {
      if (showLoading) {
        setIsLoading(true);
      }
      const response = await fetch(`/api/score/match/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: code }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to load match');
      }

      const data = await response.json();
      setMatch(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load match');
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const code = sessionStorage.getItem('scoring_access_code');
    if (!code) {
      router.push('/score');
      return;
    }
    setAccessCode(code);

    // Get bonus point setting from event
    const fetchEvent = async () => {
      const response = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: code }),
      });
      if (response.ok) {
        const data = await response.json();
        setBonusPointEnabled(data.event.bonus_point_enabled);
      }
    };
    fetchEvent();
  }, [router]);

  useEffect(() => {
    if (accessCode && matchId) {
      fetchMatch(accessCode, matchId, true);
    }
  }, [accessCode, matchId, fetchMatch]);

  // Realtime subscription for frame_results changes
  useEffect(() => {
    if (!matchId || !accessCode) return;

    const supabase = createClient();
    const bracketMatchId = parseInt(matchId, 10);

    if (isNaN(bracketMatchId)) return;

    const channel = supabase
      .channel(`public-match-scoring-${bracketMatchId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'frame_results',
          filter: `bracket_match_id=eq.${bracketMatchId}`,
        },
        () => {
          // Only refetch if we're not the one saving
          if (!isSavingRef.current) {
            fetchMatch(accessCode, matchId, false);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, accessCode, fetchMatch]);

  const handleScoreChange = async (
    eventPlayerId: string,
    frameNumber: number,
    puttsMade: number
  ): Promise<void> => {
    if (!accessCode || !matchId) return;

    const saveKey = getScoreKey(eventPlayerId, frameNumber);

    // Optimistic update: immediately update local state for responsive UI
    setLocalScores(prev => {
      const next = new Map(prev);
      next.set(saveKey, puttsMade);
      return next;
    });

    isSavingRef.current = true;

    try {
      const response = await fetch(`/api/score/match/${matchId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_code: accessCode,
          frame_number: frameNumber,
          event_player_id: eventPlayerId,
          putts_made: puttsMade,
          bonus_point_enabled: bonusPointEnabled,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save score');
      }

      const updatedMatch = await response.json();
      setMatch(updatedMatch);

      // Clear local score now that server has confirmed
      setLocalScores(prev => {
        const next = new Map(prev);
        next.delete(saveKey);
        return next;
      });
    } catch (err) {
      console.error('Failed to save score:', err);
      // Revert optimistic update on error
      setLocalScores(prev => {
        const next = new Map(prev);
        next.delete(saveKey);
        return next;
      });
    } finally {
      isSavingRef.current = false;
    }
  };

  const handleComplete = async () => {
    if (!accessCode || !matchId || !match) return;

    if (match.team_one_score === match.team_two_score) {
      setError('Scores are tied. Continue scoring in overtime until there is a winner.');
      return;
    }

    setIsCompleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/score/match/${matchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: accessCode }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to complete match');
      }

      router.push('/score/matches');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete match');
    } finally {
      setIsCompleting(false);
    }
  };

  // Wizard navigation handlers
  const handleBeginScoring = () => {
    // If match already has scores, start from where they left off
    if (match && match.frames.length > 0) {
      // Find the first incomplete frame
      const frameNumbers = getFrameNumbers(match);
      const allPlayers = [...match.team_one.players, ...match.team_two.players];

      for (const frameNum of frameNumbers) {
        const frame = match.frames.find(f => f.frame_number === frameNum);
        const isComplete = allPlayers.every(player => {
          const result = frame?.results.find(r => r.event_player_id === player.event_player_id);
          return result?.putts_made !== undefined;
        });

        if (!isComplete) {
          setCurrentFrame(frameNum);
          setWizardStage('scoring');
          return;
        }
      }

      // All frames complete, go to the last one
      setCurrentFrame(frameNumbers[frameNumbers.length - 1]);
    } else {
      setCurrentFrame(1);
    }
    setWizardStage('scoring');
  };

  const handleNextFrame = () => {
    if (!match) return;

    const frameNumbers = getFrameNumbers(match);
    const currentIndex = frameNumbers.indexOf(currentFrame);

    // Check if we need overtime
    if (currentFrame >= STANDARD_FRAMES && match.team_one_score === match.team_two_score) {
      // Add overtime frame
      setCurrentFrame(currentFrame + 1);
    } else if (currentIndex < frameNumbers.length - 1) {
      setCurrentFrame(frameNumbers[currentIndex + 1]);
    }
  };

  const handlePrevFrame = () => {
    if (currentFrame > 1) {
      setCurrentFrame(currentFrame - 1);
    }
  };

  const handleGoToFrame = (frameNumber: number) => {
    setCurrentFrame(frameNumber);
  };

  const handleFinishScoring = () => {
    setWizardStage('review');
  };

  const handleBackToSetup = () => {
    setWizardStage('setup');
  };

  const handleBackToScoring = () => {
    setWizardStage('scoring');
  };

  const handleEditFrame = (frameNumber: number) => {
    setCurrentFrame(frameNumber);
    setWizardStage('scoring');
  };

  const handleBackToMatches = () => {
    router.push('/score/matches');
  };

  // Loading state
  if (isLoading || !match) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading match...</div>
      </div>
    );
  }

  // Render based on wizard stage
  switch (wizardStage) {
    case 'setup':
      return (
        <MatchSetup
          match={match}
          onBeginScoring={handleBeginScoring}
          onBack={handleBackToMatches}
        />
      );

    case 'scoring':
      return (
        <FrameWizard
          match={match}
          localScores={localScores}
          bonusPointEnabled={bonusPointEnabled}
          currentFrame={currentFrame}
          onScoreChange={handleScoreChange}
          onNextFrame={handleNextFrame}
          onPrevFrame={handlePrevFrame}
          onGoToFrame={handleGoToFrame}
          onFinish={handleFinishScoring}
          onBack={handleBackToSetup}
        />
      );

    case 'review':
      return (
        <ReviewSubmit
          match={match}
          isCompleting={isCompleting}
          error={error}
          onSubmit={handleComplete}
          onEditFrame={handleEditFrame}
          onBack={handleBackToScoring}
        />
      );
  }
}
