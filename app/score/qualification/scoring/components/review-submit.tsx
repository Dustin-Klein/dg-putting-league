'use client';

import { ArrowLeft, Check, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface QualificationFrameInfo {
  id: string;
  frame_number: number;
  putts_made: number;
  points_earned: number;
}

interface QualificationPlayerInfo {
  event_player_id: string;
  full_name: string;
  player_number: number | null;
  total_points: number;
  frames: QualificationFrameInfo[];
}

interface ReviewSubmitProps {
  players: QualificationPlayerInfo[];
  frameCount: number;
  isSubmitting: boolean;
  onSubmit: () => void;
  onEditFrame: (frameNumber: number) => void;
  onBack: () => void;
}

export function QualificationReviewSubmit({
  players,
  frameCount,
  isSubmitting,
  onSubmit,
  onEditFrame,
  onBack,
}: ReviewSubmitProps) {
  const frameNumbers = Array.from({ length: frameCount }, (_, index) => index + 1);

  return (
    <div className="min-h-screen bg-background p-4 pb-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <Button variant="ghost" size="sm" onClick={onBack} disabled={isSubmitting}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to Scoring
          </Button>
          <Badge variant="outline">Review</Badge>
        </div>

        <Card className="mb-6">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-xl">Qualification Review</CardTitle>
          </CardHeader>
          <CardContent className="text-center text-sm text-muted-foreground">
            Review frame scores before submitting.
          </CardContent>
        </Card>

        <Card className="mb-6 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Frame Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-medium">Player</th>
                    {frameNumbers.map((frameNumber) => (
                      <th key={frameNumber} className="text-center p-2 font-medium min-w-[40px]">
                        <button
                          onClick={() => onEditFrame(frameNumber)}
                          className="flex items-center justify-center gap-0.5 mx-auto hover:underline disabled:pointer-events-none disabled:opacity-50"
                          title={`Edit frame ${frameNumber}`}
                          disabled={isSubmitting}
                        >
                          {frameNumber}
                          <Edit className="h-3 w-3 opacity-50" />
                        </button>
                      </th>
                    ))}
                    <th className="text-center p-2 font-medium bg-muted">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((player) => (
                    <tr key={player.event_player_id} className="border-b">
                      <td className="p-2">
                        <div className="font-medium text-sm truncate max-w-[140px]">{player.full_name}</div>
                      </td>
                      {frameNumbers.map((frameNumber) => {
                        const frame = player.frames.find((item) => item.frame_number === frameNumber);

                        return (
                          <td key={frameNumber} className="text-center p-2 font-mono">
                            {frame?.putts_made ?? '-'}
                          </td>
                        );
                      })}
                      <td className="text-center p-2 bg-muted font-mono font-bold">{player.total_points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Button size="lg" className="w-full h-14 text-lg" onClick={onSubmit} disabled={isSubmitting}>
          <Check className="mr-2 h-5 w-5" />
          {isSubmitting ? 'Submitting...' : 'Submit Qualification Scores'}
        </Button>
      </div>
    </div>
  );
}
