export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface ChangelogRelease {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  sections: ChangelogSection[];
}

/** Newest first. The first entry's version should match package.json. */
export const changelog: ChangelogRelease[] = [
  {
    version: '0.9.0',
    date: '2026-11-18',
    sections: [
      {
        title: 'New',
        items: [
          'Second-chance events: run a second bracket for players knocked out of the main event while the main bracket is still going. Start it empty and add knocked-out players one at a time.',
          'Lend main-event lanes to the second chance. Pick them when creating it, including lanes in use, which pass over once their match finishes. Either side can take a lane back.',
          'Choose zones or one distance for everyone when creating a second chance.',
          'Single-elimination brackets, with an optional third-place match.',
          'Guided create-event wizard: repeat your last event with a new date, or walk through night, format, scoring and money step by step.',
          'Handicap leagues can run a one-distance event.',
          'Scoreboard header on the admin event page with the scoring code (copy or QR), a status track and stats for the current stage.',
          'David scoring: an optional − / + stepper for entering putts, turned on from the gear on the scoring screens and saved on that device.',
          'Present mode shows the bracket key and a QR code that opens scoring with the event code filled in.',
        ],
      },
      {
        title: 'Improved',
        items: [
          'Match scoring fits on one screen, so team totals and Next never scroll away.',
          'Tap a selected putt score again to clear it.',
          'The scoring match list shows how many frames each match has completed.',
          'Pinch and zoom the bracket on phones.',
          'Anyone can open a finished match’s frame scores on the public bracket, even after the event is completed, with players’ zone badges.',
          'The main event’s lanes stay listed while lent to the second chance, and the second chance’s header shows the lanes it borrowed.',
        ],
      },
    ],
  },
];
