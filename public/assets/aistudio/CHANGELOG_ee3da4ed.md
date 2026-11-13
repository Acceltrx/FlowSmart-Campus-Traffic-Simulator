# Changelog

All notable changes to FlowSmart beyond the visual redesign. Visual and layout changes (new four-step flow, restyled Settings, Simulation and Results screens) are described in `flowsmart-ui-implementation-plan.md`.

Format based on [Keep a Changelog](https://keepachangelog.com/). Items marked **(confirm)** are in the design draft or plan but I have not seen them in the code yet.

## [Unreleased] - 2026-11-13

### Added

- **Scenarios.** One-click presets for the traffic mix: Light traffic (2 + 2 cars/min, 70% sticker), Normal morning (3 + 3, 70%), Rush hour (6 + 5, 60%), and Custom. Editing any value after picking a preset switches it to Custom. *(preset values are placeholders until replaced with observed campus numbers)*
- **Simulation run length.** The run length can be set to 15, 30, 45 or 60 simulated minutes. It uses the existing `simDurationMin` setting, which had no control before.
- **Scenario expectation modal.** *(details to add: what it shows, when it opens, how it is dismissed)*
- **Expected cars summary (confirm).** The Settings summary shows total cars per minute and the expected number of cars for the chosen run length (rate x duration).
- **Start checks (confirm).** The Start button is disabled until every gate's destination split adds up to 100% and at least one gate has a rate above 0. A "make it add up to 100%" button fixes a split in one click.
- **Reset to defaults (confirm).** Restores the default settings without touching the map. "Reset all data" moves out of the Simulation screen to the Settings screen.
- **Cars that finished (confirm).** New Results card showing completed cars out of cars that arrived.
- **Settings used for this run (confirm).** Results shows the arrival rates, sticker share, duration and random seed for the selected run, so a run can be repeated.
- **Hide / show legend (confirm).** The Simulation legend can be collapsed.

### Changed

- **Traffic settings moved.** Arrival rates, vehicle mix, destination split, drop-off behaviour, vehicle geometry and alert thresholds moved out of Map setup and the Simulation sidebar into one Settings step. The settings data model is unchanged.
- **Results metric names.** Measured values are unchanged but renamed in plain language: Total throughput -> Cars exiting per hour, Flow efficiency -> Road capacity used, Max queue length -> Longest line of cars, Avg transit time -> Average trip time, Avg wait time -> Average wait in line, Early drop-offs -> Gave up and dropped off early, Bottleneck analysis -> Where cars got stuck, Actionable insights -> What you could try.
- **Simulation speed (confirm).** The 0.5-5x slider is replaced by 0.5x / 1x / 2x / 5x buttons.
- **Results run log (confirm).** Shows 6 columns by default; "Show all columns" reveals the original 12.

### Fixed / consistency (confirm)

- **One set of status bands.** The longest-line card (clear up to 5, warning 6-14, critical 15 and up) and the bottleneck rows (previously above 4 and above 12) now use the same bands, so one queue size no longer gets two labels.
- **Cars exiting per hour badge.** Judged against how many cars were arriving per hour (good at 90% or more, warning 70-89%, bad under 70%) instead of fixed 1200 / 900 veh/hr bands that low-volume scenarios could never reach.

### Unchanged

- Simulation engine, routing rules, result calculations, CSV and PDF export, and the saved-map JSON format.
