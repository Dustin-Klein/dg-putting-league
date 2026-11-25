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
    version: '0.10.0',
    date: '2026-11-24',
    sections: [
      {
        title: 'New',
        items: [
          'Event stats: a public stats report for every event, live during bracket play, with standings, a sortable player table, zones, putts mix and match margins. Admins get a Stats tab with data warnings, team detail, handicap evaluations and CSV export.',
          'Roster screen for the TV: every registered player alphabetically with their zone, refreshed every 10 seconds, so a missed or wrongly zoned player can speak up before the bracket is drawn.',
          'Starting bracket play opens a checklist first: player count against cash, electronic and waived payments, and whether every player has a zone.',
          'Missed a player? From the Bracket tab, substitute them onto a team between matches, enter them with the floater into a Round 1 bye, or reopen registration, keeping the announced teams if you like.',
          'Move a player’s zone mid-event. Frames scored before the move stay with the old zone and later ones use the new one.',
          'Waived payment type: waived players count as paid and as a full entry in the payout pot.',
        ],
      },
      {
        title: 'Improved',
        items: [
          'League pages are a timeline of event nights, with each second chance branching off its main event and live nights showing bracket progress.',
          'The Leagues and My Leagues lists are redesigned, with live leagues first and each league’s current night at a glance.',
          'The team preview and the build-teams-by-hand editor show each player’s zone badge.',
          'The bracket lane queue labels the next two matches On deck and In the hole.',
          'Dialogs and popovers stay above the on-screen keyboard on phones and tablets, and iPad no longer zooms in when you tap a field.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'Byes no longer count as wins on player profiles.',
          'Roster zone badges and the demotion review show the current ladder distances after a league edits its ladder.',
        ],
      },
    ],
  },
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
