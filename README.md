# FlowSmart

FlowSmart is a web-based 2D top-down traffic flow simulator designed for the Don Bosco Technical College (DBTC) campus. It enables interactive modeling, visual simulation, and bottleneck analysis of campus vehicular traffic patterns.

## Features

- **Map setup**: Configure road networks and campus zones with optional reference image overlay and scale calibration.
- **Drawn-path traffic simulation**: Run real-time vehicle movement simulations along custom-drawn roadways and intersections.
- **Results and PDF export**: Inspect congestion statistics, traffic throughput, and export formatted PDF reports.
- **JSON export and import**: Save complete scenarios to portable JSON files and restore them anytime.

## How data is stored

All simulation configurations and map settings are stored strictly in browser LocalStorage. Nothing is sent to a server. Use the JSON export feature to back up scenarios or move them between browsers.

## Run locally

Prerequisites: Node.js 20 or higher.

1. Install dependencies:
```bash
npm install
```

2. Start the local development server:
```bash
npm run dev
```

3. Build the application:
```bash
npm run build
```

4. Preview the production build:
```bash
npm run preview
```

## Deploy to Vercel

Deploy as a standard static Vite application:

- **Framework**: Vite
- **Build command**: `npm run build`
- **Output directory**: `dist`
- **Environment variables**: None

## Project structure

- `src/components`: UI components including top navigation, sidebar controls, canvas, and results panels.
- `src/sim`: Simulation engine, graph construction, routing logic, and traffic flow calculations.
- `src/context`: React context providers managing application state and simulation lifecycles.
- `src/utils`: Geometry, image handling, coordinate transformations, and scale measurement utilities.
- `src/hooks`: Custom React hooks such as interactive wire drafting tools.
- `src/types`: TypeScript data models and interfaces for traffic and map entities.

## About

FlowSmart is a thesis prototype for Don Bosco Technical College (DBTC).
