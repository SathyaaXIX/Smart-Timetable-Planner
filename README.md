# Smart Timetable Planner

Smart Timetable Planner is a full-stack web application for managing course flow, faculty data, student records, and timetable generation in a structured and conflict-free way.

## Project Overview

This repository contains the Amrita Course Flow application, organized as a professional, self-contained project with:

- a Node.js/Express backend
- a vanilla HTML/CSS/JavaScript frontend
- MySQL-backed data storage for courses, users, and timetable records

## Repository Structure

- [Amrita-Course-Flow](Amrita-Course-Flow/) - Main application folder
  - [Amrita-Course-Flow/backend](Amrita-Course-Flow/backend/) - API and business logic
  - [Amrita-Course-Flow/frontend](Amrita-Course-Flow/frontend/) - Client-side interface
  - [Amrita-Course-Flow/db](Amrita-Course-Flow/db/) - Database schema and setup files

## Getting Started

1. Change into the application folder:
   ```bash
   cd Amrita-Course-Flow
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a local environment file from the example file and configure your database settings.
4. Start the application:
   ```bash
   npm start
   ```

## Notes

The application creates the required database tables automatically and seeds demo data when needed, making it easier to test the workflow locally.
