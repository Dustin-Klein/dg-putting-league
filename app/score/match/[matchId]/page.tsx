'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { MatchSetup } from './components/match-setup';
import { FrameWizard } from './components/frame-wizard';
import { ReviewSubmit } from './components/review-submit';
import type { WizardStage, MatchInfo, ScoreState } from './components/wizard-types';
import { STANDARD_FRAMES, getFrameNumbers, getScoreKey, areScoresTiedWithLocalScores } from './components/wizard-types';

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

  // Save all local scores for a frame to the server
  const saveFrameScores = useCallback(async (frameNumber: number): Promise<boolean> => {
    if (!accessCode || !matchId || !match) return true;

    // Collect all local scores for this frame
    const allPlayers = [...match.team_one.players, ...match.team_two.players];
    const frameScores: Array<{ event_player_id: string; putts_made: number }> = [];

    for (const player of allPlayers) {
      const key = getScoreKey(player.event_player_id, frameNumber);
      const localScore = localScores.get(key);
      if (localScore !== undefined) {
        frameScores.push({
          event_player_id: player.event_player_id,
          putts_made: localScore,
        });
      }
    }

    // Only call API if there are local scores to save
    if (frameScores.length === 0) return true;

    isSavingRef.current = true;

    try {
      const response = await fetch(`/api/score/match/${matchId}/batch`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_code: accessCode,
          frame_number: frameNumber,
          scores: frameScores,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save scores');
      }

      const updatedMatch = await response.json();
      setMatch(updatedMatch);

      // Clear local scores for this frame now that server confirmed
      setLocalScores(prev => {
        const next = new Map(prev);
        for (const player of allPlayers) {
          const key = getScoreKey(player.event_player_id, frameNumber);
          next.delete(key);
        }
        return next;
      });

      return true;
    } catch (err) {
      console.error('Failed to save frame scores:', err);
      setError(err instanceof Error ? err.message : 'Failed to save scores');
      return false;
    } finally {
      isSavingRef.current = false;
    }
  }, [accessCode, matchId, match, localScores]);

  // Simple score change - just updates local state, no API call
  const handleScoreChange = (
    eventPlayerId: string,
    frameNumber: number,
    puttsMade: number
  ): void => {
    const saveKey = getScoreKey(eventPlayerId, frameNumber);
    setLocalScores(prev => {
      const next = new Map(prev);
      next.set(saveKey, puttsMade);
      return next;
    });
  };

  const handleComplete = async () => {
    if (!accessCode || !matchId || !match) return;

    // Save any pending scores before completing
    const saved = await saveFrameScores(currentFrame);
    if (!saved) return;

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

  const handleNextFrame = async () => {
    if (!match) return;

    // Check if tied before saving (local scores will be cleared after save)
    const isTiedBeforeSave = areScoresTiedWithLocalScores(match, localScores, bonusPointEnabled);

    const saved = await saveFrameScores(currentFrame);
    if (!saved) return;

    const frameNumbers = getFrameNumbers(match);
    const currentIndex = frameNumbers.indexOf(currentFrame);

    // Check if we need overtime using pre-save tie status
    if (currentFrame >= STANDARD_FRAMES && isTiedBeforeSave) {
      // Add overtime frame
      setCurrentFrame(currentFrame + 1);
    } else if (currentIndex < frameNumbers.length - 1) {
      setCurrentFrame(frameNumbers[currentIndex + 1]);
    }
  };

  const handlePrevFrame = async () => {
    const saved = await saveFrameScores(currentFrame);
    if (!saved) return;

    if (currentFrame > 1) {
      setCurrentFrame(currentFrame - 1);
    }
  };

  const handleGoToFrame = async (frameNumber: number) => {
    const saved = await saveFrameScores(currentFrame);
    if (!saved) return;

    setCurrentFrame(frameNumber);
  };

  const handleFinishScoring = async () => {
    const saved = await saveFrameScores(currentFrame);
    if (!saved) return;

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
