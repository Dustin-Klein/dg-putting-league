import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/utils';

interface ScoreInputProps {
  value: number | null;
  onChange: (value: number) => void;
  disabled: boolean;
  isSaving: boolean;
  bonusPointEnabled: boolean;
}

export function ScoreInput({ value, onChange, disabled, isSaving, bonusPointEnabled }: ScoreInputProps) {
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
        className={cn(
          "w-12 h-10 text-center text-lg font-mono rounded border",
          "bg-background focus:ring-2 focus:ring-primary focus:border-primary",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          value !== null && "font-bold",
          isMax && "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
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
