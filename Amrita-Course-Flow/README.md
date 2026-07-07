# Amrita Course Flow

Amrita Course Flow is a structured web application for managing academic workflows with a clean Express backend, a lightweight frontend, and MySQL-backed persistence.

## Project Structure

- [backend/app.server.js](backend/app.server.js) - Main Express application and API wiring
- [backend/server.js](backend/server.js) - Compatibility entry wrapper for startup
- [backend/controllers](backend/controllers/) - Shared controller helpers and validators
- [backend/middleware](backend/middleware/) - Authentication and async middleware
- [backend/models](backend/models/) - Database access and schema initialization
- [backend/modules](backend/modules/) - Feature modules such as authentication
- [backend/routes](backend/routes/) - API route definitions
- [frontend](frontend/) - Browser-facing HTML, CSS, and JavaScript assets
- [db/schema.sql](db/schema.sql) - MySQL schema definition
- [scripts](scripts/) - Utility scripts for data preparation and maintenance

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a local environment file from [.env.example](.env.example) and configure your database credentials.
3. Start the application:
   ```bash
   npm start
   ```

The server creates the required database, applies the schema, and seeds demo records when the database is empty.

## Demo Credentials

- Admin: `admin` / `admin123`
- Faculty: `AIDFAC001` / `faculty123` (legacy `FAC001` also supported)
- Student: `AID1NA01` / `student123` (legacy `CB.EN.U4CSE23001` also supported)
