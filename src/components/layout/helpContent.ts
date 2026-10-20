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
    subtitle: 'Draw the campus roads once, then run as many simulations as you like.',
    intro:
      'This is where you build the map the simulation uses. Roads, entrances, exits and drop-off points are all placed on this screen. Your work is saved in this browser.',
    steps: [
      {
        heading: 'Start a layout',
        body: 'Choose Load sample map to try a ready-made example, or Start blank layout to draw your own. You can also attach a PNG or JPG picture of the campus (200 KB to 5 MB) and trace over it. The picture is only a guide and is not saved, so attach it again after you reload the page. New layout clears the roads and markers but keeps the picture, the scale and your run history, and names the next layout (Layout B, Layout C and so on). Reset all data erases everything, including the run history.',
      },
      {
        heading: 'Set the map scale',
        body: 'Open Map scale. With no picture, type how many meters one grid cell is under Grid scale. With a picture, press Calibrate map scale, click two points on the picture, and type the real distance between them in meters. Every road length, travel time and car gap depends on this number, so set it before you draw.',
      },
      {
        heading: 'Draw roads',
        body: 'Pick the Road tool and click to place points along the road. Clicking a road end, a marker or the middle of another road connects to it, and clicking the middle of a road makes an intersection. Double-click or press Enter to finish, press Esc to cancel, press Backspace or right-click to undo the last point, and hold Shift to lock the next piece to straight angles. The Road tool stays on so you can draw the next road right away; choose Select to stop. To change a road later, pick Select, click it, and drag its round handles to move them (roads that share an end move together) or drag a + handle to add a bend. Use Split to add an intersection in the middle of a road, and Erase to remove a road or marker. The length in meters shows while drawing, and Show lengths labels every road.',
      },
      {
        heading: 'Place zone markers',
        body: 'Under Zone markers choose Entrance (where cars come in), Exit (where cars leave) or Drop-off (where students get dropped off), then click the map. You need at least one entrance and one exit joined by roads before you can run a simulation. To move a marker, pick Select and drag it, or click it and use the arrow keys (hold Shift for bigger steps). If no road is within 6 meters of a marker, an amber note tells you, because cars attach to the nearest road point.',
      },
      {
        heading: 'Set road rules with Select',
        body: 'Pick the Select tool and click a road. You can set its Flow direction (two-way or one-way, with Reverse direction), its Access type and its Lanes, and you can see its length and queue capacity. Click a marker to rename it. Lanes sets how many cars can travel side by side. More lanes let more cars fit on the road and raise how much traffic it can carry.',
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
            note: 'only cars without a sticker',
            color: '#D97706',
            style: 'dotted',
          },
        ],
      },
      {
        heading: 'Set traffic, vehicles and alerts in the right panel',
        body:
          'The right panel controls how the simulation behaves. The settings below are listed in the same order as in the panel. Some settings show a lock icon and cannot be changed while a simulation is running. Stop the run first to edit them.',
        settings: [
          {
            name: 'Reference map image',
            what:
              'Lets you attach a PNG or JPG satellite photo or campus layout to trace roads over. The image is a visual guide and is never saved into the map data or exported files.',
            why:
              'Attach an image if you have a real campus map or aerial photo so your roads follow actual campus curves and distances.',
            fields: [
              {
                label: 'Image file',
                text: 'Campus aerial view or schematic drawing in PNG or JPG format.',
                range: '200 KB to 5 MB, at least 1280 × 720 px',
              },
            ],
            note:
              'The image stays visible during your current browser session only. If you refresh the page, attach it again.',
          },
          {
            name: 'Map scale',
            what:
              'Tells the simulation how many meters each pixel or grid square represents. All road lengths, travel times, vehicle spacing and queue limits depend on this number.',
            why:
              'Calibrate with Calibrate map scale when you have an image, or pick a Grid scale when drawing without one.',
            fields: [
              {
                label: 'Grid scale',
                text: 'Real-world distance for each grid cell on the blank canvas.',
                range: '0.5 to 200 m per cell (or presets 5, 10, 20, 50 m)',
                defaultValue: '1 cell = 10 m',
              },
            ],
            note:
              'Changing the scale recalculates the length of existing roads without altering how they look on screen.',
          },
          {
            name: 'Default speed limit',
            what:
              'The maximum driving speed for cars everywhere on campus. This speed applies to all roads across the entire map.',
            why:
              'Change this to see how campus-wide speed regulations affect transit times and queue formation.',
            fields: [
              {
                label: 'Speed limit',
                text: 'Allowed campus vehicle speed in kilometers per hour.',
                range: '5, 10, or 15 km/h',
                defaultValue: '10 km/h',
              },
            ],
            note:
              'Speed limits are map-wide in this version and cannot be set separately for individual road segments.',
          },
          {
            name: 'Vehicle mix',
            what:
              'The share of arriving cars that have an official campus sticker versus those that do not. Cars are assigned sticker or non-sticker status at random when they enter.',
            why:
              'Adjust this to test access schemes, such as routing non-sticker cars away from central campus roads or setting aside gates for sticker holders.',
            fields: [
              {
                label: 'Sticker %',
                text: 'Percentage of arriving cars that carry a campus sticker.',
                range: '0% to 100%',
                defaultValue: '70%',
              },
              {
                label: 'Non-sticker %',
                text:
                  'Percentage of cars without a sticker, calculated automatically as 100% minus the sticker share.',
                defaultValue: '30%',
              },
            ],
            note:
              'Locked while a simulation is running. If an entrance connects only to sticker-only roads, only sticker cars will enter there.',
          },
          {
            name: 'Destination split',
            what:
              'Sets where the cars from each entrance go: to one of the drop-off zones, or straight to an exit without stopping. Each entrance has its own split, shown as a section you can open and close.',
            why:
              'Use it to match how families really spread out between drop-off points, for example 20% at Drop-off 1 and 40% at each of the other two. Give Direct to exit a share for cars that do not drop anyone off.',
            fields: [
              {
                label: 'Drop-off rows',
                text: 'The share of the cars from this entrance that go to that drop-off zone.',
                range: '0% to 100%',
                defaultValue: 'Equal shares across all drop-offs',
              },
              {
                label: 'Direct to exit',
                text: 'The share of cars that skip the drop-offs and drive straight to an exit.',
                range: '0% to 100%',
                defaultValue: '0%',
              },
              {
                label: 'Total',
                text:
                  'The shares of one entrance should add up to 100%. If they do not, the total turns amber and the shares are scaled to 100% when the run starts.',
              },
              {
                label: 'Balance evenly',
                text: 'Gives every drop-off and Direct to exit the same share for that entrance.',
              },
              {
                label: 'Apply to all entrances',
                text:
                  'Copies this entrance\'s split to every other entrance after you confirm. It only appears when the map has more than one entrance.',
              },
            ],
            note:
              'Locked while a simulation is running, but you can still open the sections to read them. If a drop-off cannot be reached from an entrance, for example because of a sticker-only road, an amber note appears and that share goes to the other places that car can reach. Sticker and non-sticker cars use the same split. This replaces the old "Cars that drop off" setting; maps saved before this change are converted automatically.',
          },
          {
            name: 'Drop-off behavior',
            what:
              'Controls how drivers act at a drop-off: how long they wait in line before dropping off where they are stopped, and how long unloading takes. Which drop-offs cars use is set in Destination split.',
            why:
              'Change these values to match observed morning drop-off habits or test the effect of quicker drop-off procedures.',
            fields: [
              {
                label: 'Patience (s)',
                text:
                  'How long a driver is willing to wait in a drop-off line before dropping off passengers where the car is stopped.',
                range: '5 to 300 s',
                defaultValue: '30 s',
              },
              {
                label: 'Patience spread (s)',
                text:
                  'Random spread added or subtracted from base patience so drivers do not all give up at the exact same moment.',
                range: '0 to 120 s',
                defaultValue: '20 s',
              },
              {
                label: 'Drop-off time min (s)',
                text: 'The shortest time a car remains stopped to let passengers out.',
                range: '5 to 300 s',
                defaultValue: '20 s',
              },
              {
                label: 'Drop-off time max (s)',
                text: 'The longest time a car remains stopped to let passengers out.',
                range: '5 to 300 s',
                defaultValue: '60 s',
              },
            ],
            note:
              'Locked while a simulation is running. Giving drivers a reasonable patience prevents drop-off queues from locking up the whole campus.',
          },
          {
            name: 'Vehicle geometry & gap',
            what:
              'Sets how long cars are and how much space drivers leave between their car and the car ahead when stopped in a queue.',
            why:
              'Increase length if your campus has school vans or buses, or adjust the gap to model tighter or looser queuing behavior.',
            fields: [
              {
                label: 'Length',
                text: 'Physical length of a single vehicle from front to rear bumper.',
                range: '1 to 20 m',
                defaultValue: '4.5 m',
              },
              {
                label: 'Standstill gap',
                text: 'Minimum safety distance maintained between two stopped cars.',
                range: '0.5 to 10 m',
                defaultValue: '2.0 m',
              },
            ],
            note:
              'Each road queue capacity is calculated as: road length ÷ (vehicle length + standstill gap) × lanes.',
          },
          {
            name: 'Alert thresholds',
            what:
              'Rules that trigger warning cards during simulation when roads get congested, and dismiss them when traffic normalizes.',
            why:
              'Tune these thresholds to match how much delay or queue buildup is considered unacceptable on your campus.',
            fields: [
              {
                label: 'Wait threshold',
                text: 'How many seconds of delay trigger a critical congestion alert.',
                range: '10 to 600 s',
                defaultValue: '120 s',
              },
              {
                label: 'Saturation threshold',
                text: 'The percentage of road capacity that must be filled to trigger an alert.',
                range: '50% to 100%',
                defaultValue: '80%',
              },
              {
                label: 'Duration threshold',
                text: 'How many continuous seconds saturation must last before an alert appears.',
                range: '5 to 180 s',
                defaultValue: '30 s',
              },
              {
                label: 'Recovery threshold',
                text: 'The utilization level a congested road must fall back to before the alert clears.',
                range: '20% to 80%',
                defaultValue: '60%',
              },
            ],
            note:
              'Active alerts appear in the right panel while the simulation is running and highlight the affected roads.',
          },
          {
            name: 'Spawn rates',
            what:
              'The number of cars that enter the campus through each entrance gate each minute. Each entrance has its own independent rate.',
            why:
              'Raise the rates to test peak arrival periods like morning rush, or lower them for midday traffic.',
            fields: [
              {
                label: 'Vehicles per minute',
                text: 'Target arrival rate at the gate. Cars spawn at randomized intervals around this value.',
                range: '0 to 120 veh/min',
                defaultValue: '3 veh/min at each entrance in the sample map',
              },
            ],
            note:
              'Setting an entrance to 0 veh/min stops cars from entering there without having to remove the marker.',
          },
        ],
      },
      {
        heading: 'Check and save',
        body: 'Check the Network summary and Zone breakdown for a quick count of roads, intersections and markers. When you are ready, press Save and go to simulation. If something is missing, a message will tell you what to fix.',
      },
    ],
    tips: [
      'Your map is saved in this browser automatically. Use Export map to save a copy as a JSON file to keep or share.',
      'You can clear everything and start over anytime with Reset all data.',
      'The map view can be zoomed with the + and − buttons or the mouse wheel, and moved around by dragging the canvas background.',
      'Settings with a lock icon, like vehicle mix, destination split and drop-off behavior, cannot be changed while a simulation is running. Stop the run first to edit them.',
      'Destination split and Drop-off behavior are locked while a run is going, like Vehicle mix.',
      'All right-panel settings are saved with your map and included in JSON exports, so your test scenarios can be shared or reloaded anytime.',
    ],
  },
  simulation: {
    title: 'Simulation guide',
    subtitle: 'Watch cars move through your map and see where traffic builds up.',
    intro:
      'This screen runs the map you saved. Cars enter at entrances, stop at drop-offs and leave through exits. Nothing you do here changes the map itself.',
    steps: [
      {
        heading: 'Start a run',
        body: 'Press Run simulation in the top bar. If the button is greyed out, the map cannot run yet. Hover over it or read the message on the canvas to see why, for example no entrance, no exit, or no valid path. Go back to Map setup to fix it.',
      },
      {
        heading: 'Read the left panel',
        body: 'Setup summary shows how many entrances, exits, drop-offs and road segments you have, plus the spawn rates and speed limit. Route eligibility shows which roads sticker and non-sticker cars may use. For an entrance that allows only one kind of car, Route eligibility shows "Sticker holders only" or "Non-sticker only" in amber instead of an error, and this is normal. You can change the sticker share under Vehicle mix before a run, but it is locked during one. Simulation state shows whether the run is ready, running, paused or finished. Settings are locked while a run is going.',
      },
      {
        heading: 'Watch the canvas',
        body: 'Each small block is a car. Sticker cars are white and non-sticker cars are blue. Drop-off areas are amber and cars that are stopped in a queue are marked as queued. Scrolling zooms around the cursor, dragging pans, and Fit brings the whole map back. Zooming and panning never change the simulation.',
      },
      {
        heading: 'Turn on the heatmap',
        body: 'Switch on Heatmap to color busy roads. Under 60% of capacity is green, 60 to 80% is amber, and over 80% is red. Red roads are where queues are most likely to form.',
      },
      {
        heading: 'Follow the live numbers',
        body: 'Live metrics update while the run goes: active vehicles, throughput, average wait, average transit and max queue length. Active alerts appear when a road gets congested. Capacity utilization shows how full each road is.',
      },
      {
        heading: 'Control the run',
        body: 'Use Pause and Resume to freeze and continue, Stop to end the run and reset the cars, and the Simulation speed slider to run faster or slower. If cars stop moving for a long time, the run is marked as gridlocked.',
      },
      {
        heading: 'Finish and review',
        body: 'When the run ends, the right panel shows Run again, View results and Edit layout. Run again starts a new run on the same map. View results opens the numbers. Edit layout takes you back to Map setup. Clear on the finished message returns the screen to idle without deleting the saved run.',
      },
      {
        heading: 'Change the map between runs',
        body: 'If you change the map or the settings after a run has finished, the finished screen clears by itself and returns to idle. The run stays in Results. If you edit the layout while a run is going, the run keeps using the old layout and an amber label says the changes apply to the next run.',
      },
    ],
    tips: [
      'Stop clears the cars but keeps your map and settings.',
      'Each finished run is saved to the run log, with the spawn rates and sticker mix it used.',
      'Cars appear at random times around the spawn rate, so two runs of the same map will not match exactly. Run each layout several times.',
      'Space starts, pauses and resumes the run when the cursor is over the map.',
      'Each finished run saves the split between drop-offs that it used, so you can compare runs with different splits.',
    ],
  },
  results: {
    title: 'Results guide',
    subtitle: 'See how the run went, what each number means, and where the map can be improved.',
    intro:
      'This screen summarizes your latest finished run and keeps a log of every run. Read the metric cards first, then the bottleneck list to see which roads cause the problems. Every number counts only cars that finished their trip, meaning they reached an exit before the run ended.',
    steps: [
      {
        heading: 'Check which setup you are looking at',
        body:
          'The configuration section shows the layout name, the run number, the spawn rate for each entrance and the sticker share. Sticker share is the real number of sticker and non-sticker cars that entered. It can differ a little from the mix you chose, because each car is picked at random. Change the Layout name in Map setup to keep different layouts apart in the run log. The Run details card lists, for each entrance, the destination split used in that run (for example Gate 1: Drop-off 1 20, Drop-off 2 40, Drop-off 3 40, Direct 0), and runs saved before the split existed show n/a.',
      },
      {
        heading: 'Read the five metric cards',
        body:
          'Each card shows one number and a colored badge. Green is good, amber needs attention, red is critical.',
        metrics: [
          {
            name: 'Total throughput',
            meaning:
              'How many cars the campus moved through per hour. Higher is better. The small label under the number says Hourly exit rate.',
            how:
              'The number of cars that reached an exit, divided by the run length in hours. For example, 300 cars exiting in a 30-minute run is 600 cars per hour.',
            ratings: [
              { label: 'Optimal', tone: 'good', range: '1,200 or more' },
              { label: 'Moderate', tone: 'warn', range: '900 to 1,199' },
              { label: 'Critical', tone: 'bad', range: 'under 900' },
            ],
            note:
              'The live throughput shown on the Simulation screen only uses the last 5 minutes, so it can differ from this final number.',
          },
          {
            name: 'Avg wait time',
            meaning:
              'How long a typical car spent stopped or crawling in traffic. Lower is better. The small label says Mean queue delay.',
            how:
              'The total seconds all exited cars spent queued or stationary (< 0.5 m/s), divided by the number of exited cars.',
            ratings: [
              { label: 'Low', tone: 'good', range: 'under 30 s' },
              { label: 'Elevated', tone: 'warn', range: '30 to 50 s' },
              { label: 'Critical', tone: 'bad', range: 'over 50 s' },
            ],
            note:
              'Wait time accumulates whenever a car is stopped in a queue or waiting near a drop-off zone.',
          },
          {
            name: 'Avg transit time',
            meaning:
              'The average total time from when a car enters the campus to when it leaves through an exit. Lower is better. The small label says Entrance to exit duration.',
            how:
              'The sum of trip durations (exit time minus enter time in seconds) for all exited cars, divided by the number of exited cars.',
            ratings: [
              { label: 'Low', tone: 'good', range: 'under 150 s' },
              { label: 'Elevated', tone: 'warn', range: '150 to 180 s' },
              { label: 'Critical', tone: 'bad', range: 'over 180 s' },
            ],
            note:
              'This covers both free-flowing movement and any queue or drop-off delays.',
          },
          {
            name: 'Max queue length',
            meaning:
              'The largest line of vehicles waiting behind a bottleneck on any single road segment during the run. Lower is better. The card also shows which road had this queue.',
            how:
              'The simulation tracks vehicle queues on every road segment throughout the run and records the single highest peak value.',
            ratings: [
              { label: 'Clear', tone: 'good', range: '5 or fewer' },
              { label: 'Warning', tone: 'warn', range: '6 to 14' },
              { label: 'Critical', tone: 'bad', range: '15 or more' },
            ],
            note:
              'A red warning badge appears when the queue reaches 15 or more vehicles.',
          },
          {
            name: 'Flow efficiency',
            meaning:
              'How close the campus was to operating at its theoretical bottleneck capacity. Higher is better. The small label says Capacity ratio.',
            how:
              '(Actual throughput ÷ Configured maximum capacity) × 100. Configured maximum capacity is the minimum segment capacity (lanes × 1,900 veh/hr/lane) along the main route.',
            ratings: [
              { label: 'Good', tone: 'good', range: '75% or higher' },
              { label: 'Acceptable', tone: 'warn', range: '60% to 74%' },
              { label: 'Poor', tone: 'bad', range: 'under 60%' },
            ],
            note:
              'A network can have high efficiency but still suffer local queues if traffic is concentrated on a single gate.',
          },
        ],
      },
      {
        heading: 'Check drop-off performance',
        body:
          'The drop-off cards show Early drop-offs (cars that gave up waiting in line and dropped off students away from the designated zone) and Average wait at drop-off (time held near the zone before unloading). High early drop-offs indicate that the drop-off loop cannot handle the arrival volume. The Drop-off zones table has one row for each drop-off: how many cars were sent there, their share of all cars in the run, how many dropped off at the zone, and how many gave up and dropped off early. A last row, Direct to exit, counts the cars that never went to a drop-off. The share is what this run actually produced, so it can differ a few points from the split you set, because each car is chosen at random. Early drop-offs show as a count out of the total drop-offs with a percentage. Cars still driving when the run ended are not counted as dropped off.',
      },
      {
        heading: 'Inspect the bottleneck analysis',
        body:
          'The bottleneck list ranks campus road segments by their maximum queue length. Each segment displays a color-coded bar and severity badge: Clear (green), Moderate (amber), or Critical (red). Focus on critical segments first when redesigning roads or access rules.',
      },
      {
        heading: 'Review actionable insights',
        body:
          'System-generated recommendations suggest concrete ways to improve traffic flow, such as adding a second loading bay, staggering arrival windows between grade levels, rerouting flow to underused roads, or adding gate lanes. At least two recommendations are generated for each run.',
      },
      {
        heading: 'Compare runs in the run log',
        body:
          'Every completed simulation run is added to the run log table. Click any row in the table to inspect that run\'s metrics and bottlenecks above. The table records the layout name, run number, spawn rates, sticker share, and performance outcomes.',
      },
      {
        heading: 'Export your findings',
        body:
          'Click Export run log (CSV) to download the complete history of evaluation runs for spreadsheet analysis. Click Export report to generate a downloadable landscape PDF report containing all charts, metrics, bottlenecks, and insights for stakeholders. Both the CSV and the PDF include the Drop-off zones table and the split used.',
      },
    ],
    tips: [
      'Click any row in the run log table to view that specific run\'s full metrics and recommendations.',
      'All numbers count only completed vehicle trips; vehicles still on campus when the run ended are not counted.',
      'Export run log (CSV) saves all evaluation runs, allowing offline comparison across different road network designs in Excel or Google Sheets.',
      'Use Export report to create a clean PDF summary to present to school administrators or traffic advisors.',
      'Compare two runs that have different drop-off splits to see which zone causes the queues; look at the zone with the most early drop-offs first.',
    ],
  },
};
