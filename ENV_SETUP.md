# Environment Variables Setup

This application uses environment variables for configuration. Here's how to set them up:

## Option 1: Create a .env file (Recommended)

Create a `.env` file in the project root with your actual values:

```bash
# LDBWS API Configuration
LDBWS_API_KEY=your-actual-api-key-here
LDBWS_BASE_URL=http://your-ldbws-server

# GetNextDepartures (optional separate credentials)
NEXTDEPS_API_KEY=your-nextdeps-api-key
NEXTDEPS_BASE_URL=http://your-nextdeps-server

# Application Configuration
NODE_ENV=development
PORT=3000
```

## Option 2: Set environment variables directly

```bash
export LDBWS_API_KEY=your-actual-api-key-here
export LDBWS_BASE_URL=http://your-ldbws-server
export NEXTDEPS_API_KEY=your-nextdeps-api-key
export NEXTDEPS_BASE_URL=http://your-nextdeps-server
```

## Option 3: Use Docker Compose

The docker-compose.yml file will automatically use environment variables from your system or a .env file.

## Running the Application

### Local Development
```bash
# Set your environment variables first, then:
npm start
```

### Docker
```bash
# Set environment variables, then:
docker-compose up
```

## Security Note

Never commit your actual API keys to version control. The `.env` file is already in `.gitignore` for security.
