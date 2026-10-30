import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/utils';

interface ScoreInputProps {
  value: number | null;
  onChange: (value: number) => void;
  disabled: boolean;
  isSaving: boolean;
  bonusPointEnabled: boolean;
  /** Accessible name, e.g. "Avery Lund frame 3". */
  label?: string;
}

export function ScoreInput({ value, onChange, disabled, isSaving, bonusPointEnabled, label }: ScoreInputProps) {
  const displayOptions = bonusPointEnabled ? [0, 1, 2, 4] : [0, 1, 2, 3];
  const displayValue = value !== null
    ? (bonusPointEnabled && value === 3 ? 4 : value)
    : '';
  const isMax = value === 3;

  return (
    <div className="relative">
      <select
        value={displayValue}
        onChange={(e) => {
          const val = parseInt(e.target.value, 10);
          if (!isNaN(val)) {
            const puttsMade = bonusPointEnabled && val === 4 ? 3 : val;
            onChange(puttsMade);
          }
        }}
        disabled={disabled}
        aria-label={label}
        className={cn(
          "h-[38px] w-11 appearance-none rounded-lg border-[1.5px] border-input bg-control text-center font-score text-xl tabular-nums",
          "focus-visible:border-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-hidden",
          "disabled:cursor-not-allowed disabled:opacity-60",
          value !== null && "font-bold",
          isMax && "border-success/60 bg-success/10 text-success"
        )}
      >
        <option value="">-</option>
        {displayOptions.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      {isSaving && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
    </div>
  );
}
