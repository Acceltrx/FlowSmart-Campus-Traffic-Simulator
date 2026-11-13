/**
 * FlowSmart - In-App Help Content
 * Plain-language guide text for students and administrators.
 * Standardized on sentence case and clean, jargon-free instructions.
 */

import { ActiveTab } from '../../types/traffic';

export interface HelpChip {
  label: string;
  note: string;
  color: string;
  style: 'solid' | 'dashed' | 'dotted';
}

export interface HelpRating {
  label: string;
  tone: 'good' | 'warn' | 'bad';
  range: string;
}

export interface HelpMetric {
  name: string;
  meaning: string;
  how: string;
  ratings?: HelpRating[];
  note?: string;
}

export interface HelpSettingField {
  label: string;
  text: string;
  range?: string;
  defaultValue?: string;
}

export interface HelpSetting {
  name: string;
  what: string;
  why?: string;
  fields?: HelpSettingField[];
  note?: string;
}

export interface HelpStep {
  heading: string;
  body: string;
  chips?: HelpChip[];
  metrics?: HelpMetric[];
  settings?: HelpSetting[];
}

export interface HelpGuide {
  title: string;
  subtitle: string;
  intro: string;
  steps: HelpStep[];
  tips: string[];
}

export const HELP_CONTENT: Record<ActiveTab, HelpGuide> = {
  'map-setup': {
    title: 'Map setup guide',
    subtitle: 'Draw the campus roads once, then test as many scenarios as you like.',
    intro:
      'Build the campus road layout here by placing roads, entrances, exits and drop-off zones. Your layout is saved in this browser automatically. Traffic rates and driver behaviour are set in the next step under Settings.',
    steps: [
      {
        heading: 'Start a layout',
        body: 'In the right panel under Map file, choose Load sample map to try a ready-made campus, or New layout to start a blank one while keeping your run history (Layout B, Layout C, and so on). You can also Attach a PNG or JPG image of your campus (200 KB to 5 MB, at least 1280 × 720 px) to trace over; the image stays only for this browser session, so re-attach it after reloading.',
      },
      {
        heading: 'Set the map scale',
        body: 'Under Map scale in the right panel, pick a Grid scale (such as 1 cell = 10 m) when drawing without an image, or press Calibrate, click two points on your reference image, and type the real distance in meters. Every road length, driving time and car spacing depends on this scale, so set it before drawing.',
      },
      {
        heading: 'Draw and edit roads',
        body: 'Pick Road in the left sidebar and click points along the path. Clicking a road end, a marker or the middle of another road connects to it, and clicking the middle of a road creates an intersection. Double-click or press Enter to finish, Esc to cancel, Backspace or right-click to undo the last point, and hold Shift for straight 45° or 90° angles. Use Select to drag round handles or + midpoint handles to reshape a road, Split to add an intersection, and Erase to remove a road or marker. Turn on Show lengths in Layers to display road lengths.',
      },
      {
        heading: 'Place zone markers',
        body: 'Under Zone markers, choose Entrance (where cars enter), Exit (where cars leave) or Drop-off (where students unload), then click on the map. You need at least one entrance and one exit connected by roads before you can run. Use Select to drag markers or nudge them with the arrow keys (hold Shift for bigger steps). An amber warning appears if no road is within 6 m of a marker.',
      },
      {
        heading: 'Set road rules with Select',
        body: 'Pick Select and click any road to set its Flow direction (One-way or Two-way, plus Reverse direction), Access type and Lanes (1 to 3), and inspect its length and how many cars fit in a line of cars along it. Click a marker to rename it.',
        chips: [
          {
            label: 'Shared',
            note: 'any car can use it',
            color: '#3B4658',
            style: 'solid',
          },
          {
            label: 'Sticker-only',
            note: 'only cars with a sticker',
            color: '#2563EB',
            style: 'dashed',
          },
          {
            label: 'Non-sticker-only',
            note: 'only visitors without a sticker',
            color: '#D97706',
            style: 'dotted',
          },
        ],
      },
      {
        heading: 'Check the network and move to Settings',
        body: 'Check Network summary and Zone breakdown in the right panel to confirm your road segments, intersections and zones, then press Next: Settings at the bottom right to set arrival rates, run length and traffic mix.',
      },
    ],
    tips: [
      'Your map is saved in this browser automatically. Use Export (JSON) to back up your layout or share it.',
      'Zoom with +, − or the mouse wheel, and pan by holding Space + drag or middle-dragging.',
      'Need to erase everything and start over completely? Reset all data is at the bottom of the Settings screen.',
    ],
  },
  settings: {
    title: 'Settings guide',
    subtitle: 'Pick a scenario, adjust who arrives and where they go, and check the pre-run estimate.',
    intro:
      'Use this screen to set up the traffic for your simulation without changing the map layout. Every option starts with sensible defaults. Settings are locked while a simulation is running or paused.',
    steps: [
      {
        heading: '1. Start from a scenario',
        body: 'Pick one of the quick presets—Light traffic (2 cars/min per gate, 70% sticker), Normal morning (3 cars/min per gate, 70% sticker) or Rush hour (6 cars/min at the first gate, 5 at other gates, 60% sticker)—to fill in gate arrival rates and sticker share at once. Editing any gate rate or the sticker slider afterwards switches the selection to Custom automatically.',
      },
      {
        heading: '2. Who is arriving?',
        body: 'Use each gate slider (0 to 20 cars/min) to set how busy that entrance is; setting a gate to 0 closes it so no cars arrive there. Adjust Sticker holders vs visitors (0% to 100%) to choose how many arriving drivers hold a campus sticker. Sticker holders may use sticker-only roads, while visitors may not. If a gate only connects to sticker-only or non-sticker-only roads, a yellow notice explains that only that car type enters there.',
      },
      {
        heading: '3. Where do they go?',
        body: 'Open any gate row to set the percentage of cars from that gate heading to each drop-off zone or Straight to exit. Each gate must add up to 100% before you can start. If the numbers do not add up to 100%, click Fix: make it add up to 100% to balance them in one click. If sticker or visitor cars cannot reach a destination from that gate, a notice tells you their share goes to the destinations they can reach.',
      },
      {
        heading: '4. How long should it run?',
        body: 'Choose 15, 30, 45 or 60 minutes of simulated campus time. Real elapsed time can be much faster using the speed buttons (0.5x, 1x, 2x, 5x) on the Simulation screen.',
      },
      {
        heading: 'Advanced options (optional)',
        body: 'Most users can leave Advanced options closed. Open it only when you want to tune drop-off behaviour, vehicle spacing or live warning thresholds:',
        settings: [
          {
            name: 'Drop-off behaviour',
            what: 'Controls how long drivers wait in a drop-off line before giving up and unloading where they are stopped, and how long unloading takes.',
            fields: [
              {
                label: 'Wait before giving up',
                text: 'Base patience before a waiting car drops off early.',
                range: '5 to 300 s',
                defaultValue: '30 s',
              },
              {
                label: 'Extra random patience',
                text: 'Random variation added so drivers do not all give up together.',
                range: '0 to 120 s',
                defaultValue: '20 s',
              },
              {
                label: 'Fastest / Slowest drop-off',
                text: 'Shortest and longest time a car stops to let passengers out.',
                range: '5 to 300 s',
                defaultValue: '20 s to 60 s',
              },
            ],
          },
          {
            name: 'Roads and vehicles',
            what: 'Map-wide speed limit and vehicle spacing used to compute travel times and how many cars fit in a line of cars.',
            fields: [
              {
                label: 'Speed limit',
                text: 'Maximum speed for cars across all roads.',
                range: '5, 10 or 15 km/h',
                defaultValue: '10 km/h',
              },
              {
                label: 'Car length & Gap between stopped cars',
                text: 'Physical vehicle length and safety gap when stopped in a line of cars.',
                range: 'Length 1 to 20 m; Gap 0.5 to 10 m',
                defaultValue: '4.5 m length, 2.0 m gap',
              },
            ],
          },
          {
            name: 'Warnings',
            what: 'Controls when the live Simulation screen shows an alert for delayed cars or crowded roads.',
            fields: [
              {
                label: 'Wait warning',
                text: 'Triggers when a car has waited longer than this.',
                range: '10 to 600 s',
                defaultValue: '120 s',
              },
              {
                label: 'Road fullness warning & clear threshold',
                text: 'Triggers when a road stays above the % full threshold for the set duration, and clears once it drops below the recovery %.',
                range: 'Warn 50% to 100% for 5 to 180 s; Clear 20% to 80%',
                defaultValue: '80% for 30 s; clear below 60%',
              },
            ],
          },
        ],
      },
      {
        heading: 'Summary card and "Before you start" estimate',
        body: 'The sticky right card shows total cars per minute, Expected cars (rate × run length), Run length, Sticker holders, and live readiness checks. When you press Start simulation, the "Before you start" window shows an estimate from your settings—expected sticker and visitor counts plus whether each drop-off zone looks Comfortable, Busy or Likely to back up. Check Don\'t show this again if you want to skip it on future runs.',
      },
      {
        heading: 'How the estimate differs from real results',
        body: 'The "Before you start" estimate assumes steady, evenly spaced arrivals and looks only at drop-off unloading capacity. The real simulation models random arrival bunches, lane merging, lines of cars spilling back across intersections, and drivers giving up early—so real results can reveal backups or relief the quick estimate cannot predict.',
      },
    ],
    tips: [
      'Start simulation stays disabled until every gate adds up to 100%, at least one gate has a rate above 0, and your map has valid connected routes.',
      'Reset to defaults restores default traffic settings without changing your map or run history.',
      'Reset all data at the bottom of the page erases the map, settings and all saved runs.',
    ],
  },
  simulation: {
    title: 'Simulation guide',
    subtitle: 'Watch cars move through campus and spot where lines of cars build up.',
    intro:
      'This screen runs your map and settings across the full canvas. Cars enter at gates, unload at drop-off zones or drive straight out, and leave through exits.',
    steps: [
      {
        heading: 'Top-left scenario card and Heatmap',
        body: 'Shows your active scenario name, sticker share, run length, and arrival rate at each gate. While a run is going, Settings locked while running reminds you that parameters cannot change mid-run. Switch on Heatmap to tint busy roads green (under 60% of capacity), amber (60 to 80%) or red (over 80%).',
      },
      {
        heading: 'Bottom-centre controls and speed',
        body: 'Before starting, click Start simulation (opens the Before you start estimate unless skipped) or Change settings to return to Settings. During a run, use Pause / Resume, Stop (resets cars without deleting your map or settings) and the 0.5x, 1x, 2x or 5x speed buttons. When the run finishes, click See results or Run again.',
      },
      {
        heading: 'Top-right live summary',
        body: 'Tracks the run status (Ready, Running, Paused, Gridlocked or Finished), simulated clock and progress bar, four live numbers (Cars on campus now, Cars exiting per hour, Average wait in line, Average trip time), the single most urgent active alert, and a collapsible Road usage list of the 5 busiest roads.',
      },
      {
        heading: 'Read the canvas, legend and zoom',
        body: 'Sticker holder (white) and Visitor (blue) cars get an amber outline while unloading and red brake lights when stopped in a line of cars. Use Hide legend / Show legend next to the scale bar at the bottom-left, and use +, −, Fit, scroll-wheel zoom or drag-to-pan at the bottom-right.',
      },
    ],
    tips: [
      'Press Space when the canvas is focused to start, pause or resume the simulation.',
      'If cars stop moving for too long, the status changes to Gridlocked.',
      'Cars arrive at random intervals around each gate rate, so two runs with the same settings will vary slightly.',
    ],
  },
  results: {
    title: 'Results guide',
    subtitle: 'See how the run went, where lines of cars formed, and what to try next.',
    intro:
      'Results summarize your latest run in plain language and keep earlier runs so you can compare scenarios. Time and speed averages count only cars that finished their trip and reached an exit before time ran out.',
    steps: [
      {
        heading: 'Read the verdict banner and eight metric cards',
        body: 'The top banner gives an overall verdict (Traffic flowed smoothly, Mostly fine, Traffic struggled or Traffic got stuck). Below it are two rows of four cards—How traffic moved and Waiting and drop-offs—with colored status pills:',
        metrics: [
          {
            name: 'Cars that finished',
            meaning: 'How many cars reached an exit before time ran out, compared with the total cars that arrived.',
            how: 'Count of exited cars shown out of total arrived cars.',
          },
          {
            name: 'Cars exiting per hour',
            meaning: 'The hourly exit rate, judged against how many cars were arriving per hour in that same run.',
            how: 'Exited cars divided by run length in hours, compared with the run\'s arrival rate per hour.',
            ratings: [
              { label: 'Keeping up', tone: 'good', range: '90% or more of arrivals' },
              { label: 'Falling behind', tone: 'warn', range: '70% to 89% of arrivals' },
              { label: 'Far behind', tone: 'bad', range: 'under 70% of arrivals' },
            ],
          },
          {
            name: 'Average trip time',
            meaning: 'Average total time from entering a gate to leaving an exit, including any waiting and drop-off time.',
            how: 'Total trip seconds across all exited cars divided by exited cars.',
            ratings: [
              { label: 'Quick', tone: 'good', range: 'under 150 s' },
              { label: 'Slowish', tone: 'warn', range: '150 to 180 s' },
              { label: 'Too slow', tone: 'bad', range: 'over 180 s' },
            ],
          },
          {
            name: 'Road capacity used',
            meaning: 'How much of the campus\'s main-route road capacity was put to work.',
            how: 'Actual hourly exit rate divided by the tightest lane capacity along the main route.',
            ratings: [
              { label: 'Good', tone: 'good', range: '75% or higher' },
              { label: 'Acceptable', tone: 'warn', range: '60% to 74%' },
              { label: 'Poor', tone: 'bad', range: 'under 60%' },
            ],
          },
          {
            name: 'Average wait in line',
            meaning: 'Average time a finished car spent stopped or crawling in traffic.',
            how: 'Total seconds spent stopped or moving under 0.5 m/s across all exited cars, divided by exited cars.',
            ratings: [
              { label: 'Short', tone: 'good', range: 'under 30 s' },
              { label: 'Getting long', tone: 'warn', range: '30 to 50 s' },
              { label: 'Too long', tone: 'bad', range: 'over 50 s' },
            ],
          },
          {
            name: 'Longest line of cars',
            meaning: 'Peak number of stopped cars waiting on any single road segment during the run, plus where it happened.',
            how: 'Highest count of stopped cars recorded on any single road segment.',
            ratings: [
              { label: 'Clear', tone: 'good', range: '5 or fewer cars' },
              { label: 'Building up', tone: 'warn', range: '6 to 14 cars' },
              { label: 'Backed up', tone: 'bad', range: '15 or more cars' },
            ],
          },
          {
            name: 'Gave up and dropped off early',
            meaning: 'Cars that ran out of patience waiting near a crowded drop-off zone and unloaded away from the zone.',
            how: 'Count of early drop-offs out of total completed drop-offs (with percentage).',
          },
          {
            name: 'Average wait before dropping off',
            meaning: 'Average time cars spent waiting near a drop-off zone before unloading.',
            how: 'Total drop-off wait time divided by cars that completed a drop-off.',
          },
        ],
      },
      {
        heading: 'Where cars got stuck and What you could try',
        body: 'Where cars got stuck ranks every road by its longest line of cars using the same Clear, Building up and Backed up labels. Next to it, What you could try offers tailored suggestions—such as adding a loading bay, staggering arrivals, shifting flow to quieter roads, or checking one-way and sticker rules.',
      },
      {
        heading: 'Where cars went',
        body: 'Compares the Actual share of cars sent to each drop-off zone and Direct to exit against your Planned split, followed by a breakdown table (Cars sent here, Share of all cars, Dropped off at the zone, and Gave up and dropped off early).',
      },
      {
        heading: 'Settings used and Compare with earlier runs',
        body: 'Expand Settings used for this run to inspect the exact gate rates, destination splits, sticker share, run length, layout and Random seed (for repeating a run). Under Compare with earlier runs, click any row to load that run\'s full results above, or click Show all columns to view all 14 details.',
      },
      {
        heading: 'Download or adjust',
        body: 'Use Download run log (CSV) for spreadsheet analysis, Download report to save a printable PDF summary, or Change settings to jump back to Settings and test another scenario.',
      },
    ],
    tips: [
      'Click any row in Compare with earlier runs to switch the cards and charts above to that run.',
      'Because arrivals and destination choices are randomized per car, actual shares can differ slightly from your planned percentages.',
      'Only cars that reached an exit before the run ended are counted in trip and wait averages.',
    ],
  },
};
