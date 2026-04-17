# Root Record Developer Panel

A desktop application for managing, building, and deploying Root Record applications from the Development folder.

## Features

- **Project Discovery**: Automatically discovers all projects in the parent Development folder
- **Build Management**: Build, install, and run projects with npm commands
- **Git Integration**: Push, pull, and check git status for each project
- **Terminal**: Execute custom commands in project directories
- **Dark Theme**: Developer-friendly dark interface

## Installation

1. Install dependencies:
```bash
npm install
```

2. Run the application:
```bash
npm start
```

For development mode with DevTools:
```bash
npm run dev
```

Build a Windows installer (NSIS):
```bash
npm run build:installer
```

## Usage

1. **Project Selection**: Click on any project in the sidebar to select it
2. **Actions**: Use the action buttons to:
   - **Build**: Run `npm run build` on the selected project
   - **Install**: Run `npm install` on the selected project
   - **Run**: Start the project with `npm start` (runs in background)
   - **Sign**: Code signing (placeholder - needs implementation)
   - **Git Status**: Check git repository status
   - **Git Push**: Push changes to remote repository
   - **Git Pull**: Pull changes from remote repository
3. **Terminal**: Enter custom commands and execute them in the selected project directory

## Project Structure

The application automatically scans the parent Development folder and excludes itself from the project list. It looks for `package.json` files to identify Node.js projects and displays their metadata.

## Configuration

Settings are stored using Electron Store and persist between sessions.

## Code Signing

The code signing functionality is currently a placeholder. You'll need to implement this based on your specific signing requirements and certificates.

## Technology Stack

- **Electron**: Desktop application framework
- **Node.js**: Backend runtime
- **Simple Git**: Git operations
- **Electron Store**: Configuration persistence
- **HTML/CSS/JavaScript**: User interface

## Notes

- This is a personal developer tool, not intended for distribution
- Installer output is written to `dist-installer/`
- The interface is embedded directly in the main process for simplicity
